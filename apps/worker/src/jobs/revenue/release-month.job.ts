import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AuditActor,
  appendPreOpeningResultAccount,
  awaitsOpening,
  companies,
  type Database,
  describeForLog,
  mapAppendedTemplateSlots,
  RECOGNITION_SLOTS,
  releaseMissingMonths,
  releaseMonth,
  SYSTEM_NAME,
  withCompany,
} from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE, JOBS_DATABASE } from '../../core/database/database.module.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

/** The system, as the audit log records a release (S06 "Audit"). */
const releaseActor: AuditActor = {
  kind: 'system',
  name: SYSTEM_NAME,
  requestId: 'job:revenue.release-month',
  ipAddress: null,
  userAgent: null,
};

/** What one company's run did. */
export interface CompanyRelease {
  readonly mapped: number;
  /** Whether it got S10's `312002` with its role (a company made before the templates' version 2). */
  readonly appended: boolean;
  /** Whether it waits for its opening, so nothing was released (S10 rule 3). */
  readonly awaitingOpening: boolean;
  readonly posted: number;
  readonly refused: number;
}

/**
 * One company's releases, in its context as the app role, in one transaction: the template's
 * recognition slots mapped when the company predates them (S06 "Data"), then every month that has
 * ended and still misses a release (S06 rules 4–5). S10: a company made before the templates'
 * version 2 gets `312002` with its role first, and one with a books start waits for its opening:
 * nothing releases before it posts (rule 3). An archived company is read-only (S01 rule 12):
 * nothing posts.
 */
export async function releaseInCompany(
  db: Database,
  companyId: string,
  today: string,
): Promise<CompanyRelease> {
  return withCompany(db, companyId, async (tx) => {
    const [company] = await tx
      .select({ archivedAt: companies.archivedAt })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for('share');
    const none = { mapped: 0, appended: false, awaitingOpening: false, posted: 0, refused: 0 };
    if (!company || company.archivedAt) return none;
    const mapped = await mapAppendedTemplateSlots(tx, companyId, RECOGNITION_SLOTS, releaseActor);
    const appended = await appendPreOpeningResultAccount(tx, companyId, releaseActor);
    if (await awaitsOpening(tx)) return { ...none, mapped, appended, awaitingOpening: true };
    const result = await releaseMissingMonths(tx, today, releaseActor);
    return {
      mapped,
      appended,
      awaitingOpening: false,
      posted: result.posted,
      refused: result.refused.length,
    };
  });
}

/**
 * `revenue.release-month` (S06 rules 4–5, "Jobs"): daily at 01:00 in Damascus (22:00 UTC), so the
 * month that ended posts on the first day of the next, and at the worker's start after a deploy;
 * every run releases any ended month still missing its release, one entry per invoice and month
 * dated on the month's last day. The jobs role lists the companies; each runs as the app role in
 * its context, one transaction each, so one company's failure leaves the others. A release that
 * cannot post (its revenue slot unmapped, its account blocked, its period closed) is left missing
 * and logged; `/revenue` and S07's checklist show it. Safe to run twice: a month releases once.
 */
@Injectable()
export class RevenueReleaseMonthJob implements ScheduledJob {
  readonly queue = 'revenue.release-month';
  readonly cron = '0 22 * * *';
  readonly runAtStart = true;
  readonly queueOptions = { retryLimit: 2, retryDelay: 300 };
  private readonly logger = new Logger(RevenueReleaseMonthJob.name);

  constructor(
    @Inject(JOBS_DATABASE) private readonly jobs: Database,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async run(today: string = todayInDamascus()): Promise<{
    companies: number;
    posted: number;
    refused: number;
    failed: number;
  }> {
    const found = await this.jobs.select({ id: companies.id }).from(companies);
    let posted = 0;
    let refused = 0;
    let failed = 0;
    for (const { id } of found) {
      try {
        const result = await releaseInCompany(this.db, id, today);
        posted += result.posted;
        refused += result.refused;
      } catch (error) {
        failed += 1;
        this.logger.error(`Releases of company ${id} failed: ${describeForLog(error)}`);
      }
    }
    if (posted > 0 || refused > 0 || failed > 0) {
      this.logger.log(
        `Releases: ${posted} entries posted, ${refused} left missing, ${failed} companies failed`,
      );
    }
    if (failed > 0) throw new Error(`The releases failed in ${failed} companies`);
    return { companies: found.length, posted, refused, failed };
  }
}

/** What `revenue:run-release --month YYYY-MM` did. */
export interface MonthRun {
  readonly companies: number;
  readonly posted: number;
  readonly refused: number;
}

/**
 * The server command `revenue:run-release --month YYYY-MM` (S06 "Acceptance"): one month's releases
 * in every company that is not archived, as the job posts them, once the month has ended (`today`
 * after its last day, in Damascus); a second run posts nothing.
 */
export async function runMonth(
  jobs: Database,
  db: Database,
  month: string,
  today: string,
): Promise<MonthRun> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError('Expected --month YYYY-MM');
  const found = await jobs.select({ id: companies.id }).from(companies);
  let posted = 0;
  let refused = 0;
  for (const { id } of found) {
    const result = await withCompany(db, id, async (tx) => {
      const [company] = await tx
        .select({ archivedAt: companies.archivedAt })
        .from(companies)
        .where(eq(companies.id, id))
        .for('share');
      if (!company || company.archivedAt) return { posted: 0, refused: [] };
      await mapAppendedTemplateSlots(tx, id, RECOGNITION_SLOTS, releaseActor);
      await appendPreOpeningResultAccount(tx, id, releaseActor);
      // A company waiting for its opening releases nothing (S10 rule 3).
      if (await awaitsOpening(tx)) return { posted: 0, refused: [] };
      return releaseMonth(tx, month, today, releaseActor);
    });
    posted += result.posted;
    refused += result.refused.length;
  }
  return { companies: found.length, posted, refused };
}
