import { Module } from '@nestjs/common';
import { CashController, VouchersController } from './cash.controller.js';
import { CashService } from './cash.service.js';

/** S11's cash reads: the cash position, a cash account's statement and the vouchers. */
@Module({ controllers: [CashController, VouchersController], providers: [CashService] })
export class CashModule {}
