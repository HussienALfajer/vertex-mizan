import {
  type Account,
  type AccountStatement,
  type AgeingReport,
  type BalanceSheet,
  type ClientStatement,
  type ContractPosition,
  type CurrencyCode,
  DomainError,
  type GeneralLedger,
  type IncomeStatement,
  type Journal,
  type JournalQuery,
  type Profitability,
  REPORT_FILE_QUERIES,
  type Report,
  type ReportFileQuery,
  type RevenueReleaseSchedule,
  type TrialBalance,
} from '@vertex-mizan/contracts';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { isClosedPeriod, readClosedPeriods } from '../posting/periods.js';
import { companySettings } from '../schema/companies.js';
import { periods } from '../schema/ledger.js';
import { journalBookPrints, reportFiles } from '../schema/reports.js';
import { readChartAccounts } from './chart-reads.js';
import { ledgersOf } from './companies.js';
import { readAgeingReport, readClientStatementReport } from './receivables-reads.js';
import {
  readAccountStatement,
  readBalanceSheet,
  readContractPosition,
  readGeneralLedger,
  readIncomeStatement,
  readJournal,
  readProfitability,
  readRevenueReleaseSchedule,
  readTrialBalance,
} from './reports.js';

// The exports and files of S09 (rules 28–30, 35–37): a report read whole, every page of it, for
// an Excel export or a PDF; the official print's months; the print register with `superseded`.

/**
 * A report's whole answer as one value, for the sheets of `@vertex-mizan/ui/print` (rules 35,
 * 36); `journal` is the journal book's Excel, the journal of `/reports/journal` (rule 12).
 */
export type ReportAnswer =
  | { readonly report: 'trial_balance'; readonly data: TrialBalance }
  | { readonly report: 'general_ledger'; readonly data: GeneralLedger }
  | { readonly report: 'account_statement'; readonly data: AccountStatement }
  | { readonly report: 'journal'; readonly data: Journal }
  | { readonly report: 'income_statement'; readonly data: IncomeStatement }
  | { readonly report: 'balance_sheet'; readonly data: BalanceSheet }
  | { readonly report: 'profitability'; readonly data: Profitability }
  | { readonly report: 'contract_position'; readonly data: ContractPosition }
  | { readonly report: 'revenue_schedule'; readonly data: RevenueReleaseSchedule }
  | { readonly report: 'ageing'; readonly data: AgeingReport; readonly producedAt: string }
  | {
      readonly report: 'client_statement';
      readonly data: ClientStatement;
      readonly producedAt: string;
    }
  | {
      readonly report: 'chart';
      readonly data: readonly Account[];
      readonly bookCurrency: CurrencyCode;
      readonly producedAt: string;
    };

/** The reports a sheet is read for: every one but the journal book's print, and the journal. */
export type SheetReport = Exclude<Report, 'journal_book'> | 'journal';

/**
 * Reads a report whole in the transaction's snapshot: the general ledger, the account statement
 * and the journal page after page until their last, so the export carries every line (rule 10).
 * `params` is the output of the report's query schema; `today` is today in Damascus.
 */
export async function readReportAnswer(
  tx: Transaction,
  report: SheetReport,
  params: unknown,
  now: Date,
  today: string,
): Promise<ReportAnswer> {
  switch (report) {
    case 'trial_balance':
      return { report, data: await readTrialBalance(tx, query(report, params), now) };
    case 'general_ledger':
      return { report, data: await wholeGeneralLedger(tx, query(report, params), now) };
    case 'account_statement': {
      const { account, ...rest } = query(report, params);
      return { report, data: await wholeAccountStatement(tx, account, rest, now) };
    }
    case 'journal':
      return { report, data: await wholeJournal(tx, params as JournalQuery, now) };
    case 'income_statement':
      return { report, data: await readIncomeStatement(tx, query(report, params), now) };
    case 'balance_sheet':
      return { report, data: await readBalanceSheet(tx, query(report, params), now) };
    case 'profitability':
      return { report, data: await readProfitability(tx, query(report, params), now) };
    case 'contract_position':
      return { report, data: await readContractPosition(tx, query(report, params), now) };
    case 'revenue_schedule':
      return { report, data: await readRevenueReleaseSchedule(tx, query(report, params), now) };
    case 'ageing':
      return {
        report,
        data: await readAgeingReport(tx, query(report, params), today),
        producedAt: now.toISOString(),
      };
    case 'client_statement': {
      const { client, ...rest } = query(report, params);
      return {
        report,
        data: await readClientStatementReport(tx, client, rest, today),
        producedAt: now.toISOString(),
      };
    }
    case 'chart': {
      const [settings] = await tx.select().from(companySettings);
      if (!settings) throw new Error('A company without its settings');
      return {
        report,
        data: await readChartAccounts(tx, true),
        bookCurrency: ledgersOf(settings).book.currency,
        producedAt: now.toISOString(),
      };
    }
  }
}

/** Params already validated by the report's schema, typed as its output. */
const query = <R extends Report>(_report: R, params: unknown) => params as ReportFileQuery<R>;

async function wholeGeneralLedger(
  tx: Transaction,
  first: ReportFileQuery<'general_ledger'>,
  now: Date,
): Promise<GeneralLedger> {
  const pages: GeneralLedger[] = [
    await readGeneralLedger(tx, { ...first, cursor: undefined }, now),
  ];
  for (let next = pages[0]?.nextCursor; next; next = pages.at(-1)?.nextCursor) {
    pages.push(await readGeneralLedger(tx, { ...first, cursor: next }, now));
  }
  const accounts: GeneralLedger['accounts'][number][] = [];
  for (const account of pages.flatMap((page) => page.accounts)) {
    const last = accounts.at(-1);
    // An account continued on the next page repeats with the next lines (S09 "API").
    if (last !== undefined && last.account.id === account.account.id) {
      accounts[accounts.length - 1] = {
        ...last,
        lines: [...last.lines, ...account.lines],
        closing: account.closing,
      };
    } else {
      accounts.push(account);
    }
  }
  return { header: (pages[0] as GeneralLedger).header, accounts, nextCursor: null };
}

async function wholeAccountStatement(
  tx: Transaction,
  accountId: string,
  first: Omit<ReportFileQuery<'account_statement'>, 'account'>,
  now: Date,
): Promise<AccountStatement> {
  const pages = [await readAccountStatement(tx, accountId, { ...first, cursor: undefined }, now)];
  for (let next = pages[0]?.nextCursor; next; next = pages.at(-1)?.nextCursor) {
    pages.push(await readAccountStatement(tx, accountId, { ...first, cursor: next }, now));
  }
  const head = pages[0] as AccountStatement;
  const tail = pages.at(-1) as AccountStatement;
  return {
    ...head,
    lines: pages.flatMap((page) => page.lines),
    closing: tail.closing,
    currencies: tail.currencies,
    nextCursor: null,
  };
}

async function wholeJournal(tx: Transaction, first: JournalQuery, now: Date): Promise<Journal> {
  const pages = [await readJournal(tx, { ...first, cursor: undefined }, now)];
  for (let next = pages[0]?.nextCursor; next; next = pages.at(-1)?.nextCursor) {
    pages.push(await readJournal(tx, { ...first, cursor: next }, now));
  }
  return {
    header: (pages[0] as Journal).header,
    entries: pages.flatMap((page) => page.entries),
    nextCursor: null,
  };
}

/** A report's PDF parameters, validated by its schema (`VALIDATION_FAILED` with the issues). */
export function parseReportFileParams(report: Report, params: unknown): Record<string, unknown> {
  const parsed = REPORT_FILE_QUERIES[report].safeParse(params);
  if (!parsed.success) {
    throw new DomainError('VALIDATION_FAILED', 'The report’s parameters are not valid', {
      issues: parsed.error.issues.map((issue) => ({
        path: ['params', ...issue.path.map(String)],
        message: issue.message,
      })),
    });
  }
  // Stored as JSON: a cursor is dropped, the file carries every page.
  const { cursor: _cursor, ...rest } = parsed.data as Record<string, unknown>;
  return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
}

/** The months of a fiscal year, `YYYY-MM`, from its first month. */
export function fiscalYearMonths(fiscalYear: number, startMonth: number): string[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = startMonth - 1 + index;
    const year = fiscalYear + Math.floor(month / 12);
    return `${String(year).padStart(4, '0')}-${String((month % 12) + 1).padStart(2, '0')}`;
  });
}

/**
 * An official print's range (rule 28): months of its fiscal year in order (`VALIDATION_FAILED`),
 * every one closed now (`PERIOD_NOT_CLOSED` naming the first that is not). The worker checks again
 * in its snapshot, and the register's guard once more.
 */
export async function checkOfficialRange(
  tx: Transaction,
  range: { readonly fiscalYear: number; readonly from: string; readonly to: string },
): Promise<string[]> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const months = fiscalYearMonths(range.fiscalYear, settings.fiscalYearStartMonth);
  if (!months.includes(range.from) || !months.includes(range.to)) {
    throw new DomainError('VALIDATION_FAILED', 'The months are of the fiscal year', {
      issues: [{ path: ['params', 'from'], message: 'The months are of the fiscal year' }],
    });
  }
  const printed = months.filter((month) => month >= range.from && month <= range.to);
  const closed = await readClosedPeriods(tx);
  // A month before the first period reads as closed only while a month is closed (S07); the
  // register's guard wants each month's own closed row, so such a month is not printable.
  const rows = await tx
    .select({ period: periods.period, state: periods.state })
    .from(periods)
    .where(inArray(periods.period, printed));
  const state = new Map(rows.map((row) => [row.period, row.state]));
  const open = printed.find(
    (month) => state.get(month) !== 'closed' || !isClosedPeriod(closed, month),
  );
  if (open !== undefined) {
    throw new DomainError('PERIOD_NOT_CLOSED', 'An official print is of closed months', {
      period: open,
    });
  }
  return printed;
}

/** The register's row as read, its months and supersession computed (rule 29). */
export interface JournalBookPrintRow {
  readonly id: string;
  readonly reportFileId: string;
  readonly fiscalYear: number;
  readonly from: string;
  readonly to: string;
  readonly firstPage: number | null;
  readonly lastPage: number | null;
  readonly entryCount: number;
  readonly lineCount: number;
  readonly debitTotalMinor: bigint;
  readonly creditTotalMinor: bigint;
  readonly currency: CurrencyCode;
  readonly contentSha256: string;
  readonly fileSha256: string;
  readonly printedByUserId: string;
  readonly createdAt: Date;
  readonly supersededAt: Date | null;
}

/**
 * `GET /api/reports/journal-book/prints` (rule 29): one fiscal year's official prints, newest
 * first; a print is superseded once a month of its range was reopened after it (`period_events`).
 */
export async function readJournalBookPrints(
  tx: Transaction,
  fiscalYear: number,
): Promise<JournalBookPrintRow[]> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const currency = ledgersOf(settings).book.currency;
  // Outer columns in a raw subquery are written qualified: Drizzle prints them bare.
  const fromPeriod = sql<string>`(select p.period from periods p where p.company_id = journal_book_prints.company_id and p.id = journal_book_prints.from_period_id)`;
  const toPeriod = sql<string>`(select p.period from periods p where p.company_id = journal_book_prints.company_id and p.id = journal_book_prints.to_period_id)`;
  const rows = await tx
    .select({
      print: journalBookPrints,
      from: fromPeriod,
      to: toPeriod,
      supersededAt: sql<string | null>`(
        select to_json(min(e.created_at))#>>'{}' from period_events e
        join periods p on p.company_id = e.company_id and p.id = e.period_id
        where e.company_id = journal_book_prints.company_id and e.kind = 'reopened'
          and e.created_at > journal_book_prints.created_at
          and p.period between ${fromPeriod} and ${toPeriod})`,
    })
    .from(journalBookPrints)
    .where(eq(journalBookPrints.fiscalYear, fiscalYear))
    .orderBy(desc(journalBookPrints.createdAt), desc(journalBookPrints.id));
  return rows.map(({ print, from, to, supersededAt }) => ({
    id: print.id,
    reportFileId: print.reportFileId,
    fiscalYear: print.fiscalYear,
    from,
    to,
    firstPage: print.firstPage,
    lastPage: print.lastPage,
    entryCount: print.entryCount,
    lineCount: print.lineCount,
    debitTotalMinor: print.debitTotalMinor,
    creditTotalMinor: print.creditTotalMinor,
    currency,
    contentSha256: print.contentSha256,
    fileSha256: print.fileSha256,
    printedByUserId: print.printedByUserId,
    createdAt: print.createdAt,
    supersededAt: supersededAt === null ? null : new Date(supersededAt),
  }));
}

/** The person's files, newest first (`GET /api/reports/files`). */
export function readReportFiles(tx: Transaction, userId: string, limit: number) {
  return tx
    .select()
    .from(reportFiles)
    .where(eq(reportFiles.requestedByUserId, userId))
    .orderBy(desc(reportFiles.createdAt), desc(reportFiles.id))
    .limit(limit);
}

/** How many files the person has queued now (rule 36's limit). */
export async function countQueuedReportFiles(tx: Transaction, userId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(reportFiles)
    .where(and(eq(reportFiles.requestedByUserId, userId), eq(reportFiles.state, 'queued')));
  return row?.count ?? 0;
}

/** The periods of a range of months, in order, for the register row (rule 28). */
export function readRangePeriods(tx: Transaction, from: string, to: string) {
  return tx
    .select({ id: periods.id, period: periods.period, state: periods.state })
    .from(periods)
    .where(and(gte(periods.period, from), lte(periods.period, to)))
    .orderBy(asc(periods.period));
}


/**
 * The counts and book totals of the entries dated in a range of months of a fiscal year, as the
 * journal book prints them (every line, debit when positive) and as the register's guard checks
 * them (rule 28).
 */
export async function readJournalBookTotals(
  tx: Transaction,
  range: { readonly fiscalYear: number; readonly from: string; readonly to: string },
): Promise<{ entryCount: number; lineCount: number; debitMinor: bigint; creditMinor: bigint }> {
  const result = await tx.execute<{
    entries: number;
    lines: number;
    debits: string;
    credits: string;
  }>(sql`select count(distinct e.id)::int as entries, count(l.id)::int as lines,
      coalesce(sum(greatest(l.book_minor, 0)), 0)::text as debits,
      coalesce(sum(greatest(-l.book_minor, 0)), 0)::text as credits
    from journal_entries e
    join journal_lines l on l.company_id = e.company_id and l.entry_id = e.id
    where e.fiscal_year = ${range.fiscalYear}
      and e.entry_date between to_date(${range.from} || '-01', 'YYYY-MM-DD')
        and (to_date(${range.to} || '-01', 'YYYY-MM-DD') + interval '1 month')::date - 1`);
  const row = result.rows[0];
  return {
    entryCount: row?.entries ?? 0,
    lineCount: row?.lines ?? 0,
    debitMinor: BigInt(row?.debits ?? '0'),
    creditMinor: BigInt(row?.credits ?? '0'),
  };
}
