import { Module } from '@nestjs/common';
import {
  BrandingController,
  BrandingPublicController,
  DashboardController,
  DayRatesController,
  MaterialCostsController,
  MovementsController,
  PartiesController,
  ProjectBooksController,
} from './movements.controller.js';
import { MovementsService } from './movements.service.js';

/** S13's project movements (ADR 0024): movements, projects, parties, costs, rates and branding. */
@Module({
  controllers: [
    MovementsController,
    ProjectBooksController,
    PartiesController,
    MaterialCostsController,
    DayRatesController,
    DashboardController,
    BrandingController,
    BrandingPublicController,
  ],
  providers: [MovementsService],
})
export class MovementsModule {}
