import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AnalysisModule } from './analysis/analysis.module';
import { AuthModule } from './auth/auth.module';
import { BadgeModule } from './badge/badge.module';
import { ConfigModule } from './config/config.module';
import { EnvironmentModule } from './common/runtime/environment.module';
import { FeedbackModule } from './feedback/feedback.module';
import { GuidanceModule } from './guidance/guidance.module';
import { HealthModule } from './health/health.module';
import { HistoryModule } from './history/history.module';
import { MeModule } from './me/me.module';
import { MotivationModule } from './motivation/motivation.module';
import { NotificationModule } from './notification/notification.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrivacyModule } from './privacy/privacy.module';
import { ReportModule } from './report/report.module';
import { StorageModule } from './storage/storage.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    EnvironmentModule,
    PrismaModule,
    AuditModule,
    PrivacyModule,
    HealthModule,
    AnalysisModule,
    AuthModule,
    AdminModule,
    GuidanceModule,
    VideoModule,
    ReportModule,
    FeedbackModule,
    NotificationModule,
    ConfigModule,
    BadgeModule,
    StorageModule,
    HistoryModule,
    MeModule,
    MotivationModule,
  ],
})
export class AppModule {}
