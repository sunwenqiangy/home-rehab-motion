import { Injectable, InternalServerErrorException } from '@nestjs/common';

const DEFAULT_SECRETS = new Set([
  '',
  'home-rehab-motion-dev-secret',
  'home-rehab-motion-internal-token',
  'replace-with-your-secret',
]);

@Injectable()
export class EnvironmentService {
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  }

  assertProductionReady() {
    if (!this.isProduction) {
      return;
    }

    const errors: string[] = [];
    const requiredSecrets = ['AUTH_TOKEN_SECRET', 'ANALYSIS_INTERNAL_TOKEN'];
    for (const name of requiredSecrets) {
      const value = String(process.env[name] || '').trim();
      if (value.length < 32 || DEFAULT_SECRETS.has(value)) {
        errors.push(`${name} 必须配置至少 32 位的非默认密钥`);
      }
    }

    if (process.env.MOCK_AUTH_FALLBACK === 'true' || process.env.AUTH_ALLOW_LEGACY_MOCK_TOKEN === 'true') {
      errors.push('生产环境禁止启用 Mock 登录或 legacy Mock token');
    }
    if (process.env.ALLOW_SAMPLE_VIDEO_FALLBACK === 'true' || process.env.ALLOW_MOCK_KEYPOINTS_FALLBACK === 'true') {
      errors.push('生产环境禁止启用样例视频或 Mock 关键点回退');
    }
    if (process.env.STORAGE_UPLOAD_MODE !== 's3_post') {
      errors.push('生产环境必须使用私有对象存储直传模式 STORAGE_UPLOAD_MODE=s3_post');
    }
    if (process.env.STORAGE_SKIP_DIRECT_OBJECT_CHECK === 'true') {
      errors.push('生产环境禁止跳过对象存储存在性校验');
    }
    if (!String(process.env.OSS_ENDPOINT || '').startsWith('https://')) {
      errors.push('生产环境 OSS_ENDPOINT 必须使用 HTTPS');
    }
    if (!String(process.env.PUBLIC_API_BASE_URL || '').startsWith('https://')) {
      errors.push('生产环境 PUBLIC_API_BASE_URL 必须使用 HTTPS');
    }
    if (!String(process.env.ANALYSIS_CALLBACK_URL || '').startsWith('https://')) {
      errors.push('生产环境 ANALYSIS_CALLBACK_URL 必须使用 HTTPS');
    }

    if (errors.length) {
      throw new InternalServerErrorException(`生产环境配置校验失败：${errors.join('；')}`);
    }
  }

  getSecret(name: 'AUTH_TOKEN_SECRET' | 'ANALYSIS_INTERNAL_TOKEN', developmentFallback: string) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
      if (this.isProduction) {
        throw new InternalServerErrorException(`${name} 未安全配置`);
      }
      return developmentFallback;
    }
    if (this.isProduction && (value.length < 32 || DEFAULT_SECRETS.has(value))) {
      throw new InternalServerErrorException(`${name} 未安全配置`);
    }
    return value;
  }
}
