import { Module } from '@nestjs/common';
import {
  ClientFundsController,
  ClientsController,
  OpenItemsController,
  ReceivablesController,
} from './open-items.controller.js';
import { OpenItemsService } from './open-items.service.js';

/** Open items, the receivables ageing, client funds and client statements (S04). */
@Module({
  controllers: [
    OpenItemsController,
    ReceivablesController,
    ClientFundsController,
    ClientsController,
  ],
  providers: [OpenItemsService],
})
export class OpenItemsModule {}
