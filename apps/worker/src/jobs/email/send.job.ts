import { Inject, Injectable, Logger } from '@nestjs/common';
import { type EmailKind, emailKindSchema } from '@vertex-mizan/contracts';
import { type Database, emailOutbox } from '@vertex-mizan/db';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../core/email/email.module.js';
import type { ScheduledJob } from '../../core/queue/scheduled-job.js';
import { renderEmail } from './templates.js';

/** Emails claimed per run. */
const BATCH = 50;

/** A claimed email is left alone this long, so a concurrent run does not send it too. */
const LEASE_MINUTES = 5;

/** After a failure the next try waits 2, 4, 8 … minutes, at most an hour. */
export function retryDelayMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 60);
}

interface Claimed {
  id: string;
  kind: EmailKind;
  recipient: string;
  data: unknown;
  attempts: number;
}

/** The code of a failed send (an SMTP or network code), never its message, which can quote data. */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown; responseCode?: unknown } | null)?.code;
  const value = typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
  return (value ?? (error instanceof Error ? error.name : 'UNKNOWN')).slice(0, 100);
}

/**
 * Sends the email outbox (S01 "Jobs and events"; owner decision 2026-10-26): every minute it claims
 * the emails due, sends each through SMTP and deletes it with its link token; a failure stays with
 * its code and is tried again later. Two runs at once claim different rows (`SKIP LOCKED` and a
 * lease); a crash between sending and deleting sends that email again, which is harmless: the link
 * inside is the same token. pg-boss keeps its finished runs one day.
 */
@Injectable()
export class EmailSendJob implements ScheduledJob {
  readonly queue = 'email.send';
  readonly cron = '* * * * *';
  readonly queueOptions = { deleteAfterSeconds: 24 * 60 * 60 };
  private readonly logger = new Logger(EmailSendJob.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
  ) {}

  async run(): Promise<{ sent: number; failed: number }> {
    const claimed = await this.db.execute<Claimed & Record<string, unknown>>(sql`
      update email_outbox
      set send_after = now() + make_interval(mins => ${LEASE_MINUTES}),
          attempts = attempts + 1,
          updated_at = now()
      where id in (
        select id from email_outbox
        where send_after <= now()
        order by send_after, id
        limit ${BATCH}
        for update skip locked
      )
      returning id, kind, recipient, data, attempts`);
    let sent = 0;
    let failed = 0;
    for (const email of claimed.rows) {
      try {
        await this.transport.send(
          renderEmail(emailKindSchema.parse(email.kind), email.data, email.recipient),
        );
        await this.db.delete(emailOutbox).where(eq(emailOutbox.id, email.id));
        sent++;
      } catch (error) {
        failed++;
        // Only the code: a mail server's message can quote the recipient.
        this.logger.warn(`Email ${email.id} not sent: ${codeOf(error)}`);
        await this.db
          .update(emailOutbox)
          .set({
            lastErrorCode: codeOf(error),
            sendAfter: sql`now() + make_interval(mins => ${retryDelayMinutes(email.attempts)})`,
          })
          .where(eq(emailOutbox.id, email.id));
      }
    }
    return { sent, failed };
  }
}
