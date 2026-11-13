import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { describeForLog } from '@vertex-mizan/db';
import { PgBoss } from 'pg-boss';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

/**
 * Queues a job for the worker after the commit of its change (S09: `reports.render` for a report
 * file): pg-boss as the queue role, started on the first job, never installing or scheduling
 * anything (the worker owns the queues). A failure to queue is logged, never thrown. Without
 * `DATABASE_QUEUE_URL` (the tests) nothing is queued.
 */
@Injectable()
export class JobQueue implements OnApplicationShutdown {
  private readonly logger = new Logger('JobQueue');
  private boss: Promise<PgBoss> | null = null;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  /** Queues one job for the worker; a failure is logged, never thrown. */
  async send(queue: string, data: object): Promise<void> {
    if (!this.config.queueDatabaseUrl) return;
    try {
      const boss = await this.start(this.config.queueDatabaseUrl);
      await boss.send(queue, data);
    } catch (error) {
      this.logger.error(`Could not queue ${queue}: ${describeForLog(error)}`);
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

/** The worker's job producer, for every module that queues work after its commit. */
@Global()
@Module({ providers: [JobQueue], exports: [JobQueue] })
export class JobsModule {}
