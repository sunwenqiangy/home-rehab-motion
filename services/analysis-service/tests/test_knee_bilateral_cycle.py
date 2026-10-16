import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.knee_bilateral_cycle import (
    preview_knee_bilateral_cycle, score_knee_bilateral, to_segmentation_result,
)
from app.core.models import Frame, Keypoint


def _frames(lobes, duration=40, fps=10, visible=True):
    times = np.arange(0, duration, 1 / fps)
    signed = np.zeros(len(times))
    for start, peak, end, amplitude in lobes:
        rise = (times >= start) & (times <= peak)
        fall = (times > peak) & (times <= end)
        signed[rise] += amplitude * (times[rise] - start) / (peak - start)
        signed[fall] += amplitude * (end - times[fall]) / (end - peak)
    visibility = 1 if visible else 0.1
    return [Frame(index, float(time), {
        'LEFT_KNEE': Keypoint(0.5, 0.5 + float(value) / 2, 0, visibility),
        'RIGHT_KNEE': Keypoint(0.5, 0.5 - float(value) / 2, 0, visibility),
    }) for index, (time, value) in enumerate(zip(times, signed))]


def test_opposite_sides_with_stable_returns_form_one_cycle():
    frames = _frames([(10, 14, 18, 0.08), (23, 28, 34, -0.08)])
    preview = preview_knee_bilateral_cycle(frames, 10)
    assert len(preview.excursions) == 2
    assert len(preview.cycles) == 1
    first, second = preview.cycles[0].first, preview.cycles[0].second
    assert first.sign == 1 and second.sign == -1
    assert first.start_frame < first.arrival_frame <= first.return_start_frame < first.end_frame
    assert first.end_frame < second.start_frame
    assert not preview.direction_verified and not preview.score_calibrated
    segmentation = to_segmentation_result(preview)
    assert len(segmentation.reps) == 1
    assert segmentation.version == preview.version
    rep_scores, video_score = score_knee_bilateral(1, preview, frames, 0.9, True)
    assert len(rep_scores) == 1 and video_score.valid_reps == 1
    assert 80 <= video_score.average_score <= 96
    assert video_score.analysis_version == segmentation.version


def test_one_side_and_same_side_repetition_never_complete_a_bilateral_cycle():
    one = preview_knee_bilateral_cycle(_frames([(10, 14, 18, 0.08)]), 10)
    same = preview_knee_bilateral_cycle(
        _frames([(10, 14, 18, 0.08), (23, 28, 34, 0.08)]), 10,
    )
    assert len(one.excursions) == 1 and not one.cycles
    assert len(same.excursions) == 2 and not same.cycles


def test_initial_preparation_is_not_counted_without_prior_neutral():
    preview = preview_knee_bilateral_cycle(
        _frames([(0, 1, 5, -0.10), (10, 14, 18, 0.08), (23, 28, 34, -0.08)]), 10,
    )
    assert len(preview.cycles) == 1
    assert preview.cycles[0].first.start_frame >= 90


def test_incomplete_final_return_and_static_or_hidden_knees_are_not_counted():
    incomplete = preview_knee_bilateral_cycle(
        _frames([(10, 14, 18, 0.08), (23, 35, 44, -0.08)]), 10,
    )
    static = preview_knee_bilateral_cycle(_frames([]), 10)
    hidden = preview_knee_bilateral_cycle(
        _frames([(10, 14, 18, 0.08), (23, 28, 34, -0.08)], visible=False), 10,
    )
    assert not incomplete.cycles
    assert not static.cycles
    assert not hidden.cycles
