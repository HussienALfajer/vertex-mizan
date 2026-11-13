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
import { isScheduled, type WorkerJob } from './scheduled-job.js';

/** Injection token for the process's pg-boss, connected as the queue role. */
export const BOSS = Symbol('BOSS');
const SCHEDULED_JOBS = Symbol('SCHEDULED_JOBS');

/** The schema the owner role creates for pg-boss (`0000_foundation.sql` in `packages/db`). */
export const QUEUE_SCHEMA = 'pgboss';

/**
 * pg-boss (ADR 0002), run as `mizan_queue` in its own schema (ADR 0003): at start it installs or
 * migrates its tables there, then creates each scheduled job's queue, schedules it and works it,
 * and removes the schedule of a job that no longer exists.
 * It stops gracefully on shutdown. Copied from Vertex Food's queue module.
 */
@Global()
@Module({})
export class QueueModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Queue');

  static forRoot(jobs: Type<WorkerJob>[]): DynamicModule {
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
          useFactory: (...instances: WorkerJob[]) => instances,
        },
      ],
      exports: [BOSS],
    };
  }

  constructor(
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(SCHEDULED_JOBS) private readonly jobs: WorkerJob[],
  ) {}

  async onModuleInit(): Promise<void> {
    // The message can quote values: only its code reaches the log.
    this.boss.on('error', (error) => this.logger.error(describeForLog(error)));
    await this.boss.start();
    for (const job of this.jobs) {
      await this.boss.createQueue(job.queue, job.queueOptions);
      if (!isScheduled(job)) {
        await this.boss.work(job.queue, async (batch) => {
          for (const one of batch) await job.work(one.data);
        });
        this.logger.log(`Working ${job.queue}`);
        continue;
      }
      await this.boss.schedule(job.queue, job.cron);
      await this.boss.work(job.queue, async () => {
        await job.run();
      });
      this.logger.log(`Scheduled ${job.queue} (${job.cron})`);
    }
    // A schedule whose job left (ADR 0021: the event, digest and release jobs) stops firing.
    const scheduled = new Set(this.jobs.filter(isScheduled).map((job) => job.queue));
    for (const schedule of await this.boss.getSchedules()) {
      if (scheduled.has(schedule.name)) continue;
      await this.boss.unschedule(schedule.name, schedule.key);
      this.logger.log(`Unscheduled ${schedule.name}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true });
  }
}
