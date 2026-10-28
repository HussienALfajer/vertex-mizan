import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { chartAccounts } from './chart.js';
import { companyId, createdAt, id, idIsUuidV7, timestamptz, updatedAt } from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES, SETTINGS_RATE_TYPES } from './companies.js';
import { dimensionValues } from './dimensions.js';
import { exchangeRates, RATE_ROW_SOURCES } from './rates.js';

// The ledger module (S03, ADR 0005, ADR 0008, ADR 0012): the append-only ledger (posting requests,
// entries, lines, their conversions and dimension sets) and the ledger state the posting function
// keeps beside it (the ledger head, the entry-number counters, the periods and the period
// balances), company tables under forced RLS. `post()` in `src/posting/` is their only writer; the
// guards of the S03 migration hold every rule for every role, pinned in `GUARDS`.

/** `ENTRY_SOURCES` of `@vertex-mizan/ledger`; a test keeps them equal. */
export const JOURNAL_ENTRY_SOURCES = [
  'manual',
  'hub_event',
  'opening',
  'revaluation',
  'revenue_release',
] as const;

/** The kinds of a line (`Line['kind']` of `@vertex-mizan/ledger`). */
export const JOURNAL_LINE_KINDS = ['measured', 'carried', 'difference', 'rounding'] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

const HASH = `'^[0-9a-f]{64}$'`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * What was asked to post, once (ADR 0005 invariant 5): a client's idempotency key and the hash of
 * its request. A manual entry's key is its draft id, a reversal's `reversal:<entry id>`.
 */
export const postingRequests = pgTable(
  'posting_requests',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    /** `manual`, `system`, or the API client's id (S05). */
    client: text().notNull(),
    idempotencyKey: text().notNull(),
    /** SHA-256 of the request's canonical form, in lowercase hex. */
    payloadHash: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('posting_requests', t.id),
    unique('posting_requests_company_id_id_key').on(t.companyId, t.id),
    unique('posting_requests_key').on(t.companyId, t.client, t.idempotencyKey),
    check(
      'posting_requests_client',
      sql`${t.client} in ('manual', 'system') or ${t.client} ~ ${sql.raw(`'^${UUID}$'`)}`,
    ),
    check('posting_requests_key_length', sql`char_length(${t.idempotencyKey}) between 1 and 200`),
    check('posting_requests_payload_hash', sql`${t.payloadHash} ~ ${sql.raw(HASH)}`),
  ],
);

/**
 * A posted entry (ADR 0005, ADR 0008): numbered per fiscal year of its date in posting order,
 * dated `entry_date` and posted at `posted_at`, the transaction time; `sequence` is its place in
 * the company's chain, `previous_hash` the hash of the entry before it. Never changed: a
 * correction is a reversal, which names its original once.
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    requestId: uuid().notNull(),
    sequence: bigint({ mode: 'bigint' }).notNull(),
    fiscalYear: smallint().notNull(),
    number: integer().notNull(),
    entryDate: date().notNull(),
    postedAt: timestamptz().notNull(),
    source: text().notNull(),
    /** The inbox id or job run of a Hub, revaluation or release entry (S05–S07). */
    sourceRef: text(),
    /** The Hub document's type, id and number (S05). */
    hubDocument: jsonb(),
    /** البيان: the entry's description, in Arabic. */
    description: text().notNull(),
    reference: text(),
    reversesEntryId: uuid(),
    /** The draft a manual entry was posted from (S03 PR 2); kept without a key until then. */
    draftId: uuid(),
    // People and API clients are platform ids, kept without a foreign key as the audit log does.
    preparedByUserId: uuid(),
    approvedByUserId: uuid(),
    postedByUserId: uuid(),
    postedByClientId: uuid(),
    lineCount: smallint().notNull(),
    previousHash: text(),
    hash: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('journal_entries', t.id),
    unique('journal_entries_company_id_id_key').on(t.companyId, t.id),
    unique('journal_entries_number_key').on(t.companyId, t.fiscalYear, t.number),
    unique('journal_entries_reverses_key').on(t.companyId, t.reversesEntryId),
    unique('journal_entries_request_key').on(t.companyId, t.requestId),
    unique('journal_entries_hash_key').on(t.companyId, t.hash),
    unique('journal_entries_sequence_key').on(t.companyId, t.sequence),
    // One entry follows each link of the chain, the first entry included.
    unique('journal_entries_previous_hash_key').on(t.companyId, t.previousHash).nullsNotDistinct(),
    foreignKey({
      name: 'journal_entries_request_fk',
      columns: [t.companyId, t.requestId],
      foreignColumns: [postingRequests.companyId, postingRequests.id],
    }),
    foreignKey({
      name: 'journal_entries_reverses_fk',
      columns: [t.companyId, t.reversesEntryId],
      foreignColumns: [t.companyId, t.id],
    }),
    // The journal reads by date then number (ADR 0008).
    index('journal_entries_company_date_idx').on(t.companyId, t.entryDate, t.number),
    check('journal_entries_source', sql`${t.source} in (${listed(JOURNAL_ENTRY_SOURCES)})`),
    check('journal_entries_sequence', sql`${t.sequence} >= 1`),
    check('journal_entries_number', sql`${t.number} >= 1`),
    check('journal_entries_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check('journal_entries_line_count', sql`${t.lineCount} >= 2`),
    check(
      'journal_entries_description_length',
      sql`char_length(${t.description}) between 1 and 500`,
    ),
    check(
      'journal_entries_reference_length',
      sql`${t.reference} is null or char_length(${t.reference}) between 1 and 100`,
    ),
    check(
      'journal_entries_source_ref_length',
      sql`${t.sourceRef} is null or char_length(${t.sourceRef}) between 1 and 200`,
    ),
    check('journal_entries_not_self_reversal', sql`${t.reversesEntryId} <> ${t.id}`),
    // A person or an API client posted it, never both; a person posts every manual entry.
    check(
      'journal_entries_posted_by',
      sql`(${t.postedByUserId} is null or ${t.postedByClientId} is null)
        and (${t.source} <> 'manual' or ${t.postedByUserId} is not null)`,
    ),
    check(
      'journal_entries_hashes',
      sql`${t.hash} ~ ${sql.raw(HASH)}
        and (${t.previousHash} is null or ${t.previousHash} ~ ${sql.raw(HASH)})
        and (${t.sequence} = 1) = (${t.previousHash} is null)`,
    ),
  ],
);

/**
 * A set of dimension values, shared by every line that carries exactly them (ADR 0003, S02
 * dimensions). `key` is the canonical form: the `type_id:value_id` pairs sorted by type, joined by
 * commas; `''` is the empty set. A deferred guard keeps the key equal to its values.
 */
export const dimensionSets = pgTable(
  'dimension_sets',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    key: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('dimension_sets', t.id),
    unique('dimension_sets_company_id_id_key').on(t.companyId, t.id),
    unique('dimension_sets_key').on(t.companyId, t.key),
    check(
      'dimension_sets_key_shape',
      sql`${t.key} ~ ${sql.raw(`'^(${UUID}:${UUID}(,${UUID}:${UUID})*)?$'`)}`,
    ),
  ],
);

/** One value of a dimension set: one per type, of that type. */
export const dimensionSetValues = pgTable(
  'dimension_set_values',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    setId: uuid().notNull(),
    typeId: uuid().notNull(),
    valueId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('dimension_set_values', t.id),
    unique('dimension_set_values_type_key').on(t.companyId, t.setId, t.typeId),
    foreignKey({
      name: 'dimension_set_values_set_fk',
      columns: [t.companyId, t.setId],
      foreignColumns: [dimensionSets.companyId, dimensionSets.id],
    }),
    // The value and its type together, so a set never names a value under another type.
    foreignKey({
      name: 'dimension_set_values_value_fk',
      columns: [t.companyId, t.valueId, t.typeId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id, dimensionValues.typeId],
    }),
    index('dimension_set_values_company_value_idx').on(t.companyId, t.valueId, t.typeId),
  ],
);

/**
 * A posted line (ADR 0007): the transaction amount in its currency and the book and parallel
 * amounts in minor units, positive debit and negative credit; `parallel_minor` is null exactly when
 * the company keeps no parallel ledger. A difference or rounding line has an amount in its
 * `ledger` only.
 */
export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    entryId: uuid().notNull(),
    lineNo: smallint().notNull(),
    accountId: uuid().notNull(),
    dimensionSetId: uuid().notNull(),
    kind: text().notNull(),
    ledger: text(),
    currency: text().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    bookMinor: bigint({ mode: 'bigint' }).notNull(),
    parallelMinor: bigint({ mode: 'bigint' }),
    memo: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('journal_lines', t.id),
    unique('journal_lines_company_id_id_key').on(t.companyId, t.id),
    unique('journal_lines_line_no_key').on(t.companyId, t.entryId, t.lineNo),
    foreignKey({
      name: 'journal_lines_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'journal_lines_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    foreignKey({
      name: 'journal_lines_dimension_set_fk',
      columns: [t.companyId, t.dimensionSetId],
      foreignColumns: [dimensionSets.companyId, dimensionSets.id],
    }),
    // An account's lines (S03 "Volume and performance").
    index('journal_lines_company_account_idx').on(t.companyId, t.accountId, t.entryId),
    index('journal_lines_company_dimension_set_idx').on(t.companyId, t.dimensionSetId),
    check('journal_lines_line_no', sql`${t.lineNo} >= 1`),
    check('journal_lines_kind', sql`${t.kind} in (${listed(JOURNAL_LINE_KINDS)})`),
    check(
      'journal_lines_ledger',
      sql`(${t.ledger} is not null) = (${t.kind} in ('difference', 'rounding'))
        and (${t.ledger} is null or ${t.ledger} in ('book', 'parallel'))`,
    ),
    // A one-ledger line has zero in the other ledger (ADR 0007).
    check(
      'journal_lines_one_ledger',
      sql`${t.ledger} is null
        or (${t.ledger} = 'book' and coalesce(${t.parallelMinor}, 0) = 0)
        or (${t.ledger} = 'parallel' and ${t.bookMinor} = 0 and ${t.parallelMinor} is not null)`,
    ),
    check('journal_lines_currency', sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`),
    check(
      'journal_lines_memo_length',
      sql`${t.memo} is null or char_length(${t.memo}) between 1 and 300`,
    ),
  ],
);

/**
 * How one ledger amount of a measured line was converted (ADR 0007, S02 rule 15): the rate as
 * used, with its row; a transaction's own or dealt rate has no row. A cross rate stores its two
 * quotes, numbered 1 and 2.
 */
export const lineConversions = pgTable(
  'line_conversions',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    lineId: uuid().notNull(),
    ledger: text().notNull(),
    basis: text().notNull(),
    quoteNo: smallint().notNull(),
    rateId: uuid(),
    base: text().notNull(),
    quote: text().notNull(),
    rate: numeric({ precision: 22, scale: 10 }).notNull(),
    rateType: text().notNull(),
    rateSource: text().notNull(),
    effectiveOn: date().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('line_conversions', t.id),
    unique('line_conversions_quote_key').on(t.companyId, t.lineId, t.ledger, t.quoteNo),
    foreignKey({
      name: 'line_conversions_line_fk',
      columns: [t.companyId, t.lineId],
      foreignColumns: [journalLines.companyId, journalLines.id],
    }),
    foreignKey({
      name: 'line_conversions_rate_fk',
      columns: [t.companyId, t.rateId],
      foreignColumns: [exchangeRates.companyId, exchangeRates.id],
    }),
    // The entries that used a rate row (S02 rule 15).
    index('line_conversions_company_rate_idx').on(t.companyId, t.rateId),
    check('line_conversions_ledger', sql`${t.ledger} in ('book', 'parallel')`),
    check(
      'line_conversions_basis',
      sql`${t.basis} in ('policy', 'transaction')
        and (${t.rateId} is null) = (${t.basis} = 'transaction')
        and (${t.basis} = 'policy' or ${t.quoteNo} = 1)`,
    ),
    check('line_conversions_quote_no', sql`${t.quoteNo} in (1, 2)`),
    check('line_conversions_rate_positive', sql`${t.rate} > 0`),
    check(
      'line_conversions_currencies',
      sql`${t.base} <> ${t.quote}
        and ${t.base} in (${listed(SETTINGS_CURRENCY_CODES)})
        and ${t.quote} in (${listed(SETTINGS_CURRENCY_CODES)})`,
    ),
    check('line_conversions_rate_type', sql`${t.rateType} in (${listed(SETTINGS_RATE_TYPES)})`),
    check('line_conversions_rate_source', sql`${t.rateSource} in (${listed(RATE_ROW_SOURCES)})`),
  ],
);

/**
 * The head of a company's chain (ADR 0012 ledger state): how many entries it has, its last entry
 * and that entry's hash. Made with the company; it moves by one entry at each posting, and the
 * posting function locks it first, which serialises a company's postings (ADR 0008).
 */
export const ledgerHeads = pgTable(
  'ledger_heads',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    entryCount: bigint({ mode: 'bigint' }).notNull(),
    lastEntryId: uuid(),
    lastHash: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('ledger_heads', t.id),
    unique('ledger_heads_company_id_key').on(t.companyId),
    foreignKey({
      name: 'ledger_heads_last_entry_fk',
      columns: [t.companyId, t.lastEntryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    index('ledger_heads_company_last_entry_idx').on(t.companyId, t.lastEntryId),
    check(
      'ledger_heads_state',
      sql`${t.entryCount} >= 0
        and (${t.entryCount} = 0) = (${t.lastEntryId} is null)
        and (${t.entryCount} = 0) = (${t.lastHash} is null)
        and (${t.lastHash} is null or ${t.lastHash} ~ ${sql.raw(HASH)})`,
    ),
  ],
);

/** The last entry number given in a fiscal year (ADR 0005 invariant 6, ADR 0012). */
export const entryNumberCounters = pgTable(
  'entry_number_counters',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    fiscalYear: smallint().notNull(),
    lastNumber: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('entry_number_counters', t.id),
    unique('entry_number_counters_year_key').on(t.companyId, t.fiscalYear),
    check('entry_number_counters_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check('entry_number_counters_last_number', sql`${t.lastNumber} >= 1`),
  ],
);

/**
 * A month of a company's books (ADR 0005 invariant 4): made open by the first posting dated in it;
 * S07 brings closing and reopening.
 */
export const periods = pgTable(
  'periods',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    /** `YYYY-MM`. */
    period: text().notNull(),
    fiscalYear: smallint().notNull(),
    state: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('periods', t.id),
    unique('periods_company_id_id_key').on(t.companyId, t.id),
    unique('periods_period_key').on(t.companyId, t.period),
    check('periods_period_shape', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('periods_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check('periods_state', sql`${t.state} in ('open', 'closed')`),
  ],
);

/**
 * The totals of a period per account, dimension set and transaction currency (ADR 0008, ADR 0012):
 * debits and credits as positive totals in the transaction, book and parallel amounts. Written only
 * by the trigger on line inserts; they never decrease, and `rebuildPeriodBalances()` recomputes
 * them from the lines.
 */
export const periodBalances = pgTable(
  'period_balances',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    periodId: uuid().notNull(),
    accountId: uuid().notNull(),
    dimensionSetId: uuid().notNull(),
    currency: text().notNull(),
    debitMinor: bigint({ mode: 'bigint' }).notNull(),
    creditMinor: bigint({ mode: 'bigint' }).notNull(),
    bookDebitMinor: bigint({ mode: 'bigint' }).notNull(),
    bookCreditMinor: bigint({ mode: 'bigint' }).notNull(),
    parallelDebitMinor: bigint({ mode: 'bigint' }),
    parallelCreditMinor: bigint({ mode: 'bigint' }),
    lineCount: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('period_balances', t.id),
    unique('period_balances_key').on(
      t.companyId,
      t.periodId,
      t.accountId,
      t.dimensionSetId,
      t.currency,
    ),
    foreignKey({
      name: 'period_balances_period_fk',
      columns: [t.companyId, t.periodId],
      foreignColumns: [periods.companyId, periods.id],
    }),
    foreignKey({
      name: 'period_balances_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    foreignKey({
      name: 'period_balances_dimension_set_fk',
      columns: [t.companyId, t.dimensionSetId],
      foreignColumns: [dimensionSets.companyId, dimensionSets.id],
    }),
    index('period_balances_company_account_idx').on(t.companyId, t.accountId, t.periodId),
    index('period_balances_company_dimension_set_idx').on(t.companyId, t.dimensionSetId),
    check(
      'period_balances_totals',
      sql`${t.debitMinor} >= 0 and ${t.creditMinor} >= 0
        and ${t.bookDebitMinor} >= 0 and ${t.bookCreditMinor} >= 0
        and (${t.parallelDebitMinor} is null) = (${t.parallelCreditMinor} is null)
        and coalesce(${t.parallelDebitMinor}, 0) >= 0 and coalesce(${t.parallelCreditMinor}, 0) >= 0
        and ${t.lineCount} >= 1`,
    ),
    check('period_balances_currency', sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`),
  ],
);
