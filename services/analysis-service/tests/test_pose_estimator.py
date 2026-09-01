import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.models import Frame
from app.core.pose_estimator import PoseEstimator


class _FakeCapture:
    def __init__(self, total_frames: int, source_fps: float):
        self.total_frames = total_frames
        self.source_fps = source_fps
        self.index = 0

    def isOpened(self):
        return self.index < self.total_frames

    def read(self):
        if self.index >= self.total_frames:
            return False, None
        self.index += 1
        return True, np.zeros((8, 8, 3), dtype=np.uint8)

    def get(self, property_id):
        if property_id == cv2.CAP_PROP_FPS:
            return self.source_fps
        if property_id == cv2.CAP_PROP_FRAME_COUNT:
            return self.total_frames
        return 0

    def release(self):
        pass


def test_timestamp_sampling_stretches_interval_to_preserve_full_video_under_frame_budget(monkeypatch):
    """高请求帧率遇到帧预算时，仍需采到视频结尾，而非只分析前半段。"""
    estimator = PoseEstimator(sample_fps=10, max_frames=12, exact_sample_timestamps=True)
    monkeypatch.setattr(estimator, '_init_model', lambda: None)
    monkeypatch.setattr(estimator, '_close_model', lambda: None)
    monkeypatch.setattr(cv2, 'VideoCapture', lambda _: _FakeCapture(total_frames=101, source_fps=10))
    monkeypatch.setattr(
        estimator,
        '_process_frame',
        lambda _, index, timestamp: Frame(frame_index=index, timestamp=timestamp, keypoints={}),
    )

    frames = estimator.extract_frames('long-video.mp4')

    assert len(frames) <= 12
    assert frames[0].timestamp == 0.0
    assert frames[-1].timestamp >= 9.0
    assert estimator.effective_sample_fps <= 1.2
