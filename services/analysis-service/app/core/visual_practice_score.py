"""腹壁轮廓完整周期的本段规则分；不表示临床动作质量。"""

from typing import List, Tuple

import numpy as np
from scipy.ndimage import median_filter

from app.core.models import RepScore, SegmentationResult, VideoScore
from app.core.abdominal_visual_signal import VisualSignal


PRACTICE_SCORE_VERSION = 'abdominal_visual_practice_v1'
EVIDENCE_SCORE_VERSION = 'abdominal_visual_evidence_v1'


def _clip01(value: float) -> float:
    return max(0.0, min(1.0, value))


def score_visual_practice(
    video_id: int,
    signal: VisualSignal,
    segmentation: SegmentationResult,
    confidence_score: float,
    score_available: bool,
) -> Tuple[List[RepScore], VideoScore]:
    """只评价可观察的完整周期；不可观察时保留训练记录，不给零分。"""
    reps = segmentation.reps
    if not score_available or not reps:
        return [], VideoScore(
            video_id=video_id, total_reps=len(reps), valid_reps=0,
            average_score=0.0, grade='未评分', accuracy_avg=0.0,
            stability_avg=0.0, control_avg=0.0, duration_avg=0.0,
            avg_hold_duration=0.0, confidence_score=confidence_score,
            analysis_version=PRACTICE_SCORE_VERSION,
        )

    raw = np.asarray(signal.values, dtype=float)
    delta = float(np.median(np.diff(np.asarray(signal.timestamps, dtype=float))))
    window = max(3, int(round(0.7 / delta)) | 1)
    median = median_filter(raw, size=window, mode='nearest')
    smooth = np.convolve(np.pad(median, (window // 2, window // 2), mode='edge'),
                         np.ones(window) / window, mode='valid')
    scored: List[RepScore] = []
    for rep, candidate in zip(reps, segmentation.accepted_cycles):
        start, peak, end = candidate.start_frame, candidate.peak_frame, candidate.return_frame
        if end is None or not (0 <= start < peak < end < len(smooth)):
            continue
        plateau_start = candidate.peak_start_frame if candidate.peak_start_frame is not None else peak
        plateau_end = candidate.peak_end_frame if candidate.peak_end_frame is not None else peak
        hold_seconds = max(0.0, float(signal.timestamps[plateau_end] - signal.timestamps[plateau_start]))
        rise = smooth[start:peak + 1]
        fall = smooth[peak:end + 1]
        rise_path = float(np.sum(np.abs(np.diff(rise))))
        fall_path = float(np.sum(np.abs(np.diff(fall))))
        rise_direct = abs(float(rise[-1] - rise[0]))
        fall_direct = abs(float(fall[-1] - fall[0]))
        smoothness = _clip01((rise_direct + fall_direct) / max(rise_path + fall_path, 1e-8))
        hold_quality = _clip01(hold_seconds / 1.0)
        score = round(70.0 + 15.0 * hold_quality + 15.0 * smoothness, 1)
        scored.append(RepScore(
            rep_id=rep.id, accuracy_score=0.0,
            stability_score=round(smoothness * 100, 1),
            control_score=0.0, duration_score=round(hold_quality * 100, 1),
            total_score=score, grade='练习完成', valid_flag=True,
            hold_duration=round(hold_seconds, 2),
        ))

    if not scored:
        return score_visual_practice(video_id, signal, SegmentationResult(segmentation.version, []),
                                     confidence_score, False)
    count = len(scored)
    return scored, VideoScore(
        video_id=video_id, total_reps=count, valid_reps=count,
        average_score=round(sum(item.total_score for item in scored) / count, 1),
        grade='练习完成', accuracy_avg=0.0,
        stability_avg=round(sum(item.stability_score for item in scored) / count, 1),
        control_avg=0.0,
        duration_avg=round(sum(item.duration_score for item in scored) / count, 1),
        avg_hold_duration=round(sum(item.hold_duration for item in scored) / count, 2),
        confidence_score=confidence_score,
        analysis_version=PRACTICE_SCORE_VERSION,
    )


def score_visual_evidence(
    video_id: int,
    signal: VisualSignal,
    segmentation: SegmentationResult,
    confidence_score: float,
    score_available: bool,
) -> Tuple[List[RepScore], VideoScore]:
    """候选规则分，不是统计校准后的完成概率；只用于可信完整周期。"""
    legacy_reps, legacy_video = score_visual_practice(
        video_id, signal, segmentation, confidence_score, score_available,
    )
    if not legacy_reps:
        legacy_video.analysis_version = EVIDENCE_SCORE_VERSION
        return [], legacy_video

    raw = np.asarray(signal.values, dtype=float)
    delta = float(np.median(np.diff(np.asarray(signal.timestamps, dtype=float))))
    window = max(3, int(round(0.7 / delta)) | 1)
    median = median_filter(raw, size=window, mode='nearest')
    smooth = np.convolve(np.pad(median, (window // 2, window // 2), mode='edge'),
                         np.ones(window) / window, mode='valid')
    scored = []
    for old_score in legacy_reps:
        index = old_score.rep_id - 1
        if not 0 <= index < len(segmentation.accepted_cycles):
            continue
        cycle = segmentation.accepted_cycles[index]
        if cycle.return_frame is None:
            continue
        start, peak, end = cycle.start_frame, cycle.peak_frame, cycle.return_frame
        amplitude = abs(float(smooth[peak] - smooth[start]))
        if amplitude <= 1e-8:
            continue
        return_gap = abs(float(smooth[end] - smooth[start])) / amplitude
        hold_quality = _clip01((old_score.hold_duration - 0.5) / 2.5)
        return_quality = _clip01(1.0 - return_gap / 0.4)
        rhythm_quality = _clip01((old_score.stability_score / 100.0 - 0.75) / 0.25)
        total = round(70.0 + 10.0 * (hold_quality + return_quality + rhythm_quality), 1)
        scored.append(RepScore(
            rep_id=old_score.rep_id,
            accuracy_score=round(return_quality * 100, 1),
            stability_score=round(rhythm_quality * 100, 1),
            control_score=0.0,
            duration_score=round(hold_quality * 100, 1),
            total_score=total,
            grade='本段完成',
            valid_flag=True,
            hold_duration=old_score.hold_duration,
        ))

    if not scored:
        legacy_video.grade = '未评分'
        legacy_video.average_score = 0.0
        legacy_video.valid_reps = 0
        legacy_video.analysis_version = EVIDENCE_SCORE_VERSION
        return [], legacy_video
    count = len(scored)
    return scored, VideoScore(
        video_id=video_id, total_reps=count, valid_reps=count,
        average_score=round(sum(item.total_score for item in scored) / count, 1),
        grade='本段完成', accuracy_avg=0.0,
        stability_avg=round(sum(item.stability_score for item in scored) / count, 1),
        control_avg=0.0,
        duration_avg=round(sum(item.duration_score for item in scored) / count, 1),
        avg_hold_duration=round(sum(item.hold_duration for item in scored) / count, 2),
        confidence_score=confidence_score,
        analysis_version=EVIDENCE_SCORE_VERSION,
    )
