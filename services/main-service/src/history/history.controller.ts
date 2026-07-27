import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { HistoryService } from './history.service';

@Controller('history/videos')
export class HistoryController {
  constructor(
    private readonly historyService: HistoryService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  listHistoryVideos(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.historyService.listHistoryVideos(user.userId);
  }
}
