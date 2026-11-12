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
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { chartAccounts } from './chart.js';
import { companyId, createdAt, id, idIsUuidV7, timestamptz, updatedAt } from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES } from './companies.js';
import { dimensionValues } from './dimensions.js';
import { journalEntries } from './ledger.js';

// The opening module (S10, ADR 0019): Hub's snapshots of its open documents as of the eve of the
// books start, the company's one live opening and the accountant's lines and the records' figures
// of each of its versions. Company tables under forced RLS; the guards of the S10 migration hold
// the snapshot's eve, the opening's states and the lines' versions, pinned in `GUARDS`.

/** `OPENING_STATES` of `@vertex-mizan/contracts`; a test keeps them equal. */
export const OPENING_ROW_STATES = ['draft', 'posted', 'reversed'] as const;

/** `OPENING_FIGURE_SLOTS` of `@vertex-mizan/contracts`; a test keeps them equal. */
export const OPENING_ROW_FIGURE_SLOTS = ['receivable', 'ad_funds'] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * A snapshot of Hub's open documents as of the eve (S10 rules 5–9), as the API validated it, once
 * per API client and key; the latest by `received_at` is the one the draft reads. `as_of` is the
 * eve of the company's books start, and no snapshot arrives once the opening is posted (guards).
 */
export const openingSnapshots = pgTable(
  'opening_snapshots',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    /** The API client that sent it: a platform id, kept without a key (as `inbound_events`). */
    apiClientId: uuid().notNull(),
    /** Hub's snapshot id, the `Idempotency-Key`. */
    snapshotKey: text().notNull(),
    asOf: date().notNull(),
    generatedAt: timestamptz().notNull(),
    payload: jsonb().notNull(),
    payloadHash: text().notNull(),
    invoiceCount: integer().notNull(),
    walletCount: integer().notNull(),
    milestoneCount: integer().notNull(),
    priorDocumentCount: integer().notNull(),
    receivedAt: timestamptz().notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('opening_snapshots', t.id),
    unique('opening_snapshots_company_id_id_key').on(t.companyId, t.id),
    unique('opening_snapshots_key').on(t.companyId, t.apiClientId, t.snapshotKey),
    index('opening_snapshots_company_received_idx').on(t.companyId, t.receivedAt),
    check('opening_snapshots_key_length', sql`char_length(${t.snapshotKey}) between 1 and 100`),
    check('opening_snapshots_payload_hash', sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check('opening_snapshots_payload', sql`jsonb_typeof(${t.payload}) = 'object'`),
    check(
      'opening_snapshots_counts',
      sql`${t.invoiceCount} >= 0 and ${t.walletCount} >= 0 and ${t.milestoneCount} >= 0
        and ${t.priorDocumentCount} >= 0`,
    ),
  ],
);

/**
 * A company's opening (S10 rules 10, 16, 23, 25): one live (not reversed) per company, created by
 * the first save. `version` counts its saves from 1; its lines and figures are those of its
 * version. `draft → posted` sets the entry, its poster and time and the snapshot it used, in the
 * transaction that posts the entry; `posted → reversed` sets the reversal with its reason, while
 * the opening entry is the company's only entry (guards).
 */
export const openings = pgTable(
  'openings',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    state: text().notNull().default('draft'),
    version: integer().notNull().default(1),
    snapshotId: uuid(),
    entryId: uuid(),
    reversalEntryId: uuid(),
    // People are platform ids, kept without a key as drafts keep them.
    preparedByUserId: uuid().notNull(),
    postedByUserId: uuid(),
    postedAt: timestamptz(),
    reversedByUserId: uuid(),
    reversedAt: timestamptz(),
    reverseReason: text(),
    /** The fingerprint of the preview the owner posted (S10 rules 20, 23). */
    fingerprint: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('openings', t.id),
    unique('openings_company_id_id_key').on(t.companyId, t.id),
    uniqueIndex('openings_live_key').on(t.companyId).where(sql`${t.state} <> 'reversed'`),
    unique('openings_entry_key').on(t.companyId, t.entryId),
    unique('openings_reversal_entry_key').on(t.companyId, t.reversalEntryId),
    index('openings_company_snapshot_idx').on(t.companyId, t.snapshotId),
    foreignKey({
      name: 'openings_snapshot_fk',
      columns: [t.companyId, t.snapshotId],
      foreignColumns: [openingSnapshots.companyId, openingSnapshots.id],
    }),
    foreignKey({
      name: 'openings_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'openings_reversal_entry_fk',
      columns: [t.companyId, t.reversalEntryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    check('openings_state', sql`${t.state} in (${listed(OPENING_ROW_STATES)})`),
    check('openings_version', sql`${t.version} >= 1`),
    check(
      'openings_posted_fields',
      sql`(${t.state} = 'draft') = (${t.entryId} is null)
        and (${t.entryId} is null) = (${t.postedByUserId} is null)
        and (${t.entryId} is null) = (${t.postedAt} is null)
        and (${t.entryId} is null) = (${t.fingerprint} is null)
        and (${t.entryId} is not null or ${t.snapshotId} is null)`,
    ),
    check(
      'openings_reversed_fields',
      sql`(${t.state} = 'reversed') = (${t.reversalEntryId} is not null)
        and (${t.reversalEntryId} is null) = (${t.reversedByUserId} is null)
        and (${t.reversalEntryId} is null) = (${t.reversedAt} is null)
        and (${t.reversalEntryId} is null) = (${t.reverseReason} is null)
        and (${t.reverseReason} is null or char_length(${t.reverseReason}) between 1 and 500)`,
    ),
    check(
      'openings_fingerprint',
      sql`${t.fingerprint} is null or ${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/**
 * A line of the accountant (S10 rules 14, 17) in one version of its opening: written by the save
 * that makes the version, never changed. The amount is signed (debit positive); `book_minor` and
 * `parallel_minor` only on a stated line, each null in its ledger's own currency.
 */
export const openingLines = pgTable(
  'opening_lines',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    openingId: uuid().notNull(),
    version: integer().notNull(),
    lineNo: smallint().notNull(),
    accountId: uuid().notNull(),
    dimensionValueIds: uuid().array().notNull().default(sql`'{}'`),
    currency: text().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    bookMinor: bigint({ mode: 'bigint' }),
    parallelMinor: bigint({ mode: 'bigint' }),
    itemReference: text(),
    itemDueOn: date(),
    memo: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('opening_lines', t.id),
    unique('opening_lines_line_no_key').on(t.companyId, t.openingId, t.version, t.lineNo),
    foreignKey({
      name: 'opening_lines_opening_fk',
      columns: [t.companyId, t.openingId],
      foreignColumns: [openings.companyId, openings.id],
    }),
    foreignKey({
      name: 'opening_lines_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    index('opening_lines_company_account_idx').on(t.companyId, t.accountId),
    check('opening_lines_line_no', sql`${t.lineNo} >= 1`),
    check('opening_lines_currency', sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`),
    check('opening_lines_amount', sql`${t.amountMinor} <> 0`),
    check(
      'opening_lines_item',
      sql`(${t.itemReference} is null or char_length(${t.itemReference}) between 1 and 100)
        and (${t.itemDueOn} is null or ${t.itemReference} is not null)`,
    ),
    check(
      'opening_lines_memo_length',
      sql`${t.memo} is null or char_length(${t.memo}) between 1 and 300`,
    ),
    check(
      'opening_lines_dimension_values',
      sql`cardinality(${t.dimensionValueIds}) <= 20
        and array_position(${t.dimensionValueIds}, null) is null`,
    ),
  ],
);

/**
 * The records' figure of a client and currency (S10 rule 15) in one version of its opening, signed
 * as the account's natural balance: a receivable's debit positive, client funds' credit positive.
 */
export const openingRecordFigures = pgTable(
  'opening_record_figures',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    openingId: uuid().notNull(),
    version: integer().notNull(),
    slot: text().notNull(),
    clientValueId: uuid().notNull(),
    currency: text().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('opening_record_figures', t.id),
    unique('opening_record_figures_key').on(
      t.companyId,
      t.openingId,
      t.version,
      t.slot,
      t.clientValueId,
      t.currency,
    ),
    foreignKey({
      name: 'opening_record_figures_opening_fk',
      columns: [t.companyId, t.openingId],
      foreignColumns: [openings.companyId, openings.id],
    }),
    foreignKey({
      name: 'opening_record_figures_client_fk',
      columns: [t.companyId, t.clientValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    index('opening_record_figures_company_client_idx').on(t.companyId, t.clientValueId),
    check('opening_record_figures_slot', sql`${t.slot} in (${listed(OPENING_ROW_FIGURE_SLOTS)})`),
    check(
      'opening_record_figures_currency',
      sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`,
    ),
  ],
);
