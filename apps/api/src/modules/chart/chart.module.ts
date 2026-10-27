import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { AccountRolesController, ChartController } from './chart.controller.js';
import { ChartService } from './chart.service.js';

/** The chart of accounts, its roles, templates and export (S02 rules 1–7). */
@Module({
  controllers: [AccountsController, ChartController, AccountRolesController],
  providers: [AccountsService, ChartService],
})
export class ChartModule {}
