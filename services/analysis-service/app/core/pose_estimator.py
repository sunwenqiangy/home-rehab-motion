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

    # 允许容器元数据与最终可读帧存在极小尾差，超过该比例即不应把截断画面用于评分。
    MIN_DECODE_COMPLETION_RATIO = 0.95

    def __init__(
        self,
        model_complexity: int = 1,
        sample_fps: int = 10,
        max_frames: Optional[int] = None,
        max_frame_width: Optional[int] = None,
        exact_sample_timestamps: bool = False,
    ):
        self.sample_fps = sample_fps
        self.max_frames = max_frames if max_frames and max_frames > 0 else None
        self.max_frame_width = max_frame_width if max_frame_width and max_frame_width > 0 else None
        # 固定节奏采样按视频时间戳而非源帧序号取样，用于要求跨视频长度保持
        # 一致时序分辨率的动作；不会增加帧预算，只消除 source_fps 整除取步长的漂移。
        self.exact_sample_timestamps = exact_sample_timestamps
        self.effective_sample_fps = float(sample_fps)
        # 解码完整性用于防止容器元数据声明的时长远长于实际可读取画面时，
        # 将一段截断视频误当作完整训练视频进行计数和评分。
        self.source_duration_seconds = 0.0
        self.decoded_duration_seconds = 0.0
        self.decode_completion_ratio = 1.0
        self._model_complexity = model_complexity
        self._mp_pose = None
        self._pose = None

    def _init_model(self):
        """延迟初始化 MediaPipe（避免 import 时加载）。"""
        if self._pose is not None:
            return
        try:
            # OpenCV 会按宿主机核数创建线程池；在单 Worker、限 1 CPU 的容器中
            # 反而造成调度竞争和内存峰值。推理逐帧执行，因此固定为受控线程数。
            cv2.setNumThreads(max(1, settings.native_thread_count))
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

    @property
    def has_complete_decode(self) -> bool:
        """视频元数据可用时，确认实际解码已覆盖几乎完整的时长。"""
        return (
            self.source_duration_seconds <= 0
            or self.decode_completion_ratio >= self.MIN_DECODE_COMPLETION_RATIO
        )

    def extract_frames(self, video_path: str) -> List[Frame]:
        """
        从视频中按 sample_fps 采样帧，提取关键点
        """
        self.source_duration_seconds = 0.0
        self.decoded_duration_seconds = 0.0
        self.decode_completion_ratio = 1.0
        self._init_model()

        # FFMPEG 解码由 VideoCapture 逐帧输出；通过 OpenCV 的原生线程限制避免
        # 单个分析任务把 2C2G 实例的所有 CPU 核心占满。
        cv2.setNumThreads(max(1, settings.native_thread_count))
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error('Cannot open video: %s', video_path)
            self._close_model()
            return []

        source_fps = cap.get(cv2.CAP_PROP_FPS)
        source_fps = source_fps if source_fps > 0 else float(self.sample_fps)
        source_step = max(1, int(source_fps / self.sample_fps))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.source_duration_seconds = max(0.0, (total_frames - 1) / source_fps) if total_frames > 1 else 0.0
        # 限制总推理帧数而非仅限制视频文件时长：高帧率长视频会自动增大抽帧步长，
        # 既避免低配服务器被单任务耗尽，也保留完整时间范围供周期切分。
        budget_step = (total_frames + self.max_frames - 1) // self.max_frames if self.max_frames and total_frames > self.max_frames else 1
        step = max(source_step, budget_step)

        frames: List[Frame] = []
        frame_index = 0
        next_sample_timestamp = 0.0
        sample_interval = 1.0 / max(self.sample_fps, 1)
        if self.exact_sample_timestamps and self.max_frames and total_frames > 1:
            # 固定时间戳模式也必须覆盖整段视频。不能在前 max_frames 个采样点后
            # 静默停止，否则高采样率长视频会只分析开头一段。将实际间隔放宽到帧预算
            # 可承载的最小值，后续由 effective_sample_fps 如实记录实际抽样率。
            duration_seconds = (total_frames - 1) / source_fps
            max_budget_fps = max(1, self.max_frames - 1) / max(duration_seconds, 1e-6)
            sample_interval = max(sample_interval, 1.0 / max_budget_fps)

        try:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                timestamp = frame_index / source_fps if source_fps > 0 else 0.0
                if self.exact_sample_timestamps:
                    # 固定节奏模式不依赖整数 source_step。长短视频均使用同一个时间间隔，
                    # 同时严格遵守帧预算，保证最长 300 秒骨盆倾斜视频也能完整分析。
                    should_sample = timestamp + 1e-9 >= next_sample_timestamp
                    if should_sample and (not self.max_frames or len(frames) < self.max_frames):
                        frames.append(self._process_frame(frame, frame_index, timestamp))
                        next_sample_timestamp += sample_interval
                elif frame_index % step == 0:
                    frames.append(self._process_frame(frame, frame_index, timestamp))

                frame_index += 1
        finally:
            cap.release()
            # MediaPipe 的 Python 封装不会立即回收底层图、纹理和临时张量；每个
            # Celery 子进程只处理一个任务时显式 close 能显著降低任务尾部的内存峰值。
            self._close_model()
        if len(frames) >= 2:
            self.effective_sample_fps = (len(frames) - 1) / (frames[-1].timestamp - frames[0].timestamp)
            self.decoded_duration_seconds = max(0.0, frames[-1].timestamp - frames[0].timestamp)
        else:
            self.effective_sample_fps = float(self.sample_fps)
            self.decoded_duration_seconds = 0.0
        self.decode_completion_ratio = (
            min(1.0, self.decoded_duration_seconds / self.source_duration_seconds)
            if self.source_duration_seconds > 0
            else 1.0
        )
        sampling_mode = (
            f'timestamp_interval={sample_interval:.4f}s'
            if self.exact_sample_timestamps else f'step={step}'
        )
        logger.info(
            'Extracted %d frames from %s (total=%d, requested_fps=%d, mode=%s, effective_fps=%.2f, '
            'source_duration=%.2fs, decoded_duration=%.2fs, decode_completion=%.3f)',
            len(frames), video_path, total_frames, self.sample_fps, sampling_mode, self.effective_sample_fps,
            self.source_duration_seconds, self.decoded_duration_seconds, self.decode_completion_ratio,
        )
        return frames

    def _close_model(self) -> None:
        """显式释放 MediaPipe 的底层图资源，允许异常路径也及时归还内存。"""
        pose, self._pose = self._pose, None
        if pose is not None:
            pose.close()

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
