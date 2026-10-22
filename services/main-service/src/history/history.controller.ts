import { Controller, Get, Query, Req } from '@nestjs/common';
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
  listHistoryVideos(@Req() req: Request, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const user = this.authService.requireUser(req, ['patient']);
    const parsedPage = Number(page);
    const parsedPageSize = Number(pageSize);
    return this.historyService.listHistoryVideos(
      user.userId,
      Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
      Number.isSafeInteger(parsedPageSize) && parsedPageSize > 0 ? Math.min(parsedPageSize, 50) : 20,
    );
  }
}
