import { Module } from '@nestjs/common';
import { OpeningController } from './opening.controller.js';
import { OpeningService } from './opening.service.js';

/** The opening balances (S10). */
@Module({
  controllers: [OpeningController],
  providers: [OpeningService],
})
export class OpeningModule {}
