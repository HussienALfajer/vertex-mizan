import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module.js';
import { CashController, VouchersController } from './cash.controller.js';
import { CashService } from './cash.service.js';

/** S11's cash reads and their Excel exports: the cash position, a cash account's statement, the vouchers. */
@Module({
  imports: [ReportsModule],
  controllers: [CashController, VouchersController],
  providers: [CashService],
})
export class CashModule {}
