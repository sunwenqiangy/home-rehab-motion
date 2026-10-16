"""Read-only dual-excursion preview for saved keypoints (see technical note)."""

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from app.core.config import settings
from app.core.knee_dual_cycle import preview_knee_dual_cycle
from app.core.models import Frame, Keypoint
from app.core.preprocessor import DataPreprocessor


def preview_video(video_id: int) -> dict:
    path = Path(settings.local_storage_root) / settings.oss_bucket / 'keypoints' / f'{video_id}.json'
    payload = json.loads(path.read_text(encoding='utf-8'))
    source = payload['frames']
    frames = [Frame(
        frame_index=item['frame_index'], timestamp=item['timestamp'],
        keypoints={name: Keypoint(**value) for name, value in item['keypoints'].items()},
        hip_mid=tuple(item['hip_mid']) if item.get('hip_mid') else None,
        shoulder_mid=tuple(item['shoulder_mid']) if item.get('shoulder_mid') else None,
    ) for item in source]
    frames = DataPreprocessor().run_full_pipeline(frames)
    fps = payload.get('effective_sample_fps') or (
        (len(source) - 1) / (source[-1]['timestamp'] - source[0]['timestamp'])
    )
    preview = preview_knee_dual_cycle(frames, float(fps))
    result = asdict(preview)
    result['video_id'] = video_id
    result['cycles'] = [{
        **asdict(cycle),
        'start_seconds': round(frames[cycle.start_frame].timestamp, 2),
        'first_peak_seconds': round(frames[cycle.first_peak_frame].timestamp, 2),
        'middle_return_seconds': round(frames[cycle.middle_return_frame].timestamp, 2),
        'second_peak_seconds': round(frames[cycle.second_peak_frame].timestamp, 2),
        'end_seconds': round(frames[cycle.end_frame].timestamp, 2),
    } for cycle in preview.cycles]
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Read-only knee dual-cycle preview')
    parser.add_argument('video_ids', nargs='+', type=int)
    args = parser.parse_args()
    for requested_id in args.video_ids:
        print(json.dumps(preview_video(requested_id), ensure_ascii=False))
