import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ConfirmUploadRequestDto,
  ConfirmUploadResponseDto,
  ManualVideoReviewDto,
  PresignUploadResponseDto,
  SaveManualVideoReviewRequestDto,
  VideoStatusDto,
} from '@home-rehab-motion/shared-contract';
import type { AnalysisStatus, TrainingActionType, TrainingVideoSourceType } from '@home-rehab-motion/shared-types';

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
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { AnalysisService, type AnalysisEnqueueResult } from '../analysis/analysis.service';
import { BadgeService } from '../badge/badge.service';
import { ConfigService } from '../config/config.service';
import { MotivationService } from '../motivation/motivation.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrivacyService } from '../privacy/privacy.service';
import { StorageService, type UploadedBinaryFile } from '../storage/storage.service';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisService: AnalysisService,
    private readonly storageService: StorageService,
    private readonly badgeService: BadgeService,
    private readonly configService: ConfigService,
    private readonly motivationService: MotivationService,
    private readonly privacyService: PrivacyService,
  ) {}

  async getPresignUpload(userId: number, actionType: TrainingActionType): Promise<PresignUploadResponseDto> {
    await this.privacyService.requireActiveConsent(userId);
    if (userId <= 0) {
      throw new BadRequestException('无效的用户身份，无法创建上传任务');
    }

    const ownerId = BigInt(userId);

    const created = await this.prisma.trainingVideo.create({
      data: {
        user_id: ownerId,
        action_type: actionType,
        source_type: 'miniapp',
        video_key: null,
        analysis_status: 'uploading',
      },
    });

    const videoId = Number(created.video_id);
    const objectKey = this.storageService.buildVideoObjectKey(videoId, userId, actionType);

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

  async getInternalSamplePresignUpload(
    sourceType: Exclude<TrainingVideoSourceType, 'miniapp'>,
    actionType: TrainingActionType,
  ) {
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
        action_type: actionType,
        source_type: sourceType,
        analysis_status: 'uploading',
      },
    });
    const videoId = Number(created.video_id);
    const uploadTarget = await this.storageService.createUploadTarget(
      videoId,
      this.storageService.buildInternalSampleVideoObjectKey(videoId, sourceType, actionType),
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

    const objectKey = video.video_key || (
      allowInternalAccess
        ? this.storageService.buildInternalSampleVideoObjectKey(
          videoId,
          video.source_type as 'gold_template' | 'admin_flow_verify',
          video.action_type,
        )
        : this.storageService.buildVideoObjectKey(videoId, Number(video.user_id), video.action_type)
    );
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
    const startedAt = Date.now();
    this.logger.log(
      `Confirm upload started: videoId=${payload.videoId}, userId=${userId}, actionType=${payload.actionType}, `
      + `durationSeconds=${payload.duration}, source=${options.requireConsent === false ? 'internal-sample' : 'patient'}`,
    );
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

    if (video.analysis_status !== 'uploading') {
      if (video.confirmed_at) {
        return {
          videoId: payload.videoId,
          status: video.analysis_status as ConfirmUploadResponseDto['status'],
          estimatedWaitSeconds: 0,
        };
      }
      throw new BadRequestException('当前视频状态不允许确认上传');
    }
    if (video.action_type !== payload.actionType) {
      throw new BadRequestException('动作类型与上传任务不一致，请重新选择视频');
    }

    const appConfig = await this.configService.getPatientAppConfig();
    if (!Number.isFinite(payload.duration) || payload.duration < appConfig.videoMinDurationSeconds) {
      throw new BadRequestException(`视频时长不能少于 ${appConfig.videoMinDurationSeconds} 秒`);
    }
    if (payload.duration > appConfig.videoMaxDurationSeconds) {
      throw new BadRequestException(`视频时长不能超过 ${appConfig.videoMaxDurationSeconds} 秒`);
    }

    const objectKey = video.video_key || this.storageService.buildVideoObjectKey(payload.videoId, userId, video.action_type);
    const resolvedObjectKey = objectKey.endsWith('.mp4')
      || objectKey.endsWith('.mov')
      || objectKey.endsWith('.m4v')
      || objectKey.endsWith('.avi')
      ? objectKey
      : `${objectKey}.mp4`;

    const objectExists = await this.storageService.objectExists(resolvedObjectKey);
    if (!objectExists) {
      this.logger.warn(`Confirm upload rejected: videoId=${payload.videoId}, reason=object_not_found`);
      throw new BadRequestException('视频文件尚未上传，请先完成上传');
    }
    this.logger.log(`Video object verified: videoId=${payload.videoId}, hasObject=true`);

    await this.prisma.trainingVideo.update({
      where: { video_id: BigInt(payload.videoId) },
      data: {
        action_type: payload.actionType,
        duration: payload.duration,
        video_key: resolvedObjectKey,
        confirmed_at: video.confirmed_at || new Date(),
        analysis_status: 'queued',
        fail_reason: null,
      },
    });

    if (options.recordMotivation !== false) {
      await this.motivationService.recordConfirmedTraining(userId, payload.videoId, video.confirmed_at || new Date());
    }

    const analysisRunId = randomUUID();
    await this.prisma.analysisRun.create({
      data: {
        analysis_run_id: analysisRunId,
        video_id: BigInt(payload.videoId),
        status: 'queued',
        request_snapshot: payload as object,
      },
    });

    try {
      this.logger.log(`Enqueue requested from confirm upload: videoId=${payload.videoId}, runId=${analysisRunId}, actionType=${payload.actionType}`);
      const task = await this.analysisService.enqueueVideo({
        videoId: payload.videoId,
        actionType: payload.actionType,
        analysisRunId,
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
          analysis_run_id: analysisRunId,
          // worker 可能已先一步把任务标记为 processing，不能再被确认接口降级回 queued。
          task_status: task.status === 'completed' ? 'completed' : undefined,
          fail_reason: null,
          finished_at: task.status === 'completed' ? new Date() : undefined,
        },
        create: {
          video_id: BigInt(payload.videoId),
          provider_task_id: task.task_id,
          analysis_run_id: analysisRunId,
          task_status: task.status === 'completed' ? 'completed' : 'queued',
          finished_at: task.status === 'completed' ? new Date() : null,
        },
      });

      this.logger.log(
        `Analysis task persisted after enqueue: videoId=${payload.videoId}, taskId=${task.task_id}, status=${task.status}, `
        + `elapsedMs=${Date.now() - startedAt}`,
      );

      if (task.status === 'completed' && task.compatReport) {
        await this.applyCompatAnalyzeResult(payload.videoId, task.compatReport);
        return {
          videoId: payload.videoId,
          status: 'completed',
          estimatedWaitSeconds: 0,
        };
      }

      this.logger.log(`Confirm upload completed: videoId=${payload.videoId}, status=queued, elapsedMs=${Date.now() - startedAt}`);
      return {
        videoId: payload.videoId,
        status: 'queued',
        estimatedWaitSeconds: 30,
      };
    } catch (error) {
      // 视频和确认信息已持久化。分析服务短暂不可用时不应把患者视频标记为失败，
      // 由主服务的协调器按退避策略重新投递，避免患者重复上传。
      const failReason = error instanceof Error ? error.message : '分析服务暂不可用';
      const retryAt = new Date(Date.now() + 30_000);
      this.logger.error(
        `Enqueue failed; keeping video queued for retry: videoId=${payload.videoId}, actionType=${payload.actionType}, `
        + `retryAt=${retryAt.toISOString()}, elapsedMs=${Date.now() - startedAt}, error=${failReason}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.prisma.$transaction([
        this.prisma.trainingVideo.update({
          where: { video_id: BigInt(payload.videoId) },
          data: {
            analysis_status: 'queued',
            fail_reason: null,
          },
        }),
        this.prisma.analysisTask.upsert({
          where: { video_id: BigInt(payload.videoId) },
          update: {
            analysis_run_id: analysisRunId,
            task_status: 'queued',
            fail_reason: failReason.slice(0, 255),
            callback_status: 'retry_pending',
            callback_last_error: failReason.slice(0, 255),
            callback_next_retry_at: retryAt,
            finished_at: null,
          },
          create: {
            video_id: BigInt(payload.videoId),
            analysis_run_id: analysisRunId,
            task_status: 'queued',
            fail_reason: failReason.slice(0, 255),
            callback_status: 'retry_pending',
            callback_last_error: failReason.slice(0, 255),
            callback_next_retry_at: retryAt,
          },
        }),
      ]);
      this.logger.warn(`Confirm upload deferred: videoId=${payload.videoId}, status=queued, retryScheduledAt=${retryAt.toISOString()}`);
      return {
        videoId: payload.videoId,
        status: 'queued',
        estimatedWaitSeconds: 60,
      };
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
    const startedAt = Date.now();
    this.logger.log(`Internal sample status requested: videoId=${videoId}`);
    const video = await this.findVideoWithTimeout(
      this.prisma.trainingVideo.findUnique({
        where: { video_id: BigInt(videoId) },
      }),
      videoId,
      'internal_sample_lookup',
    );
    if (!video) {
      throw new NotFoundException(`视频不存在: ${videoId}`);
    }
    this.ensureInternalSample(video.source_type);
    const status = await this.getVideoStatus(videoId, Number(video.user_id));
    this.logger.log(
      `Internal sample status returned: videoId=${videoId}, status=${status.status}, `
      + `reportReady=${status.reportReady}, elapsedMs=${Date.now() - startedAt}`,
    );
    return status;
  }

  async getVideoStatus(videoId: number, userId: number): Promise<VideoStatusDto> {
    const startedAt = Date.now();
    const video = await this.findVideoWithTimeout(
      this.prisma.trainingVideo.findUnique({
        where: { video_id: BigInt(videoId) },
        include: {
          analysis_task: true,
          video_evaluation_result: true,
        },
      }),
      videoId,
      'status_with_analysis_result',
    );

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

    const result = {
      videoId,
      status: (effectiveStatus as AnalysisStatus) || 'pending',
      reportReady:
        (effectiveStatus === 'completed' || effectiveStatus === 'review_required')
        && Boolean(video.video_evaluation_result),
      estimatedWaitSeconds,
      failReason,
    };
    this.logger.log(
      `Video status resolved: videoId=${videoId}, videoStatus=${video.analysis_status}, `
      + `taskStatus=${video.analysis_task?.task_status || 'none'}, effectiveStatus=${result.status}, `
      + `reportReady=${result.reportReady}, elapsedMs=${Date.now() - startedAt}`,
    );
    return result;
  }

  private async findVideoWithTimeout<T>(query: Promise<T>, videoId: number, operation: string): Promise<T> {
    const timeoutMs = Number(process.env.VIDEO_STATUS_QUERY_TIMEOUT_MS || 8_000);
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        query,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`database query timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Video status query failed: videoId=${videoId}, operation=${operation}, timeoutMs=${timeoutMs}, error=${reason}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException({
        code: 'VIDEO_STATUS_UNAVAILABLE',
        message: '分析状态暂时无法读取，请稍后重试。',
        detail: `videoId=${videoId}, operation=${operation}, error=${reason}`,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
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

  async getAdminDashboardOverview(days = 7) {
    const rangeDays = days === 30 ? 30 : 7;
    const startAt = new Date();
    startAt.setHours(0, 0, 0, 0);
    startAt.setDate(startAt.getDate() - rangeDays + 1);
    const patientVideoWhere = { source_type: 'miniapp' as const };
    const [videos, patients, totalPatients, allVideoCount, allCompletedAnalysisCount, analysisStatusGroups] = await this.prisma.$transaction([
      this.prisma.trainingVideo.findMany({
        where: { ...patientVideoWhere, created_at: { gte: startAt } },
        select: { created_at: true, analysis_status: true, user_id: true },
      }),
      this.prisma.userProfile.findMany({
        where: { role: 'patient' },
        select: { user_id: true, created_at: true },
      }),
      this.prisma.userProfile.count({ where: { role: 'patient' } }),
      this.prisma.trainingVideo.count({ where: patientVideoWhere }),
      this.prisma.trainingVideo.count({ where: { ...patientVideoWhere, analysis_status: 'completed' } }),
      this.prisma.trainingVideo.findMany({
        where: patientVideoWhere,
        select: { analysis_status: true },
      }),
    ]);
    const dayKey = (value: Date) => value.toISOString().slice(0, 10);
    const buckets = new Map<string, { date: string; uploads: number; completed: number; newPatients: number }>();
    for (let offset = 0; offset < rangeDays; offset += 1) {
      const date = new Date(startAt);
      date.setDate(startAt.getDate() + offset);
      const key = dayKey(date);
      buckets.set(key, { date: key, uploads: 0, completed: 0, newPatients: 0 });
    }
    videos.forEach((video) => {
      const bucket = buckets.get(dayKey(video.created_at));
      if (!bucket) return;
      bucket.uploads += 1;
      if (video.analysis_status === 'completed') bucket.completed += 1;
    });
    patients.forEach((patient) => {
      const bucket = buckets.get(dayKey(patient.created_at));
      if (bucket) bucket.newPatients += 1;
    });
    const activePatientIds = new Set(videos.map((video) => video.user_id.toString()));
    return {
      days: rangeDays,
      totalPatients,
      activePatientCount: activePatientIds.size,
      newPatientCount: [...buckets.values()].reduce((sum, item) => sum + item.newPatients, 0),
      videoUploadCount: videos.length,
      completedAnalysisCount: videos.filter((video) => video.analysis_status === 'completed').length,
      allVideoCount,
      allCompletedAnalysisCount,
      analysisStatusCounts: analysisStatusGroups.reduce<Record<string, number>>((counts, item) => {
        counts[item.analysis_status] = (counts[item.analysis_status] || 0) + 1;
        return counts;
      }, {}),
      trend: [...buckets.values()],
    };
  }

  async getAdminVideoList(options: { page?: number; limit?: number; status?: string; keyword?: string } = {}) {
    const page = Math.max(1, Math.floor(options.page || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 10)));
    const allowedStatuses = new Set(['pending', 'uploading', 'queued', 'processing', 'completed', 'failed', 'quality_insufficient']);
    const status = options.status && allowedStatuses.has(options.status) ? options.status : undefined;
    const keyword = options.keyword?.trim().slice(0, 50);
    const videoId = keyword && /^\d+$/.test(keyword) ? BigInt(keyword) : undefined;
    const where: Prisma.TrainingVideoWhereInput = {
      source_type: 'miniapp',
      ...(status ? { analysis_status: status } : {}),
      ...(keyword ? {
        OR: [
          ...(videoId ? [{ video_id: videoId }] : []),
          { action_type: { contains: keyword } },
          { user: { is: { name: { contains: keyword } } } },
        ],
      } : {}),
    };
    const [total, videos] = await this.prisma.$transaction([
      this.prisma.trainingVideo.count({ where }),
      this.prisma.trainingVideo.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: true },
      }),
    ]);

    return {
      items: videos.map((video) => ({
      videoId: Number(video.video_id),
      actionType: video.action_type,
      status: video.analysis_status,
      qualityStatus: video.quality_status,
      patientName: video.user?.name || '未命名患者',
      uploadedAt: video.created_at.toISOString(),
        createdAt: video.created_at.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async getAdminAnalysisTasks(options: { page?: number; limit?: number; status?: string; keyword?: string } = {}) {
    const page = Math.max(1, Math.floor(options.page || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 10)));
    const allowedStatuses = new Set(['pending', 'uploading', 'queued', 'processing', 'completed', 'failed', 'quality_insufficient', 'review_required']);
    const status = options.status && allowedStatuses.has(options.status) ? options.status : undefined;
    const keyword = options.keyword?.trim().slice(0, 50);
    const videoId = keyword && /^\d+$/.test(keyword) ? BigInt(keyword) : undefined;
    const where: Prisma.TrainingVideoWhereInput = {
      source_type: { in: ['miniapp', 'admin_flow_verify', 'gold_template'] },
      ...(status ? { analysis_status: status } : {}),
      ...(keyword ? {
        OR: [
          ...(videoId ? [{ video_id: videoId }] : []),
          { action_type: { contains: keyword } },
          { user: { is: { name: { contains: keyword } } } },
        ],
      } : {}),
    };
    const [total, videos] = await this.prisma.$transaction([
      this.prisma.trainingVideo.count({ where }),
      this.prisma.trainingVideo.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { user: true, analysis_task: true, video_evaluation_result: true },
      }),
    ]);
    return {
      items: videos.map((video) => ({
        videoId: Number(video.video_id),
        actionType: video.action_type,
        sourceType: video.source_type,
        patientName: video.user?.name || (video.source_type === 'miniapp' ? '未命名患者' : '内部样本'),
        analysisStatus: video.analysis_status,
        taskStatus: video.analysis_task?.task_status || video.analysis_status,
        providerTaskId: video.analysis_task?.provider_task_id || null,
        retryCount: video.analysis_task?.retry_count || 0,
        retryAt: video.analysis_task?.callback_next_retry_at?.toISOString() || null,
        callbackStatus: video.analysis_task?.callback_status || null,
        failReason: video.fail_reason || video.analysis_task?.fail_reason || null,
        qualityStatus: video.quality_status,
        reportReady: Boolean(video.video_evaluation_result),
        createdAt: video.created_at.toISOString(),
        startedAt: video.analysis_task?.started_at?.toISOString() || null,
        finishedAt: video.analysis_task?.finished_at?.toISOString() || null,
        // 模板、阈值或算法版本发布后，管理员需要能对已完成视频做回归复测；
        // 进行中任务仍不可重复投递，避免并发写入同一视频结果。
        canReanalyze: ['completed', 'failed', 'quality_insufficient', 'review_required'].includes(video.analysis_status),
      })),
      total,
      page,
      limit,
    };
  }

  async retryAnalysis(videoId: number) {
    const video = await this.prisma.trainingVideo.findUnique({ where: { video_id: BigInt(videoId) } });
    if (!video) throw new NotFoundException(`视频不存在: ${videoId}`);
    if (!video.video_key) throw new BadRequestException('原视频不存在，无法重新分析');
    if (!['completed', 'failed', 'quality_insufficient', 'review_required'].includes(video.analysis_status)) {
      throw new BadRequestException('仅已完成、失败、质量不足或待复核任务可以重新分析');
    }

    const analysisRunId = randomUUID();
    await this.prisma.analysisRun.create({
      data: { analysis_run_id: analysisRunId, video_id: BigInt(videoId), status: 'queued' },
    });

    await this.prisma.$transaction([
      this.prisma.trainingVideo.update({
        where: { video_id: BigInt(videoId) },
        data: { analysis_status: 'queued', fail_reason: null, quality_status: null, quality_score: null },
      }),
      this.prisma.analysisTask.upsert({
        where: { video_id: BigInt(videoId) },
        update: {
          provider_task_id: null,
          analysis_run_id: analysisRunId,
          task_status: 'queued',
          retry_count: 0,
          fail_reason: null,
          callback_status: 'retry_pending',
          callback_last_error: null,
          callback_next_retry_at: new Date(),
          started_at: null,
          finished_at: null,
        },
        create: {
          video_id: BigInt(videoId),
          analysis_run_id: analysisRunId,
          task_status: 'queued',
          callback_status: 'retry_pending',
          callback_next_retry_at: new Date(),
        },
      }),
    ]);

    try {
      const task = await this.analysisService.enqueueVideo({
        videoId,
        actionType: video.action_type as TrainingActionType,
        analysisRunId,
        videoKey: video.video_key,
      });
      await this.prisma.analysisTask.update({
        where: { video_id: BigInt(videoId) },
        data: {
          provider_task_id: task.task_id,
          analysis_run_id: analysisRunId,
          task_status: task.status === 'completed' ? 'completed' : 'queued',
          callback_status: 'pending',
          callback_next_retry_at: null,
        },
      });
      return { videoId, status: 'queued', message: '已重新提交分析任务' };
    } catch (error) {
      // 即时投递失败时保留补偿状态，由协调器自动退避重试，无需患者重新上传。
      this.logger.warn(`Manual reanalysis deferred: videoId=${videoId}, error=${error instanceof Error ? error.message : String(error)}`);
      return { videoId, status: 'queued', message: '分析服务暂不可用，已加入自动重试队列' };
    }
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
      templateId: video.video_evaluation_result?.template_id
        ? Number(video.video_evaluation_result.template_id)
        : null,
      templateVersion: video.video_evaluation_result?.template_version ?? null,
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
    analysis_run_id: string;
    provider_task_id: string;
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
      template_id?: number;
      template_version?: string;
      threshold_snapshot?: unknown;
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
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[4-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.analysis_run_id)) {
      throw new BadRequestException('无效的分析运行 ID');
    }
    if (!payload.provider_task_id) {
      throw new BadRequestException('回调缺少分析服务任务 ID');
    }
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: videoId },
    });

    if (!video) {
      throw new NotFoundException(`视频不存在: ${payload.video_id}`);
    }
    const run = await this.prisma.analysisRun.findUnique({ where: { analysis_run_id: payload.analysis_run_id } });
    if (!run || run.video_id !== videoId) {
      throw new BadRequestException('分析运行不存在或不属于该视频');
    }
    const currentTask = await this.prisma.analysisTask.findUnique({ where: { video_id: videoId } });
    if (!currentTask || currentTask.analysis_run_id !== payload.analysis_run_id || currentTask.provider_task_id !== payload.provider_task_id) {
      throw new BadRequestException('回调任务与当前分析运行不匹配');
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

    await this.prisma.analysisRun.update({
      where: { analysis_run_id: payload.analysis_run_id },
      data: {
        provider_task_id: payload.provider_task_id,
        status: payload.analysis_status,
        fail_reason: payload.fail_reason,
        finished_at: finalStatuses.has(payload.analysis_status) ? new Date() : undefined,
      },
    });

    await this.prisma.analysisTask.upsert({
      where: { video_id: videoId },
      update: {
        task_status: payload.analysis_status,
        analysis_run_id: payload.analysis_run_id,
        provider_task_id: payload.provider_task_id,
        fail_reason: payload.fail_reason,
        callback_status: 'received',
        callback_attempt_count: { increment: 1 },
        callback_last_error: null,
        callback_next_retry_at: null,
        callback_payload: payload as object,
        callback_url: process.env.ANALYSIS_CALLBACK_URL || null,
        finished_at:
          finalStatuses.has(payload.analysis_status)
            ? new Date()
            : undefined,
      },
      create: {
        video_id: videoId,
        task_status: payload.analysis_status,
        analysis_run_id: payload.analysis_run_id,
        provider_task_id: payload.provider_task_id,
        fail_reason: payload.fail_reason,
        callback_status: 'received',
        callback_attempt_count: 1,
        callback_payload: payload as object,
        callback_url: process.env.ANALYSIS_CALLBACK_URL || null,
        finished_at:
          finalStatuses.has(payload.analysis_status)
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
          template_id: payload.video_evaluation.template_id != null
            ? BigInt(payload.video_evaluation.template_id)
            : undefined,
          template_version: payload.video_evaluation.template_version ?? undefined,
          threshold_snapshot: (payload.video_evaluation.threshold_snapshot as object | undefined) ?? undefined,
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
          template_id: payload.video_evaluation.template_id != null
            ? BigInt(payload.video_evaluation.template_id)
            : null,
          template_version: payload.video_evaluation.template_version ?? 'legacy_unknown',
          threshold_snapshot: (payload.video_evaluation.threshold_snapshot as object | undefined) ?? undefined,
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
