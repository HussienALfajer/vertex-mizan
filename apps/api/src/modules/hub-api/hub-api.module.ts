import { Module } from '@nestjs/common';
import { HubApiController } from './hub-api.controller.js';
import { HubApiService } from './hub-api.service.js';

/** Hub's API under `/v1` (S05): the events and the periods' states. */
@Module({
  controllers: [HubApiController],
  providers: [HubApiService],
})
export class HubApiModule {}
