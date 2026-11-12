import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, createdAt, id, idIsUuidV7, timestamptz, updatedAt } from './columns.js';
import { companies } from './companies.js';
import { periods } from './ledger.js';

// The reports module (S09 rules 28–31, 36): the PDF files the worker renders, a queue the API
// fills, and the register of the journal book's official prints, append-only. Guards in 0049.

const HASH = sql.raw(`'^[0-9a-f]{64}$'`);

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', '));

/** `REPORTS` of `@vertex-mizan/contracts` (S09 rule 37, append-only); a test keeps them equal. */
export const REPORT_FILE_REPORTS = [
  'trial_balance',
  'general_ledger',
  'account_statement',
  'journal_book',
  'income_statement',
  'balance_sheet',
  'profitability',
  'contract_position',
  'revenue_schedule',
  'ageing',
  'client_statement',
  'chart',
] as const;

/** `REPORT_FILE_STATES` of `@vertex-mizan/contracts`; a test keeps them equal. */
export const REPORT_FILE_STATES = ['queued', 'ready', 'failed', 'expired'] as const;

/**
 * A report rendered to PDF (S09 rule 36): `queued` when requested with the report's validated
 * query, then `ready` with its file under `MIZAN_FILES_DIR` (`<company_id>/<id>`), its size, its
 * SHA-256 and, unless it is an official print, 24 hours to download; or `failed` with an error
 * code. A ready file past `expires_at` has its file deleted and becomes `expired`. An official
 * print of the journal book (rule 28) never expires: the register keeps it.
 */
export const reportFiles = pgTable(
  'report_files',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    report: text().notNull(),
    /** The report's query as validated by its schema in `@vertex-mizan/contracts`. */
    params: jsonb().notNull(),
    format: text().notNull().default('pdf'),
    official: boolean().notNull().default(false),
    /** The person who asked, as drafts keep their people: no key to the platform's users. */
    requestedByUserId: uuid().notNull(),
    state: text().notNull().default('queued'),
    storageKey: text(),
    sizeBytes: bigint({ mode: 'number' }),
    sha256: text(),
    /** The code of the failure (an error code), never its message. */
    error: text(),
    /** Renders started: a file whose render keeps dying (a crash, a kill) fails at three. */
    attempts: integer().notNull().default(0),
    readyAt: timestamptz(),
    expiresAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('report_files', t.id),
    unique('report_files_company_id_id_key').on(t.companyId, t.id),
    index('report_files_company_requester_idx').on(t.companyId, t.requestedByUserId, t.createdAt),
    index('report_files_company_state_idx').on(t.companyId, t.state, t.createdAt),
    check('report_files_report', sql`${t.report} in (${listed(REPORT_FILE_REPORTS)})`),
    check('report_files_format', sql`${t.format} = 'pdf'`),
    check('report_files_official', sql`not ${t.official} or ${t.report} = 'journal_book'`),
    check('report_files_params', sql`jsonb_typeof(${t.params}) = 'object'`),
    check('report_files_state', sql`${t.state} in (${listed(REPORT_FILE_STATES)})`),
    check(
      'report_files_ready_fields',
      sql`(${t.state} in ('ready', 'expired')) = (${t.storageKey} is not null)
        and (${t.storageKey} is null) = (${t.sizeBytes} is null)
        and (${t.storageKey} is null) = (${t.sha256} is null)
        and (${t.storageKey} is null) = (${t.readyAt} is null)
        and ((${t.storageKey} is not null and not ${t.official}) = (${t.expiresAt} is not null))
        and (${t.state} = 'failed') = (${t.error} is not null)`,
    ),
    check('report_files_official_kept', sql`not (${t.official} and ${t.state} = 'expired')`),
    check(
      'report_files_storage_key',
      sql`${t.storageKey} is null or ${t.storageKey} = ${t.companyId}::text || '/' || ${t.id}::text`,
    ),
    check('report_files_size', sql`${t.sizeBytes} is null or ${t.sizeBytes} > 0`),
    check('report_files_attempts', sql`${t.attempts} >= 0`),
    check('report_files_sha256', sql`${t.sha256} is null or ${t.sha256} ~ ${HASH}`),
    check(
      'report_files_error_length',
      sql`${t.error} is null or char_length(${t.error}) between 1 and 100`,
    ),
  ],
);

/**
 * The register of the journal book's official prints (S09 rules 28–29): one per official file,
 * written by the worker in the transaction that marks the file ready, with the range of closed
 * months of one fiscal year, the pages it took in the year's numbering (none for a range with no
 * entries, edge case 23), the counts and totals in the book ledger, the SHA-256 of the canonical
 * rows (rule 31) and of the file. Append-only; a reopen supersedes a print on read, never here.
 */
export const journalBookPrints = pgTable(
  'journal_book_prints',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    reportFileId: uuid().notNull(),
    fiscalYear: smallint().notNull(),
    fromPeriodId: uuid().notNull(),
    toPeriodId: uuid().notNull(),
    firstPage: integer(),
    lastPage: integer(),
    entryCount: integer().notNull(),
    lineCount: integer().notNull(),
    debitTotalMinor: bigint({ mode: 'bigint' }).notNull(),
    creditTotalMinor: bigint({ mode: 'bigint' }).notNull(),
    contentSha256: text().notNull(),
    fileSha256: text().notNull(),
    /** The person who asked for the print, the file's requester. */
    printedByUserId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('journal_book_prints', t.id),
    unique('journal_book_prints_report_file_key').on(t.companyId, t.reportFileId),
    foreignKey({
      name: 'journal_book_prints_report_file_fk',
      columns: [t.companyId, t.reportFileId],
      foreignColumns: [reportFiles.companyId, reportFiles.id],
    }),
    foreignKey({
      name: 'journal_book_prints_from_period_fk',
      columns: [t.companyId, t.fromPeriodId],
      foreignColumns: [periods.companyId, periods.id],
    }),
    foreignKey({
      name: 'journal_book_prints_to_period_fk',
      columns: [t.companyId, t.toPeriodId],
      foreignColumns: [periods.companyId, periods.id],
    }),
    index('journal_book_prints_company_year_idx').on(t.companyId, t.fiscalYear, t.createdAt),
    index('journal_book_prints_company_from_period_idx').on(t.companyId, t.fromPeriodId),
    index('journal_book_prints_company_to_period_idx').on(t.companyId, t.toPeriodId),
    check('journal_book_prints_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check(
      'journal_book_prints_pages',
      sql`(${t.firstPage} is null) = (${t.lastPage} is null)
        and (${t.firstPage} is null) = (${t.entryCount} = 0)
        and (${t.firstPage} is null or (${t.firstPage} >= 1 and ${t.firstPage} <= ${t.lastPage}))`,
    ),
    check(
      'journal_book_prints_counts',
      sql`${t.entryCount} >= 0 and ${t.lineCount} >= ${t.entryCount}
        and (${t.entryCount} = 0) = (${t.lineCount} = 0)`,
    ),
    check(
      'journal_book_prints_totals',
      sql`${t.debitTotalMinor} = ${t.creditTotalMinor} and ${t.debitTotalMinor} >= 0`,
    ),
    check('journal_book_prints_content_sha256', sql`${t.contentSha256} ~ ${HASH}`),
    check('journal_book_prints_file_sha256', sql`${t.fileSha256} ~ ${HASH}`),
  ],
);
