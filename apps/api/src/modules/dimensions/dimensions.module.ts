import { Module } from '@nestjs/common';
import { DimensionTypesController, DimensionValuesController } from './dimensions.controller.js';
import { DimensionsService } from './dimensions.service.js';

/** Dimension types and values (S02 rules 9–13); S05's Hub intake calls the same service. */
@Module({
  controllers: [DimensionTypesController, DimensionValuesController],
  providers: [DimensionsService],
})
export class DimensionsModule {}
