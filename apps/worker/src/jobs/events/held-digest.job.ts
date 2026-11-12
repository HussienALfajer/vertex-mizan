import { Inject, Injectable, Logger } from '@nestjs/common';
import { type EmailData, emailDataSchemas, type HoldReason } from '@vertex-mizan/contracts';
import {
  companies,
  type Database,
  describeForLog,
  emailOutbox,
  inboundEventStates,
  memberships,
  readPeriods,
  type Transaction,
  uncleanReconciliationDays,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nowInDamascus, todayInDamascus } from '../../core/clock/today.js';
import type { Config } from '../../core/config/config.js';
import { CONFIG } from '../../core/config/config.module.js';
import { DATABASE, JOBS_DATABASE } from '../../core/database/database.module.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

/**
 * `events.held-digest` (S05 "Jobs"; owner, 2026-11-07): daily at 08:00 in Damascus (05:00 UTC),
 * one email per company and day to its owners and accountants, when any of its sections has content
 * (S08 rule 16): the events held in the last day and all held, by reason, with a link to the inbox;
 * (S07 "Jobs") the ended months not closed with their failing checklist items ("أشهر منتهية غير
 * مقفلة"); (S08) the days on or after a client's start date that are `missing` or `differences`, the
 * 31 latest, with a link to `/reconciliation`. Keyed by company, day and person in the outbox, whose
 * row stays once sent (`sent_at`) until the clean-up two days later, so a second run that day, the
 * job's retry included, queues nothing. The jobs role lists the companies; each company's sections
 * and people are read as the app role in its context.
 */
@Injectable()
export class EventsHeldDigestJob implements ScheduledJob {
  readonly queue = 'events.held-digest';
  readonly cron = '0 5 * * *';
  readonly queueOptions = { retryLimit: 3, retryDelay: 60, retryBackoff: true };
  private readonly logger = new Logger(EventsHeldDigestJob.name);

  constructor(
    @Inject(JOBS_DATABASE) private readonly jobs: Database,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async run(
    day = todayInDamascus(),
    now = day === todayInDamascus() ? nowInDamascus() : `${day}T08:00`,
  ): Promise<{ queued: number }> {
    const found = await this.jobs.select({ companyId: companies.id }).from(companies);
    let queued = 0;
    let failed = 0;
    for (const { companyId } of found) {
      try {
        queued += await withCompany(this.db, companyId, (tx) =>
          this.digest(tx, companyId, day, now),
        );
      } catch (error) {
        failed += 1;
        this.logger.error(`Held digest of company ${companyId} failed: ${describeForLog(error)}`);
      }
    }
    if (queued > 0) this.logger.log(`Held digest: ${queued} emails queued`);
    // The retry finds the companies done already keyed in the outbox, sent or not, and skips them.
    if (failed > 0) throw new Error(`The held digest failed in ${failed} companies`);
    return { queued };
  }

  private async digest(
    tx: Transaction,
    companyId: string,
    day: string,
    now: string,
  ): Promise<number> {
    const [company] = await tx
      .select({ name: companies.name, archivedAt: companies.archivedAt })
      .from(companies)
      .where(eq(companies.id, companyId));
    if (!company || company.archivedAt) return 0;
    const held = await tx
      .select({
        reason: inboundEventStates.holdReason,
        count: sql<number>`count(*)::int`,
        newly: sql<number>`(count(*) filter (where ${inboundEventStates.createdAt} > now() - interval '1 day'))::int`,
      })
      .from(inboundEventStates)
      .where(eq(inboundEventStates.state, 'held'))
      .groupBy(inboundEventStates.holdReason)
      .orderBy(asc(inboundEventStates.holdReason));
    // S07 "Jobs": each ended month not closed, with its count of failing checklist items.
    const unclosedMonths = (await readPeriods(tx, { today: day }))
      .filter((month) => month.ended && month.state !== 'closed')
      .map((month) => ({ period: month.period, failingItems: month.failingItems ?? 0 }));
    // S08 rule 16: the reconciliation's days not clean, the 31 latest.
    const reconciliation = await uncleanReconciliationDays(tx, { today: day, now, limit: 31 });
    if (held.length === 0 && unclosedMonths.length === 0 && reconciliation.length === 0) return 0;
    const people = await tx
      .select({ id: users.id, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.scopeCompanyId, companyId),
          inArray(memberships.role, ['owner', 'accountant']),
          isNull(memberships.archivedAt),
          isNull(users.archivedAt),
        ),
      );
    const data: EmailData<'held_digest'> = emailDataSchemas.held_digest.parse({
      companyName: company.name,
      day,
      newlyHeld: held.reduce((total, row) => total + row.newly, 0),
      held: held.map((row) => ({ reason: row.reason as HoldReason, count: row.count })),
      unclosedMonths,
      reconciliation,
      link: `${this.config.appUrl}/inbox`,
      ...(reconciliation.length > 0 && {
        reconciliationLink: `${this.config.appUrl}/reconciliation`,
      }),
    });
    if (people.length === 0) return 0;
    const inserted = await tx
      .insert(emailOutbox)
      .values(
        people.map((person) => ({
          kind: 'held_digest',
          recipient: person.email,
          data,
          dedupeKey: `held_digest:${companyId}:${day}:${person.id}`,
        })),
      )
      .onConflictDoNothing({ target: emailOutbox.dedupeKey })
      .returning({ id: emailOutbox.id });
    return inserted.length;
  }
}
