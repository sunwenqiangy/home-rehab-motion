import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type {
  GoldTemplateGenerateRequestDto,
  GoldTemplateSaveRequestDto,
  GoldTemplateVersionStatusUpdateRequestDto,
  MotivationRulesDto,
  PatientAppConfigDto,
  UpdatePatientAppConfigRequestDto,
} from '@home-rehab-motion/shared-contract';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from './config.service';

@Controller('admin/thresholds')
export class ConfigController {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  listThresholds(@Req() req: Request) {
    this.authService.requireUser(req, ['admin']);
    return this.configService.listThresholds();
  }

  @Get('gold-templates/source-videos')
  listGoldTemplateSourceVideos(
    @Req() req: Request,
    @Query('actionType') actionType?: string,
  ) {
    this.authService.requireUser(req, ['admin']);
    return this.configService.listGoldTemplateSourceVideos(actionType);
  }

  @Get('gold-templates')
  listGoldTemplates(
    @Req() req: Request,
    @Query('actionType') actionType?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.authService.requireUser(req, ['admin']);
    const parsedStatus = status == null ? undefined : Number(status);
    const parsedPage = page == null ? undefined : Number(page);
    const parsedPageSize = pageSize == null ? undefined : Number(pageSize);
    return this.configService.listGoldTemplateVersions({
      actionType,
      status: Number.isFinite(parsedStatus as number) ? parsedStatus : undefined,
      page: Number.isFinite(parsedPage as number) ? parsedPage : undefined,
      pageSize: Number.isFinite(parsedPageSize as number) ? parsedPageSize : undefined,
    });
  }

  @Post('gold-templates/generate')
  generateGoldTemplate(@Req() req: Request, @Body() payload: GoldTemplateGenerateRequestDto) {
    this.authService.requireUser(req, ['admin']);
    return this.configService.generateGoldTemplate(payload);
  }

  @Post('gold-templates')
  saveGoldTemplate(@Req() req: Request, @Body() payload: GoldTemplateSaveRequestDto) {
    const user = this.authService.requireUser(req, ['admin']);
    const operator = user.accountId ? `admin:${user.accountId}` : 'admin';
    return this.configService.saveGoldTemplateVersion(payload, operator);
  }

  @Get('gold-templates/:templateId')
  getGoldTemplateVersion(@Req() req: Request, @Param('templateId') templateId: string) {
    this.authService.requireUser(req, ['admin']);
    return this.configService.getGoldTemplateVersion(Number(templateId));
  }

  @Put('gold-templates/:templateId/archive')
  archiveGoldTemplateVersion(@Req() req: Request, @Param('templateId') templateId: string) {
    this.authService.requireUser(req, ['admin']);
    return this.configService.archiveGoldTemplateVersion(Number(templateId));
  }

  @Delete('gold-templates/:templateId')
  deleteGoldTemplateVersion(@Req() req: Request, @Param('templateId') templateId: string) {
    this.authService.requireUser(req, ['admin']);
    return this.configService.deleteGoldTemplateVersion(Number(templateId));
  }

  @Put('gold-templates/:templateId/status')
  updateGoldTemplateStatus(
    @Req() req: Request,
    @Param('templateId') templateId: string,
    @Body() payload: GoldTemplateVersionStatusUpdateRequestDto,
  ) {
    this.authService.requireUser(req, ['admin']);
    return this.configService.updateGoldTemplateVersionStatus(Number(templateId), payload.status);
  }

  @Get('motivation-rules')
  getMotivationRules(@Req() req: Request): Promise<MotivationRulesDto> {
    this.authService.requireUser(req, ['admin']);
    return this.configService.getMotivationRules();
  }

  @Put('motivation-rules')
  updateMotivationRules(@Req() req: Request, @Body() payload: Partial<MotivationRulesDto>): Promise<MotivationRulesDto> {
    this.authService.requireUser(req, ['admin']);
    return this.configService.updateMotivationRules(payload);
  }

  @Get('patient-app-config')
  getPatientAppConfig(@Req() req: Request): Promise<PatientAppConfigDto> {
    this.authService.requireUser(req, ['admin']);
    return this.configService.getPatientAppConfig();
  }

  @Put('patient-app-config')
  updatePatientAppConfig(
    @Req() req: Request,
    @Body() payload: UpdatePatientAppConfigRequestDto,
  ): Promise<PatientAppConfigDto> {
    this.authService.requireUser(req, ['admin']);
    return this.configService.updatePatientAppConfig(payload);
  }

  @Put(':actionType')
  updateThreshold(
    @Req() req: Request,
    @Param('actionType') actionType: string,
    @Body() payload: Record<string, unknown>,
  ) {
    const user = this.authService.requireUser(req, ['admin']);
    const operator = user.accountId ? `admin:${user.accountId}` : 'admin';
    return this.configService.createThresholdVersion({
      actionType: actionType as any,
      thresholdConfig: ((payload.thresholdConfig as Record<string, unknown> | undefined) || payload),
      changeSummary: typeof payload.changeSummary === 'string' ? payload.changeSummary : undefined,
      activate: payload.activate !== false,
      parentTemplateId: typeof payload.parentTemplateId === 'number' ? payload.parentTemplateId : undefined,
    }, operator);
  }
}
