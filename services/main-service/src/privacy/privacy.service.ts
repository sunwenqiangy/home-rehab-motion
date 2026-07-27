import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const PRIVACY_POLICY_VERSION = '2026-07-26';

@Injectable()
export class PrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  async getConsentStatus(userId: number) {
    const consent = await this.prisma.patientPrivacyConsent.findUnique({
      where: { user_id: BigInt(userId) },
    });
    const consented = Boolean(consent?.consented_at) && !consent?.withdrawn_at;
    return {
      policyVersion: PRIVACY_POLICY_VERSION,
      consented,
      consentedAt: consent?.consented_at?.toISOString(),
      withdrawnAt: consent?.withdrawn_at?.toISOString(),
    };
  }

  async grantConsent(userId: number) {
    const now = new Date();
    const consent = await this.prisma.patientPrivacyConsent.upsert({
      where: { user_id: BigInt(userId) },
      create: {
        user_id: BigInt(userId),
        policy_version: PRIVACY_POLICY_VERSION,
        consented_at: now,
        withdrawn_at: null,
      },
      update: {
        policy_version: PRIVACY_POLICY_VERSION,
        consented_at: now,
        withdrawn_at: null,
      },
    });
    return {
      policyVersion: consent.policy_version,
      consented: true,
      consentedAt: consent.consented_at?.toISOString(),
    };
  }

  async withdrawConsent(userId: number) {
    const now = new Date();
    const consent = await this.prisma.patientPrivacyConsent.upsert({
      where: { user_id: BigInt(userId) },
      create: {
        user_id: BigInt(userId),
        policy_version: PRIVACY_POLICY_VERSION,
        consented_at: null,
        withdrawn_at: now,
      },
      update: { withdrawn_at: now },
    });
    return {
      policyVersion: consent.policy_version,
      consented: false,
      withdrawnAt: consent.withdrawn_at?.toISOString(),
    };
  }

  async requireActiveConsent(userId: number) {
    const status = await this.getConsentStatus(userId);
    if (!status.consented) {
      throw new ForbiddenException('请先阅读并同意隐私政策和视频分析授权后再继续');
    }
  }
}
