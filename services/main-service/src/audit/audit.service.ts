import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recordSensitiveRead(
    actor: AuthenticatedUser,
    request: Request,
    action: string,
    resourceType: string,
    resourceId: string | number,
    patientId?: number,
  ) {
    if (actor.role !== 'admin' && actor.role !== 'nurse') return;

    const forwardedFor = request.headers['x-forwarded-for'];
    const requestIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : String(forwardedFor || request.ip || '').split(',')[0].trim() || null;
    const userAgent = String(request.headers['user-agent'] || '').slice(0, 255) || null;

    await this.prisma.sensitiveAccessAudit.create({
      data: {
        actor_account_id: actor.accountId ? BigInt(actor.accountId) : null,
        actor_role: actor.role,
        action,
        resource_type: resourceType,
        resource_id: String(resourceId),
        patient_id: patientId ? BigInt(patientId) : null,
        request_ip: requestIp,
        user_agent: userAgent,
      },
    });
  }
}
