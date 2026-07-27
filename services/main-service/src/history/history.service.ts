import { Injectable } from '@nestjs/common';
import type { HistoryVideoDto } from '@home-rehab-motion/shared-contract';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listHistoryVideos(userId: number): Promise<HistoryVideoDto[]> {
    const videos = await this.prisma.trainingVideo.findMany({
      where: {
        user_id: BigInt(userId),
        source_type: 'miniapp',
      },
      orderBy: {
        created_at: 'desc',
      },
      take: 20,
      include: {
        video_evaluation_result: {
          select: {
            average_score: true,
            grade: true,
          },
        },
        manual_review: {
          select: {
            use_manual_result: true,
            manual_score: true,
            manual_grade: true,
          },
        },
      },
    });

    return videos.map((video) => ({
      videoId: Number(video.video_id),
      actionType: video.action_type as HistoryVideoDto['actionType'],
      status: video.analysis_status as HistoryVideoDto['status'],
      uploadedAt: video.upload_time.toISOString(),
      reportReady: video.analysis_status === 'completed' && Boolean(video.video_evaluation_result),
      averageScore:
        video.manual_review?.use_manual_result && typeof video.manual_review.manual_score === 'number'
          ? Math.round(video.manual_review.manual_score)
          : typeof video.video_evaluation_result?.average_score === 'number'
            ? Math.round(video.video_evaluation_result.average_score)
            : undefined,
      grade: video.manual_review?.use_manual_result
        ? video.manual_review.manual_grade || video.video_evaluation_result?.grade || undefined
        : video.video_evaluation_result?.grade || undefined,
      duration: typeof video.duration === 'number' ? Math.round(video.duration) : undefined,
      failReason: this.resolvePatientFailReason(video.analysis_status, video.fail_reason),
    }));
  }

  private resolvePatientFailReason(status: string, failReason: string | null): string | undefined {
    if (status === 'quality_insufficient') {
      return '视频质量不足，请按拍摄要求重新上传。';
    }

    if (status === 'failed') {
      if (!failReason) {
        return '分析暂未完成，请重新上传后再试。';
      }

      const normalized = failReason.toLowerCase();
      if (normalized.includes('timeout')) {
        return '分析等待超时，请重新上传后再试。';
      }
      if (normalized.includes('quality') || normalized.includes('姿势') || normalized.includes('角度')) {
        return '视频质量不足，请按拍摄要求重新上传。';
      }
      return '分析暂未完成，请重新上传后再试。';
    }

    return undefined;
  }
}
