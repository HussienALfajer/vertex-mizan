import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller.js';
import { ReconciliationService } from './reconciliation.service.js';

/** The daily reconciliation's reads (S08). Hub's report and events are `/v1`'s (`hub-api`). */
@Module({ controllers: [ReconciliationController], providers: [ReconciliationService] })
export class ReconciliationModule {}
