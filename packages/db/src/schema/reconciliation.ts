import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, createdAt, id, idIsUuidV7, timestamptz } from './columns.js';
import { companies } from './companies.js';

// The reconciliation module (S08 "Data", ADR 0017): every daily report Hub sent, as received, and
// the events it lists, both append-only. A date's latest report counts (rule 5); the comparison is
// computed on read from these and the inbox, never stored, but for the answer Hub got.

/** `HUB_DELIVERY_STATES` of contracts (a test keeps them equal). */
export const REPORT_DELIVERY_STATES = ['pending', 'delivered', 'refused'] as const;

/** The answer a report got at receipt (`reconciliationResultSchema.status`). */
export const REPORT_RECEIPT_STATUSES = ['matched', 'differences'] as const;

/** Hub's currencies (`HUB_CURRENCIES`), the only ones a report's amounts are in. */
export const REPORT_CURRENCIES = ['SYP', 'USD'] as const;

const listOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * A daily report as Hub sent it (S08 rules 1, 4, 5): the accounting date it covers, when Hub built
 * it, its payload as received with the SHA-256 of its canonical form (RFC 8785), how many events
 * it lists, and the comparison's answer at receipt. Hub's report id is the idempotency key.
 */
export const reconciliationReports = pgTable(
  'reconciliation_reports',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    /** The API client that sent it: a platform id, kept without a key (as `inbound_events`). */
    apiClientId: uuid().notNull(),
    /** Hub's report id, the idempotency key. */
    reportId: uuid().notNull(),
    reportDate: date().notNull(),
    generatedAt: timestamptz().notNull(),
    payload: jsonb().notNull(),
    payloadHash: text().notNull(),
    eventCount: integer().notNull(),
    receivedAt: timestamptz().notNull().defaultNow(),
    requestId: text().notNull(),
    statusAtReceipt: text().notNull(),
    gapsAtReceipt: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('reconciliation_reports', t.id),
    unique('reconciliation_reports_company_id_id_key').on(t.companyId, t.id),
    unique('reconciliation_reports_report_key').on(t.companyId, t.apiClientId, t.reportId),
    index('reconciliation_reports_latest_idx').on(
      t.companyId,
      t.apiClientId,
      t.reportDate,
      t.generatedAt.desc(),
      t.receivedAt.desc(),
    ),
    check('reconciliation_reports_payload_hash', sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check('reconciliation_reports_payload', sql`jsonb_typeof(${t.payload}) = 'object'`),
    check('reconciliation_reports_event_count', sql`${t.eventCount} between 0 and 5000`),
    check('reconciliation_reports_request_id', sql`char_length(${t.requestId}) between 1 and 200`),
    check(
      'reconciliation_reports_status_at_receipt',
      sql`${t.statusAtReceipt} in (${listOf(REPORT_RECEIPT_STATUSES)})`,
    ),
    check(
      'reconciliation_reports_gaps_at_receipt',
      sql`${t.gapsAtReceipt} >= 0
        and (${t.statusAtReceipt} = 'matched') = (${t.gapsAtReceipt} = 0)`,
    ),
  ],
);

/**
 * One event of a report (S08 rule 1): Hub's event id, its type, its amount by rule 2 (none for a
 * type counted only) and Hub's delivery state, with the code of a refusal.
 */
export const reconciliationReportEvents = pgTable(
  'reconciliation_report_events',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    reportId: uuid().notNull(),
    /** Hub's event id. */
    eventId: uuid().notNull(),
    type: text().notNull(),
    currency: text(),
    amountMinor: bigint({ mode: 'bigint' }),
    delivery: text().notNull(),
    refusalCode: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('reconciliation_report_events', t.id),
    foreignKey({
      name: 'reconciliation_report_events_report_fk',
      columns: [t.companyId, t.reportId],
      foreignColumns: [reconciliationReports.companyId, reconciliationReports.id],
    }),
    unique('reconciliation_report_events_event_key').on(t.companyId, t.reportId, t.eventId),
    index('reconciliation_report_events_company_event_idx').on(t.companyId, t.eventId),
    check('reconciliation_report_events_type', sql`${t.type} ~ '^[a-z][a-z_]*\\.[a-z][a-z_]*$'`),
    check(
      'reconciliation_report_events_amount',
      sql`(${t.currency} is null) = (${t.amountMinor} is null)
        and (${t.currency} is null or ${t.currency} in (${listOf(REPORT_CURRENCIES)}))`,
    ),
    check(
      'reconciliation_report_events_delivery',
      sql`${t.delivery} in (${listOf(REPORT_DELIVERY_STATES)})
        and (${t.refusalCode} is null or (${t.delivery} = 'refused'
          and ${t.refusalCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'))`,
    ),
  ],
);
