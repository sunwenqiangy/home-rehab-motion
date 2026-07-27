import { Injectable } from '@nestjs/common';
import type {
  BadgeProgressDto,
  BadgeSummaryDto,
  MotivationSummaryDto,
} from '@home-rehab-motion/shared-contract';
import type { ReportStage } from '@home-rehab-motion/shared-types';
import { BadgeService } from '../badge/badge.service';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
type Evaluation = {
  video_id: bigint;
  average_score: number | null;
  stability_avg: number | null;
  avg_hold_duration: number | null;
  valid_reps: number;
  grade: string | null;
  video: { action_type: string };
};

type Improvement = {
  level: 'none' | 'slight' | 'clear';
  type?: 'score' | 'stability' | 'duration' | 'reps';
  message: string;
  scoreDelta?: number;
  stabilityDelta?: number;
  durationDelta?: number;
  validRepsDelta?: number;
};

function shanghaiDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function utcDateForShanghaiKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function shiftDateKey(key: string, offsetDays: number) {
  const date = utcDateForShanghaiKey(key);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function getShanghaiWeekday(key: string) {
  const weekday = utcDateForShanghaiKey(key).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function getShanghaiWeekDateKeys(now = new Date()) {
  const today = shanghaiDateKey(now);
  const todayWeekday = getShanghaiWeekday(today);
  const monday = shiftDateKey(today, 1 - todayWeekday);
  return Array.from({ length: 7 }, (_, index) => shiftDateKey(monday, index));
}

function shanghaiDayBounds(now = new Date()) {
  const startKey = shanghaiDateKey(now);
  const endKey = shiftDateKey(startKey, 1);
  return {
    start: new Date(`${startKey}T00:00:00+08:00`),
    end: new Date(`${endKey}T00:00:00+08:00`),
  };
}

function resolveStage(totalTrainingCount: number, rehabilitationWeek: number): ReportStage {
  // 阶段是患者端的鼓励重点，不是能力评级：按真实周数推进，并以最低训练次数避免过早跳阶段。
  if (rehabilitationWeek <= 2 || totalTrainingCount < 4) return 'corrective';
  if (rehabilitationWeek <= 4 || totalTrainingCount < 8) return 'consolidation';
  return 'incentive';
}

function resolveTodayState(video: { analysis_status: string; video_evaluation_result?: unknown } | null): MotivationSummaryDto['todayTrainingState'] {
  if (!video) return 'not_started';
  if (video.analysis_status === 'completed' && video.video_evaluation_result) return 'reported';
  if (['pending', 'uploading', 'queued', 'processing'].includes(video.analysis_status)) return 'analyzing';
  return 'confirmed';
}

function numberOrNull(value: number | null | undefined) {
  return value == null ? null : Number(value);
}

@Injectable()
export class MotivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly badgeService: BadgeService,
    private readonly configService: ConfigService,
  ) {}

  async recordConfirmedTraining(userId: number, videoId: number, confirmedAt = new Date()) {
    const trainingDate = shanghaiDateKey(confirmedAt);
    const existing = await this.prisma.trainingAttendance.findUnique({
      where: { video_id: BigInt(videoId) },
    });
    if (existing) return existing;

    try {
      return await this.prisma.trainingAttendance.create({
        data: {
          user_id: BigInt(userId),
          video_id: BigInt(videoId),
          training_date: utcDateForShanghaiKey(trainingDate),
          counted_for_training_day: true,
          counted_at: confirmedAt,
        },
      });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        return this.prisma.trainingAttendance.findUniqueOrThrow({ where: { video_id: BigInt(videoId) } });
      }
      throw error;
    }
  }

  async buildSummary(userId: number): Promise<MotivationSummaryDto> {
    const appConfig = await this.configService.getPatientAppConfig();
    const attendanceRows = await this.prisma.trainingAttendance.findMany({
      where: { user_id: BigInt(userId), counted_for_training_day: true },
      select: { training_date: true },
      orderBy: { training_date: 'asc' },
    });
    const dateKeys = [...new Set(attendanceRows.map((row) => row.training_date.toISOString().slice(0, 10)))];
    const todayKey = shanghaiDateKey(new Date());
    const weekDateKeys = getShanghaiWeekDateKeys();
    const recentWeekKeys = new Set(weekDateKeys);
    const totalTrainingDays = dateKeys.length;
    const weeklyTrainingDays = dateKeys.filter((key) => recentWeekKeys.has(key)).length;
    const firstTrainingDate = dateKeys[0];
    const rehabilitationWeek = firstTrainingDate
      ? Math.max(1, Math.floor((utcDateForShanghaiKey(todayKey).getTime() - utcDateForShanghaiKey(firstTrainingDate).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1)
      : 1;

    let consecutiveTrainingDays = 0;
    let cursor = todayKey;
    const dateSet = new Set(dateKeys);
    while (dateSet.has(cursor)) {
      consecutiveTrainingDays += 1;
      cursor = shiftDateKey(cursor, -1);
    }

    const todayBounds = shanghaiDayBounds();
    const [totalTrainingCount, totalQualifiedCount, latestEvaluation, todayConfirmedVideo, badges] = await Promise.all([
      this.prisma.trainingAttendance.count({ where: { user_id: BigInt(userId) } }),
      this.prisma.videoEvaluationResult.count({
        where: {
          video: { user_id: BigInt(userId), source_type: 'miniapp' },
          grade: { in: ['优秀', '合格'] },
        },
      }),
      this.prisma.videoEvaluationResult.findFirst({
        where: { video: { user_id: BigInt(userId), source_type: 'miniapp' } },
        include: { video: true },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.trainingVideo.findFirst({
        where: {
          user_id: BigInt(userId),
          source_type: 'miniapp',
          confirmed_at: { gte: todayBounds.start, lt: todayBounds.end },
        },
        include: { video_evaluation_result: true },
        orderBy: { confirmed_at: 'desc' },
      }),
      this.badgeService.listUserBadges(userId),
    ]);

    const stage = resolveStage(totalTrainingCount, rehabilitationWeek);
    const latestBadge = badges[0];
    const nearestBadge = this.buildNearestBadge(badges, totalTrainingDays, consecutiveTrainingDays);
    const latestGrade = latestEvaluation?.grade || undefined;
    const improvement = latestEvaluation
      ? await this.compareWithPrevious(userId, latestEvaluation)
      : { level: 'none' as const, message: '完成训练后，系统会持续记录您的变化。' };

    return {
      totalTrainingCount,
      totalTrainingDays,
      consecutiveTrainingDays,
      weeklyTrainingDays,
      weeklyTargetDays: appConfig.weeklyTarget,
      weeklyCalendar: weekDateKeys.map((date, index) => ({
        date,
        weekday: index + 1,
        trained: dateSet.has(date),
        isToday: date === todayKey,
      })),
      totalQualifiedCount,
      latestGrade,
      scoreDelta: improvement.scoreDelta,
      stabilityDelta: improvement.stabilityDelta,
      durationDelta: improvement.durationDelta,
      validRepsDelta: improvement.validRepsDelta,
      improvementLevel: improvement.level,
      improvementType: improvement.type,
      improvementMessage: improvement.message,
      stage,
      badges,
      latestBadge,
      nearestBadge,
      encourageText: this.buildEncourageText(totalTrainingDays, consecutiveTrainingDays, stage),
      todayTrainingState: resolveTodayState(todayConfirmedVideo),
    };
  }

  async handleCompletedAnalysis(videoId: number) {
    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(videoId) },
      include: { video_evaluation_result: true },
    });
    if (!video || !video.video_evaluation_result || video.source_type !== 'miniapp') return [];

    const existing = await this.prisma.trainingMotivationSnapshot.findUnique({
      where: { video_id: BigInt(videoId) },
    });
    if (existing) return [];

    const userId = Number(video.user_id);
    const summaryBeforeBadge = await this.buildSummary(userId);
    const newlyUnlocked = await this.badgeService.evaluateAndAwardBadges({
      userId,
      videoId,
      totalTrainingDays: summaryBeforeBadge.totalTrainingDays,
      consecutiveTrainingDays: summaryBeforeBadge.consecutiveTrainingDays,
      grade: video.video_evaluation_result.grade || undefined,
    });
    const summary = await this.buildSummary(userId);

    try {
      await this.prisma.trainingMotivationSnapshot.create({
        data: {
          user_id: BigInt(userId),
          video_id: BigInt(videoId),
          training_count_after: summary.totalTrainingCount,
          training_days_after: summary.totalTrainingDays,
          consecutive_training_days_after: summary.consecutiveTrainingDays,
          weekly_training_days_after: summary.weeklyTrainingDays,
          qualified_count_after: summary.totalQualifiedCount,
          improvement_level: summary.improvementLevel,
          improvement_type: summary.improvementType,
          improvement_message: summary.improvementMessage,
          newly_unlocked_badge_codes: newlyUnlocked.map((item) => item.badgeCode),
          stage: summary.stage,
        },
      });
      return newlyUnlocked;
    } catch (error: unknown) {
      // 快照的 video_id 唯一约束使并发/重复回调保持幂等。
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return [];
      throw error;
    }
  }

  async getSnapshotBadges(videoId: number): Promise<BadgeSummaryDto[]> {
    const snapshot = await this.prisma.trainingMotivationSnapshot.findUnique({
      where: { video_id: BigInt(videoId) },
    });
    const codes = Array.isArray(snapshot?.newly_unlocked_badge_codes)
      ? snapshot.newly_unlocked_badge_codes.filter((item): item is string => typeof item === 'string')
      : [];
    if (!codes.length) return [];
    const badges = await this.prisma.userBadge.findMany({
      where: { source_video_id: BigInt(videoId), badge: { badge_code: { in: codes } } },
      include: { badge: true },
      orderBy: { awarded_at: 'asc' },
    });
    return badges.map((item) => ({
      badgeCode: item.badge.badge_code,
      title: item.badge.title,
      description: item.badge.description || undefined,
      awardedAt: item.awarded_at.toISOString(),
      sourceVideoId: Number(item.source_video_id || 0) || undefined,
      seenAt: item.seen_at?.toISOString(),
    }));
  }

  private async compareWithPrevious(userId: number, latest: Evaluation): Promise<Improvement> {
    const previous = await this.prisma.videoEvaluationResult.findFirst({
      where: {
        video: { user_id: BigInt(userId), source_type: 'miniapp', action_type: latest.video.action_type },
        NOT: { video_id: latest.video_id },
      },
      include: { video: true },
      orderBy: { created_at: 'desc' },
    });
    if (!previous) return { level: 'none', message: '这是一次新的练习记录，继续保持当前节奏。' };

    const rules = await this.configService.getMotivationRules();
    const candidates: Array<{
      type: NonNullable<Improvement['type']>;
      delta: number;
      slight: number;
      clear: number;
      message: (level: Improvement['level']) => string;
    }> = [
      {
        type: 'duration',
        delta: (numberOrNull(latest.avg_hold_duration) ?? 0) - (numberOrNull(previous.avg_hold_duration) ?? 0),
        slight: rules.durationSlightDelta,
        clear: rules.durationClearDelta,
        message: (level) => level === 'clear' ? '这次保持时间明显更长了，已经更接近目标。' : '这次保持时间更长了一些，继续慢慢坚持。',
      },
      {
        type: 'stability',
        delta: (numberOrNull(latest.stability_avg) ?? 0) - (numberOrNull(previous.stability_avg) ?? 0),
        slight: rules.stabilitySlightDelta,
        clear: rules.stabilityClearDelta,
        message: (level) => level === 'clear' ? '这次身体明显更稳了，您的练习正在看到成果。' : '这次身体更稳了一些，继续把动作放慢就会更好。',
      },
      {
        type: 'reps',
        delta: latest.valid_reps - previous.valid_reps,
        slight: rules.repsSlightDelta,
        clear: rules.repsClearDelta,
        message: (level) => level === 'clear' ? '这次完成的有效动作更多了，节奏越来越稳定。' : '这次有效动作多了一些，继续保持。',
      },
      {
        type: 'score',
        delta: (numberOrNull(latest.average_score) ?? 0) - (numberOrNull(previous.average_score) ?? 0),
        slight: rules.scoreSlightDelta,
        clear: rules.scoreClearDelta,
        message: (level) => level === 'clear' ? '这次综合表现进步明显，继续保持现在的节奏。' : '这次比上次更稳一些，继续保持现在的节奏。',
      },
    ];

    const candidate = candidates.find((item) => item.delta >= item.slight);
    const level = candidate ? (candidate.delta >= candidate.clear ? 'clear' : 'slight') : 'none';
    const result: Improvement = {
      level,
      type: candidate?.type,
      message: candidate ? candidate.message(level) : '这次表现保持得很稳定，坚持练习会越来越熟练。',
      scoreDelta: Math.round((numberOrNull(latest.average_score) ?? 0) - (numberOrNull(previous.average_score) ?? 0)),
      stabilityDelta: Math.round((numberOrNull(latest.stability_avg) ?? 0) - (numberOrNull(previous.stability_avg) ?? 0)),
      durationDelta: Math.round(((numberOrNull(latest.avg_hold_duration) ?? 0) - (numberOrNull(previous.avg_hold_duration) ?? 0)) * 10) / 10,
      validRepsDelta: latest.valid_reps - previous.valid_reps,
    };
    return result;
  }

  private buildNearestBadge(badges: BadgeSummaryDto[], totalDays: number, consecutiveDays: number): BadgeProgressDto | undefined {
    const owned = new Set(badges.map((badge) => badge.badgeCode));
    const goals = [
      { code: 'streak_3', current: consecutiveDays, target: 3, title: '连续 3 天' },
      { code: 'streak_7', current: consecutiveDays, target: 7, title: '连续 7 天' },
      { code: 'days_30', current: totalDays, target: 30, title: '坚持 30 天' },
      { code: 'days_60', current: totalDays, target: 60, title: '坚持 60 天' },
      { code: 'days_90', current: totalDays, target: 90, title: '坚持 90 天' },
    ].filter((goal) => !owned.has(goal.code) && goal.current < goal.target);
    const goal = goals.sort((left, right) => (left.target - left.current) - (right.target - right.current))[0];
    if (!goal) return undefined;
    return {
      code: goal.code,
      current: goal.current,
      target: goal.target,
      unit: '天',
      message: `再完成 ${goal.target - goal.current} 天训练，就能点亮“${goal.title}”徽章。`,
    };
  }

  private buildEncourageText(totalDays: number, consecutiveDays: number, stage: ReportStage) {
    if (consecutiveDays >= 3) return `已连续训练 ${consecutiveDays} 天，好习惯正在慢慢养成。`;
    if (totalDays === 0) return '从一次简单练习开始，系统会陪您记录每一点变化。';
    if (stage === 'incentive') return '稳定练习很了不起，继续保持自己的节奏。';
    return '每次认真练习都在积累，继续保持当前节奏。';
  }
}
