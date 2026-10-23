import { Injectable } from '@nestjs/common';
import type { HistoryVideoDto } from '@home-rehab-motion/shared-contract';
import { getVisualEvidencePreviewScore } from '../common/visual-evidence-score';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listHistoryVideos(userId: number, page = 1, pageSize = 20): Promise<HistoryVideoDto[]> {
    const videos = await this.prisma.trainingVideo.findMany({
      where: {
        user_id: BigInt(userId),
        source_type: 'miniapp',
      },
      orderBy: {
        created_at: 'desc',
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        video_evaluation_result: {
          select: {
            average_score: true,
            grade: true,
            total_reps: true,
            segmentation_snapshot: true,
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

    return videos.map((video) => {
      const snapshot = video.video_evaluation_result?.segmentation_snapshot;
      const visualScoreType = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? (snapshot as Record<string, unknown>).score_type : undefined;
      const visualPractice = (visualScoreType === 'visual_practice' || visualScoreType === 'visual_evidence')
        && !video.manual_review?.use_manual_result;
      const scoreAvailable = !visualPractice || (snapshot as Record<string, unknown>).score_available === true;
      const evidencePreviewScore = visualPractice && scoreAvailable && video.analysis_status === 'completed'
        ? getVisualEvidencePreviewScore(snapshot as Record<string, unknown>, video.video_evaluation_result?.total_reps || 0)
        : undefined;
      const hasEvidenceScore = visualScoreType === 'visual_evidence' || evidencePreviewScore !== undefined;
      return {
      videoId: Number(video.video_id),
      actionType: video.action_type as HistoryVideoDto['actionType'],
      status: video.analysis_status as HistoryVideoDto['status'],
      uploadedAt: video.upload_time.toISOString(),
      reportReady: video.analysis_status === 'completed' && Boolean(video.video_evaluation_result),
      averageScore:
        !scoreAvailable ? undefined :
        evidencePreviewScore !== undefined ? Math.round(evidencePreviewScore) :
        visualPractice && !hasEvidenceScore ? undefined :
        video.manual_review?.use_manual_result && typeof video.manual_review.manual_score === 'number'
          ? Math.round(video.manual_review.manual_score)
          : typeof video.video_evaluation_result?.average_score === 'number'
            ? Math.round(video.video_evaluation_result.average_score)
            : undefined,
      grade: video.manual_review?.use_manual_result
        ? video.manual_review.manual_grade || video.video_evaluation_result?.grade || undefined
        : evidencePreviewScore !== undefined ? '本段完成'
        : video.video_evaluation_result?.grade || undefined,
      scoreType: visualPractice
        ? (hasEvidenceScore ? 'visual_evidence' : 'visual_practice') : 'pose',
      scoreAvailable,
      duration: typeof video.duration === 'number' ? Math.round(video.duration) : undefined,
      failReason: this.resolvePatientFailReason(video.analysis_status, video.fail_reason),
      };
    });
  }

  private resolvePatientFailReason(status: string, failReason: string | null): string | undefined {
    if (status === 'quality_insufficient') {
      const normalized = (failReason || '').toLowerCase();
      if (normalized.includes('视频上传不完整') || normalized.includes('视频文件信息不一致') || normalized.includes('缺少原视频文件大小')) {
        return '训练已记录，但视频文件未完整上传；请重新选择手机里的原视频。';
      }
      if (normalized.includes('视频解码不完整') || normalized.includes('video_decode_incomplete')) {
        return '训练已记录，但视频画面不完整；请确认原视频可完整播放后再上传。';
      }
      const trunkKeypointsUnstable = (failReason || '').includes('关键躯干点') || (failReason || '').includes('肩髋');
      return trunkKeypointsUnstable
        ? '训练已记录，但部分画面未识别到肩部或髋部；请先查看拍摄要求。'
        : '训练已记录，但暂未生成可靠的动作观察；请先查看拍摄要求。';
    }

    if (status === 'failed') {
      if (!failReason) {
        return '分析暂未完成，请重新上传后再试。';
      }

      const normalized = failReason.toLowerCase();
      if (normalized.includes('timeout')) {
        return '训练已记录，分析等待时间较长；请稍后从训练记录查看。';
      }
      if (normalized.includes('quality') || normalized.includes('姿势') || normalized.includes('角度')) {
        return '训练已记录，但暂未生成可靠的动作观察；请先查看拍摄要求。';
      }
      return '训练已记录，动作观察暂未完成；请稍后从训练记录查看。';
    }

    return undefined;
  }
}
