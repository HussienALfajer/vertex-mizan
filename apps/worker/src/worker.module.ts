import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Config } from './core/config/config.js';
import { ConfigModule } from './core/config/config.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { EmailModule } from './core/email/email.module.js';
import { FilesModule } from './core/files/file-store.js';
import { QueueModule } from './core/queue/queue.module.js';
import type { ScheduledJob } from './core/queue/scheduled-job.js';

/**
 * The worker (ADR 0002): a Nest application context with no HTTP server, its configuration,
 * logging, the app and jobs roles' databases, the files of attachments and exports, the SMTP
 * transport, pg-boss as the queue role, and the scheduled jobs listed in `jobs/index.ts`.
 */
@Module({})
export class WorkerModule {
  static forRoot(config: Config, jobs: Type<ScheduledJob>[]): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            ...(config.environment === 'development' && { transport: { target: 'pino-pretty' } }),
          },
        }),
        DatabaseModule,
        FilesModule,
        EmailModule,
        QueueModule.forRoot(jobs),
      ],
    };
  }
}
