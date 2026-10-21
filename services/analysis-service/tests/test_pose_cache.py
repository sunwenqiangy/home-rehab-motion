import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.models import Frame, Keypoint
from app.core import pose_cache


def _frame() -> Frame:
    return Frame(
        frame_index=3,
        timestamp=0.6,
        keypoints={'LEFT_HIP': Keypoint(x=.1, y=.2, z=.3, visibility=.9)},
        hip_mid=(.2, .3),
        shoulder_mid=(.4, .5),
    )


def test_cache_roundtrip_requires_same_content_and_extraction_config(monkeypatch, tmp_path):
    monkeypatch.setattr(pose_cache.settings, 'local_storage_root', str(tmp_path))
    monkeypatch.setattr(pose_cache.settings, 'oss_bucket', 'bucket')
    digest = 'a' * 64
    config = pose_cache.extraction_config(
        action_type='pelvic_tilt', model_complexity=1, sample_fps=4,
        max_frames=600, max_frame_width=480, exact_sample_timestamps=True,
    )
    pose_cache.save(
        digest, config, [_frame()], effective_sample_fps=4,
        source_duration_seconds=10, decoded_duration_seconds=10,
        decode_completion_ratio=1,
    )

    cached = pose_cache.load(digest, config)

    assert cached is not None
    assert cached['frames'][0].keypoints['LEFT_HIP'].visibility == .9
    assert pose_cache.load('b' * 64, config) is None
    assert pose_cache.load(digest, {**config, 'sample_fps': 5}) is None
