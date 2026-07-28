import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { UploadedBinaryFile } from '../storage/storage.service';
import { AuthService } from '../auth/auth.service';
import { GuidanceService } from './guidance.service';

@Controller()
export class GuidanceController {
  constructor(
    private readonly guidanceService: GuidanceService,
    private readonly authService: AuthService,
  ) {}

  @Get('guidance')
  listPatientGuidance(@Req() req: Request) {
    this.authService.requireUser(req, ['patient', 'admin', 'nurse']);
    return this.guidanceService.listPatientGuidance();
  }

  @Get('guidance/:contentId')
  getGuidanceDetail(@Req() req: Request, @Param('contentId') contentId: string) {
    this.authService.requireUser(req, ['patient', 'admin', 'nurse']);
    return this.guidanceService.getGuidanceDetail(Number(contentId));
  }

  @Get('admin/guidance')
  listAdminGuidance(@Req() req: Request) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.listAdminGuidance();
  }

  @Post('admin/guidance')
  createAdminGuidance(@Req() req: Request, @Body() payload: Record<string, unknown>) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.createAdminGuidance(payload);
  }

  @Get('admin/guidance/:id/draft')
  getAdminDraft(@Req() req: Request, @Param('id') id: string) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.getAdminDraft(Number(id));
  }

  @Put('admin/guidance/:id/draft')
  saveAdminDraft(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() payload: Record<string, unknown>,
  ) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.saveAdminDraft(Number(id), payload);
  }

  @Post('admin/guidance/:id/validate')
  validateAdminGuidance(@Req() req: Request, @Param('id') id: string) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.validateAdminGuidance(Number(id));
  }

  @Post('admin/guidance/:id/publish')
  publishAdminGuidance(@Req() req: Request, @Param('id') id: string) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.publishAdminGuidance(Number(id));
  }

  @Post('admin/guidance/:id/rollback')
  rollbackAdminGuidance(@Req() req: Request, @Param('id') id: string, @Body() payload: { version?: number }) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.rollbackAdminGuidance(Number(id), Number(payload.version));
  }

  @Put('admin/guidance/:id')
  updateAdminGuidance(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() payload: Record<string, unknown>,
  ) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.updateAdminGuidance(Number(id), payload);
  }

  @Delete('admin/guidance/:id')
  deleteAdminGuidance(@Req() req: Request, @Param('id') id: string) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.deleteAdminGuidance(Number(id));
  }

  @Get('admin/guidance/:id/versions')
  getGuidanceVersions(@Req() req: Request, @Param('id') id: string) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.getGuidanceVersions(Number(id));
  }

  @Get('admin/guidance/presign-upload')
  getAdminPresignUpload(
    @Req() req: Request,
    @Query('fileName') fileName?: string,
    @Query('mediaKind') mediaKind?: string,
    @Query('contentType') contentType?: string,
  ) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.getAdminPresignUpload(fileName, mediaKind === 'video' ? 'video' : 'image', contentType);
  }

  @Post('assets/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadAsset(
    @Req() req: Request,
    @Body() payload: { objectKey?: string },
    @UploadedFile() file?: UploadedBinaryFile,
  ) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.uploadAsset(payload.objectKey || '', file);
  }
}
