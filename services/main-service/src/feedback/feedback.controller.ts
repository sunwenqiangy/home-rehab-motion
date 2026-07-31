import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { CreateFeedbackRequestDto } from '@home-rehab-motion/shared-contract';
import type { UploadedBinaryFile } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { FeedbackService } from './feedback.service';

@Controller()
export class FeedbackController {
  constructor(
    private readonly feedbackService: FeedbackService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Get('feedback/presign-upload')
  async getFeedbackImageUploadTarget(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.feedbackService.getFeedbackImageUploadTarget(user.userId);
  }

  @Post('feedback/upload-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadFeedbackImage(
    @Req() req: Request,
    @Body() payload: { objectKey?: string },
    @UploadedFile() file?: UploadedBinaryFile,
  ) {
    const user = this.authService.requireUser(req, ['patient']);
    if (!payload.objectKey) {
      throw new BadRequestException('缺少对象路径');
    }
    return this.feedbackService.uploadFeedbackImage(user.userId, payload.objectKey, file);
  }

  @Post('feedback')
  createFeedback(@Req() req: Request, @Body() payload: CreateFeedbackRequestDto) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.feedbackService.createFeedback(user.userId, payload);
  }

  @Get('feedback')
  listPatientFeedback(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.feedbackService.listPatientFeedback(user.userId);
  }

  @Get('feedback/:feedbackId')
  getPatientFeedbackDetail(@Req() req: Request, @Param('feedbackId') feedbackId: string) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.feedbackService.getPatientFeedbackDetail(user.userId, Number(feedbackId));
  }

  @Post('feedback/:feedbackId/messages')
  appendPatientMessage(
    @Req() req: Request,
    @Param('feedbackId') feedbackId: string,
    @Body() payload: { content?: string; imageUrls?: string[] },
  ) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.feedbackService.appendPatientMessage(user.userId, Number(feedbackId), payload);
  }

  @Get('admin/feedback')
  getAdminFeedbackList(@Req() req: Request, @Query('keyword') keyword?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    this.authService.requireUser(req, ['admin', 'nurse']);
    return this.feedbackService.getAdminFeedbackList({ keyword, page: Number(page) || 1, limit: Number(limit) || 10 });
  }

  @Get('admin/feedback/safety-records')
  getSafetyRecords(@Req() req: Request, @Query('keyword') keyword?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    this.authService.requireUser(req, ['admin', 'nurse']);
    return this.feedbackService.getAdminFeedbackList({ safetyOnly: true, keyword, page: Number(page) || 1, limit: Number(limit) || 10 });
  }

  @Get('admin/feedback/reply-templates')
  getReplyTemplates(@Req() req: Request) {
    this.authService.requireUser(req, ['admin', 'nurse']);
    return this.feedbackService.getReplyTemplates();
  }

  @Get('admin/feedback/:feedbackId')
  async getAdminFeedbackDetail(@Req() req: Request, @Param('feedbackId') feedbackId: string) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    const detail = await this.feedbackService.getAdminFeedbackDetail(Number(feedbackId));
    await this.auditService.recordSensitiveRead(user, req, 'view_feedback_detail', 'feedback', feedbackId, detail.patientId);
    return detail;
  }

  @Post('admin/feedback/:feedbackId/start')
  startFeedback(@Req() req: Request, @Param('feedbackId') feedbackId: string) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    return this.feedbackService.startFeedback(Number(feedbackId), user.accountId || user.userId);
  }

  @Post('admin/feedback/:feedbackId/reply')
  replyFeedback(
    @Req() req: Request,
    @Param('feedbackId') feedbackId: string,
    @Body() payload: { content?: string; templateCode?: string },
  ) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    return this.feedbackService.replyFeedback(Number(feedbackId), user.accountId || user.userId, payload);
  }

  @Post('admin/feedback/:feedbackId/close')
  closeFeedback(@Req() req: Request, @Param('feedbackId') feedbackId: string) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    return this.feedbackService.closeFeedback(Number(feedbackId), user.accountId || user.userId, 'resolved');
  }

  @Post('admin/feedback/batch-close')
  batchCloseInactiveFeedback(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    return this.feedbackService.batchCloseInactiveFeedback(user.accountId || user.userId);
  }

}
