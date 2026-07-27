import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  BadgeProgressDto,
  BadgeSummaryDto,
  BadgeWallDto,
  PatientAppConfigDto,
  TrainingSummaryDto,
  UpdatePatientProfileRequestDto,
  UserProfileDto,
  WeeklyProgressDto,
} from '@home-rehab-motion/shared-contract';
import type { DisplayMode, WeeklyProgressStatus } from '@home-rehab-motion/shared-types';
import { BadgeService } from '../badge/badge.service';
import { ConfigService } from '../config/config.service';
import { MotivationService } from '../motivation/motivation.service';
import { PrismaService } from '../prisma/prisma.service';

function buildWeeklyProgress(
  completedDays: number,
  weeklyTarget: number,
  badges: BadgeSummaryDto[],
): WeeklyProgressDto {
  const currentCount = Math.min(completedDays, weeklyTarget);
  const progressPercent = weeklyTarget > 0 ? Math.round((currentCount / weeklyTarget) * 100) : 0;
  const status: WeeklyProgressStatus = currentCount >= weeklyTarget
    ? 'week_completed'
    : currentCount >= 3
      ? 'target_reached'
      : 'started';
  const desc = currentCount >= weeklyTarget
    ? `本周 ${weeklyTarget} 天训练已完成，继续保持自己的节奏。`
    : `本周已完成 ${currentCount} / ${weeklyTarget} 天训练，继续坚持会更容易看到变化。`;
  return {
    weeklyTarget,
    currentCount,
    completedDays: currentCount,
    progressPercent,
    status,
    label: `${currentCount} / ${weeklyTarget}`,
    desc,
    badges,
  };
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly badgeService: BadgeService,
    private readonly configService: ConfigService,
    private readonly motivationService: MotivationService,
  ) {}

  async getProfile(userId: number) {
    const user = await this.prisma.userProfile.findUnique({ where: { user_id: BigInt(userId) } });
    if (!user) throw new NotFoundException(`用户不存在: ${userId}`);
    const gender: 'male' | 'female' | 'unknown' = user.gender === 1
      ? 'male'
      : user.gender === 2
        ? 'female'
        : 'unknown';
    return {
      userId: Number(user.user_id),
      nickname: user.name || '训练用户',
      phoneBound: Boolean(user.phone_authorized_at && user.phone),
      displayMode: (user.display_mode as DisplayMode) || 'elderly',
      age: user.age ?? undefined,
      gender,
    };
  }

  async updateProfile(userId: number, payload: UpdatePatientProfileRequestDto): Promise<UserProfileDto> {
    const nickname = String(payload.nickname || '').trim();
    if (!nickname || nickname.length > 50) {
      throw new BadRequestException('昵称长度应为 1 到 50 个字符');
    }
    const user = await this.prisma.userProfile.update({
      where: { user_id: BigInt(userId) },
      data: { name: nickname },
    });
    return {
      userId: Number(user.user_id),
      nickname: user.name || '训练用户',
      phoneBound: Boolean(user.phone_authorized_at && user.phone),
      displayMode: (user.display_mode as DisplayMode) || 'elderly',
      age: user.age ?? undefined,
      gender: user.gender === 1 ? 'male' : user.gender === 2 ? 'female' : 'unknown',
    };
  }

  async getDisplaySettings(userId: number) {
    const user = await this.prisma.userProfile.findUnique({ where: { user_id: BigInt(userId) } });
    if (!user) throw new NotFoundException(`用户不存在: ${userId}`);
    return { displayMode: (user.display_mode as DisplayMode) || 'elderly' };
  }

  async getTrainingSummary(userId: number): Promise<TrainingSummaryDto> {
    const [motivation, appConfig, pendingCount, maxScoreResult, firstAttendance] = await Promise.all([
      this.motivationService.buildSummary(userId),
      this.getAppConfig(),
      this.prisma.trainingVideo.count({
        where: {
          user_id: BigInt(userId),
          source_type: 'miniapp',
          analysis_status: { in: ['pending', 'uploading', 'queued', 'processing'] },
        },
      }),
      this.prisma.videoEvaluationResult.aggregate({
        _max: { average_score: true },
        where: { video: { user_id: BigInt(userId), source_type: 'miniapp' } },
      }),
      this.prisma.trainingAttendance.findFirst({
        where: { user_id: BigInt(userId) },
        orderBy: { training_date: 'asc' },
      }),
    ]);
    const rehabilitationWeek = firstAttendance
      ? Math.max(1, Math.floor((Date.now() - firstAttendance.training_date.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1)
      : undefined;
    return {
      ...motivation,
      weeklyProgress: buildWeeklyProgress(motivation.weeklyTrainingDays, appConfig.weeklyTarget, motivation.badges),
      completedCount: motivation.weeklyTrainingDays,
      pendingCount,
      latestScoreDeltaText: motivation.scoreDelta == null
        ? undefined
        : motivation.scoreDelta > 0 ? `较上次 +${motivation.scoreDelta} 分` : motivation.scoreDelta < 0 ? `较上次 ${motivation.scoreDelta} 分` : '与上次持平',
      latestBestScore: motivation.latestGrade ? undefined : undefined,
      maxScore: maxScoreResult._max.average_score == null ? undefined : Math.round(maxScoreResult._max.average_score),
      consecutiveCompletedWeeks: 0,
      rehabilitationWeek,
    };
  }

  async getUserBadges(userId: number): Promise<BadgeSummaryDto[]> {
    return this.badgeService.listUserBadges(userId);
  }

  async getBadgeWall(userId: number): Promise<BadgeWallDto> {
    const [definitions, owned, motivation] = await Promise.all([
      this.badgeService.listBadgeDefinitions(),
      this.badgeService.listUserBadges(userId),
      this.motivationService.buildSummary(userId),
    ]);
    const ownedByCode = new Map(owned.map((badge) => [badge.badgeCode, badge]));
    const items = definitions.map((definition) => {
      const badge = ownedByCode.get(definition.badgeCode);
      return {
        badgeCode: definition.badgeCode,
        title: definition.title,
        description: definition.description,
        unlocked: Boolean(badge),
        awardedAt: badge?.awardedAt,
        sourceVideoId: badge?.sourceVideoId,
        seenAt: badge?.seenAt,
        progress: !badge && motivation.nearestBadge?.code === definition.badgeCode
          ? motivation.nearestBadge
          : undefined,
      };
    });
    return {
      unlockedCount: owned.length,
      totalCount: items.length,
      items,
      nearestBadge: motivation.nearestBadge as BadgeProgressDto | undefined,
    };
  }

  async markBadgeSeen(userId: number, badgeCode: string) {
    return this.badgeService.markBadgeSeen(userId, badgeCode);
  }

  async updateDisplaySettings(userId: number, displayMode: 'elderly' | 'standard') {
    const user = await this.prisma.userProfile.update({
      where: { user_id: BigInt(userId) },
      data: { display_mode: displayMode },
    });
    return { displayMode: (user.display_mode as DisplayMode) || displayMode };
  }

  async getAppConfig(): Promise<PatientAppConfigDto> {
    return this.configService.getPatientAppConfig();
  }
}
