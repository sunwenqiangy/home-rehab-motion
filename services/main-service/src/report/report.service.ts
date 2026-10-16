import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BadgeSummaryDto, ReportDto, WeeklyProgressDto } from '@home-rehab-motion/shared-contract';
import type { ReportFocus, ReportStage, WeeklyProgressStatus } from '@home-rehab-motion/shared-types';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MotivationService } from '../motivation/motivation.service';
import { getVisualEvidencePreviewScore } from '../common/visual-evidence-score';

function getCurrentWeekStart() {
  // 训练日账本使用上海日历日期并以 UTC 零点保存。
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
  const weekday = today.getUTCDay() || 7;
  today.setUTCDate(today.getUTCDate() - weekday + 1);
  return today;
}

function getPreviousWeekStart(currentWeekStart: Date) {
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setUTCDate(currentWeekStart.getUTCDate() - 7);
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

function resolveReportFocus(params: {
  requiresManualReview: boolean;
  grade: string;
  averageScore: number;
  validReps: number;
  totalReps: number;
  adviceCount: number;
}): { focus: ReportFocus; text: string } {
  if (params.requiresManualReview) {
    return { focus: 'review_pending', text: '本次训练记录已收到，复核完成前暂不展示分数和动作判断。' };
  }
  if (params.grade === '无效' || params.averageScore < 60 || params.validReps === 0 || params.totalReps === 0) {
    return { focus: 'learn_motion', text: '跟着动作步骤慢慢完成，优先保证动作完整和舒适。' };
  }
  if (params.grade === '需改进' || params.averageScore < 75) {
    return { focus: 'build_stability', text: '保持均匀节奏，动作到位后停一小会儿，再慢慢回到起始位置。' };
  }
  // 单次轻微提示不应覆盖整体优秀表现；具体改进项已在 adviceSummary 中单独呈现。
  if (params.adviceCount > 0 && params.averageScore < 90) {
    return { focus: 'build_stability', text: '保持均匀节奏，动作到位后停一小会儿，再慢慢回到起始位置。' };
  }
  return { focus: 'maintain_rhythm', text: '动作整体完成得不错。下次继续按舒适、均匀的速度练习，注意动作完整即可。' };
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly motivationService: MotivationService,
    private readonly storageService: StorageService,
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

    const shortClip = result.video.short_clip;
    const reliableShortClip = shortClip && result.video.analysis_status === 'completed'
      && result.video.quality_status === 'passed' && !result.video.manual_review?.use_manual_result
      && (result.confidence_score ?? 0) >= 0.75 && result.valid_reps > 0
      && Boolean(result.analysis_version && result.template_version && result.segmentation_version);
    const [currentWeekCompletedCount, previousWeekCompletedCount, latestBadges, previousCompletedResult] = await Promise.all([
      this.prisma.trainingAttendance.count({
        where: { user_id: BigInt(userId), counted_for_training_day: true, training_date: { gte: currentWeekStart } },
      }),
      this.prisma.trainingAttendance.count({
        where: { user_id: BigInt(userId), counted_for_training_day: true,
          training_date: { gte: previousWeekStart, lt: currentWeekStart } },
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
            user_id: BigInt(userId), source_type: 'miniapp', action_type: result.video.action_type,
            short_clip: shortClip,
            ...(shortClip ? { analysis_status: 'completed', quality_status: 'passed',
              OR: [{ manual_review: { is: null } }, { manual_review: { is: { use_manual_result: false } } }] } : {}),
          },
          ...(shortClip ? { analysis_version: result.analysis_version || '__unknown__',
            template_version: result.template_version || '__unknown__',
            segmentation_version: result.segmentation_version || '__unknown__', confidence_score: { gte: 0.75 },
            valid_reps: { gte: 1 } } : {}),
          NOT: {
            video_id: BigInt(videoId),
          },
          created_at: { lt: result.created_at },
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
    const uncertainAbdominalClip = requiresManualReview && shortClip
      && result.video.action_type === 'abdominal_crunch' && result.total_reps === 0;
    const overSegmentedAbdominalClip = requiresManualReview && shortClip
      && result.video.action_type === 'abdominal_crunch' && result.total_reps > 2;
    const snapshot = result.segmentation_snapshot;
    const snapshotData = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot as Record<string, unknown> : undefined;
    const isVisualPractice = (snapshotData?.score_type === 'visual_practice'
      || snapshotData?.score_type === 'visual_evidence') && !review?.use_manual_result;
    const scoreAvailable = !isVisualPractice || snapshotData?.score_available === true;
    const visualEvidencePreviewScore = isVisualPractice && scoreAvailable && !requiresManualReview
      ? getVisualEvidencePreviewScore(snapshotData, result.total_reps || 0) : undefined;
    const hasVisualEvidenceScore = snapshotData?.score_type === 'visual_evidence'
      || visualEvidencePreviewScore !== undefined;
    const visualCycles = Array.isArray(snapshotData?.visual_accepted_cycles)
      ? snapshotData.visual_accepted_cycles : [];
    const visualPhaseRows = isVisualPractice && scoreAvailable
      ? visualCycles.flatMap((raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
          const cycle = raw as Record<string, unknown>;
          const start = Number(cycle.start_time);
          const peakStart = Number(cycle.peak_start_time);
          const peakEnd = Number(cycle.peak_end_time);
          const end = Number(cycle.return_time);
          if (![start, peakStart, peakEnd, end].every(Number.isFinite)
              || !(start < peakStart && peakStart <= peakEnd && peakEnd < end)) return [];
          return [{ rise: peakStart - start, hold: peakEnd - peakStart, returning: end - peakEnd }];
        }) : [];
    const visualPhaseMetrics = visualPhaseRows.length
      ? {
          riseSeconds: Math.round(visualPhaseRows.reduce((sum, row) => sum + row.rise, 0) / visualPhaseRows.length * 10) / 10,
          holdSeconds: Math.round(visualPhaseRows.reduce((sum, row) => sum + row.hold, 0) / visualPhaseRows.length * 10) / 10,
          returnSeconds: Math.round(visualPhaseRows.reduce((sum, row) => sum + row.returning, 0) / visualPhaseRows.length * 10) / 10,
          smoothnessPercent: Math.round(result.stability_avg || 0),
        } : undefined;
    const scoringContract = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>).scoring_contract : undefined;
    const incompatibleTemplate = scoringContract && typeof scoringContract === 'object' && !Array.isArray(scoringContract)
      && (scoringContract as Record<string, unknown>).compatible === false;
    const observedReps = requiresManualReview && shortClip && result.video.action_type === 'abdominal_crunch'
      && result.video.quality_status === 'passed' && (result.confidence_score ?? 0) >= 0.75
      && result.total_reps >= 1 && result.total_reps <= 2 && incompatibleTemplate
      ? result.total_reps : undefined;
    const reviewMessage = requiresManualReview
      ? uncertainAbdominalClip
        ? '已记录本次训练。缩腹幅度因人而异，视频暂时无法可靠判断动作周期；这不代表您没有完成练习。结果待复核，您无需为获得分数而勉强增大幅度。'
        : overSegmentedAbdominalClip
          ? '本段缩腹视频的动作切分结果不够可靠，暂不能确认次数或评分。本次训练记录已保留；如需重新拍摄，请录下 1～2 个完整动作，并保留开始准备和结束回位的画面。'
        : observedReps
          ? `系统在本次视频中识别到 ${observedReps} 次动作；评分模板与当前特征口径不一致，分数和动作问题判断暂不展示，待复核。`
        : '本次训练记录已收到，系统正在复核拍摄和动作信息，请稍后查看结果。'
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

    const grade = requiresManualReview ? '待复核' : !scoreAvailable ? '未评分'
      : visualEvidencePreviewScore !== undefined ? '本段完成'
      : (usesManualResult ? (review?.manual_grade || result.grade || '无效') : (result.grade || '无效'));
    const averageScore = requiresManualReview || !scoreAvailable ? 0
      : visualEvidencePreviewScore ?? (usesManualResult ? Number(review?.manual_score || 0) : (result.average_score || 0));
    const validReps = result.valid_reps || 0;
    const totalReps = result.total_reps || 0;
    // 患者的阶段统一来自激励服务的长期旅程规则；单次评分只影响 reportFocus，不再导致阶段跳变。
    const stage = motivation.stage;
    const standardReportFocus = resolveReportFocus({
      requiresManualReview,
      grade,
      averageScore,
      validReps,
      totalReps,
      adviceCount: adviceSummary.length,
    });
    const reportFocus = isVisualPractice && !requiresManualReview
      ? scoreAvailable
        ? { focus: 'maintain_rhythm' as ReportFocus, text: '本段完整动作已记录。阶段时间仅供回顾视频，按舒适幅度继续练习即可。' }
        : { focus: 'learn_motion' as ReportFocus, text: '本次训练已记录；视频暂时不足以可靠观察腹部完整周期，不影响训练日和连续练习。' }
      : standardReportFocus;

    const previousAverageScore = isVisualPractice || (shortClip && !reliableShortClip)
      ? null : previousCompletedResult?.average_score ?? null;
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
      videoReview: result.video.video_key
        ? {
            playbackUrl: this.storageService.getPrivateObjectUrl(result.video.video_key),
            duration: result.video.duration ? Number(result.video.duration) : undefined,
            privacyHint: '仅本人可查看，请注意保护隐私。',
          }
        : undefined,
      grade,
      averageScore,
      totalReps,
      validReps,
      observedReps,
      avgHoldDuration: result.avg_hold_duration || 0,
      confidenceScore: result.confidence_score || 0,
      scoreType: isVisualPractice
        ? (hasVisualEvidenceScore ? 'visual_evidence' : 'visual_practice') : 'pose',
      scoreAvailable: !requiresManualReview && scoreAvailable,
      countSource: isVisualPractice ? 'visual' : 'pose',
      visualPhaseMetrics,
      requiresManualReview,
      reviewMessage,
      accuracyAvg: requiresManualReview || isVisualPractice ? undefined : (result.accuracy_avg || 0),
      stabilityAvg: requiresManualReview || isVisualPractice ? undefined : (result.stability_avg || 0),
      // 骨盆倾斜没有独立的“控制力”维度，持久化的 fallback 分数不能作为该指标对外展示。
      controlAvg: requiresManualReview || isVisualPractice || result.video.action_type === 'pelvic_tilt' ? undefined : (result.control_avg || 0),
      durationAvg: requiresManualReview || isVisualPractice ? undefined : (result.duration_avg || 0),
      stage,
      reportFocus: reportFocus.focus,
      reportFocusText: reportFocus.text,
      compareToLast: requiresManualReview ? undefined : compareToLast,
      trendSummary: requiresManualReview
        ? '复核完成前，请先以动作指导中的拍摄要求为准。'
        : shortClip ? (compareToLast ? '本段观察仅与同动作、同版本的可靠短片段比较。' : '本段观察已记录，暂无可靠的同版本趋势。')
          : reportFocus.focus === 'maintain_rhythm' ? '近几次训练节奏稳定，建议继续保持当前状态。' : '继续按当前节奏训练，系统会持续记录您的变化。',
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
