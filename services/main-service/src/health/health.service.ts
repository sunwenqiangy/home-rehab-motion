import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  getLiveness() {
    return {
      service: 'main-service',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        ...this.getLiveness(),
        checks: { database: 'ok' },
      };
    } catch {
      throw new ServiceUnavailableException({
        service: 'main-service',
        status: 'unavailable',
        checks: { database: 'unavailable' },
      });
    }
  }

  getHealth() {
    return this.getLiveness();
  }
}
