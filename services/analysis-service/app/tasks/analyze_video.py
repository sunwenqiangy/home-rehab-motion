"""Celery 异步任务：视频动作分析全流水线"""

import copy
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import ROOT_DIR, settings
from app.core.models import CompareResult, ConfidenceResult, QualityCheckResult, Rep, RepScore, VideoScore
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _download_video(video_key: str) -> Tuple[Optional[str], bool]:
    """优先读取本地对象存储目录，其次回退 OSS 下载，返回 (本地路径, 是否临时文件)"""
    if not video_key:
        return None, False

    if os.path.exists(video_key):
        return video_key, False

    local_storage_candidate = Path(settings.local_storage_root) / settings.oss_bucket / video_key
    if local_storage_candidate.exists():
        logger.info('Using local storage video: %s', local_storage_candidate)
        return str(local_storage_candidate), False

    public_base = settings.oss_public_base_url.rstrip('/')
    if public_base:
        try:
            import requests
            import tempfile

            suffix = os.path.splitext(video_key)[1] or '.mp4'
            fd, local_path = tempfile.mkstemp(suffix=suffix)
            os.close(fd)

            public_url = f'{public_base}/{video_key}'
            response = requests.get(public_url, timeout=20)
            if response.status_code == 200 and response.content:
                Path(local_path).write_bytes(response.content)
                logger.info('Downloaded video via OSS public URL: %s -> %s', public_url, local_path)
                return local_path, True
            logger.warning('Failed to download %s via public URL: status=%s', video_key, response.status_code)
            if os.path.exists(local_path):
                os.remove(local_path)
        except Exception as exc:
            logger.warning('Failed to download %s via OSS public URL: %s', video_key, exc)

    # ── boto3 S3 下载（兼容 MinIO，使用 path_style + s3v4 签名）────────────
    endpoint = settings.oss_endpoint.strip()
    access_key = settings.oss_access_key or settings.oss_access_key_id
    secret_key = settings.oss_secret_key or settings.oss_access_key_secret
    if endpoint and access_key and secret_key:
        try:
            import tempfile
            import boto3
            from botocore.config import Config as BotocoreConfig

            s3 = boto3.client(
                's3',
                endpoint_url=endpoint,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                config=BotocoreConfig(
                    signature_version='s3v4',
                    s3={'addressing_style': 'path' if settings.oss_force_path_style else 'auto'},
                ),
            )
            suffix = os.path.splitext(video_key)[1] or '.mp4'
            fd, local_path = tempfile.mkstemp(suffix=suffix)
            os.close(fd)
            s3.download_file(settings.oss_bucket, video_key, local_path)
            if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
                logger.info('Downloaded video via S3/MinIO: %s -> %s', video_key, local_path)
                return local_path, True
            if os.path.exists(local_path):
                os.remove(local_path)
        except ImportError:
            logger.warning('boto3 not installed, skipping S3/MinIO download for %s', video_key)
        except Exception as exc:
            logger.warning('Failed to download %s from S3/MinIO: %s', video_key, exc)
            try:
                if 'local_path' in dir() and os.path.exists(local_path):
                    os.remove(local_path)
            except OSError:
                pass

    # ── 阿里云 oss2 下载（原生 OSS 环境回退）───────────────────────────────
    try:
        import tempfile
        import oss2

        auth = oss2.Auth(settings.oss_access_key_id, settings.oss_access_key_secret)
        bucket = oss2.Bucket(auth, settings.oss_endpoint, settings.oss_bucket)

        suffix = os.path.splitext(video_key)[1] or '.mp4'
        fd, local_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        bucket.get_object_to_file(video_key, local_path)
        logger.info('Downloaded video from OSS: %s -> %s', video_key, local_path)
        return local_path, True
    except ImportError:
        logger.warning('oss2 not installed, cannot download %s', video_key)
        return None, False
    except Exception as exc:
        logger.warning('Failed to download %s from OSS: %s', video_key, exc)
        return None, False


def _get_sample_video_path(action_type: str) -> Optional[str]:
    samples = {
        'abdominal_crunch': '教学视频_缩腹运动_0050-0080.mp4',
        'pelvic_tilt': '教学视频_骨盆倾斜_0080-0140.mp4',
        'knee_rotation': '教学视频_膝关节旋转_0140-0218.mp4',
    }
    filename = samples.get(action_type)
    if not filename:
        return None
    sample_path = ROOT_DIR / 'prd' / filename
    return str(sample_path) if sample_path.exists() else None


def _resolve_video_source(video_id: int, action_type: str, video_key: Optional[str]) -> Tuple[str, bool]:
    """解析视频来源：优先真实上传视频，按开关决定是否允许样例视频回退。"""
    if video_key:
        local_path, is_temp = _download_video(video_key)
        if local_path and os.path.exists(local_path):
            return local_path, is_temp

    if settings.allow_sample_video_fallback:
        sample_path = _get_sample_video_path(action_type)
        if sample_path:
            logger.info('Using sample video for video_id=%d, action_type=%s: %s', video_id, action_type, sample_path)
            return sample_path, False

    raise ValueError(f'No available video source for video_id={video_id}, action_type={action_type}')


def _get_feature_units(action_type: str) -> Dict[str, str]:
    from app.core.constants import DEFAULT_TEMPLATES

    template = DEFAULT_TEMPLATES.get(action_type, {})
    return {code: info.get('unit', '') for code, info in template.items()}


@celery_app.task(
    name='analysis.analyze_video',
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    soft_time_limit=settings.analysis_timeout_seconds,
    acks_late=True,
    reject_on_worker_lost=True,
)
def analyze_video(
    self,
    video_id: int,
    action_type: str,
    video_key: Optional[str] = None,
    callback_url: Optional[str] = None,
    sample_fps: Optional[int] = None,
    threshold_config: Optional[Dict] = None,
) -> Dict[str, Any]:
    task_id = self.request.id
    logger.info('[%s] Starting analysis: video_id=%d, action_type=%s', task_id, video_id, action_type)

    from app.db.repository import AnalysisRepository
    from app.db.session import sync_session_scope

    local_video_path: Optional[str] = None
    is_temp_file = False

    try:
        with sync_session_scope() as session:
            repo = AnalysisRepository(session)
            repo.create_analysis_task(video_id, str(task_id))

        if not video_key:
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                video = repo.get_video(video_id)
                if video:
                    video_key = video.video_key

        local_video_path, is_temp_file = _resolve_video_source(video_id, action_type, video_key)

        from app.core.video_quality import check_video_quality

        quality_result: QualityCheckResult = check_video_quality(local_video_path)
        logger.info('[%s] Quality metadata check: status=%s', task_id, quality_result.quality_status)
        if quality_result.quality_status == 'insufficient':
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.update_video_quality(
                    video_id,
                    quality_result.quality_status,
                    quality_score=quality_result.avg_visibility * 100,
                    quality_issues=quality_result.details.get('issues', []),
                )
                repo.mark_task_quality_insufficient(video_id, '视频基础质量不足，无法进行动作分析')
            _notify_callback(
                callback_url,
                video_id,
                'quality_insufficient',
                fail_reason='视频基础质量不足',
                quality_status=quality_result.quality_status,
            )
            return {'video_id': video_id, 'status': 'quality_insufficient', 'reason': '视频基础质量不足'}

        from app.core.pose_estimator import PoseEstimator

        effective_sample_fps = settings.sample_fps
        if isinstance(sample_fps, (int, float)):
            effective_sample_fps = max(5, min(30, int(round(sample_fps))))

        estimator = PoseEstimator(
            sample_fps=effective_sample_fps,
            model_complexity=settings.model_complexity,
        )
        frames = estimator.extract_frames(local_video_path)
        # 算法预处理会缩放和平移关键点；单独保留原始画面坐标供管理端骨架叠加，不能用处理后的坐标覆盖它。
        visualization_frames = copy.deepcopy(frames)
        logger.info('[%s] Pose extraction: %d frames (sample_fps=%d)', task_id, len(frames), effective_sample_fps)

        # 先保存原始关键点帧数据，供骨架可视化与失败排查使用
        _save_keypoints_json(video_id, visualization_frames)

        if len(frames) < 10:
            reason = '提取的关键点帧数不足'
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, reason)
            _notify_callback(callback_url, video_id, 'failed', fail_reason=reason)
            return {'video_id': video_id, 'status': 'failed', 'reason': reason}

        visibility = estimator.compute_avg_visibility(frames)
        quality_result = check_video_quality(local_video_path, keypoint_avg_visibility=visibility)
        logger.info('[%s] Quality final check: status=%s, visibility=%.3f', task_id, quality_result.quality_status, visibility)
        if quality_result.quality_status == 'insufficient':
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.update_video_quality(
                    video_id,
                    quality_result.quality_status,
                    quality_score=visibility * 100,
                    quality_issues=quality_result.details.get('issues', []),
                )
                repo.mark_task_quality_insufficient(video_id, '关键点可见性不足，无法进行动作分析')
            _notify_callback(
                callback_url,
                video_id,
                'quality_insufficient',
                fail_reason='关键点可见性不足',
                quality_status=quality_result.quality_status,
            )
            return {'video_id': video_id, 'status': 'quality_insufficient', 'reason': '关键点可见性不足'}

        from app.core.preprocessor import DataPreprocessor

        preprocessor = DataPreprocessor()
        frames = preprocessor.run_full_pipeline(frames)

        from app.core.phase_segmenter import PhaseSegmenter, SegmentationError

        segmenter = PhaseSegmenter(sample_fps=effective_sample_fps)
        # 捕获切分异常（例如信号幅度不足），直接把具体原因透传给回调和数据库
        try:
            reps: List[Rep] = segmenter.segment(frames, action_type)
        except SegmentationError as seg_exc:
            seg_reason = str(seg_exc)
            logger.warning('[%s] Segmentation failed: %s', task_id, seg_reason)
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, seg_reason)
            _notify_callback(callback_url, video_id, 'failed', fail_reason=seg_reason)
            return {'video_id': video_id, 'status': 'failed', 'reason': seg_reason}

        # 只向原始画面坐标写入周期信息；评分使用的归一化坐标不能用于与视频画面对齐。
        _save_keypoints_json(video_id, visualization_frames, reps=reps)
        logger.info('[%s] Segmentation: %d reps detected', task_id, len(reps))
        if not reps:
            empty_reason = '未检测到有效动作，视频中可能没有完整的动作周期'
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, empty_reason)
            _notify_callback(callback_url, video_id, 'failed', fail_reason=empty_reason)
            return {'video_id': video_id, 'status': 'failed', 'reason': empty_reason}

        # ── 动作合法性校验：rep 次数是否符合该动作类型的预期范围 ──────────────────
        # 各动作类型的合理 rep 次数区间（宽松设置，防止误拒）
        # 膝关节旋转视频用缩腹模式分析时，会被切出约 26 次，超过上限 25 次即拦截
        _REP_COUNT_RANGES = {
            'abdominal_crunch': (3, 25),   # 缩腹：3~25次（康复训练不超过25次）
            'pelvic_tilt':      (3, 30),   # 骨盆倾斜：3~30次
            'knee_rotation':    (4, 20),   # 膝关节旋转：4~20次（完整双向旋转）
        }
        _rep_min, _rep_max = _REP_COUNT_RANGES.get(action_type, (1, 100))
        if not (_rep_min <= len(reps) <= _rep_max):
            cn_name = {'knee_rotation': '膝关节旋转', 'pelvic_tilt': '骨盆倾斜', 'abdominal_crunch': '缩腹运动'}.get(action_type, action_type)
            reason = (
                f'分析检测到 {len(reps)} 次动作周期，不符合{cn_name}的预期范围'
                f'（{_rep_min}~{_rep_max} 次），该视频可能与所选动作类型不匹配，请重新选择后上传'
            )
            logger.warning('[%s] Rep count validation failed: %d reps for %s', task_id, len(reps), action_type)
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, reason)
            _notify_callback(callback_url, video_id, 'failed', fail_reason=reason)
            return {'video_id': video_id, 'status': 'failed', 'reason': reason}
        # ──────────────────────────────────────────────────────────────────────────

        from app.core.calculators import get_calculator

        calculator = get_calculator(action_type)
        params_result = calculator.calculate(frames, reps, sample_fps=effective_sample_fps)

        db_template = None
        with sync_session_scope() as session:
            repo = AnalysisRepository(session)
            db_template = repo.get_gold_template(action_type)

        from app.core.constants import DEFAULT_TEMPLATES, DEFAULT_THRESHOLDS
        from app.core.comparator import GoldStandardComparator

        merged_template = DEFAULT_TEMPLATES.get(action_type, {}).copy()
        if db_template and db_template.get('reference_stats'):
            for code, stats in db_template['reference_stats'].items():
                merged_template[code] = {**merged_template.get(code, {}), **stats}

        merged_thresholds = DEFAULT_THRESHOLDS.copy()
        if db_template and db_template.get('threshold_config'):
            merged_thresholds.update(db_template['threshold_config'])
        if threshold_config:
            merged_thresholds.update(threshold_config)

        comparator = GoldStandardComparator(action_type=action_type, threshold_config=merged_thresholds)
        comparator.template = merged_template

        all_compare_results: Dict[int, List[CompareResult]] = {}
        for rep_key, rep_params in params_result.items():
            if rep_key == 'video_avg':
                continue
            try:
                rep_id = int(rep_key.replace('rep_', ''))
            except ValueError:
                continue
            numeric_params = {k: v for k, v in rep_params.items() if isinstance(v, (int, float))}
            all_compare_results[rep_id] = comparator.compare_all(numeric_params)

        from app.core.confidence import compute_confidence

        confidence: ConfidenceResult = compute_confidence(
            frames=frames,
            quality_avg_visibility=quality_result.avg_visibility,
            total_reps=len(reps),
            valid_reps=len(reps),
        )

        from app.core.scoring import ScoringEngine

        engine = ScoringEngine()
        rep_scores: List[RepScore] = []
        for rep_id, compare_results in all_compare_results.items():
            rep_score = engine.score_rep(rep_id, compare_results, action_type)
            rep_key = f'rep_{rep_id}'
            if rep_key in params_result and isinstance(params_result[rep_key], dict):
                rep_score.hold_duration = params_result[rep_key].get('hold_duration', 0.0)
            rep_scores.append(rep_score)

        video_score: VideoScore = engine.aggregate_video_score(
            video_id=video_id,
            rep_scores=rep_scores,
            confidence_score=confidence.overall,
        )

        feature_units = _get_feature_units(action_type)
        quality_issues = quality_result.details.get('issues', [])
        quality_score = quality_result.avg_visibility * 100
        template_incomplete = any(
            compare.label == 'review_required'
            for results in all_compare_results.values()
            for compare in results
        )
        review_required_reason: Optional[str] = None
        if template_incomplete:
            review_required_reason = '参考动作模板不完整，结果需要人工复核'
        elif confidence.level != 'high':
            review_required_reason = '本次视频分析可信度不足，结果需要人工复核'
        elif quality_result.quality_status != 'passed':
            review_required_reason = '拍摄质量存在不确定性，结果需要人工复核'

        if review_required_reason:
            # 原始结果仅供后台复核；患者端不能把不确定计算展示成确定分数或动作结论。
            video_score.grade = '待复核'
            video_score.main_issues = []
            video_score.advice_summary = [{
                'advice_code': 'REVIEW_REQUIRED',
                'patient_text': '本次训练记录已收到，系统正在复核拍摄和动作信息，请稍后查看结果。',
            }]

        with sync_session_scope() as session:
            repo = AnalysisRepository(session)
            repo.save_full_analysis(
                video_id=video_id,
                video_score=video_score,
                rep_scores=rep_scores,
                all_compare_results=all_compare_results,
                confidence=confidence,
                feature_units=feature_units,
                quality_status=quality_result.quality_status,
                quality_score=quality_score,
                quality_issues=quality_issues,
                review_required_reason=review_required_reason,
            )

        final_status = 'review_required' if review_required_reason else 'completed'
        _notify_callback(
            callback_url,
            video_id,
            final_status,
            quality_status=quality_result.quality_status,
            quality_score=quality_score,
            quality_issues=quality_issues,
            video_evaluation=_video_score_to_dict(video_score),
            rep_evaluations=[_rep_score_to_dict(rs) for rs in rep_scores],
            analysis_version=video_score.analysis_version,
        )

        return {
            'video_id': video_id,
            'status': final_status,
            'grade': video_score.grade,
            'average_score': video_score.average_score,
            'confidence': confidence.overall,
            'total_reps': video_score.total_reps,
            'valid_reps': video_score.valid_reps,
        }
    except Exception as exc:
        logger.exception('[%s] Analysis failed for video_id=%d: %s', task_id, video_id, exc)
        try:
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, str(exc)[:255])
        except Exception as db_exc:
            logger.error('Failed to mark task as failed: %s', db_exc)

        _notify_callback(callback_url, video_id, 'failed', fail_reason=str(exc)[:255])

        try:
            raise self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            logger.error('[%s] Max retries exceeded for video_id=%d', task_id, video_id)
            return {'video_id': video_id, 'status': 'failed', 'reason': str(exc)[:255]}
    finally:
        if local_video_path and is_temp_file and os.path.exists(local_video_path):
            try:
                os.remove(local_video_path)
            except OSError:
                pass


def _save_keypoints_json(video_id: int, frames: list, reps: Optional[List[Rep]] = None) -> None:
    """将关键点帧数据序列化为 JSON 并保存到本地存储目录"""
    import json

    from app.core.constants import KEYPOINT_MAP, SKELETON_CONNECTIONS

    try:
        keypoint_names = list(KEYPOINT_MAP.keys())
        frames_data = []
        for f in frames:
            kp_dict = {}
            for name in keypoint_names:
                kp = f.keypoints.get(name)
                if kp:
                    kp_dict[name] = {'x': round(kp.x, 4), 'y': round(kp.y, 4), 'z': round(kp.z, 4), 'visibility': round(kp.visibility, 3)}
            frame_data = {
                'frame_index': f.frame_index,
                'timestamp': round(f.timestamp, 3),
                'keypoints': kp_dict,
            }
            if f.hip_mid:
                frame_data['hip_mid'] = [round(v, 4) for v in f.hip_mid]
            if f.shoulder_mid:
                frame_data['shoulder_mid'] = [round(v, 4) for v in f.shoulder_mid]
            frames_data.append(frame_data)

        # 注意：rep.start_frame/end_frame 是切片后序列下标，不是原始 frame_index
        frame_ts_by_order = {idx: f.timestamp for idx, f in enumerate(frames)}
        rep_segments = []
        for rep in reps or []:
            start_idx = int(rep.start_frame)
            end_idx = int(rep.end_frame)
            normalized_phases = {
                str(k): int(v)
                for k, v in (rep.phases or {}).items()
            }
            rep_segments.append({
                'rep_id': int(rep.id),
                'start_frame': start_idx,
                'end_frame': end_idx,
                'start_time': round(float(frame_ts_by_order.get(start_idx, 0.0)), 3),
                'end_time': round(float(frame_ts_by_order.get(end_idx, 0.0)), 3),
                'phases': normalized_phases,
            })

        payload = {
            'video_id': video_id,
            'total_frames': len(frames_data),
            'keypoint_names': keypoint_names,
            'skeleton_connections': SKELETON_CONNECTIONS,
            'frames': frames_data,
            'rep_segments': rep_segments,
        }

        # 保存到本地存储目录
        storage_root = Path(settings.local_storage_root) / settings.oss_bucket
        keypoints_dir = storage_root / 'keypoints'
        keypoints_dir.mkdir(parents=True, exist_ok=True)
        json_path = keypoints_dir / f'{video_id}.json'
        json_path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
        logger.info(
            'Saved keypoints JSON for video_id=%d: %s (%d frames, %d reps)',
            video_id,
            json_path,
            len(frames_data),
            len(rep_segments),
        )
    except Exception as exc:
        logger.warning('Failed to save keypoints JSON for video_id=%d: %s', video_id, exc)


def _notify_callback(callback_url: Optional[str], video_id: int, analysis_status: str, **kwargs) -> bool:
    """投递终态回调；短暂网络故障同步重试，最终状态写入 analysis_task 供补偿。"""
    from app.db.repository import AnalysisRepository
    from app.db.session import sync_session_scope

    callback_url = callback_url or settings.analysis_callback_url
    if not callback_url:
        logger.error('No callback URL configured for video_id=%d', video_id)
        return False

    payload = {
        'video_id': video_id,
        'analysis_status': analysis_status,
        **kwargs,
    }
    last_error: Optional[str] = None
    for attempt in range(1, 4):
        try:
            import requests

            response = requests.post(
                callback_url,
                json=payload,
                timeout=10,
                headers={'X-Internal-Token': settings.analysis_internal_token},
            )
            if 200 <= response.status_code < 300:
                with sync_session_scope() as session:
                    AnalysisRepository(session).record_callback_delivery(
                        video_id, callback_url, payload, 'delivered'
                    )
                logger.info('Callback delivered: video_id=%d, attempt=%d', video_id, attempt)
                return True
            last_error = f'HTTP {response.status_code}: {response.text[:160]}'
        except Exception as exc:
            last_error = str(exc)

        logger.warning('Callback attempt %d/3 failed for video_id=%d: %s', attempt, video_id, last_error)
        if attempt < 3:
            time.sleep(attempt)

    with sync_session_scope() as session:
        AnalysisRepository(session).record_callback_delivery(
            video_id,
            callback_url,
            payload,
            'retry_pending',
            error=last_error or '回调投递失败',
            next_retry_at=datetime.utcnow() + timedelta(minutes=1),
        )
    logger.error('Callback delivery deferred for recovery: video_id=%d, error=%s', video_id, last_error)
    return False


@celery_app.task(name='analysis.retry_pending_callbacks')
def retry_pending_callbacks() -> Dict[str, int]:
    """重投已落库但尚未投递成功的终态回调。"""
    from app.db.models import AnalysisTask
    from app.db.session import sync_session_scope

    delivered = 0
    scanned = 0
    now = datetime.utcnow()
    with sync_session_scope() as session:
        tasks = (
            session.query(AnalysisTask)
            .filter(AnalysisTask.callback_status == 'retry_pending')
            .filter((AnalysisTask.callback_next_retry_at.is_(None)) | (AnalysisTask.callback_next_retry_at <= now))
            .order_by(AnalysisTask.callback_next_retry_at.asc())
            .limit(50)
            .all()
        )
        pending = [
            (int(task.video_id), task.callback_url, dict(task.callback_payload or {}))
            for task in tasks
        ]

    for video_id, callback_url, payload in pending:
        scanned += 1
        status = str(payload.pop('analysis_status', 'failed'))
        payload.pop('video_id', None)
        if callback_url and _notify_callback(callback_url, video_id, status, **payload):
            delivered += 1

    return {'scanned': scanned, 'delivered': delivered}


def _video_score_to_dict(vs: VideoScore) -> Dict[str, Any]:
    return {
        'video_id': vs.video_id,
        'total_reps': vs.total_reps,
        'valid_reps': vs.valid_reps,
        'average_score': vs.average_score,
        'grade': vs.grade,
        'accuracy_avg': vs.accuracy_avg,
        'stability_avg': vs.stability_avg,
        'control_avg': vs.control_avg,
        'duration_avg': vs.duration_avg,
        'avg_hold_duration': vs.avg_hold_duration,
        'main_issues': vs.main_issues,
        'advice_summary': vs.advice_summary,
        'confidence_score': vs.confidence_score,
        'analysis_version': vs.analysis_version,
    }


def _rep_score_to_dict(rs: RepScore) -> Dict[str, Any]:
    return {
        'rep_id': rs.rep_id,
        'accuracy_score': rs.accuracy_score,
        'stability_score': rs.stability_score,
        'control_score': rs.control_score,
        'duration_score': rs.duration_score,
        'total_score': rs.total_score,
        'grade': rs.grade,
        'valid_flag': rs.valid_flag,
        'compensation_types': rs.compensation_types,
        'hold_duration': rs.hold_duration,
    }
