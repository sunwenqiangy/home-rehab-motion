"""分析任务 API 路由"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.schemas.analysis import (
    AnalysisResultResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    KeypointsResponse,
    TaskStatusResponse,
)
from app.tasks.analyze_video import analyze_video

logger = logging.getLogger(__name__)
router = APIRouter()


def _sanitize_json_values(value: Any) -> Any:
    """将 NaN/Infinity 转为 None，确保关键点响应可被严格 JSON 序列化。"""
    import math

    if isinstance(value, float):
        return value if math.isfinite(value) else 0.0
    if isinstance(value, dict):
        return {key: _sanitize_json_values(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize_json_values(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize_json_values(item) for item in value]
    return value


def _backfill_rep_segments(video_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
    """兼容旧版 keypoints JSON: 若缺少 rep_segments，则基于 frames 重新切分一次。"""
    if data.get('rep_segments'):
        return data

    frames_payload = data.get('frames') or []
    if not isinstance(frames_payload, list) or len(frames_payload) < 5:
        return data

    try:
        from app.core.config import settings
        from app.core.models import Frame, Keypoint
        from app.core.phase_segmenter import PhaseSegmenter
        from app.db.models import TrainingVideo
        from app.db.session import sync_session_scope

        action_type: Optional[str] = None
        with sync_session_scope() as session:
            video = session.query(TrainingVideo).filter_by(video_id=video_id).first()
            if video:
                action_type = video.action_type

        if not action_type:
            return data

        frames: List[Frame] = []
        for raw in frames_payload:
            raw_keypoints = raw.get('keypoints') or {}
            kp_map: Dict[str, Keypoint] = {}
            for name, kp in raw_keypoints.items():
                if not isinstance(kp, dict):
                    continue
                kp_map[name] = Keypoint(
                    x=float(kp.get('x', 0.0)),
                    y=float(kp.get('y', 0.0)),
                    z=float(kp.get('z', 0.0)),
                    visibility=float(kp.get('visibility', 0.0)),
                )

            hip_mid_raw = raw.get('hip_mid')
            shoulder_mid_raw = raw.get('shoulder_mid')

            frames.append(
                Frame(
                    frame_index=int(raw.get('frame_index', len(frames))),
                    timestamp=float(raw.get('timestamp', 0.0)),
                    keypoints=kp_map,
                    hip_mid=tuple(hip_mid_raw) if isinstance(hip_mid_raw, list) and len(hip_mid_raw) >= 3 else None,
                    shoulder_mid=tuple(shoulder_mid_raw)
                    if isinstance(shoulder_mid_raw, list) and len(shoulder_mid_raw) >= 3
                    else None,
                )
            )

        segmenter = PhaseSegmenter(sample_fps=settings.sample_fps)
        reps = segmenter.segment(frames, action_type)
        if not reps:
            return data

        frame_ts_by_order = {idx: frame.timestamp for idx, frame in enumerate(frames)}
        rebuilt_segments = []
        for rep in reps:
            start_idx = max(0, int(rep.start_frame))
            end_idx = max(start_idx, int(rep.end_frame))
            normalized_phases = {str(k): int(v) for k, v in (rep.phases or {}).items()}
            rebuilt_segments.append(
                {
                    'rep_id': int(rep.id),
                    'start_frame': start_idx,
                    'end_frame': end_idx,
                    'start_time': round(float(frame_ts_by_order.get(start_idx, 0.0)), 3),
                    'end_time': round(float(frame_ts_by_order.get(end_idx, 0.0)), 3),
                    'phases': normalized_phases,
                }
            )

        data['rep_segments'] = rebuilt_segments
        logger.info('Backfilled rep_segments for video_id=%d: %d reps', video_id, len(rebuilt_segments))
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning('Failed to backfill rep_segments for video_id=%d: %s', video_id, exc)

    return data


@router.post('/submit', response_model=AnalyzeResponse, summary='提交视频分析任务')
def submit_analysis(req: AnalyzeRequest) -> AnalyzeResponse:
    logger.info(
        'Analysis submit received: video_id=%d, action_type=%s, has_video_key=%s, sample_fps=%s, has_callback_url=%s',
        req.video_id,
        req.action_type,
        bool(req.video_key),
        req.sample_fps if req.sample_fps is not None else 'default',
        bool(req.callback_url),
    )
    valid_types = ('abdominal_crunch', 'pelvic_tilt', 'knee_rotation')
    if req.action_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f'Invalid action_type: {req.action_type}. Must be one of {valid_types}',
        )

    try:
        from app.db.repository import AnalysisRepository
        from app.db.session import sync_session_scope

        with sync_session_scope() as session:
            repo = AnalysisRepository(session)
            existing_task = repo.get_analysis_task(req.video_id)
            if existing_task and existing_task.task_status in ('queued', 'processing'):
                logger.info(
                    'Analysis submit deduplicated: video_id=%d, task_id=%s, existing_status=%s',
                    req.video_id,
                    existing_task.provider_task_id or '',
                    existing_task.task_status,
                )
                return AnalyzeResponse(
                    task_id=existing_task.provider_task_id or '',
                    video_id=req.video_id,
                    status=existing_task.task_status,
                )
    except Exception as exc:
        # 主服务已经负责训练视频和 analysis_task 的状态；这里的幂等查询只用于
        # 避免重复投递。数据库短暂不可达不应阻断 Redis 入队，否则会把数据库网络
        # 故障错误伪装成“分析队列不可用”。Worker 会在执行时更新任务状态。
        logger.warning(
            'Skipping duplicate-task lookup for video_id=%d because the analysis database is unavailable: %s',
            req.video_id,
            exc,
        )

    try:
        # 向 Broker 投递任务是唯一必要的同步步骤；inspect.ping() 是广播控制命令，
        # 在 Redis、网络隔离或 worker 正在启动时可能超时，即使队列可正常消费也会误报 503。
        # Worker 缺失时任务将保持 queued，后续由 worker 恢复后继续执行，不应要求患者重传视频。
        result = analyze_video.apply_async(
            kwargs={
                'video_id': req.video_id,
                'action_type': req.action_type,
                'video_key': req.video_key,
                'callback_url': req.callback_url,
                'sample_fps': req.sample_fps,
                'threshold_config': req.threshold_config,
            },
            queue='analysis',
        )
        logger.info(
            'Analysis task enqueued: video_id=%d, task_id=%s, queue=analysis',
            req.video_id,
            result.id,
        )
        return AnalyzeResponse(task_id=result.id, video_id=req.video_id, status='queued')
    except Exception as exc:
        logger.exception(
            'Analysis task enqueue failed: video_id=%d, action_type=%s, error_type=%s',
            req.video_id,
            req.action_type,
            type(exc).__name__,
        )
        raise HTTPException(status_code=503, detail='分析队列暂不可用，请稍后重试') from exc


@router.get('/status', response_model=TaskStatusResponse, summary='查询分析任务状态')
def get_task_status(video_id: int = Query(..., description='训练视频 ID')) -> TaskStatusResponse:
    from app.db.models import VideoEvaluationResult
    from app.db.repository import AnalysisRepository
    from app.db.session import sync_session_scope

    with sync_session_scope() as session:
        repo = AnalysisRepository(session)
        task = repo.get_analysis_task(video_id)
        if not task:
            raise HTTPException(status_code=404, detail='未找到该视频的分析任务')

        result_data = None
        if task.task_status == 'completed':
            video_eval = session.query(VideoEvaluationResult).filter_by(video_id=video_id).first()
            if video_eval:
                result_data = {
                    'average_score': video_eval.average_score,
                    'grade': video_eval.grade,
                    'total_reps': video_eval.total_reps,
                    'valid_reps': video_eval.valid_reps,
                    'confidence_score': video_eval.confidence_score,
                    'analysis_version': video_eval.analysis_version,
                }

        return TaskStatusResponse(
            task_id=task.provider_task_id or '',
            video_id=video_id,
            task_status=task.task_status,
            fail_reason=task.fail_reason,
            result=result_data,
        )


@router.get('/keypoints', response_model=KeypointsResponse, summary='获取视频关键点数据（骨架可视化）')
def get_keypoints(video_id: int = Query(..., description='训练视频 ID')) -> KeypointsResponse:
    """返回指定视频的关键点帧数据，用于前端骨架可视化叠加渲染。"""
    import json
    from pathlib import Path

    from app.core.config import settings

    storage_root = Path(settings.local_storage_root) / settings.oss_bucket
    json_path = storage_root / 'keypoints' / f'{video_id}.json'

    if not json_path.exists():
        raise HTTPException(status_code=404, detail='关键点数据不存在，可能视频尚未完成分析')

    try:
        data = json.loads(json_path.read_text(encoding='utf-8'))
        data = _sanitize_json_values(data)
        data = _backfill_rep_segments(video_id, data)
        return KeypointsResponse(**data)
    except Exception as exc:
        logger.error('Failed to read keypoints for video_id=%d: %s', video_id, exc)
        raise HTTPException(status_code=500, detail='读取关键点数据失败')


@router.get('/result', response_model=AnalysisResultResponse, summary='获取完整分析结果')
def get_analysis_result(video_id: int = Query(..., description='训练视频 ID')) -> AnalysisResultResponse:
    from app.db.models import MotionFeatureResult, RepEvaluationResult, TrainingVideo, VideoEvaluationResult
    from app.db.session import sync_session_scope
    from app.schemas.analysis import (
        CompareResultSchema,
        ConfidenceSchema,
        QualityCheckResponse,
        RepScoreSchema,
        VideoScoreSchema,
    )

    with sync_session_scope() as session:
        video = session.query(TrainingVideo).filter_by(video_id=video_id).first()
        if not video:
            raise HTTPException(status_code=404, detail='视频不存在')

        video_eval = session.query(VideoEvaluationResult).filter_by(video_id=video_id).first()
        if not video_eval:
            raise HTTPException(status_code=404, detail='分析结果不存在')

        video_score = VideoScoreSchema(
            video_id=video_eval.video_id,
            total_reps=video_eval.total_reps,
            valid_reps=video_eval.valid_reps,
            average_score=video_eval.average_score or 0,
            grade=video_eval.grade or '无效',
            accuracy_avg=video_eval.accuracy_avg or 0,
            stability_avg=video_eval.stability_avg or 0,
            control_avg=video_eval.control_avg or 0,
            duration_avg=video_eval.duration_avg or 0,
            avg_hold_duration=video_eval.avg_hold_duration or 0,
            main_issues=video_eval.main_issues or [],
            advice_summary=video_eval.advice_summary or [],
            confidence_score=video_eval.confidence_score or 0,
            analysis_version=video_eval.analysis_version or '',
        )

        rep_evals = session.query(RepEvaluationResult).filter_by(video_id=video_id).all()
        rep_scores = []
        for rep_eval in rep_evals:
            features = session.query(MotionFeatureResult).filter_by(
                video_id=video_id,
                rep_id=rep_eval.rep_id,
            ).all()
            compare_results = [
                CompareResultSchema(
                    feature_code=f.feature_code,
                    measured=f.feature_value or 0,
                    reference_mean=0,
                    reference_std=1,
                    deviation_sigma=f.deviation_sigma or 0,
                    label=f.compare_label or 'normal',
                    in_valid_range=True,
                )
                for f in features
            ]
            rep_scores.append(
                RepScoreSchema(
                    rep_id=rep_eval.rep_id,
                    accuracy_score=rep_eval.accuracy_score or 0,
                    stability_score=rep_eval.stability_score or 0,
                    control_score=rep_eval.control_score or 0,
                    duration_score=rep_eval.duration_score or 0,
                    total_score=rep_eval.total_score or 0,
                    grade=rep_eval.grade or '无效',
                    valid_flag=rep_eval.valid_flag,
                    compensation_types=rep_eval.compensation_types or [],
                    hold_duration=rep_eval.hold_duration or 0,
                    compare_results=compare_results,
                )
            )

        quality = QualityCheckResponse(
            quality_status=video.quality_status or 'unknown',
            avg_visibility=(video.quality_score or 0) / 100,
            resolution=video.resolution or '0x0',
            duration=video.duration or 0,
            fps=0,
            brightness_warning=False,
            completeness_warning=False,
            details=video.quality_issues or {},
        )

        confidence = ConfidenceSchema(
            overall=video_eval.confidence_score or 0,
            video_quality=0,
            keypoint_quality=0,
            parameter_reliability=0,
            level='high'
            if (video_eval.confidence_score or 0) >= 0.75
            else ('medium' if (video_eval.confidence_score or 0) >= 0.55 else 'low'),
        )

        return AnalysisResultResponse(
            video_id=video_id,
            action_type=video.action_type,
            quality=quality,
            confidence=confidence,
            video_score=video_score,
            rep_scores=rep_scores,
            analysis_version=video_eval.analysis_version or '',
        )
