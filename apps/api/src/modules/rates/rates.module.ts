import { Module } from '@nestjs/common';
import {
  RateCalendarController,
  RatePairsController,
  RatesController,
} from './rates.controller.js';
import { RatesService } from './rates.service.js';

/** The rate table and the bulletin calendar (S02 rules 14–18); S05's Hub intake calls the service. */
@Module({
  controllers: [RatesController, RatePairsController, RateCalendarController],
  providers: [RatesService],
})
export class RatesModule {}
