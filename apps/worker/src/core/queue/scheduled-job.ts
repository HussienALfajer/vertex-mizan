import type { PgBoss } from 'pg-boss';

/**
 * A job pg-boss runs on a schedule: a Nest provider in `src/jobs/<module>/<name>.job.ts`, listed in
 * `src/jobs/index.ts`. pg-boss sends one job per tick to the queue, whichever worker instance holds
 * the schedule, and one instance works it.
 */
export interface ScheduledJob {
  /** The queue's name, `<module>.<name>` after its file. */
  readonly queue: string;
  /** A cron expression in UTC: `* * * * *` is every minute. */
  readonly cron: string;
  /** The queue's pg-boss options, such as how long finished jobs are kept. */
  readonly queueOptions?: Parameters<PgBoss['createQueue']>[1];
  /** Does one run; throwing fails the job for a retry. Safe to run twice or concurrently. */
  run(): Promise<unknown>;
}
