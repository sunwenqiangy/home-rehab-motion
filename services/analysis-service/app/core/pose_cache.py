"""持久化、可校验的原始姿态缓存。

缓存只复用 MediaPipe 输出，不复用动作切分或评分结果；因此模板、阈值与评分规则
更新后仍会在当前任务内重新计算。缓存键同时包含原视频 SHA-256 与推理配置，避免
将不同模型、抽帧率或尺寸的关键点混用。
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.core.abdominal_visual_signal import VisualSignal
from app.core.models import Frame, Keypoint

logger = logging.getLogger(__name__)
CACHE_VERSION = 1


def file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def extraction_config(*, action_type: str, model_complexity: int, sample_fps: int,
                      max_frames: Optional[int], max_frame_width: Optional[int],
                      exact_sample_timestamps: bool) -> Dict[str, Any]:
    return {
        'action_type': action_type,
        'model_complexity': model_complexity,
        'sample_fps': sample_fps,
        'max_frames': max_frames,
        'max_frame_width': max_frame_width,
        'exact_sample_timestamps': exact_sample_timestamps,
    }


def _cache_path(content_sha256: str, config: Dict[str, Any]) -> Path:
    config_json = json.dumps(config, sort_keys=True, separators=(',', ':')).encode('utf-8')
    config_digest = hashlib.sha256(config_json).hexdigest()[:16]
    return (
        Path(settings.local_storage_root) / settings.oss_bucket / 'pose-cache'
        / content_sha256[:2] / f'{content_sha256}-{config_digest}.json'
    )


def _frame_to_dict(frame: Frame) -> Dict[str, Any]:
    return {
        'frame_index': frame.frame_index,
        'timestamp': frame.timestamp,
        'keypoints': {
            name: {'x': point.x, 'y': point.y, 'z': point.z, 'visibility': point.visibility}
            for name, point in frame.keypoints.items()
        },
        'hip_mid': list(frame.hip_mid) if frame.hip_mid else None,
        'shoulder_mid': list(frame.shoulder_mid) if frame.shoulder_mid else None,
    }


def _frame_from_dict(raw: Dict[str, Any]) -> Frame:
    return Frame(
        frame_index=int(raw['frame_index']),
        timestamp=float(raw['timestamp']),
        keypoints={
            name: Keypoint(
                x=float(point['x']), y=float(point['y']), z=float(point['z']),
                visibility=float(point['visibility']),
            )
            for name, point in (raw.get('keypoints') or {}).items()
        },
        hip_mid=tuple(raw['hip_mid']) if raw.get('hip_mid') else None,
        shoulder_mid=tuple(raw['shoulder_mid']) if raw.get('shoulder_mid') else None,
    )


def load(content_sha256: str, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """返回已验证缓存；损坏或过期缓存仅视为未命中，不影响当前分析。"""
    path = _cache_path(content_sha256, config)
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding='utf-8'))
        if (raw.get('cache_version') != CACHE_VERSION
                or raw.get('content_sha256') != content_sha256
                or raw.get('extraction_config') != config):
            return None
        frames = [_frame_from_dict(item) for item in raw.get('frames') or []]
        if not frames:
            return None
        return {
            'frames': frames,
            'effective_sample_fps': float(raw['effective_sample_fps']),
            'source_duration_seconds': float(raw['source_duration_seconds']),
            'decoded_duration_seconds': float(raw['decoded_duration_seconds']),
            'decode_completion_ratio': float(raw['decode_completion_ratio']),
            'visual_signal': VisualSignal(**raw['visual_signal']) if raw.get('visual_signal') else None,
        }
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logger.warning('Ignoring unreadable pose cache %s: %s', path, exc)
        return None


def save(content_sha256: str, config: Dict[str, Any], frames: List[Frame], *,
         effective_sample_fps: float, source_duration_seconds: float,
         decoded_duration_seconds: float, decode_completion_ratio: float,
         visual_signal: Optional[VisualSignal] = None) -> None:
    """原子写入缓存，避免任务中断留下半个 JSON 被下次任务误用。"""
    path = _cache_path(content_sha256, config)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'cache_version': CACHE_VERSION,
        'content_sha256': content_sha256,
        'extraction_config': config,
        'effective_sample_fps': effective_sample_fps,
        'source_duration_seconds': source_duration_seconds,
        'decoded_duration_seconds': decoded_duration_seconds,
        'decode_completion_ratio': decode_completion_ratio,
        'visual_signal': {
            'values': visual_signal.values,
            'timestamps': visual_signal.timestamps,
            'valid_ratio': visual_signal.valid_ratio,
            'median_contrast': visual_signal.median_contrast,
            'reason': visual_signal.reason,
        } if visual_signal else None,
        'frames': [_frame_to_dict(frame) for frame in frames],
    }
    fd, temporary_path = tempfile.mkstemp(prefix='.pose-cache-', suffix='.json', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(payload, output, ensure_ascii=False, separators=(',', ':'))
        os.replace(temporary_path, path)
        logger.info('Saved pose cache: %s (%d frames)', path, len(frames))
    except OSError as exc:
        logger.warning('Failed to save pose cache %s: %s', path, exc)
        try:
            os.unlink(temporary_path)
        except OSError:
            pass
