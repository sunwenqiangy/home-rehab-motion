import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const FINAL_STATUSES = new Set(['completed', 'failed', 'quality_insufficient', 'review_required']);

@Injectable()
export class AnalysisReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisReconciliationService.name);
  private readonly intervalMs = Number(process.env.ANALYSIS_RECONCILIATION_INTERVAL_MS || 60_000);
  private readonly timeoutMs = Number(process.env.ANALYSIS_TASK_TIMEOUT_SECONDS || 900) * 1000;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.reconcile();
    }, this.intervalMs);
    this.timer.unref();
    void this.reconcile();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async reconcile() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const candidates = await this.prisma.analysisTask.findMany({
        where: { task_status: { in: ['queued', 'processing', 'completed', 'failed', 'quality_insufficient', 'review_required'] } },
        include: { video: { include: { video_evaluation_result: true } } },
        take: 100,
        orderBy: { updated_at: 'asc' },
      });

      const now = Date.now();
      for (const task of candidates) {
        const video = task.video;
        const taskStatus = task.task_status;
        const videoStatus = video.analysis_status;

        if (taskStatus === 'completed' && video.video_evaluation_result && videoStatus !== 'completed') {
          if (FINAL_STATUSES.has(videoStatus)) {
            this.logger.error(`Conflicting final states for video ${video.video_id}; manual review required`);
            continue;
          }
          await this.prisma.trainingVideo.updateMany({
            where: { video_id: video.video_id, analysis_status: { notIn: ['completed'] } },
            data: { analysis_status: 'completed', fail_reason: null },
          });
          this.logger.warn(`Reconciled completed analysis result for video ${video.video_id}`);
          continue;
        }

        if ((taskStatus === 'failed' || taskStatus === 'quality_insufficient' || taskStatus === 'review_required') && !FINAL_STATUSES.has(videoStatus)) {
          await this.prisma.trainingVideo.updateMany({
            where: { video_id: video.video_id, analysis_status: { in: ['queued', 'processing', 'uploading', 'pending'] } },
            data: {
              analysis_status: taskStatus,
              fail_reason: task.fail_reason || '分析任务未完成，请重新提交视频',
            },
          });
          this.logger.warn(`Reconciled ${taskStatus} analysis result for video ${video.video_id}`);
          continue;
        }

        if (taskStatus === 'completed' && !video.video_evaluation_result) {
          const recoveryReason = '分析结果回调不完整，等待服务补偿重投';
          await this.prisma.analysisTask.update({
            where: { task_id: task.task_id },
            data: {
              callback_status: 'retry_pending',
              callback_last_error: recoveryReason,
              callback_next_retry_at: new Date(),
            },
          });
          this.logger.error(`Completed task without report for video ${video.video_id}; marked for callback recovery`);
          continue;
        }

        const active = taskStatus === 'queued' || taskStatus === 'processing';
        const lastActiveAt = task.started_at || task.updated_at || task.created_at;
        if (active && now - lastActiveAt.getTime() > this.timeoutMs) {
          const timeoutReason = '分析任务超时未完成，请重新提交视频';
          await this.prisma.$transaction([
            this.prisma.analysisTask.updateMany({
              where: { task_id: task.task_id, task_status: { in: ['queued', 'processing'] } },
              data: { task_status: 'failed', fail_reason: timeoutReason, finished_at: new Date() },
            }),
            this.prisma.trainingVideo.updateMany({
              where: { video_id: video.video_id, analysis_status: { in: ['queued', 'processing'] } },
              data: { analysis_status: 'failed', fail_reason: timeoutReason },
            }),
          ]);
          this.logger.error(`Marked stale analysis task as failed for video ${video.video_id}`);
        }
      }
    } catch (error) {
      this.logger.error('Analysis reconciliation failed', error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
