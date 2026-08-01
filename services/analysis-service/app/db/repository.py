"""数据持久化 Repository 层

封装分析结果直写主库的全部数据库操作，确保事务一致性。
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import (
    AnalysisRun,
    AnalysisTask,
    MotionFeatureResult,
    RepEvaluationResult,
    StandardActionTemplate,
    TrainingVideo,
    VideoEvaluationResult,
)
from app.core.models import (
    CompareResult,
    ConfidenceResult,
    RepScore,
    VideoScore,
)

logger = logging.getLogger(__name__)


class AnalysisRepository:
    """分析结果持久化仓库"""

    def __init__(self, session: Session):
        self.session = session

    # ─── 读取操作 ─────────────────────────────────────

    def get_video(self, video_id: int) -> Optional[TrainingVideo]:
        """获取训练视频记录"""
        return self.session.query(TrainingVideo).filter_by(video_id=video_id).first()

    def get_analysis_task(self, video_id: int) -> Optional[AnalysisTask]:
        """获取视频对应的分析任务"""
        return self.session.query(AnalysisTask).filter_by(video_id=video_id).first()

    def get_analysis_task_by_provider_id(self, provider_task_id: str) -> Optional[AnalysisTask]:
        """根据 Celery task ID 查询分析任务"""
        return self.session.query(AnalysisTask).filter_by(provider_task_id=provider_task_id).first()

    def get_gold_template(self, action_type: str) -> Optional[Dict]:
        """获取最新版本的金标准模板"""
        template = (
            self.session.query(StandardActionTemplate)
            .filter_by(action_type=action_type, status=1)
            .order_by(StandardActionTemplate.created_at.desc())
            .first()
        )
        if template:
            return {
                'reference_stats': template.reference_stats or {},
                'threshold_config': template.threshold_config or {},
            }
        return None

    # ─── 任务状态更新 ─────────────────────────────────

    def create_analysis_task(self, video_id: int, provider_task_id: str, analysis_run_id: str) -> AnalysisTask:
        """将任务和视频同时标记为执行中，供患者端展示真实分析阶段。"""
        existing = self.get_analysis_task(video_id)
        # 当前 task 已切换到另一 run 时，说明本 worker 是迟到任务；绝不能覆盖新任务状态。
        if existing and existing.analysis_run_id and existing.analysis_run_id != analysis_run_id:
            return existing
        if existing and existing.task_status in ('completed', 'failed', 'quality_insufficient', 'review_required'):
            # 同一 run 的迟到/重复执行不能重置已收敛的任务终态。
            return existing
        if existing:
            # 更新已有记录
            existing.provider_task_id = provider_task_id
            existing.analysis_run_id = analysis_run_id
            existing.task_status = 'processing'
            existing.started_at = datetime.utcnow()
            existing.retry_count = (existing.retry_count or 0) + 1
            existing.fail_reason = None
            task = existing
        else:
            task = AnalysisTask(
                video_id=video_id,
                provider_task_id=provider_task_id,
                analysis_run_id=analysis_run_id,
                task_status='processing',
                started_at=datetime.utcnow(),
            )
            self.session.add(task)

        try:
            self.session.flush()
        except IntegrityError:
            # analysis_task.video_id 存在唯一约束，可能与 main-service 的 upsert 并发写入冲突
            self.session.rollback()
            existing = self.get_analysis_task(video_id)
            if not existing:
                raise
            existing.provider_task_id = provider_task_id
            existing.analysis_run_id = analysis_run_id
            existing.task_status = 'processing'
            existing.started_at = datetime.utcnow()
            existing.retry_count = (existing.retry_count or 0) + 1
            existing.fail_reason = None
            task = existing

        run = self.session.query(AnalysisRun).filter_by(analysis_run_id=analysis_run_id, video_id=video_id).first()
        if run:
            run.provider_task_id = provider_task_id
            run.status = 'processing'
            run.started_at = run.started_at or datetime.utcnow()
            run.fail_reason = None

        video = self.get_video(video_id)
        if video and video.analysis_status not in ('completed', 'failed', 'quality_insufficient', 'review_required'):
            video.analysis_status = 'processing'
            video.fail_reason = None
        self.session.flush()
        return task

    def mark_task_completed(self, video_id: int) -> None:
        """标记分析任务完成"""
        task = self.get_analysis_task(video_id)
        if task and task.task_status not in ('failed', 'quality_insufficient', 'review_required'):
            task.task_status = 'completed'
            task.finished_at = datetime.utcnow()
            self.session.flush()

        # 同时更新 training_video 的 analysis_status
        video = self.get_video(video_id)
        if video and video.analysis_status not in ('failed', 'quality_insufficient', 'review_required'):
            video.analysis_status = 'completed'
            self.session.flush()

    def mark_task_failed(self, video_id: int, fail_reason: str) -> None:
        """标记分析任务失败"""
        task = self.get_analysis_task(video_id)
        if task and task.task_status != 'completed':
            task.task_status = 'failed'
            task.fail_reason = fail_reason[:255]
            task.finished_at = datetime.utcnow()
            self.session.flush()

        # 同时更新 training_video
        video = self.get_video(video_id)
        if video and video.analysis_status != 'completed':
            video.analysis_status = 'failed'
            video.fail_reason = fail_reason[:255]
            self.session.flush()

    def mark_task_review_required(self, video_id: int, reason: str) -> None:
        """标记结果待人工复核，保留原始计算结果但不对患者输出确定性结论。"""
        task = self.get_analysis_task(video_id)
        if task and task.task_status != 'completed':
            task.task_status = 'review_required'
            task.fail_reason = reason[:255]
            task.finished_at = datetime.utcnow()
            self.session.flush()

        video = self.get_video(video_id)
        if video and video.analysis_status != 'completed':
            video.analysis_status = 'review_required'
            video.fail_reason = reason[:255]
            self.session.flush()

    def mark_task_quality_insufficient(self, video_id: int, fail_reason: str) -> None:
        """标记不可分析的质量终态，避免被通用 failed 状态覆盖。"""
        task = self.get_analysis_task(video_id)
        if task and task.task_status != 'completed':
            task.task_status = 'quality_insufficient'
            task.fail_reason = fail_reason[:255]
            task.finished_at = datetime.utcnow()
            self.session.flush()

        video = self.get_video(video_id)
        if video and video.analysis_status != 'completed':
            video.analysis_status = 'quality_insufficient'
            video.fail_reason = fail_reason[:255]
            self.session.flush()

    # ─── 视频质量更新 ─────────────────────────────────

    def record_callback_delivery(
        self,
        video_id: int,
        callback_url: str,
        payload: Dict[str, Any],
        status: str,
        error: Optional[str] = None,
        next_retry_at: Optional[datetime] = None,
    ) -> None:
        """持久化跨服务回调投递状态，供失败重试与主服务补偿排查。"""
        task = self.get_analysis_task(video_id)
        if not task:
            return
        task.callback_url = callback_url[:512]
        task.callback_payload = payload
        task.callback_status = status
        task.callback_attempt_count = (task.callback_attempt_count or 0) + 1
        task.callback_last_error = error[:255] if error else None
        task.callback_next_retry_at = next_retry_at
        self.session.flush()

    def update_video_quality(
        self,
        video_id: int,
        quality_status: str,
        quality_score: Optional[float] = None,
        quality_issues: Optional[List[Dict]] = None,
    ) -> None:
        """更新视频质检结果"""
        video = self.get_video(video_id)
        if video:
            video.quality_status = quality_status
            if quality_score is not None:
                video.quality_score = quality_score
            if quality_issues is not None:
                video.quality_issues = quality_issues
            self.session.flush()

    # ─── 分析结果写入 ─────────────────────────────────

    def save_motion_features(
        self,
        video_id: int,
        rep_id: int,
        compare_results: List[CompareResult],
        confidence: ConfidenceResult,
        feature_units: Dict[str, str],
    ) -> None:
        """保存单次动作的特征比对结果"""
        for cr in compare_results:
            feature = MotionFeatureResult(
                video_id=video_id,
                rep_id=rep_id,
                feature_code=cr.feature_code,
                feature_value=cr.measured,
                unit=feature_units.get(cr.feature_code, ''),
                confidence=confidence.overall if confidence else None,
                compare_label=cr.label,
                deviation_sigma=cr.deviation_sigma,
            )
            self.session.add(feature)
        self.session.flush()

    def save_rep_evaluation(self, video_id: int, rep_score: RepScore) -> None:
        """保存单次动作评分"""
        rep = RepEvaluationResult(
            video_id=video_id,
            rep_id=rep_score.rep_id,
            accuracy_score=rep_score.accuracy_score,
            stability_score=rep_score.stability_score,
            control_score=rep_score.control_score,
            duration_score=rep_score.duration_score,
            total_score=rep_score.total_score,
            grade=rep_score.grade,
            valid_flag=rep_score.valid_flag,
            compensation_types=rep_score.compensation_types,
            hold_duration=rep_score.hold_duration,
        )
        self.session.add(rep)
        self.session.flush()

    def save_video_evaluation(self, video_id: int, video_score: VideoScore) -> None:
        """保存视频级综合评分（upsert）"""
        existing = (
            self.session.query(VideoEvaluationResult)
            .filter_by(video_id=video_id)
            .first()
        )
        if existing:
            existing.total_reps = video_score.total_reps
            existing.valid_reps = video_score.valid_reps
            existing.average_score = video_score.average_score
            existing.grade = video_score.grade
            existing.accuracy_avg = video_score.accuracy_avg
            existing.stability_avg = video_score.stability_avg
            existing.control_avg = video_score.control_avg
            existing.duration_avg = video_score.duration_avg
            existing.avg_hold_duration = video_score.avg_hold_duration
            existing.main_issues = video_score.main_issues
            existing.advice_summary = video_score.advice_summary
            existing.confidence_score = video_score.confidence_score
            existing.analysis_version = video_score.analysis_version
        else:
            result = VideoEvaluationResult(
                video_id=video_id,
                total_reps=video_score.total_reps,
                valid_reps=video_score.valid_reps,
                average_score=video_score.average_score,
                grade=video_score.grade,
                accuracy_avg=video_score.accuracy_avg,
                stability_avg=video_score.stability_avg,
                control_avg=video_score.control_avg,
                duration_avg=video_score.duration_avg,
                avg_hold_duration=video_score.avg_hold_duration,
                main_issues=video_score.main_issues,
                advice_summary=video_score.advice_summary,
                confidence_score=video_score.confidence_score,
                analysis_version=video_score.analysis_version,
            )
            self.session.add(result)
        self.session.flush()

    # ─── 批量保存（一次事务） ─────────────────────────

    def save_full_analysis(
        self,
        video_id: int,
        video_score: VideoScore,
        rep_scores: List[RepScore],
        all_compare_results: Dict[int, List[CompareResult]],
        confidence: ConfidenceResult,
        feature_units: Dict[str, str],
        quality_status: str,
        quality_score: Optional[float] = None,
        quality_issues: Optional[List[Dict]] = None,
        review_required_reason: Optional[str] = None,
    ) -> None:
        """一次性保存完整分析结果（事务内）。
        重新分析时先清除该视频的旧特征和 rep 评分记录，避免重复写入导致评分混乱。
        """
        try:
            # 0. 清除旧的特征和 rep 评分（幂等保证，重新分析不产生重复记录）
            self.session.query(MotionFeatureResult).filter_by(video_id=video_id).delete()
            self.session.query(RepEvaluationResult).filter_by(video_id=video_id).delete()
            self.session.flush()

            # 1. 更新视频质量信息
            self.update_video_quality(video_id, quality_status, quality_score, quality_issues)

            # 2. 保存每次动作的特征比对
            for rep_score in rep_scores:
                cr_list = all_compare_results.get(rep_score.rep_id, [])
                self.save_motion_features(video_id, rep_score.rep_id, cr_list, confidence, feature_units)

            # 3. 保存每次动作评分
            for rep_score in rep_scores:
                self.save_rep_evaluation(video_id, rep_score)

            # 4. 保存视频级评分
            self.save_video_evaluation(video_id, video_score)

            # 5. 仅在质量、置信度和模板均满足条件时对患者发布确定性结论。
            if review_required_reason:
                self.mark_task_review_required(video_id, review_required_reason)
            else:
                self.mark_task_completed(video_id)

            logger.info('Saved full analysis for video_id=%d: grade=%s, score=%.1f',
                        video_id, video_score.grade, video_score.average_score)
        except Exception as e:
            logger.error('Failed to save analysis for video_id=%d: %s', video_id, str(e))
            raise
