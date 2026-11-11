import { Module } from '@nestjs/common';
import { RevenueController } from './revenue.controller.js';
import { RevenueService } from './revenue.service.js';

/** Revenue recognition's reads (S06). */
@Module({ controllers: [RevenueController], providers: [RevenueService] })
export class RevenueModule {}
