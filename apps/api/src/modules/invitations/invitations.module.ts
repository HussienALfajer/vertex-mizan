import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

/** Invitations by email (S01 rule 15). */
@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
