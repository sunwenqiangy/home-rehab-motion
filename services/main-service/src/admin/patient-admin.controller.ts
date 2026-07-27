import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { PatientAdminService } from './patient-admin.service';

@Controller('admin/patients')
export class PatientAdminController {
  constructor(
    private readonly patientAdminService: PatientAdminService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  listPatients(
    @Req() req: Request,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.authService.requireUser(req, ['admin', 'nurse']);
    return this.patientAdminService.listPatients({
      keyword,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':patientId')
  async getPatientDetail(@Req() req: Request, @Param('patientId') patientId: string) {
    const user = this.authService.requireUser(req, ['admin', 'nurse']);
    const id = Number(patientId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('patientId 非法');
    }
    const detail = await this.patientAdminService.getPatientDetail(id);
    await this.auditService.recordSensitiveRead(user, req, 'view_patient_detail', 'patient_profile', id, id);
    return detail;
  }
}
