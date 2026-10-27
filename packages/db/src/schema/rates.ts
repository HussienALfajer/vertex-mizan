import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { archivedAt, companyId, createdAt, id, idIsUuidV7, updatedAt } from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES, SETTINGS_RATE_TYPES } from './companies.js';

// The rates module (S02 rules 14–18, ADR 0007, ADR 0011): the rate pairs with one orientation
// each, the append-only rate table and the bulletin holidays, company tables under forced RLS. The
// weekly days off are `company_settings.bulletin_days_off`.

/** `RATE_SOURCES` of `@vertex-mizan/contracts`; a test keeps them equal. */
export const RATE_ROW_SOURCES = ['hub', 'manual', 'import'] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * Two currencies in the one orientation their rates use: the first rate of two currencies makes
 * the pair; the reverse orientation is refused by the second unique index (`RATE_ORIENTATION`).
 */
export const ratePairs = pgTable(
  'rate_pairs',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    base: text().notNull(),
    quote: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('rate_pairs', t.id),
    unique('rate_pairs_company_base_quote_key').on(t.companyId, t.base, t.quote),
    uniqueIndex('rate_pairs_company_currencies_key').on(
      t.companyId,
      sql`least(${t.base}, ${t.quote})`,
      sql`greatest(${t.base}, ${t.quote})`,
    ),
    check('rate_pairs_two_currencies', sql`${t.base} <> ${t.quote}`),
    check(
      'rate_pairs_currencies',
      sql`${t.base} in (${listed(SETTINGS_CURRENCY_CODES)}) and ${t.quote} in (${listed(SETTINGS_CURRENCY_CODES)})`,
    ),
  ],
);

/**
 * A rate row (ADR 0007): `rate` units of `quote` per one `base` from `effective_on`, as quoted,
 * never inverted. Append-only: a correction is a newer row with a reason that supersedes the row
 * of the same pair, type and date (S02 rule 15). The recorder is a platform id kept without a
 * foreign key, like the audit log's actor.
 */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    effectiveOn: date().notNull(),
    base: text().notNull(),
    quote: text().notNull(),
    rate: numeric({ precision: 22, scale: 10 }).notNull(),
    type: text().notNull(),
    source: text().notNull(),
    supersedesRateId: uuid(),
    reason: text(),
    recordedByUserId: uuid(),
    recordedByApiClientId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('exchange_rates', t.id),
    unique('exchange_rates_company_id_id_key').on(t.companyId, t.id),
    foreignKey({
      name: 'exchange_rates_pair_fk',
      columns: [t.companyId, t.base, t.quote],
      foreignColumns: [ratePairs.companyId, ratePairs.base, ratePairs.quote],
    }),
    foreignKey({
      name: 'exchange_rates_supersedes_fk',
      columns: [t.companyId, t.supersedesRateId],
      foreignColumns: [t.companyId, t.id],
    }),
    // The rate in force reads one row per lookup (S02 "Volume and performance").
    index('exchange_rates_lookup_idx').on(
      t.companyId,
      t.type,
      t.base,
      t.quote,
      t.effectiveOn,
      t.createdAt,
    ),
    index('exchange_rates_company_pair_idx').on(t.companyId, t.base, t.quote, t.effectiveOn),
    // A row is superseded once, so the corrections of a date form one chain (S02 rule 15).
    uniqueIndex('exchange_rates_supersedes_key').on(t.companyId, t.supersedesRateId),
    // One original row per pair, type and date; every later row of that date is a correction.
    uniqueIndex('exchange_rates_original_key')
      .on(t.companyId, t.base, t.quote, t.type, t.effectiveOn)
      .where(sql`${t.supersedesRateId} is null`),
    check('exchange_rates_rate_positive', sql`${t.rate} > 0`),
    check('exchange_rates_type', sql`${t.type} in (${listed(SETTINGS_RATE_TYPES)})`),
    check('exchange_rates_source', sql`${t.source} in (${listed(RATE_ROW_SOURCES)})`),
    check(
      'exchange_rates_correction_reason',
      sql`(${t.supersedesRateId} is null) = (${t.reason} is null)
        and (${t.reason} is null or char_length(${t.reason}) between 1 and 500)`,
    ),
    check(
      'exchange_rates_one_recorder',
      sql`(${t.recordedByUserId} is null) <> (${t.recordedByApiClientId} is null)`,
    ),
    check(
      'exchange_rates_syp_redenominated',
      sql`'SYP' not in (${t.base}, ${t.quote}) or ${t.effectiveOn} >= date '2026-01-01'`,
    ),
  ],
);

/** A day the bulletin is not published besides the weekly days off (S02 rule 17). */
export const bulletinHolidays = pgTable(
  'bulletin_holidays',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    holidayOn: date().notNull(),
    note: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('bulletin_holidays', t.id),
    uniqueIndex('bulletin_holidays_active_key')
      .on(t.companyId, t.holidayOn)
      .where(sql`${t.archivedAt} is null`),
    index('bulletin_holidays_company_on_idx').on(t.companyId, t.holidayOn),
    check('bulletin_holidays_note_length', sql`char_length(${t.note}) between 1 and 200`),
  ],
);
