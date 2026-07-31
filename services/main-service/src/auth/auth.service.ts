import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { request as httpsRequest } from 'https';
import type {
  AdminLoginRequestDto,
  AdminLoginResponseDto,
  WxLoginRequestDto,
  WxLoginResponseDto,
  WxPhoneLoginRequestDto,
} from '@home-rehab-motion/shared-contract';
import type { DisplayMode, UserRole } from '@home-rehab-motion/shared-types';
import type { Request } from 'express';
import { EnvironmentService } from '../common/runtime/environment';
import { PrismaService } from '../prisma/prisma.service';
import { PRIVACY_POLICY_VERSION } from '../privacy/privacy.service';

export interface AuthenticatedUser {
  userId: number;
  role: UserRole;
  token: string;
  accountId?: number;
  displayMode?: DisplayMode;
}

type SignedTokenPayload = {
  sub: number;
  role: UserRole;
  accountId?: number;
  displayMode?: DisplayMode;
  iat: number;
  exp: number;
};

const TOKEN_PREFIX = 'h1';
const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ENABLE_LEGACY_MOCK_TOKEN = process.env.AUTH_ALLOW_LEGACY_MOCK_TOKEN === 'true';
const ENABLE_MOCK_AUTH_FALLBACK = process.env.MOCK_AUTH_FALLBACK === 'true';

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly environmentService: EnvironmentService,
  ) {}

  isMockLoginAvailable(): boolean {
    return process.env.NODE_ENV !== 'production' && ENABLE_MOCK_AUTH_FALLBACK;
  }

  async mockLogin(): Promise<WxLoginResponseDto> {
    if (!this.isMockLoginAvailable()) {
      throw new ForbiddenException('模拟登录仅在本地开发环境可用');
    }

    const openid = 'mock-openid:local-preview';
    const user = await this.prisma.userProfile.upsert({
      where: { openid },
      update: { role: 'patient', status: 1 },
      create: {
        openid,
        name: '本地体验用户',
        gender: 2,
        age: 62,
        role: 'patient',
        status: 1,
        display_mode: 'elderly',
      },
    });
    await this.grantDefaultVideoAnalysisConsent(user.user_id);
    const displayMode = (user.display_mode as DisplayMode) || 'elderly';
    return {
      token: this.issueToken({ sub: Number(user.user_id), role: 'patient', displayMode }),
      userId: Number(user.user_id),
      role: 'patient',
      displayMode,
    };
  }

  async wxLogin(payload: WxLoginRequestDto): Promise<WxLoginResponseDto> {
    const wxCode = String(payload.code || '').trim();
    if (!wxCode) {
      throw new UnauthorizedException('未获取到微信登录凭证');
    }

    const openid = await this.resolveOpenId(wxCode);
    const user = await this.prisma.userProfile.upsert({
      where: { openid },
      update: {
        role: 'patient',
        status: 1,
      },
      create: {
        openid,
        name: openid.startsWith('mock-openid:') ? `测试患者-${wxCode.slice(-4)}` : '训练用户',
        role: 'patient',
        status: 1,
        display_mode: 'elderly',
      },
    });
    await this.grantDefaultVideoAnalysisConsent(user.user_id);
    const displayMode = (user.display_mode as DisplayMode) || 'elderly';
    return {
      token: this.issueToken({ sub: Number(user.user_id), role: 'patient', displayMode }),
      userId: Number(user.user_id),
      role: 'patient',
      displayMode,
    };
  }

  async wxPhoneLogin(payload: WxPhoneLoginRequestDto): Promise<WxLoginResponseDto> {
    const wxCode = String(payload.wxCode || '').trim();
    const phoneCode = String(payload.phoneCode || '').trim();
    if (!wxCode || !phoneCode) {
      throw new UnauthorizedException('未获取到微信登录或手机号授权凭证');
    }

    const openid = await this.resolveOpenId(wxCode);
    const phone = await this.resolveWechatPhone(phoneCode);
    const user = await this.prisma.userProfile.upsert({
      where: { openid },
      update: {
        phone,
        phone_authorized_at: new Date(),
        role: 'patient',
        status: 1,
      },
      create: {
        openid,
        name: openid.startsWith('mock-openid:') ? `测试患者-${wxCode.slice(-4)}` : `患者-${openid.slice(-4)}`,
        gender: 2,
        age: 62,
        phone,
        phone_authorized_at: new Date(),
        role: 'patient',
        status: 1,
        display_mode: 'elderly',
      },
    });
    await this.grantDefaultVideoAnalysisConsent(user.user_id);
    const displayMode = (user.display_mode as DisplayMode) || 'elderly';
    return {
      token: this.issueToken({ sub: Number(user.user_id), role: 'patient', displayMode }),
      userId: Number(user.user_id),
      role: 'patient',
      displayMode,
    };
  }

  async bindWechatPhone(userId: number, code: string): Promise<{ phoneBound: boolean; maskedPhone: string }> {
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) {
      throw new UnauthorizedException('未获取到微信手机号授权凭证');
    }

    const phone = await this.resolveWechatPhone(normalizedCode);
    await this.prisma.userProfile.update({
      where: { user_id: BigInt(userId) },
      data: {
        phone,
        phone_authorized_at: new Date(),
      },
    });
    return {
      phoneBound: true,
      maskedPhone: this.maskPhone(phone),
    };
  }

  async adminLogin(payload: AdminLoginRequestDto): Promise<AdminLoginResponseDto> {
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const account = username
      ? await this.prisma.adminAccount.findUnique({ where: { username } })
      : null;

    if (!account || account.status !== 1 || !this.verifyPassword(password, account.password_hash)) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const role = account.role as UserRole;
    if (role !== 'admin' && role !== 'nurse') {
      throw new ForbiddenException('账号角色无效');
    }

    return {
      token: this.issueToken({
        sub: Number(account.account_id),
        accountId: Number(account.account_id),
        role,
      }),
      accountId: Number(account.account_id),
      role,
    };
  }

  async requireActiveUser(request: Request, allowedRoles?: UserRole[]): Promise<AuthenticatedUser> {
    const user = this.requireUser(request, allowedRoles);
    if (user.role !== 'admin' && user.role !== 'nurse') return user;
    const accountId = user.accountId || user.userId;
    const account = await this.prisma.adminAccount.findUnique({ where: { account_id: BigInt(accountId) } });
    if (!account || account.status !== 1 || account.role !== user.role) {
      throw new UnauthorizedException('账号已被禁用、删除或权限已变更，请重新登录');
    }
    return user;
  }

  requireUser(request: Request, allowedRoles?: UserRole[]): AuthenticatedUser {
    const authHeader = request.headers.authorization || '';
    const token = this.extractBearerToken(authHeader);
    if (!token) {
      throw new UnauthorizedException('未登录或登录已失效');
    }

    const user = this.parseToken(token);
    if (!user) {
      throw new UnauthorizedException('无效的登录凭证');
    }

    if (allowedRoles && !allowedRoles.includes(user.role)) {
      throw new ForbiddenException('无权限访问该资源');
    }

    return user;
  }

  requireInternalToken(request: Request): void {
    const token = request.headers['x-internal-token'];
    const value = Array.isArray(token) ? token[0] : token;
    const expected = this.environmentService.getSecret('ANALYSIS_INTERNAL_TOKEN', 'home-rehab-motion-internal-token');
    if (!value || value !== expected) {
      throw new UnauthorizedException('内部回调鉴权失败');
    }
  }

  isPrivilegedRole(role: UserRole): boolean {
    return role === 'admin' || role === 'nurse';
  }

  private async grantDefaultVideoAnalysisConsent(userId: bigint) {
    const now = new Date();
    await this.prisma.patientPrivacyConsent.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        policy_version: PRIVACY_POLICY_VERSION,
        consented_at: now,
        withdrawn_at: null,
      },
      // 已主动撤回授权的用户应保持撤回状态；自动授权只应用于首次登录创建的记录。
      update: { policy_version: PRIVACY_POLICY_VERSION },
    });
  }

  private extractBearerToken(header: string): string {
    if (!header.startsWith('Bearer ')) {
      return '';
    }
    return header.slice(7).trim();
  }

  private parseToken(token: string): AuthenticatedUser | null {
    const signed = this.verifyToken(token);
    if (signed) {
      if (signed.role === 'patient') {
        return {
          userId: signed.sub,
          role: signed.role,
          token,
          displayMode: signed.displayMode,
        };
      }
      return {
        userId: 0,
        accountId: signed.accountId || signed.sub,
        role: signed.role,
        token,
      };
    }

    if (!ENABLE_LEGACY_MOCK_TOKEN) {
      return null;
    }

    const [prefix, rawId] = token.split(':');
    const parsedId = Number(rawId || 0);

    if (prefix === 'mock-patient-token' || token === 'mock-patient-token') {
      return {
        userId: parsedId || 1,
        role: 'patient',
        token,
        displayMode: 'elderly',
      };
    }

    if (prefix === 'mock-admin-token' || token === 'mock-admin-token') {
      return {
        userId: 0,
        accountId: parsedId || 1,
        role: 'admin',
        token,
      };
    }

    if (prefix === 'mock-nurse-token' || token === 'mock-nurse-token') {
      return {
        userId: 0,
        accountId: parsedId || 2,
        role: 'nurse',
        token,
      };
    }

    return null;
  }

  private issueToken(payload: { sub: number; role: UserRole; accountId?: number; displayMode?: DisplayMode }) {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + Number(process.env.AUTH_TOKEN_TTL_SECONDS || DEFAULT_TOKEN_TTL_SECONDS);
    const tokenPayload: SignedTokenPayload = {
      sub: payload.sub,
      role: payload.role,
      accountId: payload.accountId,
      displayMode: payload.displayMode,
      iat,
      exp,
    };
    const body = base64UrlEncode(JSON.stringify(tokenPayload));
    const signature = this.signTokenBody(body);
    return `${TOKEN_PREFIX}.${body}.${signature}`;
  }

  private verifyToken(token: string): SignedTokenPayload | null {
    const [prefix, body, signature] = token.split('.');
    if (prefix !== TOKEN_PREFIX || !body || !signature) {
      return null;
    }

    const expectedSignature = this.signTokenBody(body);
    if (!this.safeEqual(expectedSignature, signature)) {
      return null;
    }

    try {
      const payload = JSON.parse(base64UrlDecode(body)) as SignedTokenPayload;
      if (!payload?.sub || !payload?.role) {
        return null;
      }
      if (payload.exp <= Math.floor(Date.now() / 1000)) {
        return null;
      }
      return payload;
    } catch (_error) {
      return null;
    }
  }

  private signTokenBody(body: string) {
    return createHmac('sha256', this.environmentService.getSecret('AUTH_TOKEN_SECRET', 'home-rehab-motion-dev-secret'))
      .update(body)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
  }

  private verifyPassword(password: string, storedHash: string) {
    if (!storedHash) {
      return false;
    }
    if (storedHash === 'mock-password-hash') {
      return ENABLE_LEGACY_MOCK_TOKEN && password === '123456';
    }
    if (!storedHash.startsWith('scrypt$')) {
      return false;
    }
    const [, salt, expected] = storedHash.split('$');
    if (!salt || !expected) {
      return false;
    }
    const derived = scryptSync(password, salt, 64).toString('hex');
    return this.safeEqual(derived, expected);
  }

  private maskPhone(phone: string) {
    return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '已绑定';
  }

  private async resolveWechatPhone(code: string): Promise<string> {
    const appId = process.env.WX_APP_ID;
    const appSecret = process.env.WX_APP_SECRET;
    if (!appId || !appSecret) {
      if (ENABLE_MOCK_AUTH_FALLBACK && code.startsWith('mock-phone-')) {
        return '13800000000';
      }
      throw new UnauthorizedException('未配置微信手机号授权参数');
    }

    try {
      const accessTokenResult = await this.requestWechatJson<{ access_token?: string; errmsg?: string }>(
        new URL(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`),
      );
      if (!accessTokenResult.access_token) {
        throw new Error(`获取微信访问令牌失败：${accessTokenResult.errmsg || '未知错误'}`);
      }
      const phoneResult = await this.requestWechatJson<{
        errcode?: number;
        errmsg?: string;
        phone_info?: { phoneNumber?: string; purePhoneNumber?: string };
      }>(
        new URL(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessTokenResult.access_token)}`),
        { code },
      );
      const phone = phoneResult.phone_info?.purePhoneNumber || phoneResult.phone_info?.phoneNumber;
      if (phone && /^[0-9+\-]{6,20}$/.test(phone)) {
        return phone;
      }
      throw new Error(phoneResult.errmsg || '微信未返回有效手机号');
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误';
      this.logger.warn(`微信手机号授权失败：${reason}`);
      throw new UnauthorizedException('微信手机号授权失败，请重新点击授权');
    }
  }

  private requestWechatJson<T>(url: URL, body?: Record<string, string>): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : undefined;
      const req = httpsRequest(url, {
        method: body ? 'POST' : 'GET',
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : undefined,
      }, (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(responseData || '{}') as T);
          } catch (error) {
            reject(error);
          }
        });
      });
      req.setTimeout(10000, () => req.destroy(new Error('微信接口请求超时')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  private async resolveOpenId(code: string) {
    const appId = process.env.WX_APP_ID;
    const appSecret = process.env.WX_APP_SECRET;

    if ((!appId || !appSecret) && !ENABLE_MOCK_AUTH_FALLBACK) {
      throw new UnauthorizedException('未配置微信登录参数');
    }

    if (!appId || !appSecret) {
      return `mock-openid:${code}`;
    }

    if (
      ENABLE_MOCK_AUTH_FALLBACK
      && (
        code.startsWith('debug')
        || code.startsWith('mock')
        || code.startsWith('new-')
        || code.startsWith('auto-')
        || code.startsWith('feedback-')
        || code.startsWith('regress-')
        || code.startsWith('badge-')
        || code.startsWith('e2e-')
        || code.startsWith('enqueue-')
      )
    ) {
      return `mock-openid:${code}`;
    }

    try {
      const result = await new Promise<{ openid?: string; errcode?: number; errmsg?: string }>((resolve, reject) => {
        const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
        url.searchParams.set('appid', appId);
        url.searchParams.set('secret', appSecret);
        url.searchParams.set('js_code', code);
        url.searchParams.set('grant_type', 'authorization_code');

        const req = httpsRequest(url, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data || '{}'));
            } catch (error) {
              reject(error);
            }
          });
        });
        req.on('error', reject);
        req.end();
      });

      if (result.openid) {
        return result.openid;
      }
      if (!ENABLE_MOCK_AUTH_FALLBACK) {
        const reason = result.errmsg || '微信未返回用户标识';
        this.logger.warn(`微信登录失败：${reason}`);
        throw new UnauthorizedException(`微信登录失败：${reason}`);
      }
    } catch (error) {
      if (!ENABLE_MOCK_AUTH_FALLBACK) {
        if (error instanceof UnauthorizedException) {
          throw error;
        }
        const reason = error instanceof Error ? error.message : '未知错误';
        this.logger.warn(`微信登录请求异常：${reason}`);
        throw new UnauthorizedException('微信登录服务暂时不可用，请稍后重试');
      }
    }

    return `mock-openid:${code}`;
  }
}
