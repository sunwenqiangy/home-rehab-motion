import { Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  listNotifications(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.notificationService.listNotifications(user.userId);
  }

  @Get('unread-count')
  getUnreadCount(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.notificationService.getUnreadCount(user.userId);
  }

  @Patch(':notificationId/read')
  markAsRead(@Req() req: Request, @Param('notificationId') notificationId: string) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.notificationService.markAsRead(user.userId, Number(notificationId));
  }

  @Post(':notificationId/read')
  markAsReadCompat(@Req() req: Request, @Param('notificationId') notificationId: string) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.notificationService.markAsRead(user.userId, Number(notificationId));
  }

  @Post('read-all')
  markAllAsRead(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.notificationService.markAllAsRead(user.userId);
  }
}
