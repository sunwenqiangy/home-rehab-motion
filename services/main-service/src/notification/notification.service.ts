import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  MarkAllNotificationsReadResponseDto,
  NotificationDto,
  NotificationUnreadCountDto,
} from '@home-rehab-motion/shared-contract';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async listNotifications(userId: number): Promise<NotificationDto[]> {
    const notifications = await this.prisma.notification.findMany({
      where: { user_id: BigInt(userId) },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    return notifications.map((item) => ({
      notificationId: Number(item.notification_id),
      type: item.notification_type as NotificationDto['type'],
      title: item.title,
      content: item.content,
      readFlag: item.read_flag,
      relatedId: item.related_id || undefined,
      createdAt: item.created_at.toISOString(),
    }));
  }

  async getUnreadCount(userId: number): Promise<NotificationUnreadCountDto> {
    const unreadCount = await this.prisma.notification.count({
      where: {
        user_id: BigInt(userId),
        read_flag: false,
      },
    });

    return { unreadCount };
  }

  async markAsRead(userId: number, notificationId: number) {
    const notification = await this.prisma.notification.findUnique({
      where: { notification_id: BigInt(notificationId) },
    });

    if (!notification) {
      throw new NotFoundException(`通知不存在: ${notificationId}`);
    }
    if (Number(notification.user_id) !== userId) {
      throw new ForbiddenException('无权修改他人的通知');
    }

    const updated = await this.prisma.notification.update({
      where: { notification_id: BigInt(notificationId) },
      data: { read_flag: true },
    });

    return {
      notificationId: Number(updated.notification_id),
      readFlag: updated.read_flag,
    };
  }

  async markAllAsRead(userId: number): Promise<MarkAllNotificationsReadResponseDto> {
    const result = await this.prisma.notification.updateMany({
      where: {
        user_id: BigInt(userId),
        read_flag: false,
      },
      data: {
        read_flag: true,
      },
    });

    return {
      updatedCount: result.count,
    };
  }
}
