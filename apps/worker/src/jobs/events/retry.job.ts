import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENTS_RETRY_QUEUE, eventsRetryJobSchema } from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import { DATABASE } from '../../core/database/database.module.js';
import type { QueueWorker } from '../../core/queue/scheduled-job.js';
import { retryInCompany } from './retries.js';

/**
 * `events.retry` (S05 rule 10, "Jobs"): queued by the API after the commit of a change that frees
 * held events (an event that left held, a rate or holiday, a mapping, an account unblocked or
 * restored), with the company and what freed them; each freed event is attempted again in
 * received order. Safe twice: a posted event is not attempted again and its entries post under
 * their keys once.
 */
@Injectable()
export class EventsRetryJob implements QueueWorker {
  readonly queue = EVENTS_RETRY_QUEUE;
  readonly queueOptions = { retryLimit: 3, retryDelay: 30, retryBackoff: true };
  private readonly logger = new Logger(EventsRetryJob.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async work(data: unknown): Promise<{ posted: number }> {
    const job = eventsRetryJobSchema.parse(data);
    const posted = await retryInCompany(this.db, this.queue, job.companyId, job.triggers);
    if (posted > 0) this.logger.log(`Retries: ${posted} held events posted`);
    return { posted };
  }
}
