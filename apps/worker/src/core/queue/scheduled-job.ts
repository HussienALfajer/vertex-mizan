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

/**
 * A queue another process sends to (S09's `reports.render`, which the API queues after a commit):
 * no schedule, each job worked with its data. Its data is unvalidated: parse it with its contract.
 */
export interface QueueWorker {
  readonly queue: string;
  readonly queueOptions?: Parameters<PgBoss['createQueue']>[1];
  /** Works one job; throwing fails it for a retry. Safe to run twice or concurrently. */
  work(data: unknown): Promise<unknown>;
}

/** Every job of the worker: on a schedule, or working a queue. */
export type WorkerJob = ScheduledJob | QueueWorker;

export const isScheduled = (job: WorkerJob): job is ScheduledJob => 'cron' in job;
