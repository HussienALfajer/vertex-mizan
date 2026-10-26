import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type DynamicModule,
  Module,
  StandardSchemaSerializerInterceptor,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { CodedException, issuesOf } from './core/errors/coded-exception.js';
import { ErrorFilter } from './core/errors/error.filter.js';
import { HealthModule } from './core/health/health.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CompaniesModule } from './modules/companies/companies.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';
import { MeModule } from './modules/me/me.module.js';
import { MembersModule } from './modules/members/members.module.js';

/**
 * The API: the core (configuration, logging, the database, request validation and response
 * serialization through each route's contract schemas) and the modules. New modules are imported
 * here.
 */
@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            // Every request gets an ID: in the logs, in the answer's header, in the audit logs.
            genReqId: (_request: IncomingMessage, response: ServerResponse) => {
              const id = randomUUID();
              response.setHeader('x-request-id', id);
              return id;
            },
            // API keys and sessions travel in these headers; they never reach the log.
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            ...(config.environment === 'development' && { transport: { target: 'pino-pretty' } }),
          },
        }),
        DatabaseModule,
        HealthModule,
        MeModule,
        CompaniesModule,
        MembersModule,
        InvitationsModule,
        AuditModule,
        AuthModule,
      ],
      providers: [
        // Validates every parameter declared with `{ schema }` (Zod through Standard Schema).
        // A failure answers 422 `VALIDATION_FAILED` with the failed fields (ADR 0008, S01).
        {
          provide: APP_PIPE,
          useValue: new StandardSchemaValidationPipe({
            exceptionFactory: (issues) =>
              new CodedException('VALIDATION_FAILED', 'Validation failed', issuesOf(issues)),
          }),
        },
        // Shapes responses declared with `@SerializeOptions({ schema })`, dropping unknown fields.
        { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
        // Every error answer carries a stable code (S01, ADR 0006).
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
