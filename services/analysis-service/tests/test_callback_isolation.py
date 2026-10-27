from app.core.config import settings
from app.tasks.analyze_video import analyze_video, retry_pending_callbacks
from app.tasks.celery_app import celery_app


def test_analysis_task_has_a_hard_timeout_after_the_soft_timeout():
    assert analyze_video.soft_time_limit == settings.analysis_timeout_seconds
    assert analyze_video.time_limit == settings.analysis_hard_timeout_seconds
    assert analyze_video.time_limit > analyze_video.soft_time_limit


def test_callback_retry_is_routed_to_its_own_expiring_queue():
    route = celery_app.conf.task_routes['analysis.retry_pending_callbacks']
    schedule = celery_app.conf.beat_schedule['retry-pending-callbacks-every-minute']

    assert route['queue'] == 'callbacks'
    assert schedule['options']['queue'] == 'callbacks'
    assert schedule['options']['expires'] == settings.callback_task_expires_seconds
    assert retry_pending_callbacks.soft_time_limit == settings.callback_task_soft_time_limit_seconds
    assert retry_pending_callbacks.time_limit == settings.callback_task_time_limit_seconds
    assert retry_pending_callbacks.time_limit < schedule['options']['expires']
