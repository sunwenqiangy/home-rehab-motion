"""鼓励分与姿态金标准分离，低证据时不输出假零分。"""

import numpy as np

from app.core.abdominal_visual_signal import VisualSignal
from app.core.models import Rep, SegmentationCandidate, SegmentationResult
from app.core.visual_practice_score import (
    EVIDENCE_SCORE_VERSION, PRACTICE_SCORE_VERSION,
    score_visual_evidence, score_visual_practice,
)
from app.db.models import TrainingVideo, VideoEvaluationResult


def test_practice_score_version_fits_report_database_column() -> None:
    assert len(PRACTICE_SCORE_VERSION) <= VideoEvaluationResult.__table__.columns.analysis_version.type.length
    assert len(PRACTICE_SCORE_VERSION) <= TrainingVideo.__table__.columns.model_version.type.length
    assert len(EVIDENCE_SCORE_VERSION) <= VideoEvaluationResult.__table__.columns.analysis_version.type.length
    assert len(EVIDENCE_SCORE_VERSION) <= TrainingVideo.__table__.columns.model_version.type.length


def test_complete_visual_cycle_gets_separate_practice_score() -> None:
    times = [index * 0.1 for index in range(101)]
    values = np.interp(np.arange(101), [0, 10, 30, 40, 50, 80, 100],
                       [0, 0, 0.05, 0.05, 0.05, 0, 0]).tolist()
    signal = VisualSignal(values=values, timestamps=times, valid_ratio=1, median_contrast=45)
    candidate = SegmentationCandidate('accepted', 10, 40, return_frame=80,
                                      peak_start_frame=30, peak_end_frame=50)
    segmentation = SegmentationResult('abdominal_visual_v1', [Rep(1, 10, 80, {'hold': 40})],
                                      [candidate])
    reps, video = score_visual_practice(1, signal, segmentation, 0.91, True)
    assert len(reps) == 1
    assert video.valid_reps == video.total_reps == 1
    assert 70 <= video.average_score <= 100
    assert video.grade == '练习完成'
    assert video.analysis_version == PRACTICE_SCORE_VERSION
    assert video.avg_hold_duration == 2.0


def test_unobservable_visual_clip_is_recorded_without_a_numeric_score() -> None:
    reps, video = score_visual_practice(2, VisualSignal(reason='腹壁轮廓有效帧不足'),
                                       SegmentationResult('abdominal_visual_v1', []), 0.42, False)
    assert reps == []
    assert video.total_reps == 0
    assert video.grade == '未评分'
    assert video.average_score == 0


def test_evidence_candidate_scores_hold_and_return_without_claiming_probability() -> None:
    times = [index * 0.1 for index in range(101)]
    values = np.interp(np.arange(101), [0, 10, 30, 40, 50, 80, 100],
                       [0, 0, 0.05, 0.05, 0.05, 0, 0]).tolist()
    signal = VisualSignal(values=values, timestamps=times, valid_ratio=1, median_contrast=45)
    candidate = SegmentationCandidate('accepted', 10, 40, return_frame=80,
                                      peak_start_frame=30, peak_end_frame=50)
    segmentation = SegmentationResult('abdominal_visual_v1', [Rep(1, 10, 80, {'hold': 40})],
                                      [candidate])
    reps, video = score_visual_evidence(3, signal, segmentation, 0.91, True)
    assert len(reps) == 1
    assert video.analysis_version == EVIDENCE_SCORE_VERSION
    assert video.valid_reps == 1
    assert 70 <= video.average_score <= 100
    assert video.average_score == reps[0].total_score
    assert video.grade == '本段完成'


def test_evidence_candidate_never_assigns_zero_as_an_action_score() -> None:
    reps, video = score_visual_evidence(4, VisualSignal(reason='腹壁轮廓有效帧不足'),
                                        SegmentationResult('abdominal_visual_v1', []), 0.42, False)
    assert reps == []
    assert video.grade == '未评分'
    assert video.analysis_version == EVIDENCE_SCORE_VERSION


def test_evidence_score_separates_complete_cycles_by_hold_and_return() -> None:
    times = [index * 0.1 for index in range(101)]
    segmentation = SegmentationResult(
        'abdominal_visual_v1', [Rep(1, 10, 80, {'hold': 40})],
        [SegmentationCandidate('accepted', 10, 40, return_frame=80,
                               peak_start_frame=30, peak_end_frame=50)],
    )
    complete = VisualSignal(
        values=np.interp(np.arange(101), [0, 10, 30, 50, 80, 100],
                         [0, 0, 0.05, 0.05, 0, 0]).tolist(),
        timestamps=times, valid_ratio=1, median_contrast=45,
    )
    partial_return = VisualSignal(
        values=np.interp(np.arange(101), [0, 10, 30, 50, 80, 100],
                         [0, 0, 0.05, 0.05, 0.01, 0.01]).tolist(),
        timestamps=times, valid_ratio=1, median_contrast=45,
    )
    _, complete_score = score_visual_evidence(5, complete, segmentation, 0.91, True)
    _, partial_score = score_visual_evidence(6, partial_return, segmentation, 0.91, True)
    assert 70 <= partial_score.average_score < complete_score.average_score <= 100
    assert complete_score.analysis_version == partial_score.analysis_version == EVIDENCE_SCORE_VERSION
