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
import type { ConfirmUploadRequestDto, SaveManualVideoReviewRequestDto } from '@home-rehab-motion/shared-contract';
import type { TrainingActionType, TrainingVideoSourceType } from '@home-rehab-motion/shared-types';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { UploadedBinaryFile } from '../storage/storage.service';
import { VideoService } from './video.service';

@Controller('videos')
export class VideoController {
  constructor(
    private readonly videoService: VideoService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Get('presign-upload')
  getPresignUpload(@Req() req: Request, @Query('actionType') actionType?: string) {
    const user = this.authService.requireUser(req, ['patient']);
    const supportedActionTypes = new Set<TrainingActionType>(['abdominal_crunch', 'pelvic_tilt', 'knee_rotation']);
    const resolvedActionType = actionType as TrainingActionType;
    if (!supportedActionTypes.has(resolvedActionType)) {
      throw new BadRequestException('请选择有效的训练动作类型');
    }
    return this.videoService.getPresignUpload(user.userId, resolvedActionType);
  }

  @Post('confirm-upload')
  confirmUpload(@Req() req: Request, @Body() payload: ConfirmUploadRequestDto) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.videoService.confirmUpload(user.userId, payload);
  }

  @Get('admin/internal-samples/:sourceType/presign-upload')
  getInternalSamplePresignUpload(
    @Req() req: Request,
    @Param('sourceType') sourceType: string,
    @Query('actionType') actionType?: string,
  ) {
    this.authService.requireUser(req, ['admin']);
    if (sourceType !== 'admin_flow_verify' && sourceType !== 'gold_template') {
      throw new BadRequestException('不支持的内部样本类型');
    }
    const supportedActionTypes = new Set<TrainingActionType>(['abdominal_crunch', 'pelvic_tilt', 'knee_rotation']);
    const resolvedActionType = actionType as TrainingActionType;
    if (!supportedActionTypes.has(resolvedActionType)) {
      throw new BadRequestException('请选择有效的训练动作类型');
    }
    return this.videoService.getInternalSamplePresignUpload(
      sourceType as Exclude<TrainingVideoSourceType, 'miniapp'>,
      resolvedActionType,
    );
  }

  @Post('admin/internal-samples/:videoId/confirm-upload')
  confirmInternalSample(@Req() req: Request, @Param('videoId') videoId: string, @Body() payload: ConfirmUploadRequestDto) {
    this.authService.requireUser(req, ['admin']);
    return this.videoService.confirmInternalSample(Number(videoId), payload);
  }

  @Get('admin/internal-samples/:videoId/status')
  getInternalSampleStatus(@Req() req: Request, @Param('videoId') videoId: string) {
    this.authService.requireUser(req, ['admin']);
    return this.videoService.getInternalSampleStatus(Number(videoId));
  }

  @Post('admin/internal-samples/:videoId/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  uploadInternalSample(
    @Req() req: Request,
    @Param('videoId') videoId: string,
    @UploadedFile() file?: UploadedBinaryFile,
  ) {
    this.authService.requireUser(req, ['admin']);
    if (!file) {
      throw new BadRequestException('请上传视频文件');
    }
    return this.videoService.uploadVideoFile(0, Number(videoId), file, true);
  }

  @Post(':videoId/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  uploadVideo(
    @Req() req: Request,
    @Param('videoId') videoId: string,
    @UploadedFile() file?: UploadedBinaryFile,
  ) {
    const user = this.authService.requireUser(req, ['patient']);
    if (!file) {
      throw new BadRequestException('请上传视频文件');
    }
    return this.videoService.uploadVideoFile(user.userId, Number(videoId), file);
  }

  @Get(':videoId/status')
  getVideoStatus(@Req() req: Request, @Param('videoId') videoId: string) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.videoService.getVideoStatus(Number(videoId), user.userId);
  }

  @Get('admin/dashboard-overview')
  getAdminDashboardOverview(@Req() req: Request, @Query('days') days?: string) {
    this.authService.requireUser(req, ['admin', 'nurse']);
    return this.videoService.getAdminDashboardOverview(Number(days) || 7);
  }

  @Get('admin/list')
  getAdminVideoList(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    this.authService.requireUser(req, ['admin', 'nurse']);
    return this.videoService.getAdminVideoList({ page: Number(page) || 1, limit: Number(limit) || 10, status, keyword });
  }

  @Get('admin/tasks')
  getAdminAnalysisTasks(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    this.authService.requireUser(req, ['admin', 'nurse']);
    return this.videoService.getAdminAnalysisTasks({ page: Number(page) || 1, limit: Number(limit) || 10, status, keyword });
  }

  @Post('admin/:videoId/reanalyze')
  reanalyzeVideo(@Req() req: Request, @Param('videoId') videoId: string) {
    this.authService.requireUser(req, ['admin']);
    return this.videoService.retryAnalysis(Number(videoId));
  }

  @Get('admin/:videoId')
  async getAdminVideoDetail(@Req() req: Request, @Param('videoId') videoId: string) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    const detail = await this.videoService.getAdminVideoDetail(Number(videoId));
    await this.auditService.recordSensitiveRead(user, req, 'view_video_detail', 'training_video', videoId, detail.patientId);
    return detail;
  }

  @Get('admin/:videoId/analysis-detail')
  async getAdminVideoAnalysisDetail(@Req() req: Request, @Param('videoId') videoId: string) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    const patientId = await this.videoService.getVideoOwnerId(Number(videoId));
    const detail = await this.videoService.getAdminVideoAnalysisDetail(Number(videoId));
    await this.auditService.recordSensitiveRead(user, req, 'view_analysis_detail', 'training_video', videoId, patientId);
    return detail;
  }

  @Get('admin/:videoId/keypoints')
  async getAdminVideoKeypoints(@Req() req: Request, @Param('videoId') videoId: string) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    const patientId = await this.videoService.getVideoOwnerId(Number(videoId));
    const keypoints = await this.videoService.getVideoKeypoints(Number(videoId));
    await this.auditService.recordSensitiveRead(user, req, 'view_keypoints', 'training_video', videoId, patientId);
    return keypoints;
  }

  @Get('admin/:videoId/manual-review')
  async getManualVideoReview(@Req() req: Request, @Param('videoId') videoId: string) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    const patientId = await this.videoService.getVideoOwnerId(Number(videoId));
    const review = await this.videoService.getManualVideoReview(Number(videoId));
    await this.auditService.recordSensitiveRead(user, req, 'view_manual_review', 'training_video', videoId, patientId);
    return review;
  }

  @Post('admin/:videoId/manual-review')
  saveManualVideoReview(
    @Req() req: Request,
    @Param('videoId') videoId: string,
    @Body() payload: SaveManualVideoReviewRequestDto,
  ) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    return this.videoService.saveManualVideoReview(Number(videoId), user.accountId, payload);
  }

  @Post('internal/analysis-callback')
  handleAnalysisCallback(@Req() req: Request, @Body() payload: Record<string, unknown>) {
    this.authService.requireInternalToken(req);
    return this.videoService.handleAnalysisCallback({
      video_id: Number(payload.video_id),
      analysis_run_id: typeof payload.analysis_run_id === 'string' ? payload.analysis_run_id : '',
      provider_task_id: typeof payload.provider_task_id === 'string' ? payload.provider_task_id : '',
      analysis_status: String(payload.analysis_status || ''),
      quality_status:
        typeof payload.quality_status === 'string' ? payload.quality_status : undefined,
      quality_score:
        typeof payload.quality_score === 'number' ? payload.quality_score : undefined,
      quality_issues: payload.quality_issues,
      fail_reason: typeof payload.fail_reason === 'string' ? payload.fail_reason : undefined,
      video_evaluation:
        payload.video_evaluation && typeof payload.video_evaluation === 'object'
          ? (payload.video_evaluation as Record<string, unknown> & {
              total_reps?: number;
              valid_reps?: number;
              average_score?: number;
              grade?: string;
              accuracy_avg?: number;
              stability_avg?: number;
              control_avg?: number;
              duration_avg?: number;
              avg_hold_duration?: number;
              main_issues?: unknown;
              advice_summary?: unknown;
              confidence_score?: number;
              analysis_version?: string;
            })
          : undefined,
    });
  }
}
