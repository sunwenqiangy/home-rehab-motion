import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { BadgeModule } from '../badge/badge.module';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { MotivationModule } from '../motivation/motivation.module';
import { StorageModule } from '../storage/storage.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

@Module({
  imports: [PrismaModule, AnalysisModule, StorageModule, BadgeModule, ConfigModule, MotivationModule, PrivacyModule],
  controllers: [VideoController],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
