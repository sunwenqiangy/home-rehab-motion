"""Read-only bilateral knee-rotation preview from saved *raw* keypoints."""

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from app.core.config import settings
from app.core.knee_bilateral_cycle import preview_knee_bilateral_cycle, score_knee_bilateral
from app.core.models import Frame, Keypoint


def preview_video(video_id: int, start: float = 0, end: float = float('inf')) -> dict:
    path = Path(settings.local_storage_root) / settings.oss_bucket / 'keypoints' / f'{video_id}.json'
    payload = json.loads(path.read_text(encoding='utf-8'))
    source = [frame for frame in payload['frames'] if start <= frame['timestamp'] <= end]
    frames = [Frame(
        frame_index=item['frame_index'], timestamp=item['timestamp'],
        keypoints={name: Keypoint(**value) for name, value in item['keypoints'].items()},
    ) for item in source]
    fps = (len(frames) - 1) / (frames[-1].timestamp - frames[0].timestamp) if len(frames) > 1 else 0
    preview = preview_knee_bilateral_cycle(frames, fps)
    rep_scores, video_score = score_knee_bilateral(
        video_id, preview, frames, 1.0, bool(preview.cycles),
    )

    def event_info(event):
        return {
            'start': round(frames[event.start_frame].timestamp, 2),
            'arrival': round(frames[event.arrival_frame].timestamp, 2),
            'return_start': round(frames[event.return_start_frame].timestamp, 2),
            'end': round(frames[event.end_frame].timestamp, 2),
            'sign': event.sign,
            'amplitude': event.amplitude,
        }

    return {
        'video_id': video_id, 'window': [start, end if end != float('inf') else None],
        'version': preview.version, 'cycle_count': len(preview.cycles),
        'cycles': [{'first': event_info(cycle.first), 'second': event_info(cycle.second)}
                   for cycle in preview.cycles],
        'unpaired_excursions': len(preview.excursions) - 2 * len(preview.cycles),
        'knee_visibility': preview.knee_visibility, 'reason': preview.reason,
        'offline_score': video_score.average_score if rep_scores else None,
        'offline_rep_scores': [score.total_score for score in rep_scores],
        'score_note': '仅试算；未经过画面质量与可信度门禁，不等于正式报告分',
        'direction_verified': preview.direction_verified,
        'score_calibrated': preview.score_calibrated,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Read-only bilateral knee preview')
    parser.add_argument('video_ids', nargs='+', type=int)
    parser.add_argument('--start', type=float, default=0)
    parser.add_argument('--end', type=float, default=float('inf'))
    args = parser.parse_args()
    for requested_id in args.video_ids:
        print(json.dumps(preview_video(requested_id, args.start, args.end), ensure_ascii=False))
