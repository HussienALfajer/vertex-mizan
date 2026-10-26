import { Module } from '@nestjs/common';
import { SessionController } from '../session/session.controller.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';

/** The signed-in person (`/api/me`) and the session's active company (`/api/session`). */
@Module({
  controllers: [MeController, SessionController],
  providers: [MeService],
})
export class MeModule {}
