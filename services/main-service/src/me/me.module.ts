import { Module } from '@nestjs/common';
import { BadgeModule } from '../badge/badge.module';
import { ConfigModule } from '../config/config.module';
import { MotivationModule } from '../motivation/motivation.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [BadgeModule, ConfigModule, MotivationModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
