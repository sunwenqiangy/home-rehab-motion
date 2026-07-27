import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import type {
  BadgeWallDto,
  DisplaySettingsDto,
  BindWechatPhoneRequestDto,
  BindWechatPhoneResponseDto,
  PatientAppConfigDto,
  UpdateDisplaySettingsRequestDto,
  UpdatePatientProfileRequestDto,
  UserProfileDto,
} from '@home-rehab-motion/shared-contract';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly meService: MeService,
    private readonly authService: AuthService,
  ) {}

  @Get('profile')
  getProfile(@Req() req: Request): Promise<UserProfileDto> {
    const user = this.authService.requireUser(req, ['patient']);
    return this.meService.getProfile(user.userId);
  }

  @Put('profile')
  updateProfile(
    @Req() req: Request,
    @Body() payload: UpdatePatientProfileRequestDto,
  ): Promise<UserProfileDto> {
    const user = this.authService.requireUser(req, ['patient']);
    return this.meService.updateProfile(user.userId, payload);
  }

  @Post('phone/bind')
  bindWechatPhone(
    @Req() req: Request,
    @Body() payload: BindWechatPhoneRequestDto,
  ): Promise<BindWechatPhoneResponseDto> {
    const user = this.authService.requireUser(req, ['patient']);
    return this.authService.bindWechatPhone(user.userId, payload.code);
  }

  @Get('display-settings')
  getDisplaySettings(@Req() req: Request): Promise<DisplaySettingsDto> {
    const user = this.authService.requireUser(req, ['patient']);
    return this.meService.getDisplaySettings(user.userId);
  }

  @Get('training-summary')
  getTrainingSummary(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.meService.getTrainingSummary(user.userId);
  }

  @Get('badges')
  getUserBadges(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.meService.getUserBadges(user.userId);
  }

  @Post('badges/:badgeCode/seen')
  markBadgeSeen(@Req() req: Request, @Param('badgeCode') badgeCode: string) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.meService.markBadgeSeen(user.userId, badgeCode);
  }

  @Get('badge-wall')
  getBadgeWall(@Req() req: Request): Promise<BadgeWallDto> {
    const user = this.authService.requireUser(req, ['patient']);
    return this.meService.getBadgeWall(user.userId);
  }

  @Get('app-config')
  getAppConfig(@Req() req: Request): Promise<PatientAppConfigDto> {
    this.authService.requireUser(req, ['patient']);
    return this.meService.getAppConfig();
  }

  @Put('display-settings')
  updateDisplaySettings(
    @Req() req: Request,
    @Body() payload: UpdateDisplaySettingsRequestDto,
  ): Promise<DisplaySettingsDto> {
    const user = this.authService.requireUser(req, ['patient']);
    return this.meService.updateDisplaySettings(user.userId, payload.displayMode);
  }
}
