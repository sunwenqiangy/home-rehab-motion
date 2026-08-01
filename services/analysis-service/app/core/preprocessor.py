"""Step 3: 数据预处理 — 置信度过滤、插值、平滑、归一化"""

import logging
from typing import List

import numpy as np

from app.core.models import Frame, Keypoint

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.5
MAX_INTERPOLATE_GAP = 10  # 连续缺失帧超过此值标记为不可用段
MIN_VALID_FRAME_RATIO = 0.70
REQUIRED_KEYPOINTS = ('LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_HIP', 'RIGHT_HIP')


class DataPreprocessor:
    """数据预处理器"""

    def filter_by_confidence(self, frames: List[Frame]) -> List[Frame]:
        """置信度 < 0.5 的关键点 visibility 设为 0，标记为缺失"""
        for frame in frames:
            for name, kp in frame.keypoints.items():
                if kp.visibility < CONFIDENCE_THRESHOLD:
                    kp.visibility = 0.0
                    kp.x = float('nan')
                    kp.y = float('nan')
                    kp.z = float('nan')
        return frames

    def interpolate_missing(self, frames: List[Frame]) -> List[Frame]:
        """仅在线性插值不会跨越长缺失段时填补 NaN 关键点。"""
        kp_names = list(frames[0].keypoints.keys()) if frames else []

        for name in kp_names:
            # 各坐标轴独立收集有效点，避免某一轴缺失时被错误视为完整关键点。
            coordinates = {
                'x': [],
                'y': [],
                'z': [],
            }
            for frame in frames:
                kp = frame.keypoints.get(name)
                if not kp:
                    continue
                for axis, points in coordinates.items():
                    value = getattr(kp, axis)
                    if not np.isnan(value):
                        points.append((frame.frame_index, value))

            for axis, known_points in coordinates.items():
                self._interpolate_coord(frames, name, known_points, axis)

        # 重新计算派生点
        for f in frames:
            f.hip_mid = self._recompute_midpoint(f, 'LEFT_HIP', 'RIGHT_HIP')
            f.shoulder_mid = self._recompute_midpoint(f, 'LEFT_SHOULDER', 'RIGHT_SHOULDER')

        return frames

    def _interpolate_coord(self, frames: List[Frame], kp_name: str,
                           known_points: list, axis: str):
        """对单个坐标轴进行线性插值"""
        if len(known_points) < 2:
            return

        indices = [p[0] for p in known_points]
        values = [p[1] for p in known_points]

        frame_map = {f.frame_index: f for f in frames}

        for f in frames:
            kp = f.keypoints.get(kp_name)
            if kp is None:
                continue
            val = getattr(kp, axis)
            if not np.isnan(val):
                continue

            # 线性插值
            idx = f.frame_index
            if idx < indices[0] or idx > indices[-1]:
                continue

            # 找左右邻居
            left_idx = max(i for i in indices if i <= idx)
            right_idx = min(i for i in indices if i >= idx)

            if left_idx == right_idx:
                # 边界外的值不会进入这里；保留该分支以防重复帧索引。
                left_val = values[indices.index(left_idx)]
                setattr(kp, axis, left_val)
            else:
                missing_gap = right_idx - left_idx - 1
                if missing_gap > MAX_INTERPOLATE_GAP:
                    # 长时间遮挡或离镜不能被虚构为连续运动轨迹。
                    continue
                left_val = values[indices.index(left_idx)]
                right_val = values[indices.index(right_idx)]
                t = (idx - left_idx) / (right_idx - left_idx)
                interpolated = left_val + t * (right_val - left_val)
                setattr(kp, axis, interpolated)

            if np.isnan(kp.visibility) or kp.visibility == 0:
                kp.visibility = 0.5  # 插值的点给个中等置信度

    def smooth_trajectory(self, frames: List[Frame],
                          window_size: int = 7, poly_order: int = 3) -> List[Frame]:
        """Savitzky-Golay 滤波平滑关键点轨迹"""
        if len(frames) < window_size:
            return frames

        try:
            from scipy.signal import savgol_filter
        except ImportError:
            logger.warning('scipy not available, skipping smoothing')
            return frames

        kp_names = list(frames[0].keypoints.keys()) if frames else []

        for name in kp_names:
            xs = [f.keypoints[name].x if name in f.keypoints else float('nan') for f in frames]
            ys = [f.keypoints[name].y if name in f.keypoints else float('nan') for f in frames]

            # 仅对非 NaN 值进行平滑
            for coords, attr in [(xs, 'x'), (ys, 'y')]:
                arr = np.array(coords, dtype=float)
                valid_mask = ~np.isnan(arr)
                if valid_mask.sum() >= window_size:
                    smoothed = savgol_filter(arr[valid_mask], window_size, poly_order)
                    arr[valid_mask] = smoothed
                    for i, f in enumerate(frames):
                        if name in f.keypoints:
                            setattr(f.keypoints[name], attr, arr[i])

        return frames

    def normalize_by_body_scale(self, frames: List[Frame]) -> List[Frame]:
        """以肩宽为参考长度归一化坐标"""
        for f in frames:
            ls = f.keypoints.get('LEFT_SHOULDER')
            rs = f.keypoints.get('RIGHT_SHOULDER')
            if ls is None or rs is None:
                continue

            shoulder_width = np.sqrt(
                (ls.x - rs.x) ** 2 + (ls.y - rs.y) ** 2
            )
            if shoulder_width < 1e-6:
                continue

            scale = 1.0 / shoulder_width
            for kp in f.keypoints.values():
                kp.x *= scale
                kp.y *= scale
                kp.z *= scale

        return frames

    def normalize_initial_pose(self, frames: List[Frame]) -> List[Frame]:
        """以第一个有效帧的 hip_mid 为坐标原点，平移归一化"""
        origin = None
        for f in frames:
            if f.hip_mid is not None:
                origin = f.hip_mid
                break

        if origin is None:
            return frames

        ox, oy, oz = origin
        for f in frames:
            for kp in f.keypoints.values():
                kp.x -= ox
                kp.y -= oy
                kp.z -= oz
            if f.hip_mid:
                f.hip_mid = (f.hip_mid[0] - ox, f.hip_mid[1] - oy, f.hip_mid[2] - oz)
            if f.shoulder_mid:
                f.shoulder_mid = (f.shoulder_mid[0] - ox, f.shoulder_mid[1] - oy, f.shoulder_mid[2] - oz)

        return frames

    @staticmethod
    def _recompute_midpoint(frame: Frame, kp1_name: str, kp2_name: str):
        kp1 = frame.keypoints.get(kp1_name)
        kp2 = frame.keypoints.get(kp2_name)
        if kp1 and kp2 and not np.isnan(kp1.x) and not np.isnan(kp2.x):
            return ((kp1.x + kp2.x) / 2, (kp1.y + kp2.y) / 2, (kp1.z + kp2.z) / 2)
        return None

    def validate_required_keypoints(self, frames: List[Frame]) -> None:
        """关键躯干点长期缺失时拒绝评分，避免归一化与切分基于伪造轨迹。"""
        if not frames:
            raise ValueError('未提取到可用于分析的关键点帧')
        required = [name for name in REQUIRED_KEYPOINTS if any(name in frame.keypoints for frame in frames)]
        if not required:
            raise ValueError('缺少动作分析所需的躯干关键点')
        valid_frames = 0
        for frame in frames:
            if all(
                (kp := frame.keypoints.get(name)) is not None
                and kp.visibility >= CONFIDENCE_THRESHOLD
                and all(np.isfinite(getattr(kp, axis)) for axis in ('x', 'y', 'z'))
                for name in required
            ):
                valid_frames += 1
        valid_ratio = valid_frames / len(frames)
        if valid_ratio < MIN_VALID_FRAME_RATIO:
            raise ValueError(
                f'关键躯干点有效帧占比过低（{valid_ratio:.0%}，最低要求 {MIN_VALID_FRAME_RATIO:.0%}）'
            )

    def run_full_pipeline(self, frames: List[Frame]) -> List[Frame]:
        """执行完整预处理流水线"""
        frames = self.filter_by_confidence(frames)
        self.validate_required_keypoints(frames)
        frames = self.interpolate_missing(frames)
        frames = self.smooth_trajectory(frames)
        frames = self.normalize_by_body_scale(frames)
        frames = self.normalize_initial_pose(frames)
        logger.info('Preprocessing complete: %d frames', len(frames))
        return frames
