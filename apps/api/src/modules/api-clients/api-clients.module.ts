import { Module } from '@nestjs/common';
import { ApiClientsController } from './api-clients.controller.js';
import { ApiClientsService } from './api-clients.service.js';

/** The API clients, their keys and the document sources (S05 rules 19–21). */
@Module({
  controllers: [ApiClientsController],
  providers: [ApiClientsService],
})
export class ApiClientsModule {}
