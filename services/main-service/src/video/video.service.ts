import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConfirmUploadRequestDto,
  ConfirmUploadResponseDto,
  ManualVideoReviewDto,
  PresignUploadResponseDto,
  SaveManualVideoReviewRequestDto,
  VideoStatusDto,
} from '@home-rehab-motion/shared-contract';
import type { AnalysisStatus, TrainingVideoSourceType } from '@home-rehab-motion/shared-types';

function resolveGrade(score: number | null | undefined, rawGrade?: string | null) {
  const numeric = Number(score ?? 0);
  if (Number.isFinite(numeric)) {
    if (numeric >= 90) return '优秀';
    if (numeric >= 75) return '合格';
    if (numeric >= 60) return '需改进';
    return '无效';
  }
  return rawGrade || '无效';
}
import { AnalysisService, type AnalysisEnqueueResult } from '../analysis/analysis.service';
import { BadgeService } from '../badge/badge.service';
import { ConfigService } from '../config/config.service';
import { MotivationService } from '../motivation/motivation.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrivacyService } from '../privacy/privacy.service';
import { StorageService, type UploadedBinaryFile } from '../storage/storage.service';

@Injectable()
export class VideoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisService: AnalysisService,
    private readonly storageService: StorageService,
    private readonly badgeService: BadgeService,
    private readonly configService: ConfigService,
    private readonly motivationService: MotivationService,
    private readonly privacyService: PrivacyService,
  ) {}

  async getPresignUpload(userId: number): Promise<PresignUploadResponseDto> {
    await this.privacyService.requireActiveConsent(userId);
    if (userId <= 0) {
      throw new BadRequestException('无效的用户身份，无法创建上传任务');
    }

    const ownerId = BigInt(userId);

    const created = await this.prisma.trainingVideo.create({
      data: {
        user_id: ownerId,
        action_type: 'abdominal_crunch',
        source_type: 'miniapp',
        video_key: null,
        analysis_status: 'uploading',
      },
    });

    const videoId = Number(created.video_id);
    const objectKey = this.storageService.buildVideoObjectKey(videoId);

    await this.prisma.trainingVideo.update({
      where: { video_id: created.video_id },
      data: {
        video_key: objectKey,
      },
    });

    const uploadTarget = await this.storageService.createUploadTarget(videoId, objectKey);

    await this.prisma.trainingVideo.update({
      where: { video_id: created.video_id },
      data: {
        video_key: uploadTarget.objectKey,
      },
    });

    return {
      videoId,
      ...uploadTarget,
    };
  }

  async getInternalSamplePresignUpload(sourceType: Exclude<TrainingVideoSourceType, 'miniapp'>) {
    const owner = await this.prisma.userProfile.upsert({
      where: { openid: `internal-sample:${sourceType}` },
      update: { role: 'patient', status: 1 },
      create: {
        openid: `internal-sample:${sourceType}`,
        name: sourceType === 'gold_template' ? '金标准内部样本' : '流程验证内部样本',
        role: 'patient',
        status: 1,
        display_mode: 'standard',
      },
    });
    const created = await this.prisma.trainingVideo.create({
      data: {
        user_id: owner.user_id,
        action_type: 'abdominal_crunch',
        source_type: sourceType,
        analysis_status: 'uploading',
      },
    });
    const videoId = Number(created.video_id);
    const uploadTarget = await this.storageService.createUploadTarget(
      videoId,
      this.storageService.buildVideoObjectKey(videoId),
    );
    await this.prisma.trainingVideo.update({
      where: { video_id: created.video_id },
      data: { video_key: uploadTarget.objectKey },
    });
    return {
      videoId,
      ...uploadTarget,
      uploadUrl:
        uploadTarget.uploadType === 'local_proxy'
          ? `${process.env.PUBLIC_API_BASE_URL || 'http://127.0.0.1:3000/api'}/videos/admin/internal-samples/${videoId}/upload`
          : uploadTarget.uploadUrl,
    };
  }

  async uploadVideoFile(
    userId: number,
    videoId: number,
    file: UploadedBinaryFile,
    allowInternalAccess = false,
  ) {
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(videoId) },
    });

    if (!video) {
      throw new NotFoundException(`视频不存在: ${videoId}`);
    }
    if (!allowInternalAccess) {
      await this.privacyService.requireActiveConsent(userId);
    }
    if (allowInternalAccess) {
      this.ensureInternalSample(video.source_type);
    } else {
      this.ensureVideoOwnership(video.user_id, userId);
    }

    const objectKey = video.video_key || this.storageService.buildVideoObjectKey(videoId);
    const stored = await this.storageService.saveVideoFile(objectKey, file);

    await this.prisma.trainingVideo.update({
      where: { video_id: BigInt(videoId) },
      data: {
        video_key: stored.objectKey,
        analysis_status: 'uploading',
      },
    });

    return {
      videoId,
      objectKey: stored.objectKey,
      size: stored.size,
    };
  }

  async confirmUpload(
    userId: number,
    payload: ConfirmUploadRequestDto,
    options: { requireConsent?: boolean; recordMotivation?: boolean } = {},
  ): Promise<ConfirmUploadResponseDto> {
    if (options.requireConsent !== false) {
      await this.privacyService.requireActiveConsent(userId);
    }
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(payload.videoId) },
    });

    if (!video) {
      throw new NotFoundException(`视频不存在: ${payload.videoId}`);
    }
    this.ensureVideoOwnership(video.user_id, userId);

    const appConfig = await this.configService.getPatientAppConfig();
    if (!Number.isFinite(payload.duration) || payload.duration < appConfig.videoMinDurationSeconds) {
      throw new BadRequestException(`视频时长不能少于 ${appConfig.videoMinDurationSeconds} 秒`);
    }
    if (payload.duration > appConfig.videoMaxDurationSeconds) {
      throw new BadRequestException(`视频时长不能超过 ${appConfig.videoMaxDurationSeconds} 秒`);
    }

    const objectKey = video.video_key || this.storageService.buildVideoObjectKey(payload.videoId);
    const resolvedObjectKey = objectKey.endsWith('.mp4')
      || objectKey.endsWith('.mov')
      || objectKey.endsWith('.m4v')
      || objectKey.endsWith('.avi')
      ? objectKey
      : `${objectKey}.mp4`;

    if (!(await this.storageService.objectExists(resolvedObjectKey))) {
      throw new BadRequestException('视频文件尚未上传，请先完成上传');
    }

    await this.prisma.trainingVideo.update({
      where: { video_id: BigInt(payload.videoId) },
      data: {
        action_type: payload.actionType,
        duration: payload.duration,
        video_key: resolvedObjectKey,
        confirmed_at: video.confirmed_at || new Date(),
        analysis_status: video.analysis_status === 'completed' ? 'completed' : 'queued',
        fail_reason: null,
      },
    });

    if (options.recordMotivation !== false) {
      await this.motivationService.recordConfirmedTraining(userId, payload.videoId, video.confirmed_at || new Date());
    }

    if (video.analysis_status === 'completed') {
      return { videoId: payload.videoId, status: 'completed', estimatedWaitSeconds: 0 };
    }

    try {
      const task = await this.analysisService.enqueueVideo({
        videoId: payload.videoId,
        actionType: payload.actionType,
        videoKey: resolvedObjectKey,
        sampleFps:
          typeof payload.sampleFps === 'number' && Number.isFinite(payload.sampleFps)
            ? payload.sampleFps
            : undefined,
        sigmaMultiplier:
          typeof payload.sigmaMultiplier === 'number' && Number.isFinite(payload.sigmaMultiplier)
            ? payload.sigmaMultiplier
            : undefined,
      });

      await this.prisma.analysisTask.upsert({
        where: { video_id: BigInt(payload.videoId) },
        update: {
          provider_task_id: task.task_id,
          // worker 可能已先一步把任务标记为 processing，不能再被确认接口降级回 queued。
          task_status: task.status === 'completed' ? 'completed' : undefined,
          fail_reason: null,
          finished_at: task.status === 'completed' ? new Date() : undefined,
        },
        create: {
          video_id: BigInt(payload.videoId),
          provider_task_id: task.task_id,
          task_status: task.status === 'completed' ? 'completed' : 'queued',
          finished_at: task.status === 'completed' ? new Date() : null,
        },
      });

      if (task.status === 'completed' && task.compatReport) {
        await this.applyCompatAnalyzeResult(payload.videoId, task.compatReport);
        return {
          videoId: payload.videoId,
          status: 'completed',
          estimatedWaitSeconds: 0,
        };
      }

      return {
        videoId: payload.videoId,
        status: 'queued',
        estimatedWaitSeconds: 30,
      };
    } catch (error) {
      const failReason = error instanceof Error ? error.message : '分析服务暂不可用';
      await this.prisma.trainingVideo.update({
        where: { video_id: BigInt(payload.videoId) },
        data: {
          analysis_status: 'failed',
          fail_reason: failReason.slice(0, 255),
        },
      });
      await this.prisma.analysisTask.upsert({
        where: { video_id: BigInt(payload.videoId) },
        update: {
          task_status: 'failed',
          fail_reason: failReason.slice(0, 255),
          finished_at: new Date(),
        },
        create: {
          video_id: BigInt(payload.videoId),
          task_status: 'failed',
          fail_reason: failReason.slice(0, 255),
          finished_at: new Date(),
        },
      });
      throw error;
    }
  }

  async confirmInternalSample(videoId: number, payload: ConfirmUploadRequestDto) {
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(videoId) },
    });
    if (!video) {
      throw new NotFoundException(`视频不存在: ${videoId}`);
    }
    this.ensureInternalSample(video.source_type);
    return this.confirmUpload(Number(video.user_id), payload, {
      requireConsent: false,
      recordMotivation: false,
    });
  }

  async getInternalSampleStatus(videoId: number): Promise<VideoStatusDto> {
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(videoId) },
    });
    if (!video) {
      throw new NotFoundException(`视频不存在: ${videoId}`);
    }
    this.ensureInternalSample(video.source_type);
    return this.getVideoStatus(videoId, Number(video.user_id));
  }

  async getVideoStatus(videoId: number, userId: number): Promise<VideoStatusDto> {
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(videoId) },
      include: {
        analysis_task: true,
        video_evaluation_result: true,
      },
    });

    if (!video) {
      throw new NotFoundException(`视频不存在: ${videoId}`);
    }
    this.ensureVideoOwnership(video.user_id, userId);

    // 兼容 worker 已经开始、但最终回调尚未抵达主服务的短暂窗口。
    // 此时 analysis_task 是更细粒度的执行事实，患者端应展示“动作分析”而不是继续停在“质量检测”。
    const effectiveStatus =
      video.analysis_status === 'queued' && video.analysis_task?.task_status === 'processing'
        ? 'processing'
        : video.analysis_status;
    const failReason = effectiveStatus === 'failed' || effectiveStatus === 'quality_insufficient'
      || effectiveStatus === 'review_required'
      ? video.fail_reason || undefined
      : undefined;

    const estimatedWaitSeconds = effectiveStatus === 'queued' || effectiveStatus === 'processing'
      ? 30
      : undefined;

    return {
      videoId,
      status: (effectiveStatus as AnalysisStatus) || 'pending',
      reportReady:
        (effectiveStatus === 'completed' || effectiveStatus === 'review_required')
        && Boolean(video.video_evaluation_result),
      estimatedWaitSeconds,
      failReason,
    };
  }

  async getVideoKeypoints(videoId: number) {
    try {
      return await this.analysisService.getKeyframes(videoId);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('关键点') || msg.includes('不存在') || msg.includes('未完成')) {
        return { video_id: videoId, total_frames: 0, frames: [], keypoint_names: [], skeleton_connections: [], message: '关键点数据不存在，视频可能尚未完成分析' };
      }
      throw err;
    }
  }

  async getAdminVideoList() {
    const videos = await this.prisma.trainingVideo.findMany({
      where: { source_type: 'miniapp' },
      orderBy: { created_at: 'desc' },
      take: 20,
      include: {
        user: true,
      },
    });

    return videos.map((video) => ({
      videoId: Number(video.video_id),
      actionType: video.action_type,
      status: video.analysis_status,
      qualityStatus: video.quality_status,
      patientName: video.user?.name || '未命名患者',
      uploadedAt: video.created_at.toISOString(),
      createdAt: video.created_at.toISOString(),
    }));
  }

  async getAdminVideoDetail(videoId: number) {
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(videoId) },
      include: {
        analysis_task: true,
        video_evaluation_result: true,
        user: true,
      },
    });

    if (!video) {
      throw new NotFoundException(`视频不存在: ${videoId}`);
    }

    return {
      videoId,
      actionType: video.action_type,
      status: video.analysis_status,
      qualityStatus: video.quality_status,
      qualityScore: video.quality_score,
      failReason: video.fail_reason,
      taskStatus: video.analysis_task?.task_status || video.analysis_status,
      averageScore: video.video_evaluation_result?.average_score ?? null,
      grade: resolveGrade(
        video.video_evaluation_result?.average_score ?? null,
        video.video_evaluation_result?.grade ?? null,
      ),
      patientId: Number(video.user_id),
      patientName: video.user?.name || '未命名患者',
      uploadedAt: video.created_at.toISOString(),
      videoKey: video.video_key,
      videoPreviewUrl: video.video_key ? this.storageService.getPrivateObjectUrl(video.video_key) : null,
    };
  }

  async getVideoOwnerId(videoId: number): Promise<number> {
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(videoId) },
      select: { user_id: true },
    });
    if (!video) throw new NotFoundException(`视频不存在: ${videoId}`);
    return Number(video.user_id);
  }

  async getManualVideoReview(videoId: number): Promise<ManualVideoReviewDto | null> {
    const review = await this.prisma.manualVideoReview.findUnique({ where: { video_id: BigInt(videoId) } });
    if (!review) return null;
    return {
      reviewId: Number(review.review_id),
      accuracyJudgment: review.accuracy_judgment as ManualVideoReviewDto['accuracyJudgment'],
      disposition: review.disposition as ManualVideoReviewDto['disposition'],
      useManualResult: review.use_manual_result,
      manualScore: review.manual_score,
      manualGrade: review.manual_grade,
      manualMainIssues: Array.isArray(review.manual_main_issues) ? review.manual_main_issues.map(String) : [],
      manualAdvice: review.manual_advice,
      reviewNote: review.review_note,
      reviewerName: review.reviewer_name,
      reviewedAt: review.reviewed_at.toISOString(),
      algorithmSnapshot: {
        score: review.algorithm_score,
        grade: review.algorithm_grade,
        mainIssues: Array.isArray(review.algorithm_main_issues) ? review.algorithm_main_issues.map(String) : [],
        validReps: review.algorithm_valid_reps,
        totalReps: review.algorithm_total_reps,
        confidence: review.algorithm_confidence,
        version: review.algorithm_version,
      },
    };
  }

  async saveManualVideoReview(
    videoId: number,
    reviewerAccountId: number | undefined,
    payload: SaveManualVideoReviewRequestDto,
  ): Promise<ManualVideoReviewDto> {
    if (!['accurate', 'partially_accurate', 'inaccurate', 'unable_to_judge'].includes(payload.accuracyJudgment)) {
      throw new BadRequestException('无效的算法判断结论');
    }
    if (!['archive', 'manual_correction', 'suggest_retake', 'send_guidance'].includes(payload.disposition)) {
      throw new BadRequestException('无效的复核处置');
    }
    const manualScore = payload.manualScore == null ? null : Number(payload.manualScore);
    if (manualScore !== null && (!Number.isFinite(manualScore) || manualScore < 0 || manualScore > 100)) {
      throw new BadRequestException('人工评分必须为 0 至 100');
    }
    if (payload.useManualResult && manualScore === null) {
      throw new BadRequestException('采用人工结果时必须填写人工评分');
    }

    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(videoId) },
      include: { video_evaluation_result: true },
    });
    if (!video?.video_evaluation_result) throw new NotFoundException(`未找到可复核的分析结果: ${videoId}`);
    const reviewer = reviewerAccountId
      ? await this.prisma.adminAccount.findUnique({ where: { account_id: BigInt(reviewerAccountId) } })
      : null;
    const result = video.video_evaluation_result;
    const manualGrade = manualScore === null ? null : resolveGrade(manualScore);
    await this.prisma.manualVideoReview.upsert({
      where: { video_id: BigInt(videoId) },
      create: {
        video_id: BigInt(videoId),
        algorithm_score: result.average_score,
        algorithm_grade: result.grade,
        algorithm_main_issues: result.main_issues ?? undefined,
        algorithm_advice_summary: result.advice_summary ?? undefined,
        algorithm_valid_reps: result.valid_reps,
        algorithm_total_reps: result.total_reps,
        algorithm_confidence: result.confidence_score,
        algorithm_version: result.analysis_version,
        accuracy_judgment: payload.accuracyJudgment,
        disposition: payload.disposition,
        use_manual_result: payload.useManualResult,
        manual_score: payload.useManualResult ? manualScore : null,
        manual_grade: payload.useManualResult ? manualGrade : null,
        manual_main_issues: payload.useManualResult ? (payload.manualMainIssues || []) : undefined,
        manual_advice: payload.manualAdvice?.trim() || null,
        review_note: payload.reviewNote?.trim() || null,
        reviewer_account_id: reviewerAccountId ? BigInt(reviewerAccountId) : null,
        reviewer_name: reviewer?.display_name || reviewer?.username || null,
      },
      update: {
        accuracy_judgment: payload.accuracyJudgment,
        disposition: payload.disposition,
        use_manual_result: payload.useManualResult,
        manual_score: payload.useManualResult ? manualScore : null,
        manual_grade: payload.useManualResult ? manualGrade : null,
        manual_main_issues: payload.useManualResult ? (payload.manualMainIssues || []) : undefined,
        manual_advice: payload.manualAdvice?.trim() || null,
        review_note: payload.reviewNote?.trim() || null,
        reviewer_account_id: reviewerAccountId ? BigInt(reviewerAccountId) : null,
        reviewer_name: reviewer?.display_name || reviewer?.username || null,
        reviewed_at: new Date(),
      },
    });
    return (await this.getManualVideoReview(videoId))!;
  }

  async getAdminVideoAnalysisDetail(videoId: number) {
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(videoId) },
      include: {
        analysis_task: true,
        video_evaluation_result: true,
        rep_evaluation_results: {
          orderBy: { rep_id: 'asc' },
        },
        motion_feature_results: {
          orderBy: [{ rep_id: 'asc' }, { feature_code: 'asc' }],
        },
      },
    });

    if (!video) {
      throw new NotFoundException(`视频不存在: ${videoId}`);
    }

    const videoEval = video.video_evaluation_result;
    const repScores = video.rep_evaluation_results.map((item) => ({
      repId: item.rep_id,
      accuracyScore: item.accuracy_score,
      stabilityScore: item.stability_score,
      controlScore: item.control_score,
      durationScore: item.duration_score,
      totalScore: item.total_score,
      grade: item.grade,
      validFlag: item.valid_flag,
      holdDuration: item.hold_duration,
      compensationTypes: Array.isArray(item.compensation_types) ? item.compensation_types : [],
    }));

    type FeatureRow = {
      repId: number | null;
      featureCode: string;
      value: number | null;
      unit: string | null;
      compareLabel: string | null;
      deviationSigma: number | null;
      confidence: number | null;
    };

    const featureRows: FeatureRow[] = video.motion_feature_results.map((item) => ({
      repId: item.rep_id,
      featureCode: item.feature_code,
      value: item.feature_value,
      unit: item.unit,
      compareLabel: item.compare_label,
      deviationSigma: item.deviation_sigma,
      confidence: item.confidence,
    }));

    const byRep = featureRows.reduce<Record<string, FeatureRow[]>>((acc, item) => {
      const key = String(item.repId ?? 0);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {});

    const scoringExplain = {
      gradeRanges: [
        { min: 90, max: 100, grade: '优秀' },
        { min: 75, max: 89, grade: '合格' },
        { min: 60, max: 74, grade: '需改进' },
        { min: 0, max: 59, grade: '无效' },
      ],
      weights: {
        accuracy: 0.4,
        stability: 0.25,
        control: 0.2,
        duration: 0.15,
      },
      scoringHint: '当前版本会先给出每次动作四维分，再汇总成视频平均分并映射等级。',
    };

    return {
      videoId,
      actionType: video.action_type,
      analysisStatus: video.analysis_status,
      taskStatus: video.analysis_task?.task_status || video.analysis_status,
      qualityStatus: video.quality_status,
      qualityScore: video.quality_score,
      failReason: video.fail_reason,
      videoKey: video.video_key,
      videoPreviewUrl: video.video_key ? this.storageService.getPrivateObjectUrl(video.video_key) : null,
      reportReady: Boolean(videoEval),
      summary: videoEval
        ? {
            averageScore: videoEval.average_score,
            grade: resolveGrade(videoEval.average_score, videoEval.grade),
            totalReps: videoEval.total_reps,
            validReps: videoEval.valid_reps,
            confidenceScore: videoEval.confidence_score,
            accuracyAvg: videoEval.accuracy_avg,
            stabilityAvg: videoEval.stability_avg,
            controlAvg: videoEval.control_avg,
            durationAvg: videoEval.duration_avg,
            avgHoldDuration: videoEval.avg_hold_duration,
            mainIssues: Array.isArray(videoEval.main_issues) ? videoEval.main_issues : [],
            adviceSummary: Array.isArray(videoEval.advice_summary) ? videoEval.advice_summary : [],
          }
        : null,
      scoringExplain,
      repScores,
      featureRows,
      featureRowsByRep: byRep,
    };
  }

  async handleAnalysisCallback(payload: {
    video_id: number;
    analysis_status: string;
    quality_status?: string;
    quality_score?: number;
    quality_issues?: unknown;
    fail_reason?: string;
    video_evaluation?: {
      total_reps?: number;
      valid_reps?: number;
      average_score?: number;
      grade?: string;
      accuracy_avg?: number;
      stability_avg?: number;
      control_avg?: number;
      duration_avg?: number;
      avg_hold_duration?: number;
      main_issues?: unknown;
      advice_summary?: unknown;
      confidence_score?: number;
      analysis_version?: string;
    };
  }) {
    if (!Number.isSafeInteger(payload.video_id) || payload.video_id <= 0) {
      throw new BadRequestException('无效的视频 ID');
    }
    const allowedStatuses = new Set(['queued', 'processing', 'completed', 'failed', 'quality_insufficient', 'review_required']);
    if (!allowedStatuses.has(payload.analysis_status)) {
      throw new BadRequestException('无效的分析状态');
    }

    const videoId = BigInt(payload.video_id);
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: videoId },
    });

    if (!video) {
      throw new NotFoundException(`视频不存在: ${payload.video_id}`);
    }

    const finalStatuses = new Set(['completed', 'failed', 'quality_insufficient', 'review_required']);
    const activeStatuses = new Set(['queued', 'processing']);
    const currentStatus = video.analysis_status;
    const nextStatus = payload.analysis_status;
    if (finalStatuses.has(currentStatus) && currentStatus !== nextStatus) {
      return {
        success: true,
        ignored: true,
        videoId: payload.video_id,
        status: currentStatus,
        reason: '当前视频已处于终态，忽略迟到回调',
      };
    }
    if (currentStatus === 'processing' && nextStatus === 'queued') {
      return {
        success: true,
        ignored: true,
        videoId: payload.video_id,
        status: currentStatus,
        reason: '忽略倒退状态回调',
      };
    }
    if (nextStatus === 'completed' && !payload.video_evaluation) {
      throw new BadRequestException('完成回调必须包含视频分析结果');
    }
    if (activeStatuses.has(currentStatus) || currentStatus === nextStatus || currentStatus === 'uploading' || currentStatus === 'pending') {
      await this.prisma.trainingVideo.update({
        where: { video_id: videoId },
        data: {
          analysis_status: nextStatus,
          quality_status: payload.quality_status,
          quality_score: payload.quality_score,
          quality_issues: (payload.quality_issues as object | undefined) ?? undefined,
          fail_reason: nextStatus === 'completed' ? null : (payload.fail_reason ?? null),
          model_version: payload.video_evaluation?.analysis_version,
        },
      });
    }

    await this.prisma.analysisTask.upsert({
      where: { video_id: videoId },
      update: {
        task_status: payload.analysis_status,
        fail_reason: payload.fail_reason,
        callback_status: 'received',
        callback_attempt_count: { increment: 1 },
        callback_last_error: null,
        callback_next_retry_at: null,
        callback_payload: payload as object,
        callback_url: process.env.ANALYSIS_CALLBACK_URL || null,
        finished_at:
          payload.analysis_status === 'completed'
          || payload.analysis_status === 'failed'
          || payload.analysis_status === 'quality_insufficient'
            ? new Date()
            : undefined,
      },
      create: {
        video_id: videoId,
        task_status: payload.analysis_status,
        fail_reason: payload.fail_reason,
        callback_status: 'received',
        callback_attempt_count: 1,
        callback_payload: payload as object,
        callback_url: process.env.ANALYSIS_CALLBACK_URL || null,
        finished_at:
          payload.analysis_status === 'completed'
          || payload.analysis_status === 'failed'
          || payload.analysis_status === 'quality_insufficient'
            ? new Date()
            : null,
      },
    });

    if (payload.analysis_status === 'completed' && payload.video_evaluation) {
      await this.prisma.videoEvaluationResult.upsert({
        where: { video_id: videoId },
        update: {
          total_reps: payload.video_evaluation.total_reps ?? 0,
          valid_reps: payload.video_evaluation.valid_reps ?? 0,
          average_score: payload.video_evaluation.average_score,
          grade: payload.video_evaluation.grade,
          accuracy_avg: payload.video_evaluation.accuracy_avg,
          stability_avg: payload.video_evaluation.stability_avg,
          control_avg: payload.video_evaluation.control_avg,
          duration_avg: payload.video_evaluation.duration_avg,
          avg_hold_duration: payload.video_evaluation.avg_hold_duration,
          main_issues: (payload.video_evaluation.main_issues as object | undefined) ?? undefined,
          advice_summary:
            (payload.video_evaluation.advice_summary as object | undefined) ?? undefined,
          confidence_score: payload.video_evaluation.confidence_score,
          analysis_version: payload.video_evaluation.analysis_version,
        },
        create: {
          video_id: videoId,
          total_reps: payload.video_evaluation.total_reps ?? 0,
          valid_reps: payload.video_evaluation.valid_reps ?? 0,
          average_score: payload.video_evaluation.average_score,
          grade: payload.video_evaluation.grade,
          accuracy_avg: payload.video_evaluation.accuracy_avg,
          stability_avg: payload.video_evaluation.stability_avg,
          control_avg: payload.video_evaluation.control_avg,
          duration_avg: payload.video_evaluation.duration_avg,
          avg_hold_duration: payload.video_evaluation.avg_hold_duration,
          main_issues: (payload.video_evaluation.main_issues as object | undefined) ?? undefined,
          advice_summary:
            (payload.video_evaluation.advice_summary as object | undefined) ?? undefined,
          confidence_score: payload.video_evaluation.confidence_score,
          analysis_version: payload.video_evaluation.analysis_version,
        },
      });
    }

    if (payload.analysis_status === 'completed' && !this.isInternalSample(video.source_type)) {
      await this.publishCompletedMotivation(Number(video.user_id), payload.video_id);
    }

    return {
      success: true,
      videoId: payload.video_id,
      status: payload.analysis_status,
    };
  }

  private async applyCompatAnalyzeResult(
    videoId: number,
    compatReport: NonNullable<AnalysisEnqueueResult['compatReport']>,
  ) {
    const numericVideoId = BigInt(videoId);
    const averageScore = Number(compatReport.score || 0);
    const confidenceScore = Number(compatReport.confidence || 0);

    await this.prisma.trainingVideo.update({
      where: { video_id: numericVideoId },
      data: {
        analysis_status: 'completed',
        quality_status: 'passed',
        quality_score: Math.max(0, Math.min(100, Math.round(confidenceScore * 1000) / 10)),
        fail_reason: null,
      },
    });

    await this.prisma.videoEvaluationResult.upsert({
      where: { video_id: numericVideoId },
      update: {
        total_reps: compatReport.totalReps,
        valid_reps: compatReport.validReps,
        average_score: averageScore,
        grade: compatReport.grade,
        accuracy_avg: compatReport.dimensions?.accuracy ?? averageScore,
        stability_avg: compatReport.dimensions?.stability ?? averageScore,
        control_avg: compatReport.dimensions?.control ?? averageScore,
        duration_avg: compatReport.dimensions?.duration ?? averageScore,
        avg_hold_duration: compatReport.averageHoldSeconds ?? 0,
        main_issues: compatReport.mainIssue ? [compatReport.mainIssue] : [],
        advice_summary: (compatReport.advice || []).map((item) => ({
          advice_code: 'COMPAT_ADVICE',
          patient_text: item,
        })),
        confidence_score: confidenceScore,
        analysis_version: 'compat-analyze-v1',
      },
      create: {
        video_id: numericVideoId,
        total_reps: compatReport.totalReps,
        valid_reps: compatReport.validReps,
        average_score: averageScore,
        grade: compatReport.grade,
        accuracy_avg: compatReport.dimensions?.accuracy ?? averageScore,
        stability_avg: compatReport.dimensions?.stability ?? averageScore,
        control_avg: compatReport.dimensions?.control ?? averageScore,
        duration_avg: compatReport.dimensions?.duration ?? averageScore,
        avg_hold_duration: compatReport.averageHoldSeconds ?? 0,
        main_issues: compatReport.mainIssue ? [compatReport.mainIssue] : [],
        advice_summary: (compatReport.advice || []).map((item) => ({
          advice_code: 'COMPAT_ADVICE',
          patient_text: item,
        })),
        confidence_score: confidenceScore,
        analysis_version: 'compat-analyze-v1',
      },
    });

    const video = await this.prisma.trainingVideo.findUniqueOrThrow({ where: { video_id: numericVideoId } });
    if (!this.isInternalSample(video.source_type)) {
      await this.publishCompletedMotivation(Number(video.user_id), videoId);
    }
  }

  private async publishCompletedMotivation(userId: number, videoId: number) {
    await this.createDedupedNotification({
      userId,
      type: 'analysis_completed',
      title: '分析已完成',
      content: '您上传的训练视频已生成报告，可前往查看。',
      relatedId: String(videoId),
      dedupeKey: `analysis:${userId}:${videoId}`,
    });

    const badgeAwards = await this.motivationService.handleCompletedAnalysis(videoId);
    for (const badgeAward of badgeAwards) {
      await this.createDedupedNotification({
        userId,
        type: 'badge_earned',
        title: '您获得了新徽章',
        content: `恭喜获得“${badgeAward.title}”徽章，继续保持训练节奏。`,
        relatedId: badgeAward.badgeCode,
        dedupeKey: `badge:${userId}:${badgeAward.badgeCode}`,
      });
    }
  }

  private async createDedupedNotification(params: {
    userId: number;
    type: string;
    title: string;
    content: string;
    relatedId: string;
    dedupeKey: string;
  }) {
    try {
      await this.prisma.notification.create({
        data: {
          user_id: BigInt(params.userId),
          notification_type: params.type,
          title: params.title,
          content: params.content,
          related_id: params.relatedId,
          dedupe_key: params.dedupeKey,
          read_flag: false,
        },
      });
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) throw error;
    }
  }

  private isInternalSample(sourceType: string | null) {
    return sourceType === 'admin_flow_verify' || sourceType === 'gold_template';
  }

  private ensureInternalSample(sourceType: string | null) {
    if (!this.isInternalSample(sourceType)) {
      throw new ForbiddenException('该视频不是可由管理端操作的内部样本');
    }
  }

  private ensureVideoOwnership(ownerId: bigint, userId: number) {
    if (Number(ownerId) !== userId) {
      throw new ForbiddenException('无权访问他人的视频数据');
    }
  }
}
