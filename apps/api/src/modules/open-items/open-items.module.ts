import { Module } from '@nestjs/common';
import {
  RunningBalancesController,
  CounterpartiesController,
  OpenItemsController,
  ReceivablesController,
} from './open-items.controller.js';
import { OpenItemsService } from './open-items.service.js';

/** Open items, the receivables ageing, client funds and client statements (S04). */
@Module({
  controllers: [
    OpenItemsController,
    ReceivablesController,
    RunningBalancesController,
    CounterpartiesController,
  ],
  providers: [OpenItemsService],
})
export class OpenItemsModule {}
