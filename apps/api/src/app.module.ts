import {
  type DynamicModule,
  Module,
  StandardSchemaSerializerInterceptor,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { HealthModule } from './core/health/health.module.js';

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
      ],
      providers: [
        // Validates every parameter declared with `{ schema }` (Zod through Standard Schema).
        { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
        // Shapes responses declared with `@SerializeOptions({ schema })`, dropping unknown fields.
        { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
      ],
    };
  }
}
