import {
  type DynamicModule,
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
  type Type,
} from '@nestjs/common';
import { describeForLog } from '@vertex-mizan/db';
import { PgBoss } from 'pg-boss';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';
import type { ScheduledJob } from './scheduled-job.js';

/** Injection token for the process's pg-boss, connected as the queue role. */
export const BOSS = Symbol('BOSS');
const SCHEDULED_JOBS = Symbol('SCHEDULED_JOBS');

/** The schema the owner role creates for pg-boss (`0000_foundation.sql` in `packages/db`). */
export const QUEUE_SCHEMA = 'pgboss';

/**
 * pg-boss (ADR 0002), run as `mizan_queue` in its own schema (ADR 0003): at start it installs or
 * migrates its tables there, then creates each scheduled job's queue, schedules it and works it.
 * It stops gracefully on shutdown. Copied from Vertex Food's queue module.
 */
@Global()
@Module({})
export class QueueModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Queue');

  static forRoot(jobs: Type<ScheduledJob>[]): DynamicModule {
    return {
      module: QueueModule,
      providers: [
        {
          provide: BOSS,
          inject: [CONFIG],
          useFactory: (config: Config) =>
            new PgBoss({
              connectionString: config.queueDatabaseUrl,
              schema: QUEUE_SCHEMA,
              // The queue role has no database-level CREATE; the owner made the schema.
              createSchema: false,
            }),
        },
        ...jobs,
        {
          provide: SCHEDULED_JOBS,
          inject: jobs,
          useFactory: (...instances: ScheduledJob[]) => instances,
        },
      ],
      exports: [BOSS],
    };
  }

  constructor(
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(SCHEDULED_JOBS) private readonly jobs: ScheduledJob[],
  ) {}

  async onModuleInit(): Promise<void> {
    // The message can quote values: only its code reaches the log.
    this.boss.on('error', (error) => this.logger.error(describeForLog(error)));
    await this.boss.start();
    for (const job of this.jobs) {
      await this.boss.createQueue(job.queue, job.queueOptions);
      await this.boss.schedule(job.queue, job.cron);
      await this.boss.work(job.queue, async () => {
        await job.run();
      });
      this.logger.log(`Scheduled ${job.queue} (${job.cron})`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true });
  }
}
