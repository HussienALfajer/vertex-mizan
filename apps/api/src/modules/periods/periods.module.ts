import { Module } from '@nestjs/common';
import { PeriodsController } from './periods.controller.js';
import { PeriodsService } from './periods.service.js';
import { RevaluationController } from './revaluation.controller.js';
import { RevaluationService } from './revaluation.service.js';

/** Periods, the close and the month-end revaluation (S07). */
@Module({
  controllers: [PeriodsController, RevaluationController],
  providers: [PeriodsService, RevaluationService],
})
export class PeriodsModule {}
