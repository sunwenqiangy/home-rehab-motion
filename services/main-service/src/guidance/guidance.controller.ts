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

  @Get('guidance/by-action/:actionType')
  getGuidanceDetailByAction(@Req() req: Request, @Param('actionType') actionType: string) {
    this.authService.requireUser(req, ['patient', 'admin', 'nurse']);
    return this.guidanceService.getGuidanceDetailByAction(actionType);
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

  @Get('admin/guidance/config-package')
  exportGuidanceConfigPackage(@Req() req: Request) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.exportGuidanceConfigPackage();
  }

  @Post('admin/guidance/config-package/import')
  importGuidanceConfigPackage(@Req() req: Request, @Body() payload: unknown) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.importGuidanceConfigPackage(payload);
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

  @Get('admin/guidance/:id')
  getAdminGuidance(@Req() req: Request, @Param('id') id: string) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.getAdminGuidance(Number(id));
  }

  @Post('admin/guidance/:id/enabled')
  setAdminGuidanceEnabled(@Req() req: Request, @Param('id') id: string, @Body() payload: { enabled?: boolean }) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.setAdminGuidanceEnabled(Number(id), payload.enabled === true);
  }

  @Post('admin/guidance/:id/copy')
  copyAdminGuidance(@Req() req: Request, @Param('id') id: string) {
    this.authService.requireUser(req, ['admin']);
    return this.guidanceService.copyAdminGuidance(Number(id));
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
