"""三层置信度模型"""

import logging
from typing import List

import numpy as np

from app.core.models import Frame, ConfidenceResult

logger = logging.getLogger(__name__)


def compute_confidence(
    frames: List[Frame],
    quality_avg_visibility: float,
    total_reps: int,
    valid_reps: int,
) -> ConfidenceResult:
    """
    三层置信度计算：
    - VQS (视频质量置信度): 关键区域入镜完整度 + 帧率稳定性 + 图像清晰度
    - KCS (关键点置信度): 平均 visibility 分数 + 关键点缺失率 + 关键点轨迹平滑度
    - PRS (参数可信度): 阶段切分成功率 + 物理合理性

    综合置信度 = 0.4 * VQS + 0.35 * KCS + 0.25 * PRS
    """
    # VQS
    vqs = _compute_vqs(frames, quality_avg_visibility)

    # KCS
    kcs = _compute_kcs(frames)

    # PRS
    prs = _compute_prs(total_reps, valid_reps)

    # 综合置信度
    overall = 0.4 * vqs + 0.35 * kcs + 0.25 * prs
    overall = min(1.0, max(0.0, overall))

    # 置信度等级
    if overall >= 0.75:
        level = 'high'
    elif overall >= 0.55:
        level = 'medium'
    else:
        level = 'low'

    return ConfidenceResult(
        overall=round(overall, 3),
        video_quality=round(vqs, 3),
        keypoint_quality=round(kcs, 3),
        parameter_reliability=round(prs, 3),
        level=level,
    )


def _compute_vqs(frames: List[Frame], avg_visibility: float) -> float:
    """视频质量置信度"""
    if not frames:
        return 0.0

    # 入镜完整度（基于关键点可见性）
    visibility_score = min(1.0, avg_visibility / 0.8)

    # 帧数充足度
    frame_score = min(1.0, len(frames) / 50)

    return (visibility_score * 0.7 + frame_score * 0.3)


def _compute_kcs(frames: List[Frame]) -> float:
    """关键点置信度"""
    if not frames:
        return 0.0

    from app.core.constants import QUALITY_KEYPOINTS

    # 平均 visibility
    total_vis = 0.0
    count = 0
    for f in frames:
        for name in QUALITY_KEYPOINTS:
            kp = f.keypoints.get(name)
            if kp:
                total_vis += kp.visibility
                count += 1

    avg_vis = total_vis / count if count > 0 else 0.0

    # 关键点缺失率
    missing_count = 0
    for f in frames:
        for name in QUALITY_KEYPOINTS:
            kp = f.keypoints.get(name)
            if kp is None or (hasattr(kp, 'visibility') and kp.visibility < 0.3):
                missing_count += 1

    missing_rate = missing_count / max(1, count)
    presence_score = 1.0 - missing_rate

    # 轨迹平滑度（简化：基于帧间位移方差）
    smoothness_score = _compute_smoothness(frames)

    return avg_vis * 0.4 + presence_score * 0.3 + smoothness_score * 0.3


def _compute_smoothness(frames: List[Frame]) -> float:
    """关键点轨迹平滑度"""
    if len(frames) < 3:
        return 0.5

    from app.core.constants import QUALITY_KEYPOINTS

    displacements = []
    for i in range(1, len(frames)):
        for name in QUALITY_KEYPOINTS:
            kp_prev = frames[i - 1].keypoints.get(name)
            kp_curr = frames[i].keypoints.get(name)
            if kp_prev and kp_curr:
                dx = kp_curr.x - kp_prev.x
                dy = kp_curr.y - kp_prev.y
                displacements.append(np.sqrt(dx ** 2 + dy ** 2))

    if not displacements:
        return 0.5

    # 方差越小越平滑
    std = np.std(displacements)
    smoothness = max(0.0, 1.0 - std * 50)  # 经验缩放
    return min(1.0, smoothness)


def _compute_prs(total_reps: int, valid_reps: int) -> float:
    """参数可信度"""
    if total_reps == 0:
        return 0.2  # 没切出任何 rep，可信度很低

    # 阶段切分成功率
    segmentation_success = min(1.0, total_reps / 3)  # 至少 3 个 rep 才算正常

    # 有效 rep 比例
    validity_ratio = valid_reps / total_reps if total_reps > 0 else 0.0

    return segmentation_success * 0.5 + validity_ratio * 0.5
