import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, idIsUuidV7, timestamptz, updatedAt } from './columns.js';

// The email module (S01; owner decision 2026-10-26): the outbox. The API writes an email in the
// transaction of the change that sends it (an invitation, a password reset, a two-factor reset
// notice), so the email exists exactly when the change does. The worker's `email.send` job sends
// each row through the server's SMTP account and deletes it, with the link token it carries
// (ephemeral). pg-boss cannot take the row: its schema belongs to the queue role, which the app
// role never reaches (ADR 0003).

/** The emails Mizan sends; `EMAIL_KINDS` in `@vertex-mizan/contracts` (a test keeps them equal). */
export const OUTBOX_EMAIL_KINDS = [
  'invitation',
  'password_reset',
  'two_factor_reset',
  // S03: the daily anchor and the full export.
  'daily_anchor',
  'export_ready',
] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * An email waiting to be sent. `data` is the template's input (`emailDataSchemas` in contracts),
 * with the link token until the row is sent and deleted; a failed send stays with its attempt
 * count and the error's code, and is tried again after `send_after`.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: id(),
    kind: text().notNull(),
    recipient: text().notNull(),
    data: jsonb().notNull(),
    attempts: integer().notNull().default(0),
    sendAfter: timestamptz().notNull().defaultNow(),
    /** The code of the last failure (an SMTP or network code), never its message. */
    lastErrorCode: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('email_outbox', t.id),
    index('email_outbox_send_after_idx').on(t.sendAfter),
    check('email_outbox_kind', sql`${t.kind} in (${listed(OUTBOX_EMAIL_KINDS)})`),
    check(
      'email_outbox_recipient_shape',
      sql`${t.recipient} = lower(${t.recipient}) and char_length(${t.recipient}) <= 254`,
    ),
    check('email_outbox_attempts_not_negative', sql`${t.attempts} >= 0`),
    check(
      'email_outbox_last_error_code_length',
      sql`${t.lastErrorCode} is null or char_length(${t.lastErrorCode}) between 1 and 100`,
    ),
  ],
);
