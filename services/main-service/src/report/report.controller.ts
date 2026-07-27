import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { ReportService } from './report.service';

@Controller('reports')
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly authService: AuthService,
  ) {}

  @Get(':videoId')
  getReport(@Req() req: Request, @Param('videoId') videoId: string) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.reportService.getReport(Number(videoId), user.userId);
  }
}
