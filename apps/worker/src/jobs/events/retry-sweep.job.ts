import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, describeForLog, inboundEventStates } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { DATABASE, JOBS_DATABASE } from '../../core/database/database.module.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';
import { retryInCompany } from './retries.js';

/**
 * `events.retry-sweep` (S05 rule 10, "Jobs"): daily at 04:00 in Damascus (01:00 UTC), and at the
 * worker's start after a deploy, every held event is retried but `NEEDS_DECISION` and
 * `PERIOD_CLOSED` (the `sweep` trigger, which holds `NO_MAPPING` too: S06 brings rules that way).
 * The jobs role finds the companies with held events through its own policy; each company runs as
 * the app role in its context, one transaction each, so one company's failure leaves the others.
 */
@Injectable()
export class EventsRetrySweepJob implements ScheduledJob {
  readonly queue = 'events.retry-sweep';
  readonly cron = '0 1 * * *';
  readonly runAtStart = true;
  readonly queueOptions = { retryLimit: 2, retryDelay: 300 };
  private readonly logger = new Logger(EventsRetrySweepJob.name);

  constructor(
    @Inject(JOBS_DATABASE) private readonly jobs: Database,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async run(): Promise<{ companies: number; posted: number; failed: number }> {
    const found = await this.jobs
      .selectDistinct({ companyId: inboundEventStates.companyId })
      .from(inboundEventStates)
      .where(eq(inboundEventStates.state, 'held'));
    let posted = 0;
    let failed = 0;
    for (const { companyId } of found) {
      try {
        posted += await retryInCompany(this.db, this.queue, companyId, [{ kind: 'sweep' }]);
      } catch (error) {
        failed += 1;
        this.logger.error(`Sweep of company ${companyId} failed: ${describeForLog(error)}`);
      }
    }
    if (posted > 0 || failed > 0) {
      this.logger.log(`Sweep: ${posted} held events posted, ${failed} companies failed`);
    }
    if (failed > 0) throw new Error(`The sweep failed in ${failed} companies`);
    return { companies: found.length, posted, failed };
  }
}
