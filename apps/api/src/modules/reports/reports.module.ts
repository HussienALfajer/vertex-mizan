import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** The reports of S09: the trial balance, the ledgers, the statements, profitability. */
@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
