import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  auditEntries,
  type Database,
  invitations,
  rateLimits,
  sessions,
  verifications,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';

const pending = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

/** A session idle this long has ended (S01 rule 5); the API deletes it on its next request. */
const IDLE_MINUTES = 30;

/** The longest rate-limit window (the password reset's hour, `apps/api` `LIMITS`). */
const LONGEST_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * The daily clean-up (S01 "Jobs and events"): deletes the ephemeral rows that ended — expired or
 * idle sessions, expired one-time tokens, rate-limit rows older than the longest window — and
 * marks invitations past their 7 days as revoked, each with a row in its company's audit log, so
 * the email can be invited again. A second run finds nothing more to delete or mark.
 */
@Injectable()
export class CleanUpJob implements ScheduledJob {
  readonly queue = 'system.clean-up';
  /** 02:00 UTC, 05:00 in Damascus. */
  readonly cron = '0 2 * * *';
  private readonly logger = new Logger(CleanUpJob.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async run(): Promise<{ deleted: number; invitations: number }> {
    const ended = await this.db
      .delete(sessions)
      .where(
        or(
          lte(sessions.expiresAt, sql`now()`),
          lte(sessions.lastActiveAt, sql`now() - make_interval(mins => ${IDLE_MINUTES})`),
        ),
      )
      .returning({ id: sessions.id });
    const used = await this.db
      .delete(verifications)
      .where(lte(verifications.expiresAt, sql`now()`))
      .returning({ id: verifications.id });
    const counters = await this.db
      .delete(rateLimits)
      .where(lt(rateLimits.lastRequest, Date.now() - LONGEST_LIMIT_WINDOW_MS))
      .returning({ id: rateLimits.id });

    // Per company, the marks and their audit rows in one transaction (ADR 0005 invariant 10).
    const companies = await this.db
      .selectDistinct({ id: invitations.scopeCompanyId })
      .from(invitations)
      .where(and(pending, lte(invitations.expiresAt, sql`now()`)));
    let marked = 0;
    for (const company of companies) {
      marked += await withCompany(this.db, company.id, async (tx) => {
        const expired = await tx
          .update(invitations)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(invitations.scopeCompanyId, company.id),
              pending,
              lte(invitations.expiresAt, sql`now()`),
            ),
          )
          .returning({ id: invitations.id, expiresAt: invitations.expiresAt });
        if (expired.length > 0) {
          await tx.insert(auditEntries).values(
            expired.map((invitation) => ({
              companyId: company.id,
              actorKind: 'system',
              actorName: 'Vertex',
              requestId: `job-${this.queue}`,
              action: 'invitation.revoked',
              entityType: 'invitation',
              entityId: invitation.id,
              before: { expiresAt: invitation.expiresAt.toISOString() },
            })),
          );
        }
        return expired.length;
      });
    }
    const deleted = ended.length + used.length + counters.length;
    this.logger.log(`Clean-up: ${deleted} ended rows deleted, ${marked} invitations expired`);
    return { deleted, invitations: marked };
  }
}
