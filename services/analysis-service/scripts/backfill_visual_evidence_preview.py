"""从原视频和已保存的关键点为旧视觉报告补算同版规则分。

默认只试算；必须显式指定 --apply 才写入 segmentation_snapshot 的预览字段。
不会覆盖原有评分、计次、模板版本或人工复核结果。
"""

import argparse
import json
from pathlib import Path

from app.core.abdominal_visual_signal import extract_abdominal_visual_signal, segment_abdominal_visual
from app.core.config import settings
from app.core.models import Frame, Keypoint
from app.core.visual_practice_score import EVIDENCE_SCORE_VERSION, score_visual_evidence
from app.db.models import TrainingVideo, VideoEvaluationResult
from app.db.session import sync_session_scope
from app.tasks.analyze_video import _download_video


def _load_frames(video_id: int) -> list[Frame]:
    path = Path(settings.local_storage_root) / settings.oss_bucket / 'keypoints' / f'{video_id}.json'
    payload = json.loads(path.read_text(encoding='utf-8'))
    if payload.get('video_id') != video_id or payload.get('segmentation_version') != 'abdominal_visual_v1':
        raise ValueError('关键点文件与原视觉切分版本不一致')
    return [
        Frame(
            frame_index=int(item['frame_index']), timestamp=float(item['timestamp']),
            keypoints={name: Keypoint(**value) for name, value in item['keypoints'].items()},
        )
        for item in payload['frames']
    ]


def _matching_cycles(saved: list, recomputed: list) -> bool:
    return len(saved) == len(recomputed) and all(
        old.get('start_frame') == new.start_frame
        and old.get('peak_frame') == new.peak_frame
        and old.get('return_frame') == new.return_frame
        and old.get('peak_start_frame') == new.peak_start_frame
        and old.get('peak_end_frame') == new.peak_end_frame
        for old, new in zip(saved, recomputed)
    )


def backfill(video_id: int, apply: bool) -> str:
    with sync_session_scope() as session:
        video = session.get(TrainingVideo, video_id)
        evaluation = session.get(VideoEvaluationResult, video_id)
        if video is None or evaluation is None:
            raise ValueError('视频或分析结果不存在')
        snapshot = evaluation.segmentation_snapshot or {}
        if not isinstance(snapshot, dict) or snapshot.get('score_type') != 'visual_practice':
            raise ValueError('不是旧视觉评分记录')
        if video.source_type != 'miniapp' or video.action_type != 'abdominal_crunch' or video.analysis_status != 'completed':
            raise ValueError('仅支持已完成的小程序缩腹视频')
        if snapshot.get('score_available') is not True or not 1 <= evaluation.total_reps <= 25:
            raise ValueError('原结果没有可评分的完整周期')
        if snapshot.get('visual_evidence_preview') is not None:
            return f'{video_id}: 已有新规则试算，跳过'
        saved_cycles = snapshot.get('visual_accepted_cycles')
        if not isinstance(saved_cycles, list) or len(saved_cycles) != evaluation.total_reps:
            raise ValueError('保存的周期与正式计次不一致')
        video_key = video.video_key
        confidence = float(evaluation.confidence_score or 0)

    if not video_key or not video_key.startswith('videos/patients/'):
        raise ValueError('原视频路径不可用')
    video_path, temporary = _download_video(video_key)
    if not video_path:
        raise ValueError('原视频下载失败')
    try:
        signal = extract_abdominal_visual_signal(video_path, _load_frames(video_id))
        if not signal.observable:
            raise ValueError(f'视觉信号不可观察：{signal.reason}')
        segmentation = segment_abdominal_visual(signal)
        if not _matching_cycles(saved_cycles, segmentation.accepted_cycles):
            raise ValueError('重算切分与原报告不一致，未写入')
        rep_scores, score = score_visual_evidence(video_id, signal, segmentation, confidence, True)
        if len(rep_scores) != len(saved_cycles) or score.analysis_version != EVIDENCE_SCORE_VERSION:
            raise ValueError('重算评分与原计次不一致，未写入')
        preview = {
            'version': EVIDENCE_SCORE_VERSION,
            'uncalibrated': True,
            'score_available': True,
            'average_score': score.average_score,
            'rep_scores': [item.total_score for item in rep_scores],
            'backfill_source': 'original_video_and_saved_keypoints',
        }
    finally:
        if temporary:
            Path(video_path).unlink(missing_ok=True)

    if apply:
        with sync_session_scope() as session:
            evaluation = session.get(VideoEvaluationResult, video_id, with_for_update=True)
            current = evaluation.segmentation_snapshot or {}
            if current.get('score_type') != 'visual_practice' or current.get('visual_evidence_preview') is not None:
                raise ValueError('报告已变化，未写入')
            if not _matching_cycles(current.get('visual_accepted_cycles') or [], segmentation.accepted_cycles):
                raise ValueError('报告周期已变化，未写入')
            evaluation.segmentation_snapshot = {**current, 'visual_evidence_preview': preview}
    action = '已写入' if apply else '试算'
    return f'{video_id}: {action}新规则分 {score.average_score}，{len(rep_scores)} 次，原评分未改动'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video_ids', nargs='+', type=int)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    for video_id in args.video_ids:
        try:
            print(backfill(video_id, args.apply))
        except Exception as exc:
            print(f'{video_id}: 跳过：{exc}')


if __name__ == '__main__':
    main()
