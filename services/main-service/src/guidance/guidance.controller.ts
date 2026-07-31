import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Readable } from 'stream';
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

  @Get('guidance/assets')
  async proxyPublicGuidanceAsset(@Query('key') key: string, @Req() req: Request, @Res() res: Response) {
    const targetUrl = this.guidanceService.getPublicAssetUrl(key);
    const upstream = await fetch(targetUrl, {
      headers: req.headers.range ? { range: req.headers.range } : undefined,
    });
    if (!upstream.ok && upstream.status !== 206) {
      res.sendStatus(upstream.status);
      return;
    }
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].forEach((header) => {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    });
    res.status(upstream.status);
    if (!upstream.body) { res.end(); return; }
    Readable.fromWeb(upstream.body as import('stream/web').ReadableStream).pipe(res);
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
