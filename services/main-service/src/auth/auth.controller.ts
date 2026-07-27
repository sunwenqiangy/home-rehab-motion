import { Body, Controller, Post } from '@nestjs/common';
import type {
  AdminLoginRequestDto,
  WxLoginRequestDto,
  WxPhoneLoginRequestDto,
} from '@home-rehab-motion/shared-contract';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/mock-login/status')
  mockLoginStatus() {
    return { enabled: this.authService.isMockLoginAvailable() };
  }

  @Post('auth/mock-login')
  mockLogin() {
    return this.authService.mockLogin();
  }

  @Post('auth/wx-login')
  wxLogin(@Body() payload: WxLoginRequestDto) {
    return this.authService.wxLogin(payload);
  }

  @Post('auth/wx-phone-login')
  wxPhoneLogin(@Body() payload: WxPhoneLoginRequestDto) {
    return this.authService.wxPhoneLogin(payload);
  }

  @Post('admin/auth/login')
  adminLogin(@Body() payload: AdminLoginRequestDto) {
    return this.authService.adminLogin(payload);
  }
}
