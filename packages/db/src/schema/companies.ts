import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './access.js';
import {
  archivedAt,
  companyId,
  createdAt,
  id,
  idIsUuidV7,
  timestamptz,
  updatedAt,
} from './columns.js';

// The companies module (S01): the companies themselves (a platform table: the tenant list) and
// each company's ledger settings (a company table under forced RLS).

/**
 * The currency codes and rate types of the money module (`CURRENCY_CODES`, `RATE_TYPES` in
 * `@vertex-mizan/contracts`), which the settings checks accept; a test keeps them equal. A new
 * currency extends the check in a migration of its own.
 */
export const SETTINGS_CURRENCY_CODES = ['USD', 'SYP', 'TRY', 'EUR'] as const;
export const SETTINGS_RATE_TYPES = ['market', 'bulletin'] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/** A company: archived with a reason, never deleted (ADR 0005 retention). */
export const companies = pgTable(
  'companies',
  {
    id: id(),
    name: text().notNull(),
    nameLatin: text(),
    /** `pool` in phase 1; `silo` is ADR 0003's dedicated-database option. */
    dataLocation: text().notNull().default('pool'),
    /** Null for a company the server command `admin:create-company` made (S01 rule 9). */
    createdByUserId: uuid().references(() => users.id),
    archivedReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('companies', t.id),
    index('companies_created_by_user_id_idx').on(t.createdByUserId),
    check('companies_name_length', sql`char_length(${t.name}) between 1 and 200`),
    check(
      'companies_name_latin_length',
      sql`${t.nameLatin} is null or char_length(${t.nameLatin}) between 1 and 200`,
    ),
    check('companies_data_location', sql`${t.dataLocation} in ('pool', 'silo')`),
    check(
      'companies_archived_with_reason',
      sql`(${t.archivedAt} is null) = (${t.archivedReason} is null)
        and (${t.archivedReason} is null or char_length(${t.archivedReason}) between 1 and 1000)`,
    ),
  ],
);

/**
 * A company's ledgers (ADR 0007): the book currency with its rate policy, the optional parallel
 * currency with its own, the fiscal year start and the IAS 21 policy note. Read as
 * `companyLedgersSchema`. Once `books_started_at` is set (the first posted entry, S03) a trigger
 * refuses any change to the currencies, policies, fiscal year or that timestamp (S01 rule 11).
 */
export const companySettings = pgTable(
  'company_settings',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    bookCurrency: text().notNull(),
    bookRateType: text().notNull(),
    bookAcceptsTransactionRate: boolean().notNull(),
    parallelCurrency: text(),
    parallelRateType: text(),
    parallelAcceptsTransactionRate: boolean(),
    fiscalYearStartMonth: smallint().notNull().default(1),
    policyNote: text().notNull(),
    booksStartedAt: timestamptz(),
    /**
     * The ISO weekdays the bulletin is not published (S02 rule 16): Friday and Saturday by
     * default, UNVERIFIED as the Central Bank's days, so a setting. Not part of the settings lock:
     * it decides which bulletin a future posting needs, never a posted amount.
     */
    bulletinDaysOff: smallint().array().notNull().default(sql`'{5,6}'`),
    /**
     * Manual entries and their reversals are submitted and approved before they post (S03 rule
     * 8). Not part of the settings lock: it decides how a posting is made, never a posted amount.
     */
    manualEntryApproval: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('company_settings', t.id),
    unique('company_settings_company_id_key').on(t.companyId),
    unique('company_settings_company_id_id_key').on(t.companyId, t.id),
    check(
      'company_settings_currencies',
      sql`${t.bookCurrency} in (${listed(SETTINGS_CURRENCY_CODES)})
        and (${t.parallelCurrency} is null or ${t.parallelCurrency} in (${listed(SETTINGS_CURRENCY_CODES)}))`,
    ),
    check(
      'company_settings_rate_types',
      sql`${t.bookRateType} in (${listed(SETTINGS_RATE_TYPES)})
        and (${t.parallelRateType} is null or ${t.parallelRateType} in (${listed(SETTINGS_RATE_TYPES)}))`,
    ),
    check(
      'company_settings_parallel_complete',
      sql`(${t.parallelCurrency} is null) = (${t.parallelRateType} is null)
        and (${t.parallelCurrency} is null) = (${t.parallelAcceptsTransactionRate} is null)`,
    ),
    check(
      'company_settings_parallel_differs',
      sql`${t.parallelCurrency} is null or ${t.parallelCurrency} <> ${t.bookCurrency}`,
    ),
    check(
      'company_settings_transaction_rate_market_only',
      sql`(not ${t.bookAcceptsTransactionRate} or ${t.bookRateType} = 'market')
        and (${t.parallelAcceptsTransactionRate} is not true or ${t.parallelRateType} = 'market')`,
    ),
    check(
      'company_settings_fiscal_year_start_month',
      sql`${t.fiscalYearStartMonth} between 1 and 12`,
    ),
    // Weekdays 1–7; six at most, so one weekday at least is a publication day.
    check(
      'company_settings_bulletin_days_off',
      sql`${t.bulletinDaysOff} <@ '{1,2,3,4,5,6,7}'::smallint[]
        and cardinality(${t.bulletinDaysOff}) <= 6
        and array_position(${t.bulletinDaysOff}, null) is null`,
    ),
    check(
      'company_settings_policy_note_length',
      sql`char_length(${t.policyNote}) between 1 and 4000`,
    ),
  ],
);
