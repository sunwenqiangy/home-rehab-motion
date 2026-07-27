import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAccountController } from './admin.controller';
import { PatientAdminController } from './patient-admin.controller';
import { PatientAdminService } from './patient-admin.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminAccountController, PatientAdminController],
  providers: [PatientAdminService],
})
export class AdminModule {}
