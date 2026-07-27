import { Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { PrivacyService } from './privacy.service';

@Controller('me/privacy')
export class PrivacyController {
  constructor(
    private readonly privacyService: PrivacyService,
    private readonly authService: AuthService,
  ) {}

  @Get('consent')
  getConsentStatus(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.privacyService.getConsentStatus(user.userId);
  }

  @Post('consent')
  grantConsent(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.privacyService.grantConsent(user.userId);
  }

  @Post('withdraw-consent')
  withdrawConsent(@Req() req: Request) {
    const user = this.authService.requireUser(req, ['patient']);
    return this.privacyService.withdrawConsent(user.userId);
  }
}
