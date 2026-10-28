import { Module } from '@nestjs/common';
import {
  AccountLinesController,
  AttachmentsController,
  EntriesController,
  RateEntriesController,
} from './entries.controller.js';
import { EntriesService } from './entries.service.js';

/**
 * Posted entries (S03): the journal, an entry, the reversal and copy of a manual entry, the files
 * added after posting, an account's lines and the entries of a rate row.
 */
@Module({
  controllers: [
    EntriesController,
    AttachmentsController,
    AccountLinesController,
    RateEntriesController,
  ],
  providers: [EntriesService],
})
export class EntriesModule {}
