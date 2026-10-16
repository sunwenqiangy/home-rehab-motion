"""Experimental knee-rotation pairing from *opposite signed* knee excursions.

The vertical separation of the two knees distinguishes the two visible sides
in the side-view teaching clip. A single side must return to neutral before it
can be paired with an excursion of the opposite sign. This module deliberately
does not assign anatomical left/right names or generate a formal score.
"""

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

from app.core.models import Frame, Rep, RepScore, SegmentationCandidate, SegmentationResult, VideoScore


VERSION = 'knee_bilateral_knee_separation_preview_v2'


@dataclass
class SideExcursion:
    sign: int
    start_frame: int
    arrival_frame: int
    return_start_frame: int
    end_frame: int
    amplitude: float


@dataclass
class BilateralCycle:
    first: SideExcursion
    second: SideExcursion


@dataclass
class BilateralPreview:
    version: str = VERSION
    excursions: List[SideExcursion] = field(default_factory=list)
    cycles: List[BilateralCycle] = field(default_factory=list)
    reason: str = ''
    knee_visibility: float = 0.0
    direction_verified: bool = False
    score_calibrated: bool = False


def _smooth(values: np.ndarray, fps: float) -> np.ndarray:
    width = max(1, round(0.4 * fps))
    if width % 2 == 0:
        width += 1
    if width == 1:
        return values
    pad = width // 2
    return np.convolve(np.pad(values, (pad, pad), mode='edge'), np.ones(width) / width, mode='valid')


def _stable_neutral(signal: np.ndarray, start: int, stop: int, threshold: float, fps: float) -> bool:
    required = max(1, round(0.5 * fps))
    return stop - start >= required and np.any(
        np.convolve(
            (np.abs(signal[start:stop]) <= threshold).astype(int),
            np.ones(required, dtype=int), mode='valid',
        ) >= required
    )


def _longest_missing(valid: np.ndarray) -> int:
    missing = np.flatnonzero(~valid)
    if not len(missing):
        return 0
    groups = np.split(missing, np.flatnonzero(np.diff(missing) > 1) + 1)
    return max(len(group) for group in groups)


def preview_knee_bilateral_cycle(frames: List[Frame], sample_fps: float) -> BilateralPreview:
    result = BilateralPreview()
    if len(frames) < 10 or sample_fps <= 0:
        result.reason = '关键点帧不足'
        return result
    separation = []
    valid = []
    visibility = []
    for frame in frames:
        left = frame.keypoints.get('LEFT_KNEE')
        right = frame.keypoints.get('RIGHT_KNEE')
        confidence = min(left.visibility, right.visibility) if left and right else 0.0
        visible = confidence >= 0.4
        valid.append(visible)
        separation.append(left.y - right.y if visible else np.nan)
        if visible:
            visibility.append(confidence)
    result.knee_visibility = round(float(np.mean(visibility)), 3) if visibility else 0.0
    valid = np.asarray(valid, dtype=bool)
    if valid.mean() < 0.7:
        result.reason = '双膝不能连续观察'
        return result
    raw = np.asarray(separation, dtype=float)
    index = np.arange(len(raw))
    raw = np.interp(index, index[valid], raw[valid])
    signal = _smooth(raw, sample_fps)
    # In a side-view clip the knees nearly share a vertical coordinate at
    # rest. Use the near-zero samples as an anchor so a cropped *single-side*
    # clip cannot shift its held position into the neutral baseline. A turn
    # visible at frame zero still needs a later observed rest before counting.
    quiet_indexes = np.argsort(np.abs(signal))[:max(3, round(len(signal) * 0.25))]
    baseline = float(np.median(signal[quiet_indexes]))
    signal -= baseline
    onset = max(0.025, float(np.percentile(np.abs(signal), 90)) * 0.20)
    neutral = onset * 0.55
    min_amplitude = max(0.032, onset * 1.15)
    min_samples = max(2, round(0.8 * sample_fps))
    max_missing = max(1, round(0.8 * sample_fps))
    for sign in (1, -1):
        active = sign * signal >= onset
        indexes = np.flatnonzero(active)
        if not len(indexes):
            continue
        groups = np.split(indexes, np.flatnonzero(np.diff(indexes) > 1) + 1)
        for group in groups:
            first, last = int(group[0]), int(group[-1])
            if last - first + 1 < min_samples:
                continue
            search_left = max(0, first - round(4.0 * sample_fps))
            if not _stable_neutral(signal, search_left, first, neutral, sample_fps):
                continue
            search_right = min(len(signal), last + 1 + round(5.0 * sample_fps))
            if not _stable_neutral(signal, last + 1, search_right, neutral, sample_fps):
                continue
            start_candidates = np.flatnonzero(np.abs(signal[search_left:first]) <= neutral)
            end_candidates = np.flatnonzero(np.abs(signal[last + 1:search_right]) <= neutral)
            start = search_left + int(start_candidates[-1])
            end = last + 1 + int(end_candidates[0])
            if _longest_missing(valid[start:end + 1]) > max_missing:
                continue
            peak = first + int(np.argmax(sign * signal[first:last + 1]))
            amplitude = float(sign * signal[peak])
            if amplitude < min_amplitude:
                continue
            arrival_band = np.flatnonzero(sign * signal[first:last + 1] >= amplitude * 0.75)
            peak_band = np.flatnonzero(sign * signal[first:last + 1] >= amplitude * 0.95)
            arrival = first + int(arrival_band[0])
            return_start = first + int(peak_band[-1])
            if not start < arrival <= peak <= return_start < end:
                continue
            result.excursions.append(SideExcursion(
                sign, start, arrival, return_start, end, round(amplitude, 4),
            ))
    result.excursions.sort(key=lambda event: event.start_frame)
    pending: Optional[SideExcursion] = None
    for event in result.excursions:
        if pending is None:
            pending = event
            continue
        gap = (event.start_frame - pending.end_frame) / sample_fps
        if event.sign != pending.sign and 0 <= gap <= 20:
            result.cycles.append(BilateralCycle(pending, event))
            pending = None
        else:
            pending = event
    result.reason = ('观察到两侧相反方向转动及各自回正' if result.cycles else
                     '仅观察到单侧或不完整转动' if result.excursions else
                     '未观察到可确认的侧向转动及回正')
    return result


def to_segmentation_result(preview: BilateralPreview) -> SegmentationResult:
    """Convert reviewed side pairs to the existing persistence contract."""
    reps = []
    candidates = []
    for index, cycle in enumerate(preview.cycles, start=1):
        reps.append(Rep(index, cycle.first.start_frame, cycle.second.end_frame, {
            'first_arrival': cycle.first.arrival_frame,
            'middle_return': cycle.first.end_frame,
            'hold': cycle.second.arrival_frame,
            'second_return_start': cycle.second.return_start_frame,
        }))
        candidates.append(SegmentationCandidate(
            state='COMPLETE_BILATERAL', start_frame=cycle.first.start_frame,
            peak_frame=cycle.second.arrival_frame, return_frame=cycle.second.end_frame,
            stable_frame=cycle.second.end_frame,
            amplitude=round(min(cycle.first.amplitude, cycle.second.amplitude), 4),
            peak_start_frame=cycle.second.arrival_frame,
            peak_end_frame=cycle.second.return_start_frame,
        ))
    return SegmentationResult(VERSION, reps, accepted_cycles=candidates)


def score_knee_bilateral(
    video_id: int, preview: BilateralPreview, frames: List[Frame],
    confidence_score: float, score_available: bool,
) -> tuple[List[RepScore], VideoScore]:
    """Motivational video score; it does not grade medical recovery or joint range."""
    scored = []
    if score_available:
        for index, cycle in enumerate(preview.cycles, start=1):
            low = min(cycle.first.amplitude, cycle.second.amplitude)
            high = max(cycle.first.amplitude, cycle.second.amplitude)
            amplitude_quality = min(1.0, low / 0.07)
            balance = low / high if high > 0 else 0.0
            hold_seconds = sum(
                frames[side.return_start_frame].timestamp - frames[side.arrival_frame].timestamp
                for side in (cycle.first, cycle.second)
            ) / 2
            hold_quality = min(1.0, max(0.0, hold_seconds / 3.0))
            duration = frames[cycle.second.end_frame].timestamp - frames[cycle.first.start_frame].timestamp
            rhythm = max(0.0, 1.0 - abs(duration - 22.0) / 22.0)
            total = round(min(94.0, 72 + 8 * amplitude_quality + 5 * balance +
                              4 * hold_quality + 3 * rhythm), 1)
            scored.append(RepScore(
                rep_id=index, accuracy_score=round(60 * amplitude_quality + 40 * balance, 1),
                stability_score=round(hold_quality * 100, 1),
                control_score=100.0, duration_score=round(rhythm * 100, 1),
                total_score=total, grade='优秀' if total >= 90 else '合格',
                valid_flag=True, hold_duration=round(hold_seconds, 2),
            ))
    count = len(scored)
    average = round(sum(rep.total_score for rep in scored) / count, 1) if count else 0.0
    return scored, VideoScore(
        video_id=video_id, total_reps=len(preview.cycles), valid_reps=count,
        average_score=average,
        grade=('优秀' if average >= 90 else '合格') if count else '未评分',
        accuracy_avg=round(sum(rep.accuracy_score for rep in scored) / count, 1) if count else 0.0,
        stability_avg=round(sum(rep.stability_score for rep in scored) / count, 1) if count else 0.0,
        control_avg=round(sum(rep.control_score for rep in scored) / count, 1) if count else 0.0,
        duration_avg=round(sum(rep.duration_score for rep in scored) / count, 1) if count else 0.0,
        avg_hold_duration=round(sum(rep.hold_duration for rep in scored) / count, 2) if count else 0.0,
        advice_summary=([{'advice_code': 'KNEE_BILATERAL_OBSERVED',
                          'patient_text': '已记录两侧转动与回正，继续按舒适幅度练习。'}]
                        if count else []),
        confidence_score=confidence_score, analysis_version=VERSION,
    )
