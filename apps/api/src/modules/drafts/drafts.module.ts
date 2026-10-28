import { Module } from '@nestjs/common';
import { DraftsController } from './drafts.controller.js';
import { DraftsService } from './drafts.service.js';

/** The drafts of manual entries, their approval and their attachments (S03 rules 4–11, 17). */
@Module({ controllers: [DraftsController], providers: [DraftsService] })
export class DraftsModule {}
