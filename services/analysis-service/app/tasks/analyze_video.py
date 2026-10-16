"""Celery 异步任务：视频动作分析全流水线"""

import copy
import logging
import os
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from billiard.exceptions import WorkerLostError
from celery import signals

from app.core.abdominal_visual_signal import (
    VISUAL_VERSION,
    VisualSignal,
    extract_abdominal_visual_signal,
    segment_abdominal_visual,
)
from app.core.config import ROOT_DIR, settings
from app.core.constants import ABDOMINAL_SEGMENTATION_VERSION_LEGACY
from app.core.knee_bilateral_cycle import (
    VERSION as KNEE_BILATERAL_VERSION,
    preview_knee_bilateral_cycle, score_knee_bilateral, to_segmentation_result,
)
from app.core.models import CompareResult, ConfidenceResult, QualityCheckResult, Rep, RepScore, SegmentationResult, VideoScore
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)
VISUAL_ANCHOR_KEYPOINTS = ('LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_HIP', 'RIGHT_HIP')


def _create_temp_video_path(video_key: str) -> str:
    """在受控的持久目录创建临时视频路径，避免 Docker tmpfs 被下载文件撑爆。"""
    temp_dir = Path(settings.analysis_temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)
    if not temp_dir.is_dir():
        raise RuntimeError(f'分析临时目录不可用: {temp_dir}')
    if not os.access(temp_dir, os.W_OK):
        raise RuntimeError(f'分析临时目录不可写: {temp_dir}')
    suffix = os.path.splitext(video_key)[1] or '.mp4'
    fd, local_path = tempfile.mkstemp(suffix=suffix, dir=str(temp_dir))
    os.close(fd)
    return local_path


def _stream_http_video(url: str, local_path: str) -> bool:
    """流式下载对象，避免 response.content 将整条视频同时常驻内存。"""
    import requests

    with requests.get(url, stream=True, timeout=(10, 120)) as response:
        if response.status_code != 200:
            logger.warning('Failed to download %s via public URL: status=%s', url, response.status_code)
            return False
        with open(local_path, 'wb') as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    output.write(chunk)
    return os.path.getsize(local_path) > 0


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
        local_path: Optional[str] = None
        try:
            local_path = _create_temp_video_path(video_key)
            public_url = f'{public_base}/{video_key}'
            if _stream_http_video(public_url, local_path):
                logger.info('Downloaded video via OSS public URL: %s -> %s', public_url, local_path)
                return local_path, True
            if os.path.exists(local_path):
                os.remove(local_path)
        except Exception as exc:
            logger.warning('Failed to download %s via OSS public URL: %s', video_key, exc)
            if local_path and os.path.exists(local_path):
                os.remove(local_path)

    # ── boto3 S3 下载（兼容 MinIO，使用 path_style + s3v4 签名）────────────
    endpoint = settings.oss_endpoint.strip()
    access_key = settings.oss_access_key or settings.oss_access_key_id
    secret_key = settings.oss_secret_key or settings.oss_access_key_secret
    if endpoint and access_key and secret_key:
        local_path: Optional[str] = None
        try:
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
            local_path = _create_temp_video_path(video_key)
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
                if local_path and os.path.exists(local_path):
                    os.remove(local_path)
            except OSError:
                pass

    # ── 阿里云 oss2 下载（原生 OSS 环境回退）───────────────────────────────
    local_path: Optional[str] = None
    try:
        import oss2

        auth = oss2.Auth(settings.oss_access_key_id, settings.oss_access_key_secret)
        bucket = oss2.Bucket(auth, settings.oss_endpoint, settings.oss_bucket)

        local_path = _create_temp_video_path(video_key)
        bucket.get_object_to_file(video_key, local_path)
        logger.info('Downloaded video from OSS: %s -> %s', video_key, local_path)
        return local_path, True
    except ImportError:
        logger.warning('oss2 not installed, cannot download %s', video_key)
        return None, False
    except Exception as exc:
        logger.warning('Failed to download %s from OSS: %s', video_key, exc)
        if local_path and os.path.exists(local_path):
            os.remove(local_path)
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


def _resolve_pose_sampling(action_type: str, requested_sample_fps: Optional[int]) -> Tuple[int, bool]:
    """返回姿态推理频率及是否按固定时间戳采样。

    骨盆倾斜的线上默认值为 4fps，以适配 300 秒 / 1200 帧的资源预算；传入显式
    采样率时则按请求值执行，供 4fps、6fps、10fps 的同视频回归对比使用。骨盆动作
    始终按真实时间戳采样，避免源视频帧率不能整除时产生时序漂移。
    """
    target_fps = settings.sample_fps
    if isinstance(requested_sample_fps, (int, float)):
        target_fps = max(4, min(30, int(round(requested_sample_fps))))
    if action_type == 'pelvic_tilt':
        return (target_fps if requested_sample_fps is not None else 4), True
    return target_fps, False


def _should_run_visual_shadow(action_type: str, mode: str, short_clip: bool, source_type: Optional[str]) -> bool:
    """患者短片段和后台流程验证均计算腹壁轮廓诊断。"""
    return (
        action_type == 'abdominal_crunch'
        and mode == 'shadow'
        and (short_clip or source_type == 'admin_flow_verify')
    )


def _visual_analysis_limit_seconds(source_type: Optional[str]) -> float:
    """患者端控制二次解码成本；仅后台流程验证可分析长视频。"""
    return 300.0 if source_type == 'admin_flow_verify' else 30.0


def _uses_visual_practice(action_type: str, mode: str, short_clip: bool,
                          source_type: Optional[str]) -> bool:
    """所有小程序缩腹短片段统一使用视觉计次；后台流程验证维持原规则。"""
    return (action_type == 'abdominal_crunch' and mode == 'shadow' and short_clip
            and source_type == 'miniapp')


def _requires_abdominal_template_review(action_type: str, source_type: Optional[str], compatible: bool) -> bool:
    """患者评分须同口径；后台流程验证保留原有诊断分数与完成状态。"""
    return action_type == 'abdominal_crunch' and source_type != 'admin_flow_verify' and not compatible


def _expected_rep_range(action_type: str, source_type: Optional[str] = None) -> Tuple[int, int]:
    """普通训练视频的次数保护；管理端流程验证允许单个完整周期。"""
    minimum, maximum = {
        'abdominal_crunch': (1, 25),
        'pelvic_tilt': (3, 30),
        'knee_rotation': (4, 20),
    }.get(action_type, (1, 100))
    return (1, maximum) if source_type == 'admin_flow_verify' else (minimum, maximum)


@celery_app.task(
    name='analysis.analyze_video',
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    soft_time_limit=settings.analysis_timeout_seconds,
    acks_late=True,
    # 原生崩溃无法进入 Python 的 except/retry；立即确认失败并由 task_failure
    # 回写终态，避免同一消息无限重投、患者永远停在 processing。
    reject_on_worker_lost=False,
)
def analyze_video(
    self,
    video_id: int,
    action_type: str,
    video_key: Optional[str] = None,
    callback_url: Optional[str] = None,
    analysis_run_id: str = '',
    sample_fps: Optional[int] = None,
    threshold_config: Optional[Dict] = None,
) -> Dict[str, Any]:
    task_id = self.request.id
    started_at = time.monotonic()
    logger.info(
        '[%s] Analysis task started: video_id=%d, action_type=%s, has_video_key=%s, sample_fps=%s, has_callback_url=%s',
        task_id,
        video_id,
        action_type,
        bool(video_key),
        sample_fps if sample_fps is not None else 'default',
        bool(callback_url),
    )

    local_video_path: Optional[str] = None
    is_temp_file = False

    try:
        # 数据库驱动和连接初始化也可能失败；必须纳入任务的重试与终态落库逻辑，
        # 否则 Celery 已消费的消息会在数据库状态仍为 queued 时直接失败，患者端会无限等待。
        from app.db.repository import AnalysisRepository
        from app.db.session import sync_session_scope

        with sync_session_scope() as session:
            repo = AnalysisRepository(session)
            persisted_task = repo.create_analysis_task(video_id, str(task_id), analysis_run_id)
            if persisted_task.analysis_run_id != analysis_run_id:
                logger.warning(
                    '[%s] Ignoring stale analysis worker: video_id=%d, worker_run_id=%s, current_run_id=%s',
                    task_id,
                    video_id,
                    analysis_run_id,
                    persisted_task.analysis_run_id,
                )
                return {'video_id': video_id, 'status': 'ignored', 'reason': 'stale_analysis_run'}

        with sync_session_scope() as session:
            repo = AnalysisRepository(session)
            video = repo.get_video(video_id)
            short_clip = bool(video and video.short_clip and video.source_type == 'miniapp')
            source_type = video.source_type if video else None
            if not video_key and video:
                video_key = video.video_key

        local_video_path, is_temp_file = _resolve_video_source(video_id, action_type, video_key)
        logger.info(
            '[%s] Video source resolved: video_id=%d, temporary_file=%s, file_size_bytes=%d',
            task_id,
            video_id,
            is_temp_file,
            os.path.getsize(local_video_path),
        )

        from app.core.video_quality import check_video_quality

        quality_result: QualityCheckResult = check_video_quality(local_video_path, action_type=action_type if short_clip else '')
        logger.info('[%s] Quality metadata check: status=%s', task_id, quality_result.quality_status)
        if quality_result.duration > settings.max_analysis_duration_seconds:
            reason = (
                f'视频时长为 {quality_result.duration:.0f} 秒，超过当前分析上限 '
                f'{settings.max_analysis_duration_seconds} 秒；请截取包含完整动作的短视频后重试'
            )
            logger.warning('[%s] Analysis duration rejected: video_id=%d, duration=%.2fs, limit=%ds', task_id, video_id, quality_result.duration, settings.max_analysis_duration_seconds)
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, reason)
            _notify_callback(callback_url, video_id, analysis_run_id, task_id, 'failed', fail_reason=reason)
            return {'video_id': video_id, 'status': 'failed', 'reason': reason}
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
                analysis_run_id,
                task_id,
                'quality_insufficient',
                fail_reason='视频基础质量不足',
                quality_status=quality_result.quality_status,
            )
            return {'video_id': video_id, 'status': 'quality_insufficient', 'reason': '视频基础质量不足'}

        # 基础画面检查已完成；接下来逐帧解码并提取人体关键点，通常是视频处理中最耗时的步骤。
        with sync_session_scope() as session:
            AnalysisRepository(session).update_progress_stage(video_id, 'keypoint_extraction')

        from app.core.pose_estimator import PoseEstimator

        effective_sample_fps, exact_sample_timestamps = _resolve_pose_sampling(action_type, sample_fps)

        estimator = PoseEstimator(
            sample_fps=effective_sample_fps,
            model_complexity=settings.model_complexity,
            max_frames=settings.max_analysis_frames,
            max_frame_width=settings.max_pose_frame_width,
            exact_sample_timestamps=exact_sample_timestamps,
        )
        frames = estimator.extract_frames(local_video_path)
        effective_sample_fps = estimator.effective_sample_fps
        # 算法预处理会缩放和平移关键点；单独保留原始画面坐标供管理端骨架叠加，不能用处理后的坐标覆盖它。
        visualization_frames = copy.deepcopy(frames)
        logger.info(
            '[%s] Pose extraction: %d frames (effective_sample_fps=%.2f, max_frames=%d, max_frame_width=%d, '
            'source_duration=%.2fs, decoded_duration=%.2fs, decode_completion=%.3f)',
            task_id,
            len(frames),
            effective_sample_fps,
            settings.max_analysis_frames,
            settings.max_pose_frame_width,
            estimator.source_duration_seconds,
            estimator.decoded_duration_seconds,
            estimator.decode_completion_ratio,
        )

        # 容器/封装元信息与实际解码帧时长不一致时，不允许只凭标注时长绕过门禁。
        from app.core.video_quality import duration_limits_for_action
        min_duration, max_duration = duration_limits_for_action(action_type if short_clip else '')
        # OpenCV 给出的帧数/FPS 与容器时长可能有约一帧偏差；容忍这一帧的偏差。
        frame_tolerance = 1.0 / quality_result.fps if quality_result.fps > 0 else 0.05
        if (estimator.source_duration_seconds > 0 and
                not min_duration - frame_tolerance <= estimator.source_duration_seconds <= max_duration):
            reason = f'实际视频时长不在 {min_duration}~{max_duration} 秒范围内，请上传完整动作短片段'
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.update_video_quality(video_id, 'insufficient', quality_issues=['duration_out_of_range'])
                repo.mark_task_quality_insufficient(video_id, reason)
            _notify_callback(callback_url, video_id, analysis_run_id, task_id, 'quality_insufficient',
                             fail_reason=reason, quality_status='insufficient', quality_issues=['duration_out_of_range'])
            return {'video_id': video_id, 'status': 'quality_insufficient', 'reason': reason}

        # 解码虽达到容器时长 90% 仍可能不足动作最短时长，不能用尾部缺失帧凑一次。
        decoded_tolerance = 1.0 / max(effective_sample_fps, 1.0)
        if (estimator.has_complete_decode and estimator.decoded_duration_seconds > 0 and
                estimator.decoded_duration_seconds < min_duration - decoded_tolerance):
            reason = '实际可分析的视频不足动作最短时长，请上传包含完整动作的短片段'
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.update_video_quality(video_id, 'insufficient', quality_issues=['duration_too_short'])
                repo.mark_task_quality_insufficient(video_id, reason)
            _notify_callback(callback_url, video_id, analysis_run_id, task_id, 'quality_insufficient',
                             fail_reason=reason, quality_status='insufficient', quality_issues=['duration_too_short'])
            return {'video_id': video_id, 'status': 'quality_insufficient', 'reason': reason}

        if not estimator.has_complete_decode:
            reason = (
                f'视频解码不完整：可读取 {estimator.decoded_duration_seconds:.0f} 秒，'
                f'文件标注 {estimator.source_duration_seconds:.0f} 秒；请重新导出或重新上传完整视频'
            )
            logger.warning(
                '[%s] Incomplete video decode: video_id=%d, decoded=%.2fs, source=%.2fs, completion=%.3f',
                task_id,
                video_id,
                estimator.decoded_duration_seconds,
                estimator.source_duration_seconds,
                estimator.decode_completion_ratio,
            )
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.update_video_quality(
                    video_id,
                    'insufficient',
                    quality_issues=[{
                        'code': 'VIDEO_DECODE_INCOMPLETE',
                        'decoded_duration_seconds': round(estimator.decoded_duration_seconds, 3),
                        'source_duration_seconds': round(estimator.source_duration_seconds, 3),
                        'decode_completion_ratio': round(estimator.decode_completion_ratio, 4),
                    }],
                )
                repo.mark_task_quality_insufficient(video_id, reason)
            _notify_callback(
                callback_url,
                video_id,
                analysis_run_id,
                task_id,
                'quality_insufficient',
                fail_reason=reason,
                quality_status='insufficient',
                quality_issues=[{
                    'code': 'VIDEO_DECODE_INCOMPLETE',
                    'decoded_duration_seconds': round(estimator.decoded_duration_seconds, 3),
                    'source_duration_seconds': round(estimator.source_duration_seconds, 3),
                    'decode_completion_ratio': round(estimator.decode_completion_ratio, 4),
                }],
            )
            return {'video_id': video_id, 'status': 'quality_insufficient', 'reason': reason}

        # 先保存原始关键点帧数据，供骨架可视化与失败排查使用
        _save_keypoints_json(
            video_id,
            visualization_frames,
            effective_sample_fps=effective_sample_fps,
            short_clip=short_clip,
        )

        # 姿态帧已成功读取，后续进入关键点校验与动作周期识别阶段。
        with sync_session_scope() as session:
            AnalysisRepository(session).update_progress_stage(video_id, 'motion_analysis')

        if len(frames) < 10:
            reason = '提取的关键点帧数不足'
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, reason)
            _notify_callback(callback_url, video_id, analysis_run_id, task_id, 'failed', fail_reason=reason)
            return {'video_id': video_id, 'status': 'failed', 'reason': reason}

        visual_abdominal_clip = _uses_visual_practice(
            action_type, settings.abdominal_segmentation_mode, short_clip, source_type,
        )
        visibility = estimator.compute_avg_visibility(
            frames, keypoint_names=VISUAL_ANCHOR_KEYPOINTS if visual_abdominal_clip else None,
        )
        quality_result = check_video_quality(local_video_path, keypoint_avg_visibility=visibility, action_type=action_type if short_clip else '')
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
                analysis_run_id,
                task_id,
                'quality_insufficient',
                fail_reason='关键点可见性不足',
                quality_status=quality_result.quality_status,
            )
            return {'video_id': video_id, 'status': 'quality_insufficient', 'reason': '关键点可见性不足'}

        from app.core.preprocessor import DataPreprocessor, KeypointQualityError

        preprocessor = DataPreprocessor()
        try:
            frames = preprocessor.run_full_pipeline(frames)
        except KeypointQualityError as exc:
            # 患者只接收可执行的拍摄建议；精确可用率仅随 quality_issues 回传，
            # 供管理端核查，不应被误认为“多少画面未拍到”。
            reason = str(exc)
            quality_issues = exc.quality_issues
            logger.warning('[%s] Keypoint safety gate rejected video_id=%d: %s', task_id, video_id, reason)
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.update_video_quality(video_id, 'insufficient', quality_issues=quality_issues)
                repo.mark_task_quality_insufficient(video_id, reason)
            _notify_callback(
                callback_url,
                video_id,
                analysis_run_id,
                task_id,
                'quality_insufficient',
                fail_reason=reason,
                quality_status='insufficient',
                quality_issues=quality_issues,
            )
            return {'video_id': video_id, 'status': 'quality_insufficient', 'reason': reason}
        except ValueError as exc:
            reason = str(exc)
            logger.warning('[%s] Keypoint safety gate rejected video_id=%d: %s', task_id, video_id, reason)
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_quality_insufficient(video_id, reason)
            _notify_callback(
                callback_url,
                video_id,
                analysis_run_id,
                task_id,
                'quality_insufficient',
                fail_reason=reason,
                quality_status='insufficient',
            )
            return {'video_id': video_id, 'status': 'quality_insufficient', 'reason': reason}

        from app.core.phase_segmenter import PhaseSegmenter, SegmentationError

        segmenter = PhaseSegmenter(sample_fps=effective_sample_fps)
        segmentation_mode = settings.abdominal_segmentation_mode
        if segmentation_mode not in {'legacy_peak', 'shadow', 'cycle_state_machine'}:
            raise ValueError(f'Invalid ABDOMINAL_SEGMENTATION_MODE: {segmentation_mode}')
        visual_score_mode = settings.abdominal_visual_score_mode
        if visual_score_mode not in {'legacy', 'evidence_shadow', 'evidence'}:
            raise ValueError(f'Invalid ABDOMINAL_VISUAL_SCORE_MODE: {visual_score_mode}')
        uses_visual_practice = _uses_visual_practice(
            action_type, segmentation_mode, short_clip, source_type,
        )
        knee_mode = settings.knee_rotation_mode
        if knee_mode not in {'legacy', 'shadow', 'bilateral'}:
            raise ValueError(f'Invalid KNEE_ROTATION_MODE: {knee_mode}')
        uses_knee_bilateral = action_type == 'knee_rotation' and knee_mode == 'bilateral'
        # 捕获切分异常（例如信号幅度不足），直接把具体原因透传给回调和数据库。
        # Shadow 共享同一份预处理 frames，仅额外运行一次轻量切分，绝不重复姿态、预处理或评分。
        try:
            # 保留峰值与闭环切分供诊断；小程序缩腹在 shadow 模式下由视觉计次接管。
            abdominal_cycle_requirement = False if action_type == 'abdominal_crunch' else None
            legacy_segment_started = time.monotonic()
            legacy_unavailable_reason = ''
            try:
                legacy_result = segmenter.segment_with_diagnostics(
                    frames, action_type, mode='legacy_peak', short_clip=short_clip,
                    require_complete_abdominal_cycle=abdominal_cycle_requirement,
                )
            except SegmentationError as exc:
                if not uses_visual_practice and not uses_knee_bilateral:
                    raise
                legacy_unavailable_reason = str(exc)
                legacy_result = SegmentationResult(
                    'knee_rotation_legacy' if action_type == 'knee_rotation'
                    else ABDOMINAL_SEGMENTATION_VERSION_LEGACY, [],
                )
            legacy_segment_ms = int((time.monotonic() - legacy_segment_started) * 1000)
            cycle_result = None
            cycle_segment_ms = 0
            shadow_enabled = action_type == 'abdominal_crunch' and segmentation_mode == 'shadow'
            cycle_enabled = action_type == 'abdominal_crunch' and segmentation_mode == 'cycle_state_machine'
            if shadow_enabled or cycle_enabled:
                cycle_segment_started = time.monotonic()
                try:
                    cycle_result = segmenter.segment_with_diagnostics(
                        frames, action_type, mode='cycle_state_machine', short_clip=short_clip,
                        require_complete_abdominal_cycle=abdominal_cycle_requirement,
                    )
                except SegmentationError as exc:
                    if not uses_visual_practice:
                        raise
                    segmentation_cycle_unavailable_reason = str(exc)
                    cycle_result = None
                else:
                    segmentation_cycle_unavailable_reason = ''
                cycle_segment_ms = int((time.monotonic() - cycle_segment_started) * 1000)
            visual_result = None
            visual_signal = None
            visual_extract_ms = 0
            visual_segment_ms = 0
            if _should_run_visual_shadow(action_type, segmentation_mode, short_clip, source_type):
                # 视觉分析共用一份视频；不可观测时小程序记为未评分，后台保持原结果。
                try:
                    visual_started = time.monotonic()
                    visual_signal = extract_abdominal_visual_signal(
                        local_video_path, visualization_frames,
                        max_seconds=_visual_analysis_limit_seconds(source_type),
                    )
                    visual_extract_ms = int((time.monotonic() - visual_started) * 1000)
                    visual_started = time.monotonic()
                    visual_result = segment_abdominal_visual(visual_signal)
                    visual_segment_ms = int((time.monotonic() - visual_started) * 1000)
                except Exception as exc:
                    logger.exception('[%s] Visual shadow segmentation unavailable: %s', task_id, exc)
                    visual_signal = VisualSignal(reason='视觉影子算法异常')
            knee_preview = None
            knee_result = None
            if action_type == 'knee_rotation' and knee_mode in {'shadow', 'bilateral'}:
                # 必须使用与画面一致的原始坐标：通用预处理会缩放、平移并遮蔽部分膝点。
                knee_preview = preview_knee_bilateral_cycle(visualization_frames, effective_sample_fps)
                knee_result = to_segmentation_result(knee_preview)
            # 后台 shadow 只记录诊断；小程序缩腹使用视觉结果作为正式计次。
            formal_result = cycle_result if cycle_enabled and cycle_result is not None else legacy_result
            if uses_visual_practice:
                formal_result = visual_result if visual_result is not None else SegmentationResult(VISUAL_VERSION, [])
            if uses_knee_bilateral and knee_result is not None:
                formal_result = knee_result
            reps: List[Rep] = formal_result.reps
            # Candidate 的帧序号是抽样后序列下标；以同一序列的时间戳换算
            # 视频位置，供管理端回看，不参与任何切分或评分判断。
            frame_timestamps = {index: frame.timestamp for index, frame in enumerate(frames)}
            segmentation_snapshot = _build_segmentation_snapshot(
                action_type=action_type,
                mode=segmentation_mode,
                effective_sample_fps=effective_sample_fps,
                legacy_result=legacy_result,
                cycle_result=cycle_result,
                legacy_segment_ms=legacy_segment_ms,
                cycle_segment_ms=cycle_segment_ms,
                frame_timestamps=frame_timestamps,
                visual_result=visual_result,
                visual_signal=visual_signal,
                visual_extract_ms=visual_extract_ms,
                visual_segment_ms=visual_segment_ms,
            )
            if uses_visual_practice:
                segmentation_snapshot.update({
                    'formal_version': formal_result.version,
                    'formal_rep_count': len(reps),
                    'count_source': 'visual',
                    'score_type': 'visual_practice',
                    'application_scope': 'miniapp',
                    'legacy_unavailable_reason': legacy_unavailable_reason,
                    'cycle_unavailable_reason': segmentation_cycle_unavailable_reason if shadow_enabled else '',
                })
            if knee_preview is not None:
                def knee_event_snapshot(event):
                    return {
                        'start_seconds': round(visualization_frames[event.start_frame].timestamp, 2),
                        'arrival_seconds': round(visualization_frames[event.arrival_frame].timestamp, 2),
                        'return_start_seconds': round(visualization_frames[event.return_start_frame].timestamp, 2),
                        'end_seconds': round(visualization_frames[event.end_frame].timestamp, 2),
                        'sign': event.sign, 'amplitude': event.amplitude,
                    }

                segmentation_snapshot['knee_bilateral_preview'] = {
                    'version': KNEE_BILATERAL_VERSION,
                    'mode': knee_mode,
                    'cycle_count': len(knee_preview.cycles),
                    'cycles': [
                        {'first': knee_event_snapshot(cycle.first),
                         'second': knee_event_snapshot(cycle.second)}
                        for cycle in knee_preview.cycles
                    ],
                    'unpaired_excursions': len(knee_preview.excursions) - 2 * len(knee_preview.cycles),
                    'direction_verified': knee_preview.direction_verified,
                    'score_calibrated': knee_preview.score_calibrated,
                    'reason': knee_preview.reason,
                }
                if uses_knee_bilateral:
                    segmentation_snapshot.update({
                        'formal_version': formal_result.version,
                        'formal_rep_count': len(reps),
                        'count_source': 'bilateral_knee_separation',
                        'score_type': 'knee_bilateral_evidence',
                        'legacy_unavailable_reason': legacy_unavailable_reason,
                    })
        except SegmentationError as seg_exc:
            seg_reason = str(seg_exc)
            logger.warning('[%s] Segmentation failed: %s', task_id, seg_reason)
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, seg_reason)
            _notify_callback(callback_url, video_id, analysis_run_id, task_id, 'failed', fail_reason=seg_reason)
            return {'video_id': video_id, 'status': 'failed', 'reason': seg_reason}

        # 只向原始画面坐标写入周期信息；评分使用的归一化坐标不能用于与视频画面对齐。
        _save_keypoints_json(
            video_id,
            visualization_frames,
            reps=reps,
            effective_sample_fps=effective_sample_fps,
            segmentation_version=formal_result.version,
            short_clip=short_clip,
        )
        logger.info('[%s] Segmentation: %d reps detected', task_id, len(reps))
        # 小幅度缩腹在视频中可能无法可靠切出周期；0 次是算法观察值，不是训练失败。
        # 视频确已通过质量和关键点检查时保留该结果及诊断，待复核，不伪造 rep。
        uncertain_abdominal_clip = short_clip and action_type == 'abdominal_crunch' and not reps and not uses_visual_practice
        if not reps and not uncertain_abdominal_clip and not uses_visual_practice:
            empty_reason = (
                '已收到训练视频，但尚未看清两侧转动并各自回正；请把双膝完整拍入画面后重试'
                if uses_knee_bilateral else '未检测到有效动作，视频中可能没有完整的动作周期'
            )
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, empty_reason)
            _notify_callback(callback_url, video_id, analysis_run_id, task_id, 'failed', fail_reason=empty_reason)
            return {'video_id': video_id, 'status': 'failed', 'reason': empty_reason}

        # 短片段仅应包含 1~2 个完整动作；多于 2 次可能是选错动作或切分过密，
        # 不直接给患者确定性评分，保留诊断并转人工复核。
        if short_clip and len(reps) > 2 and not uses_visual_practice:
            cn_name = {'knee_rotation': '膝关节旋转', 'pelvic_tilt': '骨盆倾斜', 'abdominal_crunch': '缩腹运动'}.get(action_type, action_type)
            reason = (
                f'分析检测到 {len(reps)} 次动作周期，超出{cn_name}短片段预期的 1~2 次，结果需要人工复核'
            )
            logger.warning('[%s] Rep count validation failed: %d reps for %s', task_id, len(reps), action_type)
            excess_reps_reason = reason
        else:
            excess_reps_reason = None

        if not short_clip:
            rep_min, rep_max = _expected_rep_range(action_type, source_type)
            if not rep_min <= len(reps) <= rep_max:
                reason = f'分析检测到 {len(reps)} 次动作周期，不符合该动作的预期范围（{rep_min}~{rep_max} 次）'
                with sync_session_scope() as session:
                    AnalysisRepository(session).mark_task_failed(video_id, reason)
                _notify_callback(callback_url, video_id, analysis_run_id, task_id, 'failed', fail_reason=reason)
                return {'video_id': video_id, 'status': 'failed', 'reason': reason}

        from app.core.calculators import get_calculator

        # 视觉正式结果不使用肩髋角度特征；姿态计算失败不能抢先终止轮廓结果。
        if uses_visual_practice or uses_knee_bilateral:
            params_result = {}
            segmentation_snapshot['pose_comparison_skipped'] = True
        else:
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
                # 模板统计量保留原值供诊断；若其特征版本/单位与计算器不兼容，
                # 下方会强制待复核，不能将比较结果作为确定性评分。
                merged_template[code] = {**merged_template.get(code, {}), **stats}

        merged_thresholds = DEFAULT_THRESHOLDS.copy()
        if db_template and db_template.get('threshold_config'):
            # 激活模板的特征级方向性阈值（lower/upper bound）是该版本的一部分，
            # 不能在运行时被默认模板覆盖。
            merged_thresholds.update(db_template['threshold_config'])
        if threshold_config:
            merged_thresholds.update(threshold_config)

        scoring_contract_compatible = True
        if action_type == 'abdominal_crunch':
            from app.core.scoring_contract import ABDOMINAL_POSE_FEATURE_SCHEMA, assess_scoring_contract

            # 这是计算器的特征定义版本，不代表当前模板一定兼容。
            segmentation_snapshot['feature_schema_version'] = ABDOMINAL_POSE_FEATURE_SCHEMA
            template_thresholds = db_template.get('threshold_config') if db_template else {}
            scoring_contract = assess_scoring_contract(action_type, template_thresholds)
            segmentation_snapshot['scoring_contract'] = scoring_contract
            scoring_contract_compatible = bool(scoring_contract['compatible'])
            if source_type == 'admin_flow_verify':
                # 仅内部流程验证试算。姿态模板分数与视觉规则分分开存放，绝不覆盖正式结果。
                from app.core.scoring_preview import preview_abdominal_reps
                for key, candidate_result in (
                    ('cycle_score_preview', cycle_result),
                    ('visual_score_preview', visual_result if visual_signal is not None and visual_signal.observable else None),
                ):
                    if candidate_result is None:
                        continue
                    try:
                        preview = preview_abdominal_reps(
                            frames, candidate_result.reps, effective_sample_fps,
                            db_template.get('reference_stats', {}) if db_template else {},
                            merged_thresholds,
                        )
                        preview['template_comparable'] = bool(scoring_contract['compatible'] and preview['template_comparable'])
                        if not preview['template_comparable']:
                            preview['score_status'] = 'provisional_incompatible_template'
                        segmentation_snapshot[key] = preview
                    except Exception as exc:
                        logger.exception('[%s] %s unavailable: %s', task_id, key, exc)
                        segmentation_snapshot[key] = {'score_status': 'unavailable', 'reason': str(exc)}

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

        from app.core.scoring import ScoringEngine

        engine = ScoringEngine()
        rep_scores: List[RepScore] = []
        for rep_id, compare_results in all_compare_results.items():
            rep_score = engine.score_rep(rep_id, compare_results, action_type)
            rep_key = f'rep_{rep_id}'
            if rep_key in params_result and isinstance(params_result[rep_key], dict):
                rep_score.hold_duration = params_result[rep_key].get('hold_duration', 0.0)
            rep_scores.append(rep_score)

        from app.core.confidence import compute_confidence

        confidence: ConfidenceResult = compute_confidence(
            frames=frames,
            quality_avg_visibility=quality_result.avg_visibility,
            total_reps=len(reps),
            valid_reps=(len(reps) if uses_visual_practice or uses_knee_bilateral else
                        sum(score.valid_flag for score in rep_scores) if short_clip else len(reps)),
            short_clip=short_clip,
            quality_keypoint_names=VISUAL_ANCHOR_KEYPOINTS if uses_visual_practice else None,
        )

        if uses_knee_bilateral:
            knee_score_available = bool(
                knee_preview is not None and 1 <= len(reps) <= 25
                and quality_result.quality_status == 'passed' and confidence.level == 'high'
            )
            rep_scores, video_score = score_knee_bilateral(
                video_id, knee_preview, visualization_frames,
                confidence.overall, knee_score_available,
            )
            segmentation_snapshot['score_available'] = bool(rep_scores)
            segmentation_snapshot['score_version'] = KNEE_BILATERAL_VERSION
            segmentation_snapshot['score_unavailable_reason'] = (
                '' if rep_scores else '未检测到可信的双侧完整周期或画面可信度不足'
            )
        else:
            video_score: VideoScore = engine.aggregate_video_score(
                video_id=video_id,
                rep_scores=rep_scores,
                confidence_score=confidence.overall,
                short_clip=short_clip,
            )
        if knee_preview is not None:
            if uses_knee_bilateral:
                preview_reps, preview_video = rep_scores, video_score
            else:
                preview_reps, preview_video = score_knee_bilateral(
                    video_id, knee_preview, visualization_frames, confidence.overall,
                    bool(1 <= len(knee_preview.cycles) <= 25
                         and quality_result.quality_status == 'passed'
                         and confidence.level == 'high'),
                )
            segmentation_snapshot['knee_bilateral_preview']['score_preview'] = {
                'available': bool(preview_reps),
                'average_score': preview_video.average_score if preview_reps else None,
                'rep_scores': [rep.total_score for rep in preview_reps],
                'version': KNEE_BILATERAL_VERSION,
            }

        feature_units = _get_feature_units(action_type)
        quality_issues = quality_result.details.get('issues', [])
        quality_score = quality_result.avg_visibility * 100
        template_incomplete = any(
            compare.label == 'review_required'
            for results in all_compare_results.values()
            for compare in results
        )
        review_required_reason: Optional[str] = None
        if uncertain_abdominal_clip:
            review_required_reason = '视频暂时无法可靠识别缩腹完整周期（可能受幅度或拍摄影响）；训练记录已保留，结果待复核'
        elif excess_reps_reason:
            review_required_reason = excess_reps_reason
        elif _requires_abdominal_template_review(action_type, source_type, scoring_contract_compatible):
            review_required_reason = '当前缩腹金标准模板与本次分析的特征版本或单位不兼容，评分结果待复核'
        elif template_incomplete:
            review_required_reason = '参考动作模板不完整，结果需要人工复核'
        elif short_clip and not video_score.valid_reps:
            review_required_reason = '本次动作参数证据不足，结果需要人工复核'
        elif confidence.level != 'high':
            review_required_reason = '本次视频分析可信度不足，结果需要人工复核'
        elif quality_result.quality_status != 'passed':
            review_required_reason = '拍摄质量存在不确定性，结果需要人工复核'

        if source_type == 'admin_flow_verify' and action_type == 'abdominal_crunch' and segmentation_mode == 'shadow':
            # 使用和患者端相同的视觉规则分，只在管理端留试算快照；不改变流程验证的正式姿态分。
            if visual_result is not None and visual_signal is not None and visual_signal.observable:
                try:
                    from app.core.visual_practice_score import EVIDENCE_SCORE_VERSION, score_visual_evidence

                    visual_visibility = estimator.compute_avg_visibility(
                        frames, keypoint_names=VISUAL_ANCHOR_KEYPOINTS,
                    )
                    visual_confidence = compute_confidence(
                        frames, visual_visibility, len(visual_result.reps), len(visual_result.reps),
                        short_clip=short_clip or len(visual_result.reps) <= 2,
                        quality_keypoint_names=VISUAL_ANCHOR_KEYPOINTS,
                    )
                    available = bool(
                        1 <= len(visual_result.reps) <= 25
                        and quality_result.quality_status == 'passed'
                        and visual_confidence.level == 'high'
                    )
                    evidence_reps, evidence_video = score_visual_evidence(
                        video_id, visual_signal, visual_result, visual_confidence.overall, available,
                    )
                    segmentation_snapshot['visual_evidence_preview'] = {
                        'version': EVIDENCE_SCORE_VERSION,
                        'uncalibrated': True,
                        'score_available': bool(evidence_reps),
                        'average_score': evidence_video.average_score if evidence_reps else None,
                        'rep_scores': [item.total_score for item in evidence_reps],
                        'reason': '' if evidence_reps else (
                            '画面质量或视觉可信度不足' if not available else '暂无可评分的完整周期'
                        ),
                    }
                except Exception as exc:
                    logger.exception('[%s] Visual evidence preview unavailable: %s', task_id, exc)
                    segmentation_snapshot['visual_evidence_preview'] = {
                        'score_available': False, 'reason': str(exc),
                    }

        if uses_visual_practice:
            from app.core.visual_practice_score import (
                EVIDENCE_SCORE_VERSION, PRACTICE_SCORE_VERSION,
                score_visual_evidence, score_visual_practice,
            )

            score_available = bool(
                visual_signal is not None and visual_signal.observable
                and visual_result is not None and 1 <= len(reps) <= 25
                and quality_result.quality_status == 'passed' and confidence.level == 'high'
            )
            rep_scores, video_score = score_visual_practice(
                video_id, visual_signal or VisualSignal(), formal_result,
                confidence.overall, score_available,
            )
            selected_visual_version = PRACTICE_SCORE_VERSION
            if visual_score_mode in {'evidence_shadow', 'evidence'}:
                evidence_reps, evidence_video = score_visual_evidence(
                    video_id, visual_signal or VisualSignal(), formal_result,
                    confidence.overall, score_available,
                )
                segmentation_snapshot['visual_evidence_preview'] = {
                    'version': EVIDENCE_SCORE_VERSION,
                    'uncalibrated': True,
                    'score_available': bool(evidence_reps),
                    'average_score': evidence_video.average_score if evidence_reps else None,
                    'rep_scores': [item.total_score for item in evidence_reps],
                }
                if visual_score_mode == 'evidence':
                    rep_scores, video_score = evidence_reps, evidence_video
                    selected_visual_version = EVIDENCE_SCORE_VERSION
                    segmentation_snapshot['score_type'] = 'visual_evidence'
            all_compare_results = {}
            review_required_reason = None
            segmentation_snapshot['score_available'] = bool(rep_scores)
            segmentation_snapshot['score_mode'] = visual_score_mode
            segmentation_snapshot['score_version'] = selected_visual_version
            segmentation_snapshot['score_unavailable_reason'] = (
                '' if rep_scores else
                visual_signal.reason if visual_signal is not None and visual_signal.reason
                else '未检测到可评分的完整周期或画面可信度不足'
            )

        if review_required_reason:
            # 原始结果仅供后台复核；患者端不能把不确定计算展示成确定分数或动作结论。
            video_score.grade = '待复核'
            video_score.main_issues = []
            video_score.advice_summary = [{
                'advice_code': 'REVIEW_REQUIRED',
                'patient_text': '本次训练已记录。视频观察暂时不确定，不代表您没有完成练习；可以按自己的舒适幅度继续跟随引导。',
            }]

        # 捕获本次分析实际使用的模板溯源信息，写入 video_evaluation_result 留痕。
        provenance_template_id = (None if uses_visual_practice or uses_knee_bilateral
                                  else db_template.get('template_id') if db_template else None)
        provenance_template_version = (KNEE_BILATERAL_VERSION if uses_knee_bilateral else
                                       selected_visual_version if uses_visual_practice else
                                       db_template.get('version') if db_template else 'default_v1')
        provenance_threshold_snapshot = ({
            'score_type': 'knee_bilateral_evidence', 'version': KNEE_BILATERAL_VERSION,
            'amplitude_target': 0.07, 'hold_target_seconds': 3.0,
            'base_points': 72, 'amplitude_points': 8, 'balance_points': 5,
            'hold_points': 4, 'rhythm_points': 3, 'score_cap': 94,
            'unvalidated_clinical_outcome': True,
        } if uses_knee_bilateral else {
            'score_type': segmentation_snapshot['score_type'],
            'version': selected_visual_version,
            'score_mode': visual_score_mode,
            'uncalibrated': visual_score_mode == 'evidence',
            **({'base_points': 70, 'hold_points': 10, 'return_points': 10, 'rhythm_points': 10}
               if visual_score_mode == 'evidence'
               else {'base_points': 70, 'hold_points': 15, 'smoothness_points': 15}),
        }
                                         if uses_visual_practice else db_template.get('threshold_config') if db_template else None)

        # 所有评分计算完成，正在将分析结果写入报告。
        with sync_session_scope() as session:
            repo = AnalysisRepository(session)
            repo.update_progress_stage(video_id, 'report_generation')
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
                template_id=provenance_template_id,
                template_version=provenance_template_version,
                threshold_snapshot=provenance_threshold_snapshot,
                segmentation_version=formal_result.version,
                segmentation_snapshot=segmentation_snapshot,
            )

        final_status = 'review_required' if review_required_reason else 'completed'
        logger.info(
            '[%s] Analysis result persisted: video_id=%d, status=%s, score=%.2f, total_reps=%d, valid_reps=%d, confidence=%.3f',
            task_id,
            video_id,
            final_status,
            video_score.average_score,
            video_score.total_reps,
            video_score.valid_reps,
            confidence.overall,
        )
        evaluation_dict = _video_score_to_dict(video_score)
        evaluation_dict['template_id'] = provenance_template_id
        evaluation_dict['template_version'] = provenance_template_version
        evaluation_dict['segmentation_version'] = formal_result.version
        evaluation_dict['threshold_snapshot'] = provenance_threshold_snapshot
        _notify_callback(
            callback_url,
            video_id,
            analysis_run_id,
            task_id,
            final_status,
            # review_required 也是终态；主服务需保存原因，以便缩腹金标准源视频
            # 在模板不兼容时仍可作为“当前特征口径”的候选模板来源。
            fail_reason=review_required_reason,
            quality_status=quality_result.quality_status,
            quality_score=quality_score,
            quality_issues=quality_issues,
            video_evaluation=evaluation_dict,
            rep_evaluations=[_rep_score_to_dict(rs) for rs in rep_scores],
            analysis_version=video_score.analysis_version,
        )

        logger.info(
            '[%s] Analysis task finished: video_id=%d, status=%s, elapsed_ms=%d',
            task_id,
            video_id,
            final_status,
            int((time.monotonic() - started_at) * 1000),
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
        logger.exception(
            '[%s] Analysis task failed: video_id=%d, action_type=%s, elapsed_ms=%d, error_type=%s, error=%s',
            task_id,
            video_id,
            action_type,
            int((time.monotonic() - started_at) * 1000),
            type(exc).__name__,
            exc,
        )
        # 可重试异常不能提前写入终态或发送 failed 回调；否则下一次 Celery
        # 重试会被持久化的 failed 状态拦截，形成“可恢复故障永久失败”。
        if self.request.retries < self.max_retries:
            logger.warning(
                '[%s] Retrying analysis task: video_id=%d, attempt=%d/%d',
                task_id,
                video_id,
                self.request.retries + 1,
                self.max_retries,
            )
            raise self.retry(exc=exc)

        failure_reason = str(exc)[:255]
        try:
            with sync_session_scope() as session:
                repo = AnalysisRepository(session)
                repo.mark_task_failed(video_id, failure_reason)
        except Exception as db_exc:
            logger.error('Failed to mark task as failed: %s', db_exc)

        _notify_callback(callback_url, video_id, analysis_run_id, task_id, 'failed', fail_reason=failure_reason)
        logger.error('[%s] Analysis retries exhausted for video_id=%d', task_id, video_id)
        return {'video_id': video_id, 'status': 'failed', 'reason': failure_reason}
    finally:
        if local_video_path and is_temp_file and os.path.exists(local_video_path):
            try:
                os.remove(local_video_path)
            except OSError:
                pass
        # 关键点可视化副本与 NumPy 中间数组可能较大；任务结束时主动释放，
        # 让单 Worker 能稳定处理下一条视频而不是等待 Python GC 时机。
        if 'visualization_frames' in locals():
            del visualization_frames
        if 'frames' in locals():
            del frames


def _candidate_to_dict(candidate: Any, frame_timestamps: Optional[Dict[int, float]] = None) -> Dict[str, Any]:
    """截断后的候选诊断，避免写入逐帧关键点或无限长文本。"""
    payload = {
        'state': candidate.state,
        'start_frame': int(candidate.start_frame),
        'peak_frame': int(candidate.peak_frame),
        'return_frame': int(candidate.return_frame) if candidate.return_frame is not None else None,
        'stable_frame': int(candidate.stable_frame) if candidate.stable_frame is not None else None,
        'amplitude': round(float(candidate.amplitude), 4),
        'reason': str(candidate.reason)[:160],
    }
    if frame_timestamps:
        payload['start_time'] = round(float(frame_timestamps.get(payload['start_frame'], 0.0)), 3)
        payload['peak_time'] = round(float(frame_timestamps.get(payload['peak_frame'], 0.0)), 3)
        if payload['return_frame'] is not None:
            payload['return_time'] = round(float(frame_timestamps.get(payload['return_frame'], 0.0)), 3)
        if payload['stable_frame'] is not None:
            payload['stable_time'] = round(float(frame_timestamps.get(payload['stable_frame'], 0.0)), 3)
    if getattr(candidate, 'peak_start_frame', None) is not None:
        payload['peak_start_frame'] = int(candidate.peak_start_frame)
        payload['peak_end_frame'] = int(candidate.peak_end_frame)
        if frame_timestamps:
            payload['peak_start_time'] = round(float(frame_timestamps.get(candidate.peak_start_frame, 0.0)), 3)
            payload['peak_end_time'] = round(float(frame_timestamps.get(candidate.peak_end_frame, 0.0)), 3)
    return payload


def _build_segmentation_snapshot(
    action_type: str,
    mode: str,
    effective_sample_fps: float,
    legacy_result: Any,
    cycle_result: Optional[Any],
    legacy_segment_ms: int,
    cycle_segment_ms: int,
    frame_timestamps: Optional[Dict[int, float]] = None,
    visual_result: Optional[Any] = None,
    visual_signal: Optional[Any] = None,
    visual_extract_ms: int = 0,
    visual_segment_ms: int = 0,
) -> Dict[str, Any]:
    """构建 P0 轻量诊断；Shadow 不包含第二套特征、评分或关键点。"""
    snapshot: Dict[str, Any] = {
        'mode': mode,
        'formal_version': cycle_result.version if mode == 'cycle_state_machine' and cycle_result else legacy_result.version,
        'effective_sample_fps': round(float(effective_sample_fps), 6),
        'legacy_version': legacy_result.version,
        'legacy_rep_count': len(legacy_result.reps),
        'formal_rep_count': len(cycle_result.reps) if mode == 'cycle_state_machine' and cycle_result else len(legacy_result.reps),
        'timings_ms': {
            'legacy_segment_ms': legacy_segment_ms,
            'cycle_segment_ms': cycle_segment_ms,
            'shadow_overhead_ms': cycle_segment_ms + visual_extract_ms + visual_segment_ms
            if mode == 'shadow' else 0,
        },
    }
    if action_type != 'abdominal_crunch' or cycle_result is None:
        snapshot['shadow_skipped_reason'] = '非缩腹动作或未启用闭环切分'
        if action_type != 'abdominal_crunch' or mode != 'shadow':
            return snapshot
    else:
        snapshot.update({
            'cycle_version': cycle_result.version,
            'cycle_rep_count': len(cycle_result.reps),
            'count_delta': len(cycle_result.reps) - len(legacy_result.reps),
            'accepted_cycles': [_candidate_to_dict(item, frame_timestamps) for item in cycle_result.accepted_cycles[:50]],
            'rejected_candidates': [_candidate_to_dict(item, frame_timestamps) for item in cycle_result.rejected_candidates[:50]],
        })
    if mode == 'shadow' and action_type == 'abdominal_crunch':
        visual_reason = visual_signal.reason if visual_signal is not None else '未执行视觉影子分析'
        snapshot.update({
            'visual_version': visual_result.version if visual_result else VISUAL_VERSION,
            'visual_observable': bool(visual_result is not None and not visual_reason),
            'visual_unavailable_reason': visual_reason,
            'visual_rep_count': len(visual_result.reps) if visual_result is not None and not visual_reason else None,
            'visual_count_delta': len(visual_result.reps) - len(legacy_result.reps)
            if visual_result is not None and not visual_reason else None,
            'visual_quality': {
                'valid_ratio': round(float(visual_signal.valid_ratio if visual_signal else 0.0), 4),
                'median_contrast': round(float(visual_signal.median_contrast if visual_signal else 0.0), 2),
                'amplitude_unit': 'body_length_ratio',
            },
            'visual_accepted_cycles': [_candidate_to_dict(item, frame_timestamps)
                                       for item in visual_result.accepted_cycles[:50]] if visual_result else [],
            'visual_rejected_candidates': [_candidate_to_dict(item, frame_timestamps)
                                           for item in visual_result.rejected_candidates[:50]] if visual_result else [],
        })
        snapshot['timings_ms'].update({
            'visual_extract_ms': visual_extract_ms,
            'visual_segment_ms': visual_segment_ms,
        })
    return snapshot


def _save_keypoints_json(
    video_id: int,
    frames: list,
    reps: Optional[List[Rep]] = None,
    effective_sample_fps: Optional[float] = None,
    segmentation_version: Optional[str] = None,
    short_clip: bool = False,
) -> None:
    """将原始关键点、实际抽帧率及最终切分结果保存，保证预览可复现分析运行。"""
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
            # 长视频会受 MAX_ANALYSIS_FRAMES 限制而降低实际抽帧率；预览/回填必须
            # 使用该值，而不能错误地使用配置中的 SAMPLE_FPS。
            'effective_sample_fps': round(float(effective_sample_fps), 6)
            if isinstance(effective_sample_fps, (int, float)) and effective_sample_fps > 0
            else None,
            'total_frames': len(frames_data),
            'segmentation_version': segmentation_version,
            'short_clip': short_clip,
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


def _notify_callback(callback_url: Optional[str], video_id: int, analysis_run_id: str, provider_task_id: str, analysis_status: str, **kwargs) -> bool:
    """投递终态回调；短暂网络故障同步重试，最终状态写入 analysis_task 供补偿。"""
    from app.db.repository import AnalysisRepository
    from app.db.session import sync_session_scope

    callback_url = callback_url or settings.analysis_callback_url
    if not callback_url:
        logger.error('No callback URL configured for video_id=%d', video_id)
        return False

    payload = {
        'video_id': video_id,
        'analysis_run_id': analysis_run_id,
        'provider_task_id': provider_task_id,
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


def _mark_worker_lost_failed(session: Any, video_id: int, analysis_run_id: str, task_id: str, reason: str) -> bool:
    """只终结仍属于当前执行的任务，避免旧 worker 覆盖新一次分析。"""
    from app.db.models import AnalysisRun
    from app.db.repository import AnalysisRepository

    repo = AnalysisRepository(session)
    task = repo.get_analysis_task(video_id)
    if (
        task is None
        or task.provider_task_id != task_id
        or task.analysis_run_id != analysis_run_id
        or task.task_status in ('completed', 'failed', 'quality_insufficient', 'review_required')
    ):
        return False

    repo.mark_task_failed(video_id, reason)
    run = session.query(AnalysisRun).filter_by(analysis_run_id=analysis_run_id, video_id=video_id).first()
    if run is not None:
        run.status = 'failed'
        run.fail_reason = reason[:255]
        run.finished_at = datetime.utcnow()
    return True


@signals.task_failure.connect(weak=False)
def _on_worker_lost(sender=None, task_id=None, exception=None, kwargs=None, **_extra) -> None:
    """prefork 子进程原生崩溃不会执行任务体的 except，须由主进程落库。"""
    if (
        getattr(sender, 'name', None) != 'analysis.analyze_video'
        or not isinstance(exception, WorkerLostError)
        or not task_id
    ):
        return

    request_kwargs = kwargs or {}
    video_id = request_kwargs.get('video_id')
    analysis_run_id = request_kwargs.get('analysis_run_id')
    if video_id is None or not analysis_run_id:
        logger.error('[%s] Worker lost, but task identity is incomplete', task_id)
        return

    reason = '分析进程意外退出，请重试'
    try:
        from app.db.session import sync_session_scope

        with sync_session_scope() as session:
            changed = _mark_worker_lost_failed(session, int(video_id), str(analysis_run_id), str(task_id), reason)
        if changed:
            logger.error('[%s] Worker lost; marked video_id=%s as failed: %s', task_id, video_id, exception)
            _notify_callback(
                request_kwargs.get('callback_url'), int(video_id), str(analysis_run_id), str(task_id),
                'failed', fail_reason=reason,
            )
    except Exception:
        logger.exception('[%s] Failed to persist worker-lost status for video_id=%s', task_id, video_id)


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
        analysis_run_id = str(payload.pop('analysis_run_id', ''))
        provider_task_id = str(payload.pop('provider_task_id', ''))
        payload.pop('video_id', None)
        if callback_url and analysis_run_id and provider_task_id and _notify_callback(callback_url, video_id, analysis_run_id, provider_task_id, status, **payload):
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
