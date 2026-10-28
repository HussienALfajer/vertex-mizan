import { Inject, Injectable, Logger } from '@nestjs/common';
import { type EmailData, emailDataSchemas } from '@vertex-mizan/contracts';
import { chainAnchors, type Database } from '@vertex-mizan/db';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { dayBefore, todayInDamascus } from '../../core/clock/today.js';
import { JOBS_DATABASE } from '../../core/database/database.module.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

/** What one run did. */
export interface AnchorRun {
  anchoredOn: string;
  anchors: number;
  emails: number;
}

/**
 * The daily anchor (S03 rule 20, "Jobs and events"): for every company with at least one entry
 * posted before the end of the previous day in Damascus, the chain head as at that moment (the
 * count, the last entry and its hash) is stored in `chain_anchors`, and each owner gets one email
 * listing the anchors of all their companies, every day, changed or not. As the jobs role, in one
 * transaction: the anchors and the emails commit together, and the day's unique key makes a second
 * run, or one racing it, write nothing.
 */
@Injectable()
export class DailyAnchorJob implements ScheduledJob {
  readonly queue = 'ledger.daily-anchor';
  /** 00:30 in Damascus (UTC+3 all year): 21:30 UTC the evening before. */
  readonly cron = '30 21 * * *';
  /** Three retries with backoff; a day that still fails is logged, and the next day sends its own. */
  readonly queueOptions = { retryLimit: 3, retryDelay: 60, retryBackoff: true };
  private readonly logger = new Logger(DailyAnchorJob.name);

  constructor(@Inject(JOBS_DATABASE) private readonly jobs: Database) {}

  async run(): Promise<AnchorRun> {
    return this.anchor(dayBefore(todayInDamascus()));
  }

  /** Anchors every company's chain at the end of `day` (`YYYY-MM-DD`, Damascus) not yet anchored. */
  async anchor(day: string): Promise<AnchorRun> {
    const result = await this.jobs.transaction(async (tx) => {
      // One run at a time: a second waits, then finds the day anchored.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${this.queue}))`);
      const heads = (
        await tx.execute<{ company_id: string; id: string; sequence: string; hash: string }>(sql`
          select distinct on (e.company_id) e.company_id, e.id, e.sequence::text, e.hash
          from journal_entries e
          where e.posted_at < (${day}::date + 1)::timestamp at time zone 'Asia/Damascus'
            and not exists (
              select 1 from chain_anchors a
              where a.company_id = e.company_id and a.anchored_on = ${day}::date)
          order by e.company_id, e.sequence desc`)
      ).rows;
      if (heads.length === 0) return { anchors: 0, emails: 0 };
      const owners = (
        await tx.execute<{ company_id: string; user_id: string; email: string; name: string }>(sql`
          select m.scope_company_id as company_id, u.id as user_id, u.email, c.name
          from memberships m
          join users u on u.id = m.user_id
          join companies c on c.id = m.scope_company_id
          where m.role = 'owner' and m.archived_at is null and u.archived_at is null
            and m.scope_company_id in (${sql.join(
              heads.map((head) => sql`${head.company_id}::uuid`),
              sql`, `,
            )})
          order by c.name, c.id`)
      ).rows;
      const headOf = new Map(heads.map((head) => [head.company_id, head]));
      const emails = new Map<
        string,
        { id: string; email: string; data: EmailData<'daily_anchor'> }
      >();
      const emailsOf = new Map<string, string[]>();
      for (const owner of owners) {
        const head = headOf.get(owner.company_id);
        if (!head) continue;
        const email = emails.get(owner.user_id) ?? {
          id: uuidv7(),
          email: owner.email,
          data: { anchoredOn: day, anchors: [] },
        };
        email.data.anchors.push({
          companyName: owner.name,
          entryCount: Number(head.sequence),
          headHash: head.hash,
        });
        emails.set(owner.user_id, email);
        emailsOf.set(owner.company_id, [...(emailsOf.get(owner.company_id) ?? []), email.id]);
      }
      await tx.insert(chainAnchors).values(
        heads.map((head) => ({
          companyId: head.company_id,
          anchoredOn: day,
          entryCount: BigInt(head.sequence),
          headEntryId: head.id,
          headHash: head.hash,
          emailOutboxIds: emailsOf.get(head.company_id) ?? [],
        })),
      );
      // The jobs role may write these four columns only; the others take their defaults.
      for (const email of emails.values()) {
        const data = emailDataSchemas.daily_anchor.parse(email.data);
        await tx.execute(sql`
          insert into email_outbox (id, kind, recipient, data)
          values (${email.id}, 'daily_anchor', ${email.email.toLowerCase()}, ${JSON.stringify(data)}::jsonb)`);
      }
      return { anchors: heads.length, emails: emails.size };
    });
    this.logger.log(
      `Daily anchor of ${day}: ${result.anchors} companies anchored, ${result.emails} emails queued`,
    );
    return { anchoredOn: day, ...result };
  }
}
