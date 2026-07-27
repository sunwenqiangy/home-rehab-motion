import { Module } from '@nestjs/common';
import { BadgeModule } from '../badge/badge.module';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MotivationService } from './motivation.service';

@Module({
  imports: [PrismaModule, BadgeModule, ConfigModule],
  providers: [MotivationService],
  exports: [MotivationService],
})
export class MotivationModule {}
