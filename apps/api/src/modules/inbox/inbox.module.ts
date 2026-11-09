import { Module } from '@nestjs/common';
import { InboxController, PostingRulesController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';
import { PostingRulesService } from './posting-rules.service.js';

/** The event inbox and the posting rules' mapping (S05). */
@Module({
  controllers: [InboxController, PostingRulesController],
  providers: [InboxService, PostingRulesService],
})
export class InboxModule {}
