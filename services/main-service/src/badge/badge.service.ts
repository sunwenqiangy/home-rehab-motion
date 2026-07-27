import { Injectable } from '@nestjs/common';
import type { BadgeSummaryDto } from '@home-rehab-motion/shared-contract';
import { PrismaService } from '../prisma/prisma.service';

const BADGE_DEFINITIONS = [
  { badgeCode: 'first_try', title: '初次尝试', description: '迈出第一步，就是很好的开始。' },
  { badgeCode: 'streak_3', title: '连续 3 天', description: '连续 3 天练习，好习惯正在慢慢养成。' },
  { badgeCode: 'streak_7', title: '连续 7 天', description: '您已经坚持 1 周，稳定练习很了不起。' },
  { badgeCode: 'days_30', title: '坚持 30 天', description: '累计坚持 30 天，每一份认真都值得纪念。' },
  { badgeCode: 'days_60', title: '坚持 60 天', description: '累计坚持 60 天，稳定练习已经成为您的好习惯。' },
  { badgeCode: 'days_90', title: '坚持 90 天', description: '累计坚持 90 天，您用长期坚持留下了很棒的成果。' },
  { badgeCode: 'first_excellent', title: '首次优秀', description: '第一次获得优秀，您的努力正在看到成果。' },
] as const;

@Injectable()
export class BadgeService {
  constructor(private readonly prisma: PrismaService) {}

  listBadgeDefinitions() {
    return BADGE_DEFINITIONS;
  }

  async ensureBadgeDefinitionsSeeded() {
    for (const badge of BADGE_DEFINITIONS) {
      await this.prisma.badgeDefinition.upsert({
        where: { badge_code: badge.badgeCode },
        update: { title: badge.title, description: badge.description, status: 1 },
        create: { badge_code: badge.badgeCode, title: badge.title, description: badge.description, status: 1 },
      });
    }
  }

  async evaluateAndAwardBadges(params: {
    userId: number;
    videoId: number;
    totalTrainingDays: number;
    consecutiveTrainingDays: number;
    grade?: string;
  }) {
    await this.ensureBadgeDefinitionsSeeded();
    const candidates = new Set<string>();
    if (params.totalTrainingDays >= 1) candidates.add('first_try');
    if (params.consecutiveTrainingDays >= 3) candidates.add('streak_3');
    if (params.consecutiveTrainingDays >= 7) candidates.add('streak_7');
    if (params.totalTrainingDays >= 30) candidates.add('days_30');
    if (params.totalTrainingDays >= 60) candidates.add('days_60');
    if (params.totalTrainingDays >= 90) candidates.add('days_90');
    if (params.grade === '优秀') candidates.add('first_excellent');

    const definitions = await this.prisma.badgeDefinition.findMany({
      where: { badge_code: { in: [...candidates] } },
    });
    const awarded: Array<{ badgeCode: string; title: string }> = [];
    for (const definition of definitions) {
      try {
        await this.prisma.userBadge.create({
          data: {
            user_id: BigInt(params.userId),
            badge_id: definition.badge_id,
            source_video_id: BigInt(params.videoId),
          },
        });
        awarded.push({ badgeCode: definition.badge_code, title: definition.title });
      } catch (error: unknown) {
        // `user_badge` 的 (user_id, badge_id) 唯一约束保证重复回调不会重复发奖。
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) throw error;
      }
    }
    return awarded;
  }

  async listUserBadges(userId: number): Promise<BadgeSummaryDto[]> {
    await this.ensureBadgeDefinitionsSeeded();
    const badges = await this.prisma.userBadge.findMany({
      where: { user_id: BigInt(userId) },
      include: { badge: true },
      orderBy: { awarded_at: 'desc' },
      take: 20,
    });
    return badges.map((item) => ({
      badgeCode: item.badge.badge_code,
      title: item.badge.title,
      description: item.badge.description || undefined,
      awardedAt: item.awarded_at.toISOString(),
      sourceVideoId: item.source_video_id ? Number(item.source_video_id) : undefined,
      seenAt: item.seen_at?.toISOString(),
    }));
  }

  async markBadgeSeen(userId: number, badgeCode: string) {
    const userBadge = await this.prisma.userBadge.findFirst({
      where: { user_id: BigInt(userId), badge: { badge_code: badgeCode } },
    });
    if (!userBadge) return { updated: false };
    await this.prisma.userBadge.update({
      where: { user_badge_id: userBadge.user_badge_id },
      data: { seen_at: new Date() },
    });
    return { updated: true };
  }
}
