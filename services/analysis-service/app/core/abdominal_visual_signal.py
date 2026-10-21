"""侧视缩腹的腹壁外缘代理信号；仅用于影子诊断，不代表肌肉收缩强度。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

import cv2
import numpy as np
from scipy.ndimage import median_filter
from scipy.signal import find_peaks

from app.core.models import Frame, Rep, SegmentationCandidate, SegmentationResult


VISUAL_VERSION = 'abdominal_visual_v1'


@dataclass
class VisualSignal:
    values: List[float] = field(default_factory=list)
    timestamps: List[float] = field(default_factory=list)
    valid_ratio: float = 0.0
    median_contrast: float = 0.0
    reason: str = ''

    @property
    def observable(self) -> bool:
        return not self.reason and len(self.values) >= 30


@dataclass
class VisualSignalCollector:
    """在姿态提取的同一次顺序解码中收集腹壁轮廓信号。

    旧实现为了拿到原始像素，会在 MediaPipe 完成后再次从头读取完整视频。这里
    只保留每个已抽样姿态帧的轻量数值，避免缓存整帧图像，也避免第二次解码。
    """

    max_seconds: float = 30.0
    values: List[float] = field(default_factory=list)
    contrasts: List[float] = field(default_factory=list)
    timestamps: List[float] = field(default_factory=list)
    source_exceeded_limit: bool = False

    def add_sample(self, image: np.ndarray, pose: Frame) -> None:
        self.timestamps.append(pose.timestamp)
        if pose.timestamp > self.max_seconds:
            self.source_exceeded_limit = True
            self.values.append(float('nan'))
            return
        measurement = _body_edge(image, pose)
        if measurement is None:
            self.values.append(float('nan'))
            return
        value, contrast = measurement
        self.values.append(value)
        self.contrasts.append(contrast)

    def build(self, poses: List[Frame]) -> VisualSignal:
        if len(poses) < 30:
            return VisualSignal(reason='姿态帧不足')
        if poses[-1].timestamp > self.max_seconds or self.source_exceeded_limit:
            return VisualSignal(reason=f'超过视觉分析时长上限（{self.max_seconds:g} 秒）')
        if len(self.values) != len(poses):
            return VisualSignal(reason='原视频未覆盖全部姿态帧')
        return _build_visual_signal(self.values, self.contrasts, self.timestamps)


def _body_edge(image: np.ndarray, pose: Frame) -> tuple[float, float] | None:
    """在随肩髋移动的狭窄腹部 ROI 内测暗色衣物/亮色背景边界。"""
    landmarks = [pose.keypoints.get(name) for name in
                 ('LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_HIP', 'RIGHT_HIP')]
    if any(point is None or not np.isfinite((point.x, point.y, point.visibility)).all()
           or point.visibility < 0.5 for point in landmarks):
        return None
    shoulder_x = (landmarks[0].x + landmarks[1].x) / 2
    shoulder_y = (landmarks[0].y + landmarks[1].y) / 2
    hip_x = (landmarks[2].x + landmarks[3].x) / 2
    hip_y = (landmarks[2].y + landmarks[3].y) / 2
    height, width = image.shape[:2]
    span = abs(hip_x - shoulder_x) * width
    if span < width * 0.08 or span > width * 0.60:
        return None
    center_x = (shoulder_x + 0.68 * (hip_x - shoulder_x)) * width
    center_y = (shoulder_y + hip_y) * height / 2
    y_low = int(center_y - 0.35 * span)
    y_high = int(center_y - 0.015 * span)
    if y_low < 0 or y_high >= height or y_high - y_low < 18:
        return None
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = []
    contrasts = []
    columns = np.linspace(center_x - 0.018 * span, center_x + 0.018 * span, 7)
    for column in columns:
        x = int(round(column))
        if x < 0 or x >= width:
            continue
        background_y = int(center_y - 0.33 * span)
        shirt_y = int(center_y - 0.07 * span)
        background = float(np.median(gray[max(0, background_y - 2):background_y + 3,
                                          max(0, x - 2):x + 3]))
        shirt = float(np.median(gray[max(0, shirt_y - 2):shirt_y + 3,
                                     max(0, x - 2):x + 3]))
        contrast = background - shirt
        if contrast < 25:
            continue
        threshold = (background + shirt) / 2
        dark = gray[y_low:y_high + 1, x] < threshold
        for offset in range(0, len(dark) - 5):
            if bool(np.all(dark[offset:offset + 6])):
                edges.append(y_low + offset)
                contrasts.append(contrast)
                break
    if len(edges) < 5:
        return None
    # 以躯干中心为参考，消除画面平移；图像 y 向下，故取负号使隆起为正。
    return (center_y - float(np.median(edges))) / span, float(np.median(contrasts))


def extract_abdominal_visual_signal(video_path: str, poses: List[Frame], max_seconds: float = 30.0) -> VisualSignal:
    """顺序二次解码、按已提取姿态的源帧号采样，不再次运行姿态模型。"""
    if len(poses) < 30:
        return VisualSignal(reason='姿态帧不足')
    if poses[-1].timestamp > max_seconds:
        return VisualSignal(reason=f'超过视觉分析时长上限（{max_seconds:g} 秒）')
    source_indices = [pose.frame_index for pose in poses]
    if source_indices != sorted(set(source_indices)):
        return VisualSignal(reason='姿态帧序号异常')
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return VisualSignal(reason='原视频不可读取')
    collector = VisualSignalCollector(max_seconds=max_seconds)
    pose_pos = 0
    source_index = 0
    try:
        while pose_pos < len(poses):
            ok, image = cap.read()
            if not ok:
                break
            if source_index == source_indices[pose_pos]:
                collector.add_sample(image, poses[pose_pos])
                pose_pos += 1
            source_index += 1
    finally:
        cap.release()
    if pose_pos < len(poses):
        return VisualSignal(reason='原视频未覆盖全部姿态帧')
    return collector.build(poses)


def _build_visual_signal(values: List[float], contrasts: List[float], timestamps: List[float]) -> VisualSignal:
    """将同一解码轮次内取得的 ROI 测量值转换为稳定的视觉信号。"""
    arr = np.asarray(values, dtype=float)
    valid = np.isfinite(arr)
    valid_ratio = float(valid.mean())
    quality = VisualSignal(valid_ratio=valid_ratio,
                           median_contrast=float(np.median(contrasts)) if contrasts else 0.0)
    if valid_ratio < 0.85:
        quality.reason = '腹壁轮廓有效帧不足'
    elif np.flatnonzero(valid)[0] > 2 or len(arr) - 1 - np.flatnonzero(valid)[-1] > 2:
        quality.reason = '视频边缘缺少可见腹壁证据'
    elif np.max(np.diff(np.flatnonzero(valid))) > 3:
        quality.reason = '腹壁轮廓连续丢失'
    else:
        quality.values = np.interp(np.arange(len(arr)), np.flatnonzero(valid), arr[valid]).tolist()
        quality.timestamps = timestamps
    return quality


def _build_candidate(smooth: np.ndarray, peak: int, left_bound: int,
                     right_bound: int, stable: int) -> SegmentationCandidate:
    """从峰两侧定位最近的准备低谷、回稳低谷与高位平台。"""
    left_slice = smooth[left_bound:peak - stable + 1]
    right_slice = smooth[peak + stable:right_bound + 1]
    left_low = float(np.min(left_slice))
    right_low = float(np.min(right_slice))
    left_near = np.flatnonzero(left_slice <= left_low + max(0.003, (smooth[peak] - left_low) * 0.10))
    right_near = np.flatnonzero(right_slice <= right_low + max(0.001, (smooth[peak] - right_low) * 0.02))
    # 平坦准备区取最后一个低点，平坦回稳区取第一个低点。
    left = left_bound + int(left_near[-1])
    right = peak + stable + int(right_near[0])
    amplitude = min(float(smooth[peak] - smooth[left]), float(smooth[peak] - smooth[right]))
    candidate = SegmentationCandidate(state='candidate', start_frame=left, peak_frame=peak,
                                      return_frame=right, amplitude=amplitude)
    platform_threshold = float(smooth[peak]) - 0.2 * amplitude
    platform_start = peak
    platform_end = peak
    while platform_start > left and smooth[platform_start - 1] >= platform_threshold:
        platform_start -= 1
    while platform_end < right and smooth[platform_end + 1] >= platform_threshold:
        platform_end += 1
    candidate.peak_start_frame = platform_start
    candidate.peak_end_frame = platform_end
    return candidate


def _candidate_rejection_reason(candidate: SegmentationCandidate, smooth: np.ndarray,
                                times: np.ndarray, stable: int, prominence_floor: float) -> str:
    """按证据顺序给出首个拒绝理由；空串表示完整周期。"""
    left = candidate.start_frame
    peak = candidate.peak_frame
    right = candidate.return_frame
    rise = float(smooth[peak] - smooth[left])
    fall = float(smooth[peak] - smooth[right])
    if rise < prominence_floor or fall < prominence_floor:
        return '隆起或回落幅度不足'
    if times[peak] - times[left] < 0.8 or times[right] - times[peak] < 0.8:
        return '隆起或回落时长不足'
    if times[right] - times[left] < 2.5:
        return '完整周期过短'
    if smooth[right] - smooth[left] > max(0.008, rise * 0.40):
        return '回落未接近准备基线'
    if left == 0 or right + stable > len(smooth):
        return '准备或回落被视频边界截断'
    if float(np.ptp(smooth[max(0, left - stable):left + stable])) > max(0.012, rise * 0.35):
        return '准备阶段未稳定'
    if float(np.ptp(smooth[right:right + stable])) > max(0.003, fall * 0.12):
        return '回落阶段未稳定'
    return ''


def segment_abdominal_visual(signal: VisualSignal) -> SegmentationResult:
    """高位平台两侧均需有低谷和回稳证据，时间尺度按实际采样时间换算。"""
    result = SegmentationResult(version=VISUAL_VERSION, reps=[])
    if not signal.observable:
        return result
    times = np.asarray(signal.timestamps, dtype=float)
    if len(times) != len(signal.values) or not np.isfinite(times).all() or not np.isfinite(signal.values).all():
        signal.reason = '视觉信号或时间戳无效'
        return result
    intervals = np.diff(times)
    delta = float(np.median(intervals))
    if not (0.015 <= delta <= 0.5) or np.any(intervals <= 0):
        signal.reason = '姿态采样间隔不支持'
        return result
    raw = np.asarray(signal.values, dtype=float)
    window = max(3, int(round(0.7 / delta)) | 1)
    smooth = np.convolve(median_filter(raw, size=window, mode='nearest'),
                         np.ones(window) / window, mode='same')
    # convolution 边界不能引入人为的峰；使用原信号局部中位数修正。
    half = window // 2
    for i in list(range(half)) + list(range(len(raw) - half, len(raw))):
        smooth[i] = float(np.median(raw[max(0, i - half):min(len(raw), i + half + 1)]))
    prep_count = max(3, int(round(1.5 / delta)))
    prep_window = max(3, int(round(0.6 / delta)))
    prep_count = min(prep_count, len(smooth))
    # 片头机位/姿态抖动不应抬高整段噪声门槛；从准备段取最稳定的 0.6 秒。
    prep_noise = min(float(np.std(smooth[i:i + prep_window]))
                     for i in range(max(1, prep_count - prep_window + 1)))
    prominence_floor = max(0.018, 3 * prep_noise)
    peaks, _ = find_peaks(smooth, distance=max(1, round(3.5 / delta)),
                          prominence=prominence_floor)
    search = max(1, int(round(8.0 / delta)))
    stable = max(3, int(round(0.5 / delta)))
    previous_end = -1
    for peak in peaks:
        left_bound = max(0, peak - search, previous_end + 1)
        right_bound = min(len(raw) - 1, peak + search)
        if peak - left_bound < stable or right_bound - peak < stable:
            continue
        candidate = _build_candidate(smooth, int(peak), left_bound, right_bound, stable)
        candidate.reason = _candidate_rejection_reason(candidate, smooth, times, stable, prominence_floor)
        if not candidate.reason:
            candidate.state = 'accepted'
            result.reps.append(Rep(id=len(result.reps) + 1, start_frame=candidate.start_frame,
                                   end_frame=candidate.return_frame,
                                   phases={'hold': int(peak)}))
            result.accepted_cycles.append(candidate)
            previous_end = candidate.return_frame
        else:
            result.rejected_candidates.append(candidate)
    return result
