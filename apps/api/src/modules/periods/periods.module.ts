import { Module } from '@nestjs/common';
import { RevaluationController } from './revaluation.controller.js';
import { RevaluationService } from './revaluation.service.js';

/** Periods and the month-end revaluation (S07). */
@Module({ controllers: [RevaluationController], providers: [RevaluationService] })
export class PeriodsModule {}
