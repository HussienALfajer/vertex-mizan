import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Database } from '@vertex-mizan/db';
import { AccessGuard } from '../../core/access/access.guard.js';
import type { Config } from '../../core/config/config.js';
import { CONFIG } from '../../core/config/config.module.js';
import { DATABASE } from '../../core/database/database.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AUTH, createAuth } from './auth.js';

/**
 * Sign-in and access (S01): Better Auth at `/api/auth`, our account routes beside it, and the
 * global access guard every route passes. `AccountController` is listed before `AuthController`,
 * whose catch-all route must come last.
 */
@Global()
@Module({
  controllers: [AccountController, AuthController],
  providers: [
    {
      provide: AUTH,
      inject: [DATABASE, CONFIG],
      useFactory: (db: Database, config: Config) => createAuth(db, config),
    },
    AccountService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AUTH],
})
export class AuthModule {}
