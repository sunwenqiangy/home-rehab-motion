"""Knee-rotation dual-excursion preview.

One practice cycle is two observable excursions with an intervening return and
a final return. Camera projection may hide the *direction* of a turn, so this
module deliberately reports two excursions rather than claiming left/right.
It is diagnostic-only until independently labelled clips validate direction.
"""

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
from scipy.signal import find_peaks

from app.core.models import Frame


VERSION = 'knee_dual_excursion_preview_v1'


@dataclass
class KneeCycle:
    start_frame: int
    first_peak_frame: int
    middle_return_frame: int
    second_peak_frame: int
    end_frame: int
    first_amplitude: float
    second_amplitude: float
    middle_return_fraction: float
    final_return_fraction: float


@dataclass
class KneePreview:
    version: str = VERSION
    cycles: List[KneeCycle] = field(default_factory=list)
    observed_motion: bool = False
    attempt_count: int = 0
    suggested_score: Optional[int] = None
    reason: str = ''
    robust_range_degrees: float = 0.0
    mean_knee_visibility: float = 0.0
    direction_verified: bool = False
    score_calibrated: bool = False


def _angle_signal(frames: List[Frame]) -> tuple[np.ndarray, float, np.ndarray]:
    values = []
    visibility = []
    for frame in frames:
        hip = frame.keypoints.get('LEFT_HIP')
        knee = frame.keypoints.get('LEFT_KNEE')
        if hip and knee and min(hip.visibility, knee.visibility) >= 0.35:
            values.append(float(np.degrees(np.arctan2(knee.y - hip.y, knee.x - hip.x))))
            visibility.append(min(hip.visibility, knee.visibility))
        else:
            values.append(np.nan)
    signal = np.asarray(values, dtype=float)
    valid = np.isfinite(signal)
    if valid.sum() < max(10, int(len(signal) * 0.70)):
        return np.array([], dtype=float), float(np.mean(visibility)) if visibility else 0.0, valid
    indexes = np.arange(len(signal))
    signal = np.interp(indexes, indexes[valid], signal[valid])
    if len(signal) >= 5:
        signal = np.convolve(np.pad(signal, (2, 2), mode='edge'), np.ones(5) / 5, mode='valid')
    return signal, float(np.mean(visibility)) if visibility else 0.0, valid


def _cycle_is_observable(valid: np.ndarray, start: int, end: int, sample_fps: float) -> bool:
    interval = valid[start:end + 1]
    if not len(interval) or float(np.mean(interval)) < 0.80:
        return False
    missing = np.flatnonzero(~interval)
    if not len(missing):
        return True
    groups = np.split(missing, np.flatnonzero(np.diff(missing) > 1) + 1)
    return max(len(group) for group in groups) <= sample_fps


def _last_rise_start(signal: np.ndarray, peak: int, baseline: float, amplitude: float) -> int:
    threshold = baseline + max(2.0, amplitude * 0.18)
    below = np.flatnonzero(signal[:peak] <= threshold)
    return int(below[-1]) if len(below) else 0


def _stable_return(signal: np.ndarray, peak: int, threshold: float, fps: float) -> Optional[int]:
    stable_frames = max(2, round(0.4 * fps))
    for index in range(peak + 1, len(signal) - stable_frames + 1):
        if np.all(signal[index:index + stable_frames] <= threshold):
            return index + stable_frames - 1
    return None


def preview_knee_dual_cycle(frames: List[Frame], sample_fps: float) -> KneePreview:
    """Return conservative temporal evidence without changing the formal report."""
    result = KneePreview()
    if len(frames) < 10 or sample_fps <= 0:
        result.reason = '关键点帧不足'
        return result
    signal, result.mean_knee_visibility, valid = _angle_signal(frames)
    if not len(signal):
        result.reason = '膝部关键点不可连续观察'
        return result
    robust_range = float(np.percentile(signal, 95) - np.percentile(signal, 5))
    result.robust_range_degrees = round(robust_range, 2)
    if robust_range < 8.0:
        result.reason = '未观察到足够明确的膝部转动'
        return result
    prominence = max(4.0, robust_range * 0.17)
    peak_distance = max(1, round(2.5 * sample_fps))
    peaks, _ = find_peaks(signal, distance=peak_distance, prominence=prominence)
    peaks = [int(index) for index in peaks if _cycle_is_observable(
        valid, max(0, int(index) - round(1.5 * sample_fps)),
        min(len(signal) - 1, int(index) + round(1.5 * sample_fps)), sample_fps,
    )]
    if not peaks:
        result.reason = '角度有变化，但没有持续的旋转峰'
        return result
    result.observed_motion = True
    result.attempt_count = max(1, min(2, (len(peaks) + 1) // 2))
    used_until = -1
    for first, second in zip(peaks, peaks[1:]):
        if first <= used_until or second - first < round(2.0 * sample_fps):
            continue
        baseline_window = signal[max(0, first - round(12 * sample_fps)):first]
        if not len(baseline_window):
            continue
        baseline = float(np.percentile(baseline_window, 25))
        middle = first + int(np.argmin(signal[first + 1:second])) + 1
        first_amplitude = float(signal[first] - baseline)
        second_amplitude = float(signal[second] - signal[middle])
        if min(first_amplitude, second_amplitude) < max(6.0, robust_range * 0.25):
            continue
        middle_fraction = float((signal[first] - signal[middle]) / first_amplitude)
        if middle_fraction < 0.65:
            continue
        # A 70% drop is enough to show return motion, but the cycle endpoint
        # should wait until the knees are closer to the intervening rest level.
        return_threshold = float(signal[middle] + second_amplitude * 0.15)
        end = _stable_return(signal, second, return_threshold, sample_fps)
        if end is None:
            continue
        final_fraction = float((signal[second] - signal[end]) / second_amplitude)
        if final_fraction < 0.70:
            continue
        start = _last_rise_start(signal, first, baseline, first_amplitude)
        if not start < first < middle < second < end:
            continue
        if not _cycle_is_observable(valid, start, end, sample_fps):
            continue
        result.cycles.append(KneeCycle(
            start_frame=start, first_peak_frame=first,
            middle_return_frame=middle, second_peak_frame=second, end_frame=end,
            first_amplitude=round(first_amplitude, 2), second_amplitude=round(second_amplitude, 2),
            middle_return_fraction=round(min(1.0, middle_fraction), 3),
            final_return_fraction=round(min(1.0, final_fraction), 3),
        ))
        used_until = end
    if result.cycles:
        result.attempt_count = len(result.cycles)
        # Product feedback only: no claim that the pose proves left/right direction.
        # Use each observed pair instead of reusing the first pair's score for
        # every repetition in a longer clip.
        cycle_scores = []
        for cycle in result.cycles:
            minimum_amplitude = min(cycle.first_amplitude, cycle.second_amplitude)
            balance = minimum_amplitude / max(cycle.first_amplitude, cycle.second_amplitude)
            motion = min(1.0, minimum_amplitude / 40.0)
            return_quality = min(cycle.middle_return_fraction, cycle.final_return_fraction)
            cycle_scores.append(min(96, 78 + 8 * motion + 7 * balance + 5 * return_quality + 2))
        result.suggested_score = round(float(np.mean(cycle_scores)))
        result.reason = '观察到两次转动及回位；转动方向仍需画面或人工核对'
    elif result.observed_motion:
        motion = min(1.0, max(0.0, (robust_range - 8.0) / 32.0))
        result.suggested_score = round(78 + 8 * motion)
        result.reason = '观察到连贯转动，但双向完整周期证据不足'
    return result
