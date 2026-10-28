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
import {
  archivedAt,
  companyId,
  createdAt,
  id,
  idIsUuidV7,
  timestamptz,
  updatedAt,
} from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES } from './companies.js';
import { journalEntries } from './ledger.js';

// The drafts module (S03 PR 2, ADR 0005 "drafts are not ledger"): the accountant's drafts of
// manual entries and their lines, which change until they post, and the files attached to a draft
// or a posted entry. Company tables under forced RLS; the guards of the S03 drafts migration keep a
// posted or discarded draft unchanged, a submitted one read-only, and an attachment of a posted
// entry for good.

/** `DRAFT_STATES` of `@vertex-mizan/contracts`; a test keeps them equal. */
export const ENTRY_DRAFT_STATES = ['draft', 'submitted', 'posted'] as const;

/** `ATTACHMENT_CONTENT_TYPES` of `@vertex-mizan/contracts`; a test keeps them equal. */
export const ATTACHMENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * A draft of a manual entry (S03 rules 4–11): saved as typed, submitted for approval when the
 * company asks for it, posted once (`posted_entry_id`), or discarded (archived). A reversal waiting
 * for approval names its original and has no lines of its own.
 */
export const entryDrafts = pgTable(
  'entry_drafts',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    state: text().notNull(),
    entryDate: date().notNull(),
    /** البيان: required to submit or post, not to save. */
    description: text(),
    reference: text(),
    /** `[{ base, quote, rate }]`, each pair as the company holds it (S03 rule 13). */
    dealtRates: jsonb().notNull().default(sql`'[]'::jsonb`),
    reversesEntryId: uuid(),
    copiedFromEntryId: uuid(),
    // People are platform ids, kept without a foreign key as the audit log does.
    preparedByUserId: uuid().notNull(),
    submittedByUserId: uuid(),
    submittedAt: timestamptz(),
    rejectedByUserId: uuid(),
    rejectedReason: text(),
    rejectedAt: timestamptz(),
    postedEntryId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
    archivedReason: text(),
  },
  (t) => [
    idIsUuidV7('entry_drafts', t.id),
    unique('entry_drafts_company_id_id_key').on(t.companyId, t.id),
    unique('entry_drafts_posted_entry_key').on(t.companyId, t.postedEntryId),
    foreignKey({
      name: 'entry_drafts_reverses_fk',
      columns: [t.companyId, t.reversesEntryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'entry_drafts_copied_from_fk',
      columns: [t.companyId, t.copiedFromEntryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'entry_drafts_posted_entry_fk',
      columns: [t.companyId, t.postedEntryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    index('entry_drafts_company_state_idx').on(t.companyId, t.state, t.updatedAt),
    index('entry_drafts_company_reverses_idx').on(t.companyId, t.reversesEntryId),
    index('entry_drafts_company_copied_from_idx').on(t.companyId, t.copiedFromEntryId),
    // One reversal of an entry waits at a time; a discarded one leaves room for another.
    uniqueIndex('entry_drafts_open_reversal_key')
      .on(t.companyId, t.reversesEntryId)
      .where(sql`${t.archivedAt} is null`),
    check('entry_drafts_state', sql`${t.state} in (${listed(ENTRY_DRAFT_STATES)})`),
    check('entry_drafts_posted', sql`(${t.postedEntryId} is not null) = (${t.state} = 'posted')`),
    check(
      'entry_drafts_description_length',
      sql`${t.description} is null or char_length(${t.description}) between 1 and 500`,
    ),
    check(
      'entry_drafts_reference_length',
      sql`${t.reference} is null or char_length(${t.reference}) between 1 and 100`,
    ),
    check('entry_drafts_dealt_rates', sql`jsonb_typeof(${t.dealtRates}) = 'array'`),
    check(
      'entry_drafts_submitted',
      sql`(${t.submittedByUserId} is null) = (${t.submittedAt} is null)
        and (${t.state} <> 'submitted' or ${t.submittedByUserId} is not null)`,
    ),
    check(
      'entry_drafts_rejected',
      sql`(${t.rejectedByUserId} is null) = (${t.rejectedReason} is null)
        and (${t.rejectedReason} is null) = (${t.rejectedAt} is null)
        and (${t.rejectedReason} is null or char_length(${t.rejectedReason}) between 1 and 1000)`,
    ),
    // Discarded from `draft` only; a submitted draft is withdrawn first (S03 rule 11).
    check(
      'entry_drafts_archived',
      sql`(${t.archivedAt} is null or ${t.state} = 'draft')
        and (${t.archivedAt} is not null or ${t.archivedReason} is null)
        and (${t.archivedReason} is null or char_length(${t.archivedReason}) between 1 and 1000)`,
    ),
  ],
);

/**
 * A line of a draft as typed: the account, the currency and the amount may be missing while the
 * accountant types; an amount is never zero. Line numbers 1 to 500, each row kept for its number:
 * a line removed from the draft is archived, and taken back when the draft grows again.
 */
export const entryDraftLines = pgTable(
  'entry_draft_lines',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    draftId: uuid().notNull(),
    lineNo: smallint().notNull(),
    accountId: uuid(),
    dimensionValueIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    currency: text(),
    amountMinor: bigint({ mode: 'bigint' }),
    memo: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('entry_draft_lines', t.id),
    unique('entry_draft_lines_line_no_key').on(t.companyId, t.draftId, t.lineNo),
    foreignKey({
      name: 'entry_draft_lines_draft_fk',
      columns: [t.companyId, t.draftId],
      foreignColumns: [entryDrafts.companyId, entryDrafts.id],
    }),
    foreignKey({
      name: 'entry_draft_lines_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    index('entry_draft_lines_company_account_idx').on(t.companyId, t.accountId),
    check('entry_draft_lines_line_no', sql`${t.lineNo} between 1 and 500`),
    check('entry_draft_lines_amount', sql`${t.amountMinor} is null or ${t.amountMinor} <> 0`),
    check(
      'entry_draft_lines_currency',
      sql`${t.currency} is null or ${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`,
    ),
    check(
      'entry_draft_lines_dimensions',
      sql`cardinality(${t.dimensionValueIds}) <= 10
        and array_position(${t.dimensionValueIds}, null) is null`,
    ),
    check(
      'entry_draft_lines_memo_length',
      sql`${t.memo} is null or char_length(${t.memo}) between 1 and 300`,
    ),
  ],
);

/**
 * A file attached to a draft or a posted entry (S03 rule 17), stored on the server's disk under
 * `<company_id>/<id>` and served only through the API. It moves to the entry at posting, is
 * removed (archived) from a draft only, and is never part of the entry's hash.
 */
export const entryAttachments = pgTable(
  'entry_attachments',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    draftId: uuid(),
    entryId: uuid(),
    fileName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    /** SHA-256 of the file, in lowercase hex: shown, and checked by the export. */
    sha256: text().notNull(),
    storageKey: text().notNull(),
    uploadedByUserId: uuid().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
    archivedReason: text(),
  },
  (t) => [
    idIsUuidV7('entry_attachments', t.id),
    unique('entry_attachments_company_id_id_key').on(t.companyId, t.id),
    foreignKey({
      name: 'entry_attachments_draft_fk',
      columns: [t.companyId, t.draftId],
      foreignColumns: [entryDrafts.companyId, entryDrafts.id],
    }),
    foreignKey({
      name: 'entry_attachments_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    index('entry_attachments_company_draft_idx').on(t.companyId, t.draftId),
    index('entry_attachments_company_entry_idx').on(t.companyId, t.entryId),
    check('entry_attachments_owner', sql`${t.draftId} is not null or ${t.entryId} is not null`),
    check('entry_attachments_type', sql`${t.contentType} in (${listed(ATTACHMENT_TYPES)})`),
    check('entry_attachments_size', sql`${t.sizeBytes} between 1 and 10485760`),
    check('entry_attachments_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'entry_attachments_storage_key',
      sql`${t.storageKey} = ${t.companyId}::text || '/' || ${t.id}::text`,
    ),
    check('entry_attachments_file_name', sql`char_length(${t.fileName}) between 1 and 255`),
    check(
      'entry_attachments_archived',
      sql`(${t.archivedAt} is not null or ${t.archivedReason} is null)
        and (${t.archivedReason} is null or char_length(${t.archivedReason}) between 1 and 1000)`,
    ),
  ],
);
