"""Step 1: 视频质量检测"""

import logging
import subprocess
from typing import Any, Dict

import numpy as np

from app.core.models import QualityCheckResult

logger = logging.getLogger(__name__)


def _run_ffprobe(video_path: str) -> Dict:
    """优先用 ffprobe 获取视频元信息；缺失时回退到 OpenCV。"""
    cmd = [
        'ffprobe',
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        video_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and result.stdout:
            import json

            return json.loads(result.stdout)
    except FileNotFoundError:
        logger.warning('ffprobe not found, falling back to OpenCV metadata parsing')
    except Exception as exc:
        logger.warning('ffprobe failed: %s', exc)

    return _read_video_meta_with_opencv(video_path)


def _read_video_meta_with_opencv(video_path: str) -> Dict:
    try:
        import cv2

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {}

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration = frame_count / fps if fps > 0 else 0.0
        cap.release()

        fps_num = int(round(fps * 1000)) if fps > 0 else 0
        return {
            'streams': [
                {
                    'codec_type': 'video',
                    'width': width,
                    'height': height,
                    'r_frame_rate': f'{fps_num}/1000' if fps_num > 0 else '0/1',
                }
            ],
            'format': {
                'duration': str(duration),
            },
        }
    except Exception as exc:
        logger.warning('OpenCV metadata parsing failed: %s', exc)
        return {}


def _inspect_visual_quality(video_path: str) -> Dict[str, Any]:
    """抽样检查亮度和画面稳定性；无法读取时保守标记为不可确认。"""
    try:
        import cv2

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {'available': False, 'brightness': 0.0, 'brightness_std': 0.0}
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        sample_indexes = sorted({int(frame_count * ratio) for ratio in (0.1, 0.3, 0.5, 0.7, 0.9)})
        brightness_values = []
        for index in sample_indexes:
            cap.set(cv2.CAP_PROP_POS_FRAMES, index)
            ok, frame = cap.read()
            if ok and frame is not None:
                brightness_values.append(float(np.mean(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))))
        cap.release()
        if not brightness_values:
            return {'available': False, 'brightness': 0.0, 'brightness_std': 0.0}
        return {
            'available': True,
            'brightness': float(np.mean(brightness_values)),
            'brightness_std': float(np.std(brightness_values)),
        }
    except Exception as exc:
        logger.warning('Visual quality sampling failed: %s', exc)
        return {'available': False, 'brightness': 0.0, 'brightness_std': 0.0}


def check_video_quality(video_path: str, keypoint_avg_visibility: float = 1.0) -> QualityCheckResult:
    """视频质量检测：格式、亮度、稳定性及关键点可见性。"""
    info = _run_ffprobe(video_path)

    video_stream = None
    for stream in info.get('streams', []):
        if stream.get('codec_type') == 'video':
            video_stream = stream
            break

    if not video_stream:
        return QualityCheckResult(
            quality_status='insufficient',
            avg_visibility=0.0,
            resolution=(0, 0),
            duration=0.0,
            fps=0.0,
            details={'error': 'no video stream found'},
        )

    width = int(video_stream.get('width', 0))
    height = int(video_stream.get('height', 0))
    fps_str = video_stream.get('r_frame_rate', '0/1')
    try:
        num, den = fps_str.split('/')
        fps = float(num) / float(den) if float(den) > 0 else 0.0
    except Exception:
        fps = 0.0

    duration = float(info.get('format', {}).get('duration', 0))

    issues = []
    visual = _inspect_visual_quality(video_path)
    brightness_warning = False
    completeness_warning = False

    if width < 480 or height < 360:
        issues.append('resolution_too_low')
    if fps < 15:
        issues.append('fps_too_low')
    if duration < 10:
        issues.append('duration_too_short')
    elif duration > 300:
        issues.append('duration_too_long')

    if not visual['available']:
        # 无法抽样读取画面时，不能假设视频质量足以支持确定性动作判断。
        issues.append('visual_quality_unavailable')
        brightness_warning = True
    elif visual['brightness'] < 45:
        issues.append('brightness_too_low')
        brightness_warning = True
    elif visual['brightness'] > 235:
        issues.append('brightness_too_high')
        brightness_warning = True
    if not np.isfinite(keypoint_avg_visibility):
        quality_status = 'insufficient'
        issues.append('keypoint_visibility_unavailable')
    elif keypoint_avg_visibility < 0.55:
        quality_status = 'insufficient'
        issues.append('keypoint_visibility_insufficient')
    elif keypoint_avg_visibility < 0.70:
        quality_status = 'warning'
        issues.append('keypoint_visibility_warning')
    else:
        quality_status = 'passed'

    insufficient_issues = {
        'resolution_too_low',
        'fps_too_low',
        'duration_too_short',
        'duration_too_long',
        'visual_quality_unavailable',
        'keypoint_visibility_unavailable',
        'keypoint_visibility_insufficient',
    }
    if any(issue in insufficient_issues for issue in issues):
        quality_status = 'insufficient'
    elif brightness_warning and quality_status == 'passed':
        quality_status = 'warning'

    return QualityCheckResult(
        quality_status=quality_status,
        avg_visibility=keypoint_avg_visibility,
        resolution=(width, height),
        duration=duration,
        fps=fps,
        brightness_warning=brightness_warning,
        completeness_warning=completeness_warning,
        details={
            'issues': issues,
            'brightness': visual['brightness'],
            'brightnessStd': visual['brightness_std'],
            'visualQualityAvailable': visual['available'],
        },
    )
