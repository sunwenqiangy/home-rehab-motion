import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.knee_dual_cycle import preview_knee_dual_cycle
from app.core.models import Frame, Keypoint


def _frames(lobes, duration=36, fps=10, visible=True):
    times = np.arange(0, duration, 1 / fps)
    angles = np.full(len(times), -65.0)
    for start, peak, end, amplitude in lobes:
        rise = (times >= start) & (times <= peak)
        fall = (times > peak) & (times <= end)
        angles[rise] += amplitude * (times[rise] - start) / (peak - start)
        angles[fall] += amplitude * (end - times[fall]) / (end - peak)
    frames = []
    for index, (time, degrees) in enumerate(zip(times, angles)):
        theta = math.radians(float(degrees))
        frames.append(Frame(
            frame_index=index, timestamp=float(time),
            keypoints={
                'LEFT_HIP': Keypoint(0.5, 0.5, 0, 1 if visible else 0.1),
                'LEFT_KNEE': Keypoint(0.5 + 0.2 * math.cos(theta),
                                      0.5 + 0.2 * math.sin(theta), 0,
                                      1 if visible else 0.1),
            },
        ))
    return frames


def test_two_excursions_with_intermediate_and_final_return_make_one_candidate():
    result = preview_knee_dual_cycle(
        _frames([(10, 15, 19, 25), (23, 29, 34, 35)]), 10,
    )
    assert len(result.cycles) == 1
    cycle = result.cycles[0]
    assert cycle.start_frame < cycle.first_peak_frame < cycle.middle_return_frame
    assert cycle.middle_return_frame < cycle.second_peak_frame < cycle.end_frame
    assert result.suggested_score is not None and 78 <= result.suggested_score <= 96
    assert not result.direction_verified
    assert not result.score_calibrated


def test_visible_one_sided_motion_is_an_attempt_not_a_complete_cycle():
    result = preview_knee_dual_cycle(_frames([(10, 15, 19, 25)]), 10)
    assert result.observed_motion
    assert result.attempt_count == 1
    assert result.cycles == []
    assert 78 <= result.suggested_score <= 86


def test_second_excursion_without_final_return_does_not_complete_cycle():
    result = preview_knee_dual_cycle(
        _frames([(10, 15, 19, 25), (23, 33, 40, 35)]), 10,
    )
    assert result.observed_motion
    assert result.cycles == []


def test_static_or_unobservable_video_is_not_awarded_a_score():
    static = preview_knee_dual_cycle(_frames([]), 10)
    invisible = preview_knee_dual_cycle(_frames([(10, 15, 19, 25)], visible=False), 10)
    assert not static.observed_motion and static.suggested_score is None
    assert not invisible.observed_motion and invisible.suggested_score is None
