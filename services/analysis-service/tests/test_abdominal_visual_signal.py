"""腹壁代理信号的确定性测试，不依赖患者原视频。"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.abdominal_visual_signal import (  # noqa: E402
    VisualSignal, _body_edge, extract_abdominal_visual_signal, segment_abdominal_visual,
)
from app.core.models import Frame, Keypoint  # noqa: E402
from app.core.models import SegmentationResult  # noqa: E402
from app.tasks.analyze_video import _build_segmentation_snapshot  # noqa: E402


def _pose(index: int) -> Frame:
    points = {
        name: Keypoint(x=x, y=y, z=0, visibility=1)
        for name, x, y in (
            ('LEFT_SHOULDER', .25, .73), ('RIGHT_SHOULDER', .25, .73),
            ('LEFT_HIP', .49, .77), ('RIGHT_HIP', .49, .77),
        )
    }
    return Frame(index, index / 10, points)


def _picture(edge: int, contrast: int = 130) -> np.ndarray:
    image = np.full((720, 1280, 3), 180, dtype=np.uint8)
    image[edge:] = 180 - contrast
    return image


def _cycle_signal(clip_end: float = 22, cycles=((1.5, 5, 9), (12, 16.5, 21))) -> VisualSignal:
    times = np.arange(0, clip_end, 0.1)
    values = np.zeros(len(times))
    for start, peak, end in cycles:
        values += np.interp(times, [0, start, peak, end, 30], [0, 0, .06, 0, 0]) * (
            (times >= start) & (times <= end)
        )
    return VisualSignal(values.tolist(), times.tolist(), 1, 130)


def test_body_edge_measures_outward_rise_and_rejects_low_contrast():
    low = _body_edge(_picture(465), _pose(0))
    high = _body_edge(_picture(449), _pose(0))
    assert low is not None and high is not None
    assert high[0] > low[0]
    assert high[0] - low[0] > .04
    assert _body_edge(_picture(465, contrast=10), _pose(0)) is None
    invalid = _pose(0)
    invalid.keypoints['LEFT_HIP'].x = float('nan')
    assert _body_edge(_picture(465), invalid) is None


def test_two_complete_cycles_and_prep_not_counted():
    signal = _cycle_signal()
    result = segment_abdominal_visual(signal)
    assert len(result.reps) == 2
    assert [round(signal.timestamps[item.peak_frame], 1) for item in result.accepted_cycles] == [5.0, 16.5]
    assert all(signal.timestamps[item.start_frame] >= 1.5 for item in result.accepted_cycles)


def test_thirty_fps_supported_and_bad_timestamps_unobservable():
    times = np.arange(0, 10, 1 / 30)
    values = np.interp(times, [0, 1.5, 5, 8, 10], [0, 0, .06, 0, 0])
    good = VisualSignal(values.tolist(), times.tolist(), 1, 130)
    assert len(segment_abdominal_visual(good).reps) == 1
    bad = VisualSignal(values.tolist(), [0.0] * len(times), 1, 130)
    assert segment_abdominal_visual(bad).reps == []
    assert not bad.observable


def test_initial_prep_jitter_does_not_hide_later_complete_cycle():
    times = np.arange(0, 10, .1)
    values = np.interp(times, [0, 1.5, 5, 8, 10], [0, 0, .06, 0, 0])
    values[:5] += np.array([.04, -.04, .05, -.03, .03])
    signal = VisualSignal(values.tolist(), times.tolist(), 1, 130)
    result = segment_abdominal_visual(signal)
    assert len(result.reps) == 1
    assert 4 <= signal.timestamps[result.accepted_cycles[0].peak_frame] <= 6


def test_partial_and_static_clips_do_not_count():
    assert segment_abdominal_visual(_cycle_signal(4)).reps == []
    assert segment_abdominal_visual(_cycle_signal(6)).reps == []
    assert segment_abdominal_visual(_cycle_signal(19, cycles=((12, 16.5, 21),))).reps == []
    static = VisualSignal([.2] * 100, [i / 10 for i in range(100)], 1, 130)
    assert segment_abdominal_visual(static).reps == []


def test_early_complete_return_counts_but_half_return_does_not():
    times = np.arange(0, 10, .1)
    full = np.interp(times, [0, 1.5, 5, 8, 10], [0, 0, .05, 0, 0])
    half = np.interp(times, [0, 1.5, 5, 9, 10], [0, 0, .10, .05, .05])
    completed = segment_abdominal_visual(VisualSignal(full.tolist(), times.tolist(), 1, 130))
    incomplete = segment_abdominal_visual(VisualSignal(half.tolist(), times.tolist(), 1, 130))
    assert len(completed.reps) == 1
    assert incomplete.reps == []
    assert any(item.reason == '回落未接近准备基线' for item in incomplete.rejected_candidates)


def test_extraction_reports_unobservable_when_contour_is_missing(monkeypatch):
    from app.core import abdominal_visual_signal as module

    class Video:
        def __init__(self, *_):
            self.index = 0

        def isOpened(self):
            return True

        def read(self):
            self.index += 1
            return (True, _picture(465, contrast=10)) if self.index <= 40 else (False, None)

        def release(self):
            pass

    monkeypatch.setattr(module.cv2, 'VideoCapture', Video)
    result = extract_abdominal_visual_signal('unused', [_pose(i) for i in range(40)])
    assert not result.observable
    assert result.reason == '腹壁轮廓有效帧不足'


def test_extraction_processes_video_longer_than_thirty_seconds(monkeypatch):
    from app.core import abdominal_visual_signal as module

    class Video:
        def __init__(self, *_):
            self.index = 0

        def isOpened(self):
            return True

        def read(self):
            self.index += 1
            return (True, None) if self.index <= 1140 else (False, None)

        def release(self):
            pass

    monkeypatch.setattr(module.cv2, 'VideoCapture', Video)
    monkeypatch.setattr(module, '_body_edge', lambda *_: (0.1, 130))
    result = extract_abdominal_visual_signal('unused', [_pose(i) for i in range(1140)], max_seconds=300)
    assert result.observable
    assert result.valid_ratio == 1
    assert result.timestamps[-1] > 30


def test_extraction_keeps_default_thirty_second_limit():
    result = extract_abdominal_visual_signal('unused', [_pose(i) for i in range(1140)])
    assert not result.observable
    assert result.reason == '超过视觉分析时长上限（30 秒）'


def test_extraction_rejects_video_longer_than_admin_limit():
    result = extract_abdominal_visual_signal('unused', [_pose(i) for i in range(3010)], max_seconds=300)
    assert not result.observable
    assert result.reason == '超过视觉分析时长上限（300 秒）'


def test_extraction_does_not_invent_preparation_from_missing_first_frames(monkeypatch):
    from app.core import abdominal_visual_signal as module

    class Video:
        def __init__(self, *_):
            self.index = 0

        def isOpened(self):
            return True

        def read(self):
            self.index += 1
            if self.index > 100:
                return False, None
            return True, _picture(465, contrast=10 if self.index <= 15 else 130)

        def release(self):
            pass

    monkeypatch.setattr(module.cv2, 'VideoCapture', Video)
    result = extract_abdominal_visual_signal('unused', [_pose(i) for i in range(100)])
    assert not result.observable
    assert result.reason == '视频边缘缺少可见腹壁证据'


def test_visual_shadow_snapshot_keeps_formal_legacy_count():
    signal = _cycle_signal()
    visual = segment_abdominal_visual(signal)
    legacy = SegmentationResult(version='abdominal_peak_v1', reps=[])
    cycle = SegmentationResult(version='abdominal_cycle_v3', reps=[])
    snapshot = _build_segmentation_snapshot(
        action_type='abdominal_crunch', mode='shadow', effective_sample_fps=10,
        legacy_result=legacy, cycle_result=cycle, legacy_segment_ms=2, cycle_segment_ms=3,
        frame_timestamps={i: t for i, t in enumerate(signal.timestamps)},
        visual_result=visual, visual_signal=signal, visual_extract_ms=20, visual_segment_ms=4,
    )
    assert snapshot['formal_rep_count'] == 0
    assert snapshot['visual_rep_count'] == 2
    assert snapshot['visual_count_delta'] == 2
    assert snapshot['visual_accepted_cycles'][0]['peak_start_time'] < 5 < snapshot['visual_accepted_cycles'][0]['peak_end_time']
    assert snapshot['timings_ms']['shadow_overhead_ms'] == 27


def test_visual_shadow_error_is_unavailable_not_zero_repetitions():
    legacy = SegmentationResult(version='abdominal_peak_v1', reps=[])
    cycle = SegmentationResult(version='abdominal_cycle_v3', reps=[])
    snapshot = _build_segmentation_snapshot(
        action_type='abdominal_crunch', mode='shadow', effective_sample_fps=10,
        legacy_result=legacy, cycle_result=cycle, legacy_segment_ms=2, cycle_segment_ms=3,
        visual_signal=VisualSignal(reason='视觉影子算法异常'), visual_extract_ms=4,
    )
    assert snapshot['formal_rep_count'] == 0
    assert snapshot['visual_observable'] is False
    assert snapshot['visual_rep_count'] is None
    assert snapshot['visual_unavailable_reason'] == '视觉影子算法异常'
    assert snapshot['timings_ms']['shadow_overhead_ms'] == 7


def test_visual_cycles_are_preserved_when_pose_cycle_diagnostics_fail():
    signal = _cycle_signal()
    visual = segment_abdominal_visual(signal)
    snapshot = _build_segmentation_snapshot(
        action_type='abdominal_crunch', mode='shadow', effective_sample_fps=10,
        legacy_result=SegmentationResult(version='abdominal_peak_v1', reps=[]),
        cycle_result=None, legacy_segment_ms=2, cycle_segment_ms=3,
        frame_timestamps={i: t for i, t in enumerate(signal.timestamps)},
        visual_result=visual, visual_signal=signal,
    )
    assert snapshot['visual_rep_count'] == 2
    assert len(snapshot['visual_accepted_cycles']) == 2
    assert 'cycle_rep_count' not in snapshot
