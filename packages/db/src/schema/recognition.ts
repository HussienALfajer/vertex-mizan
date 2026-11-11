import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { chartAccounts } from './chart.js';
import { companyId, createdAt, id, idIsUuidV7 } from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES } from './companies.js';
import { dimensionValues } from './dimensions.js';
import { inboundEvents } from './inbox.js';
import { journalEntries } from './ledger.js';

// The recognition module (S06, ADR 0015): one schedule per deferred invoice line and its movements,
// both append-only company tables under forced RLS. They are written only in the posting
// transaction, beside the entries `post()` writes, and describe those entries: a schedule's
// remaining (what is still in contract liabilities for it) is the sum of its movements in each
// ledger. The guards of the S06 migration hold every rule for every role, pinned in `GUARDS`.

/** A schedule's pattern (S06 rule 1). */
export const RECOGNITION_PATTERNS = ['over_time', 'point_in_time'] as const;

/** Hub's invoice line sources (`INVOICE_LINE_SOURCES` of contracts; a test keeps them equal). */
export const RECOGNITION_LINE_SOURCES = [
  'retainer_charge',
  'deposit',
  'milestone',
  'extra_work',
  'manual',
] as const;

/** A movement's kind (S06 "Data"); signed: positive adds to what is still to recognise. */
export const RECOGNITION_MOVEMENT_KINDS = [
  'deferred',
  'elapsed',
  'released',
  'credited',
  'reclassified',
  'reversed',
  'remainder_released',
  'remainder_refunded',
] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * A deferred invoice line's schedule (S06 "Data"): the `invoice.issued` event that created it, Hub's
 * invoice and line, its pattern with its service period or milestone, the retainer cycle it
 * belongs to, its dimensions at issue (a later service is a `reclassified` movement), and the
 * contract liability account it was deferred to, which its releases debit even if the slot is
 * remapped later.
 */
export const recognitionSchedules = pgTable(
  'recognition_schedules',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    eventId: uuid().notNull(),
    invoiceDocumentId: uuid().notNull(),
    invoiceNumber: text().notNull(),
    lineId: uuid().notNull(),
    pattern: text().notNull(),
    lineSource: text().notNull(),
    chargeKind: text(),
    serviceFrom: date(),
    serviceTo: date(),
    milestoneId: uuid(),
    cycleKey: text(),
    reissueOfScheduleId: uuid(),
    clientValueId: uuid().notNull(),
    contractValueId: uuid(),
    serviceValueId: uuid().notNull(),
    liabilityAccountId: uuid().notNull(),
    currency: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('recognition_schedules', t.id),
    unique('recognition_schedules_company_id_id_key').on(t.companyId, t.id),
    unique('recognition_schedules_line_key').on(t.companyId, t.eventId, t.lineId),
    foreignKey({
      name: 'recognition_schedules_event_fk',
      columns: [t.companyId, t.eventId],
      foreignColumns: [inboundEvents.companyId, inboundEvents.id],
    }),
    foreignKey({
      name: 'recognition_schedules_reissue_fk',
      columns: [t.companyId, t.reissueOfScheduleId],
      foreignColumns: [t.companyId, t.id],
    }),
    foreignKey({
      name: 'recognition_schedules_client_fk',
      columns: [t.companyId, t.clientValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    foreignKey({
      name: 'recognition_schedules_contract_fk',
      columns: [t.companyId, t.contractValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    foreignKey({
      name: 'recognition_schedules_service_fk',
      columns: [t.companyId, t.serviceValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    foreignKey({
      name: 'recognition_schedules_liability_fk',
      columns: [t.companyId, t.liabilityAccountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    index('recognition_schedules_company_cycle_idx').on(t.companyId, t.cycleKey),
    index('recognition_schedules_company_milestone_idx').on(t.companyId, t.milestoneId),
    index('recognition_schedules_company_contract_idx').on(t.companyId, t.contractValueId),
    index('recognition_schedules_company_invoice_idx').on(t.companyId, t.invoiceDocumentId),
    index('recognition_schedules_company_reissue_idx').on(t.companyId, t.reissueOfScheduleId),
    index('recognition_schedules_company_client_idx').on(t.companyId, t.clientValueId),
    index('recognition_schedules_company_service_idx').on(t.companyId, t.serviceValueId),
    index('recognition_schedules_company_liability_idx').on(t.companyId, t.liabilityAccountId),
    check('recognition_schedules_pattern', sql`${t.pattern} in (${listed(RECOGNITION_PATTERNS)})`),
    check(
      'recognition_schedules_line_source',
      sql`${t.lineSource} in (${listed(RECOGNITION_LINE_SOURCES)})`,
    ),
    check(
      'recognition_schedules_charge_kind',
      sql`(${t.lineSource} = 'retainer_charge') = (${t.chargeKind} is not null)
        and (${t.chargeKind} is null or ${t.chargeKind} in ('monthly', 'addition'))`,
    ),
    // The pattern's fields: a service period over time, a milestone at a point in time.
    check(
      'recognition_schedules_pattern_fields',
      sql`(${t.pattern} = 'over_time'
          and ${t.serviceFrom} is not null and ${t.serviceTo} is not null
          and ${t.serviceTo} >= ${t.serviceFrom} and ${t.milestoneId} is null
          and ${t.lineSource} in ('retainer_charge', 'manual'))
        or (${t.pattern} = 'point_in_time'
          and ${t.serviceFrom} is null and ${t.serviceTo} is null and ${t.milestoneId} is not null
          and ${t.lineSource} in ('deposit', 'milestone'))`,
    ),
    check(
      'recognition_schedules_cycle_key',
      sql`${t.cycleKey} is null
        or (${t.lineSource} = 'retainer_charge' and char_length(${t.cycleKey}) between 1 and 200)`,
    ),
    check(
      'recognition_schedules_invoice_number',
      sql`char_length(${t.invoiceNumber}) between 1 and 100`,
    ),
    check(
      'recognition_schedules_currency',
      sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`,
    ),
    check('recognition_schedules_not_self_reissue', sql`${t.reissueOfScheduleId} <> ${t.id}`),
  ],
);

/**
 * A movement of a schedule (S06 "Data"): what its entry did to what is still to recognise, in the
 * transaction, book and parallel amounts, signed (positive adds, negative takes). A month releases
 * once; a reclassification carries the service the later releases take.
 */
export const recognitionMovements = pgTable(
  'recognition_movements',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    scheduleId: uuid().notNull(),
    kind: text().notNull(),
    /** The month's first day, for a month's part (a release, an elapsed month); else null. */
    month: date(),
    /** The entry it describes; none for a service change before anything was recognised. */
    entryId: uuid(),
    transactionMinor: bigint({ mode: 'bigint' }).notNull(),
    bookMinor: bigint({ mode: 'bigint' }).notNull(),
    parallelMinor: bigint({ mode: 'bigint' }),
    serviceValueId: uuid(),
    /**
     * A credit's part of the schedule's transaction amount, its revenue and liability parts
     * together (S06 rule 6): positive on a credit, negative on its void. The schedule's amount net
     * of credits is its line's amount less their sum; only on a `credited` movement.
     */
    creditMinor: bigint({ mode: 'bigint' }),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('recognition_movements', t.id),
    foreignKey({
      name: 'recognition_movements_schedule_fk',
      columns: [t.companyId, t.scheduleId],
      foreignColumns: [recognitionSchedules.companyId, recognitionSchedules.id],
    }),
    foreignKey({
      name: 'recognition_movements_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'recognition_movements_service_fk',
      columns: [t.companyId, t.serviceValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    // A month releases once (S06 rule 4; invariant 5).
    uniqueIndex('recognition_movements_released_month_key')
      .on(t.companyId, t.scheduleId, t.month)
      .where(sql`${t.kind} = 'released' and ${t.month} is not null`),
    index('recognition_movements_company_schedule_idx').on(t.companyId, t.scheduleId, t.createdAt),
    index('recognition_movements_company_entry_idx').on(t.companyId, t.entryId),
    index('recognition_movements_company_service_idx').on(t.companyId, t.serviceValueId),
    check('recognition_movements_kind', sql`${t.kind} in (${listed(RECOGNITION_MOVEMENT_KINDS)})`),
    check(
      'recognition_movements_month',
      sql`(${t.month} is null or extract(day from ${t.month}) = 1)
        and (${t.kind} not in ('elapsed') or ${t.month} is not null)`,
    ),
    check(
      'recognition_movements_entry',
      sql`${t.entryId} is not null
        or (${t.kind} = 'reclassified' and ${t.transactionMinor} = 0 and ${t.bookMinor} = 0
          and coalesce(${t.parallelMinor}, 0) = 0)`,
    ),
    check(
      'recognition_movements_service',
      sql`(${t.kind} = 'reclassified') = (${t.serviceValueId} is not null)`,
    ),
    check(
      'recognition_movements_credit',
      sql`(${t.kind} = 'credited') = (${t.creditMinor} is not null)
        and (${t.creditMinor} is null or ${t.creditMinor} <> 0)`,
    ),
  ],
);
