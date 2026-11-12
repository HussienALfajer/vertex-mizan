import { Module } from '@nestjs/common';
import { ReportFilesController } from './report-files.controller.js';
import { ReportFilesService } from './report-files.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * The reports of S09: the trial balance, the ledgers, the statements, profitability (PR 1), and
 * their exports, PDF files and the journal book's print register (PR 2).
 */
@Module({
  controllers: [ReportsController, ReportFilesController],
  providers: [ReportsService, ReportFilesService],
})
export class ReportsModule {}
