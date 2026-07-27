import { Module } from '@nestjs/common';
import { AnalysisReconciliationService } from './analysis-reconciliation.service';
import { AnalysisService } from './analysis.service';

@Module({
  providers: [AnalysisService, AnalysisReconciliationService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
