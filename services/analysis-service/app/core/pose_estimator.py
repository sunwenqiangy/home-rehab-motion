"""Step 2: 关键点提取（MediaPipe Pose）"""

import logging
from typing import List, Optional

import cv2
import numpy as np

from app.core.models import Frame, Keypoint
from app.core.constants import KEYPOINT_MAP
from app.core.config import settings

logger = logging.getLogger(__name__)


class PoseEstimator:
    """MediaPipe Pose 关键点提取器"""

    def __init__(
        self,
        model_complexity: int = 1,
        sample_fps: int = 10,
        max_frames: Optional[int] = None,
        max_frame_width: Optional[int] = None,
    ):
        self.sample_fps = sample_fps
        self.max_frames = max_frames if max_frames and max_frames > 0 else None
        self.max_frame_width = max_frame_width if max_frame_width and max_frame_width > 0 else None
        self.effective_sample_fps = float(sample_fps)
        self._model_complexity = model_complexity
        self._mp_pose = None
        self._pose = None

    def _init_model(self):
        """延迟初始化 MediaPipe（避免 import 时加载）"""
        if self._pose is not None:
            return
        try:
            import mediapipe as mp
            self._mp_pose = mp.solutions.pose
            self._pose = self._mp_pose.Pose(
                static_image_mode=False,
                model_complexity=self._model_complexity,
                smooth_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            logger.info('MediaPipe Pose model initialized (complexity=%d)', self._model_complexity)
        except ImportError as exc:
            if not settings.allow_mock_keypoints_fallback:
                raise RuntimeError('mediapipe not installed and mock fallback disabled') from exc
            logger.warning('mediapipe not installed, using mock keypoints')
            self._pose = None

    def extract_frames(self, video_path: str) -> List[Frame]:
        """
        从视频中按 sample_fps 采样帧，提取关键点
        """
        self._init_model()

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error('Cannot open video: %s', video_path)
            return []

        source_fps = cap.get(cv2.CAP_PROP_FPS)
        source_fps = source_fps if source_fps > 0 else float(self.sample_fps)
        source_step = max(1, int(source_fps / self.sample_fps))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        # 限制总推理帧数而非仅限制视频文件时长：高帧率长视频会自动增大抽帧步长，
        # 既避免低配服务器被单任务耗尽，也保留完整时间范围供周期切分。
        sampled_frame_count = (total_frames + source_step - 1) // source_step if total_frames > 0 else 0
        budget_step = (total_frames + self.max_frames - 1) // self.max_frames if self.max_frames and total_frames > self.max_frames else 1
        step = max(source_step, budget_step)
        effective_fps = source_fps / step
        self.effective_sample_fps = effective_fps
        if step > source_step:
            logger.info(
                'Pose sampling capped: requested_fps=%d, source_fps=%.2f, total_frames=%d, max_frames=%d, step=%d, effective_fps=%.2f',
                self.sample_fps, source_fps, total_frames, self.max_frames, step, effective_fps,
            )
        elif sampled_frame_count:
            logger.info(
                'Pose sampling: requested_fps=%d, source_fps=%.2f, total_frames=%d, step=%d, sampled_frames=%d',
                self.sample_fps, source_fps, total_frames, step, sampled_frame_count,
            )

        frames: List[Frame] = []
        frame_index = 0

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            if frame_index % step == 0:
                timestamp = frame_index / source_fps if source_fps > 0 else 0.0
                mp_frame = self._process_frame(frame, frame_index, timestamp)
                frames.append(mp_frame)

            frame_index += 1

        cap.release()
        logger.info('Extracted %d frames from %s (total=%d, step=%d)',
                     len(frames), video_path, total_frames, step)
        return frames

    def _process_frame(self, frame: np.ndarray, frame_index: int, timestamp: float) -> Frame:
        """处理单帧，提取关键点"""
        keypoints = {}

        if self._pose is not None:
            frame = self._resize_for_pose(frame)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self._pose.process(rgb)

            if results.pose_landmarks:
                landmarks = results.pose_landmarks.landmark
                for name, idx in KEYPOINT_MAP.items():
                    lm = landmarks[idx]
                    keypoints[name] = Keypoint(
                        x=lm.x, y=lm.y, z=lm.z, visibility=lm.visibility,
                    )
        else:
            # Mock: 生成带周期性的关键点，确保无 MediaPipe 环境下也能联调动作切分
            t = frame_index / max(self.sample_fps, 1)
            motion = 0.08 * np.sin(t * np.pi)
            positions = {
                'LEFT_SHOULDER': (0.38 + motion, 0.28, -0.02),
                'RIGHT_SHOULDER': (0.62 + motion, 0.28, 0.02),
                'LEFT_HIP': (0.40, 0.56 - motion * 0.35, -0.01),
                'RIGHT_HIP': (0.60, 0.56 + motion * 0.35, 0.01),
                'LEFT_KNEE': (0.42 + motion * 0.6, 0.78, -0.01),
                'RIGHT_KNEE': (0.58 + motion * 0.6, 0.78, 0.01),
                'LEFT_ANKLE': (0.42 + motion * 0.2, 0.94, -0.01),
                'RIGHT_ANKLE': (0.58 + motion * 0.2, 0.94, 0.01),
            }
            for name in KEYPOINT_MAP:
                x, y, z = positions[name]
                keypoints[name] = Keypoint(
                    x=x,
                    y=y,
                    z=z,
                    visibility=0.9,
                )

        # 计算派生虚拟点
        hip_mid = self._compute_midpoint(keypoints.get('LEFT_HIP'), keypoints.get('RIGHT_HIP'))
        shoulder_mid = self._compute_midpoint(keypoints.get('LEFT_SHOULDER'), keypoints.get('RIGHT_SHOULDER'))

        return Frame(
            frame_index=frame_index,
            timestamp=timestamp,
            keypoints=keypoints,
            hip_mid=hip_mid,
            shoulder_mid=shoulder_mid,
        )

    def _resize_for_pose(self, frame: np.ndarray) -> np.ndarray:
        """姿态推理只需要归一化关键点，将高分辨率帧等比例缩至受控尺寸以降低 CPU 和内存峰值。"""
        if not self.max_frame_width or frame.shape[1] <= self.max_frame_width:
            return frame
        scale = self.max_frame_width / frame.shape[1]
        return cv2.resize(
            frame,
            (self.max_frame_width, max(1, int(round(frame.shape[0] * scale)))),
            interpolation=cv2.INTER_AREA,
        )

    @staticmethod
    def _compute_midpoint(kp1: Optional[Keypoint], kp2: Optional[Keypoint]) -> Optional[tuple]:
        if kp1 is None or kp2 is None:
            return None
        return (
            (kp1.x + kp2.x) / 2,
            (kp1.y + kp2.y) / 2,
            (kp1.z + kp2.z) / 2,
        )

    def compute_avg_visibility(self, frames: List[Frame]) -> float:
        """计算关键点平均可见性"""
        from app.core.constants import QUALITY_KEYPOINTS

        total_vis = 0.0
        count = 0
        for f in frames:
            for name in QUALITY_KEYPOINTS:
                kp = f.keypoints.get(name)
                if kp:
                    total_vis += kp.visibility
                    count += 1

        return total_vis / count if count > 0 else 0.0
