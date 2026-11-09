import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { EVENTS_RETRY_QUEUE, type EventsRetryJob } from '@vertex-mizan/contracts';
import { describeForLog, type RetryTrigger } from '@vertex-mizan/db';
import { PgBoss } from 'pg-boss';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

/**
 * Queues the automatic retries after the commit of a change that frees held events (S05 rule 10):
 * pg-boss as the queue role, started on the first job, never installing or scheduling anything
 * (the worker owns the queues). A job is only a nudge: a failure to queue is logged, and the
 * worker's daily sweep retries what it missed. Without `DATABASE_QUEUE_URL` (the tests) nothing is
 * queued.
 */
@Injectable()
export class RetryQueue implements OnApplicationShutdown {
  private readonly logger = new Logger('RetryQueue');
  private boss: Promise<PgBoss> | null = null;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  /** Queues the retries of `triggers` in `companyId`, once its change has committed. */
  async afterCommit(companyId: string, triggers: readonly RetryTrigger[]): Promise<void> {
    if (triggers.length === 0 || !this.config.queueDatabaseUrl) return;
    try {
      const boss = await this.start(this.config.queueDatabaseUrl);
      const job: EventsRetryJob = { companyId, triggers: [...triggers] };
      await boss.send(EVENTS_RETRY_QUEUE, job);
    } catch (error) {
      this.logger.error(`Could not queue ${EVENTS_RETRY_QUEUE}: ${describeForLog(error)}`);
    }
  }

  private start(connectionString: string): Promise<PgBoss> {
    if (!this.boss) {
      const boss = new PgBoss({
        connectionString,
        schema: 'pgboss',
        createSchema: false,
        migrate: false,
        supervise: false,
        schedule: false,
      });
      boss.on('error', (error) => this.logger.error(describeForLog(error)));
      this.boss = boss.start().then(
        () => boss,
        (error: unknown) => {
          this.boss = null;
          throw error;
        },
      );
    }
    return this.boss;
  }

  async onApplicationShutdown(): Promise<void> {
    const boss = await this.boss?.catch(() => null);
    await boss?.stop({ graceful: true });
  }
}

/** The retry producer, for every module whose change frees held events. */
@Global()
@Module({ providers: [RetryQueue], exports: [RetryQueue] })
export class JobsModule {}
