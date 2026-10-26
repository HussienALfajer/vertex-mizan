import { Injectable, Logger } from '@nestjs/common';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

/**
 * Proves the queue end to end once a minute: pg-boss holds the schedule, sends the job and a worker
 * works it, so a stuck queue shows as a missing log line and as heartbeat jobs left unworked in
 * `pgboss`. It reads and writes no table of its own, so it is safe to run twice.
 */
@Injectable()
export class HeartbeatJob implements ScheduledJob {
  readonly queue = 'system.heartbeat';
  readonly cron = '* * * * *';
  private readonly logger = new Logger(HeartbeatJob.name);

  async run(): Promise<void> {
    this.logger.log('Heartbeat');
  }
}
