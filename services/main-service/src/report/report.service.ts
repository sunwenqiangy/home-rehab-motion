import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BadgeSummaryDto, ReportDto, WeeklyProgressDto } from '@home-rehab-motion/shared-contract';
import type { ReportStage, WeeklyProgressStatus } from '@home-rehab-motion/shared-types';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MotivationService } from '../motivation/motivation.service';

function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - day + 1);
  return monday;
}

function getPreviousWeekStart(currentWeekStart: Date) {
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setDate(currentWeekStart.getDate() - 7);
  return previousWeekStart;
}

function buildWeeklyProgress(
  currentWeekCompletedCount: number,
  previousWeekCompletedCount: number,
  badges: BadgeSummaryDto[],
  weeklyTarget: number,
): WeeklyProgressDto {
  const currentCount = Math.min(currentWeekCompletedCount, weeklyTarget);
  const progressPercent = currentCount > 0 ? Math.min(Math.round((currentCount / weeklyTarget) * 100), 100) : 0;

  let status: WeeklyProgressStatus = 'started';
  let desc = `本周完成 ${weeklyTarget} 天训练，可更稳定地看到自己的变化。`;
  let carryoverText: string | undefined;

  if (previousWeekCompletedCount >= weeklyTarget) {
    carryoverText = `上周 ${weeklyTarget} / ${weeklyTarget} 已完成，本周重新开始；连续满周成果会继续保留。`;
  } else if (previousWeekCompletedCount >= 3) {
    carryoverText = `上周已建议达标 ${previousWeekCompletedCount} / ${weeklyTarget}，本周从 0 / ${weeklyTarget} 重新累计。`;
  }

  if (currentCount >= weeklyTarget) {
    status = 'week_completed';
    desc = `本周 ${weeklyTarget} 天训练已完成，可继续保持并承接连续满周成果。`;
  } else if (currentCount >= 3) {
    status = 'target_reached';
    desc = `当前已达到建议达标线，再完成 ${weeklyTarget - currentCount} 天可进入满周完成状态。`;
  } else if (currentCount > 0) {
    status = 'started';
    desc = `本周已完成 ${currentCount} / ${weeklyTarget}，继续坚持会更容易形成稳定节奏。`;
  } else if (previousWeekCompletedCount >= weeklyTarget) {
    status = 'new_week_after_completed';
    desc = `上周已完整完成 ${weeklyTarget} / ${weeklyTarget}，本周重新开始，继续保持当前节奏。`;
  } else if (previousWeekCompletedCount >= 3) {
    status = 'new_week_after_target';
    desc = `上周已建议达标 ${previousWeekCompletedCount} / ${weeklyTarget}，本周重新开始，继续冲击满周完成。`;
  }

  return {
    weeklyTarget,
    currentCount,
    completedDays: currentCount,
    progressPercent,
    status,
    label: `${currentCount} / ${weeklyTarget}`,
    desc,
    carryoverText,
    badges,
  };
}

function resolveReportStage(averageScore: number, grade: string, validReps: number, totalReps: number): ReportStage {
  if (grade === '优秀' || averageScore >= 90) {
    return 'incentive';
  }
  if ((grade === '良好' || averageScore >= 75) && validReps > 0 && totalReps > 0) {
    return 'consolidation';
  }
  return 'corrective';
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly motivationService: MotivationService,
  ) {}

  private async getWeeklyTarget(): Promise<number> {
    const config = await this.configService.getPatientAppConfig();
    return config.weeklyTarget;
  }

  async getReport(videoId: number, userId: number): Promise<ReportDto> {
    const weeklyTarget = await this.getWeeklyTarget();
    const result = await this.prisma.videoEvaluationResult.findUnique({
      where: { video_id: BigInt(videoId) },
      include: {
        video: { include: { manual_review: true } },
      },
    });

    if (!result) {
      throw new NotFoundException(`报告不存在: ${videoId}`);
    }
    if (Number(result.video.user_id) !== userId || result.video.source_type !== 'miniapp') {
      throw new ForbiddenException('无权访问该训练报告');
    }

    const motivation = await this.motivationService.buildSummary(userId);
    const newlyUnlockedBadges = await this.motivationService.getSnapshotBadges(videoId);
    const currentWeekStart = getCurrentWeekStart();
    const previousWeekStart = getPreviousWeekStart(currentWeekStart);

    const [currentWeekCompletedCount, previousWeekCompletedCount, latestBadges, previousCompletedResult] = await Promise.all([
      this.prisma.trainingVideo.count({
        where: {
          user_id: BigInt(userId),
          analysis_status: 'completed',
          source_type: 'miniapp',
          upload_time: { gte: currentWeekStart },
        },
      }),
      this.prisma.trainingVideo.count({
        where: {
          user_id: BigInt(userId),
          analysis_status: 'completed',
          source_type: 'miniapp',
          upload_time: { gte: previousWeekStart, lt: currentWeekStart },
        },
      }),
      this.prisma.userBadge.findMany({
        where: { user_id: BigInt(userId) },
        include: { badge: true },
        orderBy: { awarded_at: 'desc' },
        take: 3,
      }),
      this.prisma.videoEvaluationResult.findFirst({
        where: {
          video: {
            user_id: BigInt(userId),
            source_type: 'miniapp',
          },
          NOT: {
            video_id: BigInt(videoId),
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      }),
    ]);

    const badgeSummary: BadgeSummaryDto[] = latestBadges.map((item) => ({
      badgeCode: item.badge.badge_code,
      title: item.badge.title,
      description: item.badge.description || undefined,
      awardedAt: item.awarded_at.toISOString(),
    }));

    const review = result.video.manual_review;
    const requiresManualReview = result.video.analysis_status === 'review_required' && !review?.use_manual_result;
    const reviewMessage = requiresManualReview
      ? '本次训练记录已收到，系统正在复核拍摄和动作信息，请稍后查看结果。'
      : undefined;
    const usesManualResult = Boolean(review?.use_manual_result);
    const sourceIssues = requiresManualReview ? [] : (usesManualResult ? review?.manual_main_issues : result.main_issues);
    const mainIssues = Array.isArray(sourceIssues)
      ? sourceIssues
          .map((issue) => {
            if (typeof issue === 'string') return issue;
            if (issue && typeof issue === 'object' && 'feature' in issue) return String((issue as { feature?: unknown }).feature || '');
            return '';
          })
          .filter(Boolean)
      : [];

    const algorithmAdvice = Array.isArray(result.advice_summary)
      ? result.advice_summary.map((item) => ({
          adviceCode: item && typeof item === 'object' && 'advice_code' in item ? String((item as { advice_code?: unknown }).advice_code || '') : '',
          patientText: item && typeof item === 'object' && 'patient_text' in item ? String((item as { patient_text?: unknown }).patient_text || '') : '',
        }))
      : [];
    const adviceSummary = requiresManualReview
      ? [{ adviceCode: 'review_required', patientText: reviewMessage! }]
      : usesManualResult && review?.manual_advice
        ? [{ adviceCode: 'manual_review', patientText: review.manual_advice }]
        : algorithmAdvice;

    const grade = requiresManualReview ? '待复核' : (usesManualResult ? (review?.manual_grade || result.grade || '无效') : (result.grade || '无效'));
    const averageScore = requiresManualReview ? 0 : (usesManualResult ? Number(review?.manual_score || 0) : (result.average_score || 0));
    const validReps = result.valid_reps || 0;
    const totalReps = result.total_reps || 0;
    const stage = resolveReportStage(averageScore, grade, validReps, totalReps);

    const previousAverageScore = previousCompletedResult?.average_score ?? null;
    const scoreDelta =
      previousAverageScore != null && averageScore
        ? Math.round(averageScore - previousAverageScore)
        : null;
    const compareToLast =
      scoreDelta == null
        ? undefined
        : scoreDelta > 0
          ? `较上次 +${scoreDelta} 分`
          : scoreDelta < 0
            ? `较上次 ${scoreDelta} 分`
            : '与上次持平';

    return {
      videoId,
      actionType: result.video.action_type as ReportDto['actionType'],
      uploadedAt: result.video.upload_time.toISOString(),
      duration: result.video.duration ? Number(result.video.duration) : 0,
      grade,
      averageScore,
      totalReps,
      validReps,
      avgHoldDuration: result.avg_hold_duration || 0,
      confidenceScore: result.confidence_score || 0,
      requiresManualReview,
      reviewMessage,
      accuracyAvg: requiresManualReview ? undefined : (result.accuracy_avg || 0),
      stabilityAvg: requiresManualReview ? undefined : (result.stability_avg || 0),
      controlAvg: requiresManualReview ? undefined : (result.control_avg || 0),
      durationAvg: requiresManualReview ? undefined : (result.duration_avg || 0),
      stage,
      compareToLast: requiresManualReview ? undefined : compareToLast,
      trendSummary: requiresManualReview
        ? '复核完成前，请先以动作指导中的拍摄要求为准。'
        : stage === 'incentive' ? '近几次训练节奏稳定，建议继续保持当前状态。' : '继续按当前节奏训练，系统会持续记录您的变化。',
      streakSummary: buildWeeklyProgress(currentWeekCompletedCount, previousWeekCompletedCount, badgeSummary, weeklyTarget),
      badgeSummary,
      motivation,
      newlyUnlockedBadges,
      mainIssues,
      adviceSummary,
      resultSource: usesManualResult ? 'manual_review' : 'algorithm',
      manualReviewSummary: usesManualResult && review
        ? { reviewedAt: review.reviewed_at.toISOString(), advice: review.manual_advice || undefined }
        : undefined,
    };
  }
}
