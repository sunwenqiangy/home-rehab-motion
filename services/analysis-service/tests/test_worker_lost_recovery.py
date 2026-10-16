"""原生 worker 崩溃后的终态落库与旧任务隔离。"""

import importlib
import sys
import types
from contextlib import contextmanager

from billiard.exceptions import WorkerLostError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.models import AnalysisRun, AnalysisTask, Base, TrainingVideo
from app.tasks.analyze_video import _mark_worker_lost_failed, analyze_video


def _session_with_processing_task() -> Session:
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    session = Session(engine)
    session.add_all([
        TrainingVideo(video_id=403, user_id=1, action_type='abdominal', analysis_status='processing'),
        AnalysisTask(
            task_id=1, video_id=403, provider_task_id='current-task', analysis_run_id='current-run',
            task_status='processing', progress_stage='keypoint_extraction',
        ),
        AnalysisRun(analysis_run_id='current-run', video_id=403, status='processing'),
    ])
    session.flush()
    return session


def test_worker_lost_marks_current_task_video_and_run_failed() -> None:
    session = _session_with_processing_task()
    try:
        assert _mark_worker_lost_failed(session, 403, 'current-run', 'current-task', '分析进程意外退出')
        session.flush()
        task = session.get(AnalysisTask, 1)
        video = session.get(TrainingVideo, 403)
        run = session.get(AnalysisRun, 'current-run')
        assert task.task_status == 'failed'
        assert task.progress_stage is None
        assert video.analysis_status == 'failed'
        assert run.status == 'failed'
        assert run.finished_at is not None
    finally:
        session.close()


def test_worker_lost_does_not_overwrite_new_run_or_completed_task() -> None:
    session = _session_with_processing_task()
    try:
        assert not _mark_worker_lost_failed(session, 403, 'old-run', 'old-task', 'stale failure')
        assert session.get(AnalysisTask, 1).task_status == 'processing'

        session.get(AnalysisTask, 1).task_status = 'completed'
        session.get(TrainingVideo, 403).analysis_status = 'completed'
        assert not _mark_worker_lost_failed(session, 403, 'current-run', 'current-task', 'late failure')
        assert session.get(TrainingVideo, 403).analysis_status == 'completed'
    finally:
        session.close()


def test_worker_lost_is_not_requeued_indefinitely() -> None:
    assert analyze_video.reject_on_worker_lost is False


def test_worker_lost_signal_persists_failure_and_notifies(monkeypatch) -> None:
    task_module = importlib.import_module('app.tasks.analyze_video')
    session = _session_with_processing_task()
    callbacks = []

    @contextmanager
    def fake_session_scope():
        yield session
        session.commit()

    fake_db_session = types.ModuleType('app.db.session')
    fake_db_session.sync_session_scope = fake_session_scope
    monkeypatch.setitem(sys.modules, 'app.db.session', fake_db_session)
    monkeypatch.setattr(task_module, '_notify_callback', lambda *args, **kwargs: callbacks.append((args, kwargs)))
    try:
        task_module._on_worker_lost(
            sender=analyze_video,
            task_id='current-task',
            exception=WorkerLostError('SIGABRT'),
            kwargs={'video_id': 403, 'analysis_run_id': 'current-run', 'callback_url': None},
        )
        assert session.get(AnalysisTask, 1).task_status == 'failed'
        assert len(callbacks) == 1
        assert callbacks[0][0][4] == 'failed'
    finally:
        session.close()
