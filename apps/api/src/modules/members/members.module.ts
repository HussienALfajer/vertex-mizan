import { Module } from '@nestjs/common';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';

/** Memberships of the active company (S01 rules 14–18, 21). */
@Module({
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
