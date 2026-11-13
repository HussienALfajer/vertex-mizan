import {
  type AccountStatement,
  type AccountStatementQuery,
  type BalanceSheet,
  type BalanceSheetQuery,
  type ContractPosition,
  type ContractPositionQuery,
  type CurrencyCode,
  DomainError,
  type GeneralLedger,
  type GeneralLedgerQuery,
  type IncomeStatement,
  type IncomeStatementQuery,
  type Journal,
  type JournalBook,
  type JournalBookQuery,
  type JournalQuery,
  type Ledger,
  type Profitability,
  type ProfitabilityDimension,
  type ProfitabilityQuery,
  type ReportAccount,
  type ReportColumn,
  type ReportHeader,
  type ReportLine,
  type ReportLines,
  type ReportLinesQuery,
  type ReportValue,
  type RevenueReleaseSchedule,
  type RevenueReleaseScheduleQuery,
  STATEMENT_LINES,
  type TrialBalance,
  type TrialBalanceQuery,
} from '@vertex-mizan/contracts';
import {
  balanceSheet,
  balanceSheetComparative,
  booksStartMarks,
  contractPosition,
  dayAfter,
  dayBefore,
  departmentInForce,
  fiscalYearStart,
  incomeStatement,
  journalBookPages,
  lastDayOfMonth,
  monthsBetween,
  type PresentationBalance,
  type ProfitabilityAmount,
  periodOf,
  previousPeriod,
  profitability,
  type ReleasePart,
  type ReportChartAccount,
  releaseSchedule,
  reportMarks,
  sumAmounts,
  sumCarried,
  trialBalance,
  withOpeningEntry,
} from '@vertex-mizan/ledger';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { isClosedPeriod, readClosedPeriods } from '../posting/periods.js';
import { accountRoles, chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import { dimensionSetValues, journalEntries, journalLines, periods } from '../schema/ledger.js';
import { recognitionSchedules } from '../schema/recognition.js';
import { ledgersOf } from './companies.js';
import { readServiceDepartmentRows } from './departments.js';
import { amountsOf, movementsOf, overTimeStates } from './recognition.js';
import { revaluationCheck } from './revaluation.js';

/**
 * The reports' readers (S09): each runs inside `withCompany` in one transaction (a repeatable-read
 * snapshot when the caller asks, as the API does), sums ledger amounts in SQL, from
 * `period_balances` for whole months and `journal_lines` for the days of a partial month (ADR
 * 0008), and leaves every presentation rule to `packages/ledger`. Amounts leave as `MinorUnits`
 * strings of the report's ledger currency; nothing is converted.
 */

/** Lines a page of the general ledger, the account statement, the journal and the drill-down. */
export const REPORT_PAGE_LINES = 200;

const INCOME_LINE_CODES = new Set(
  STATEMENT_LINES.filter((line) => line.statement === 'income_statement').map((line) => line.code),
);

interface ReportContext {
  readonly ledger: Ledger;
  readonly currency: CurrencyCode;
  readonly hasParallel: boolean;
  readonly fiscalYearStartMonth: number;
  readonly firstPeriod: string | null;
  /** S10: the company's books start, or null. */
  readonly booksStart: string | null;
  /** S10 rule 31: the accounts that ever held the role `pre_opening_result`. */
  readonly preOpeningAccountIds: readonly string[];
}

/** The company's ledgers and fiscal year; a parallel ledger asked of a company without one fails. */
async function contextOf(tx: Transaction, ledger: Ledger | undefined): Promise<ReportContext> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const ledgers = ledgersOf(settings);
  const chosen = ledger ?? 'book';
  const currency = chosen === 'book' ? ledgers.book.currency : ledgers.parallel?.currency;
  if (currency === undefined) {
    throw new DomainError('VALIDATION_FAILED', 'The company keeps no parallel ledger', {
      field: 'ledger',
    });
  }
  const [first] = await tx
    .select({ period: periods.period })
    .from(periods)
    .orderBy(asc(periods.period))
    .limit(1);
  const preOpening = await tx
    .select({ accountId: accountRoles.accountId })
    .from(accountRoles)
    .where(eq(accountRoles.role, 'pre_opening_result'));
  return {
    ledger: chosen,
    currency: currency as CurrencyCode,
    hasParallel: ledgers.parallel !== null,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    firstPeriod: first?.period ?? null,
    booksStart: settings.booksStart,
    preOpeningAccountIds: [...new Set(preOpening.map((row) => row.accountId))],
  };
}

// --- The chart and values ---

interface ChartRow extends ReportChartAccount {
  readonly report: ReportAccount;
  readonly name: string;
}

async function readChart(tx: Transaction): Promise<ChartRow[]> {
  const rows = await tx.select().from(chartAccounts).orderBy(asc(chartAccounts.code));
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    parentId: row.parentId,
    level: row.level,
    postable: row.kind === 'postable',
    statementLine: row.statementLine,
    control: row.isControl,
    normalBalance: row.normalBalance as 'debit' | 'credit',
    archived: row.archivedAt !== null,
    name: row.name,
    report: {
      id: row.id,
      code: row.code,
      name: row.name,
      nameLatin: row.nameLatin,
      level: row.level,
      postable: row.kind === 'postable',
      statementLine: row.statementLine,
      archived: row.archivedAt !== null,
      blocked: row.blockedAt !== null,
    },
  }));
}

function chartIndex(chart: readonly ChartRow[]) {
  const byId = new Map(chart.map((account) => [account.id, account]));
  return (id: string): ChartRow => {
    const account = byId.get(id);
    if (account === undefined) throw new Error('A report names an account that is not there');
    return account;
  };
}

/** The values of dimension sets, by set, with each value's type code. */
async function setValues(
  tx: Transaction,
  setIds: readonly string[],
): Promise<Map<string, ReportValue[]>> {
  const result = new Map<string, ReportValue[]>();
  const ids = [...new Set(setIds)];
  if (ids.length === 0) return result;
  const rows = await tx
    .select({
      setId: dimensionSetValues.setId,
      typeCode: dimensionTypes.code,
      position: dimensionTypes.position,
      id: dimensionValues.id,
      code: dimensionValues.code,
      name: dimensionValues.name,
      archivedAt: dimensionValues.archivedAt,
    })
    .from(dimensionSetValues)
    .innerJoin(dimensionTypes, eq(dimensionTypes.id, dimensionSetValues.typeId))
    .innerJoin(dimensionValues, eq(dimensionValues.id, dimensionSetValues.valueId))
    .where(inArray(dimensionSetValues.setId, ids))
    .orderBy(asc(dimensionTypes.position));
  for (const row of rows) {
    const list = result.get(row.setId) ?? [];
    list.push({
      id: row.id,
      typeCode: row.typeCode,
      code: row.code,
      name: row.name,
      archived: row.archivedAt !== null,
    });
    result.set(row.setId, list);
  }
  return result;
}

async function valuesById(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, ReportValue & { contractKind: string | null }>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({
      id: dimensionValues.id,
      typeCode: dimensionTypes.code,
      code: dimensionValues.code,
      name: dimensionValues.name,
      archivedAt: dimensionValues.archivedAt,
      contractKind: dimensionValues.contractKind,
    })
    .from(dimensionValues)
    .innerJoin(dimensionTypes, eq(dimensionTypes.id, dimensionValues.typeId))
    .where(inArray(dimensionValues.id, unique));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        typeCode: row.typeCode,
        code: row.code,
        name: row.name,
        archived: row.archivedAt !== null,
        contractKind: row.contractKind,
      },
    ]),
  );
}

async function builtinTypeId(tx: Transaction, code: string): Promise<string> {
  const [type] = await tx
    .select({ id: dimensionTypes.id })
    .from(dimensionTypes)
    .where(and(eq(dimensionTypes.code, code), eq(dimensionTypes.builtin, true)));
  if (!type) throw new Error(`The company has no ${code} type`);
  return type.id;
}

// --- Sums in SQL ---

/**
 * A date range as whole months, read from the period balances, and the days of partial months,
 * read from the lines. `from` null is the start of the books.
 */
function segmentsOf(
  from: string | null,
  to: string,
): { months: { from: string | null; to: string } | null; days: [string, string][] } {
  const days: [string, string][] = [];
  if (from !== null && from > to) return { months: null, days };
  // The first whole month, or null for the start of the books.
  let firstWhole: string | null = null;
  if (from !== null) {
    let start = from;
    if (from.slice(8) !== '01' || lastDayOfMonth(from) > to) {
      const end = lastDayOfMonth(from) < to ? lastDayOfMonth(from) : to;
      days.push([from, end]);
      if (end === to) return { months: null, days };
      start = dayAfter(end);
    }
    firstWhole = periodOf(start);
  }
  if (to !== lastDayOfMonth(to)) {
    const monthStart = `${periodOf(to)}-01`;
    days.push([monthStart, to]);
    const lastWhole = periodOf(dayBefore(monthStart));
    if (firstWhole !== null && lastWhole < firstWhole) return { months: null, days };
    return { months: { from: firstWhole, to: lastWhole }, days };
  }
  return { months: { from: firstWhole, to: periodOf(to) }, days };
}

const ledgerColumns = (ledger: Ledger) =>
  ledger === 'book'
    ? {
        debit: sql.raw('pb.book_debit_minor'),
        credit: sql.raw('pb.book_credit_minor'),
        line: sql.raw('l.book_minor'),
      }
    : {
        debit: sql.raw('coalesce(pb.parallel_debit_minor, 0)'),
        credit: sql.raw('coalesce(pb.parallel_credit_minor, 0)'),
        line: sql.raw('coalesce(l.parallel_minor, 0)'),
      };

interface SumRow {
  readonly accountId: string;
  readonly setId: string;
  readonly debits: bigint;
  readonly credits: bigint;
  readonly net: bigint;
}

/**
 * The debits, credits and net debit of every account and dimension set over a range, in one
 * ledger, optionally of some accounts only.
 */
async function ledgerSums(
  tx: Transaction,
  ledger: Ledger,
  range: { readonly from: string | null; readonly to: string },
  accountIds?: readonly string[],
): Promise<SumRow[]> {
  if (accountIds !== undefined && accountIds.length === 0) return [];
  const { months, days } = segmentsOf(range.from, range.to);
  const columns = ledgerColumns(ledger);
  const accounts = (alias: string) =>
    accountIds === undefined
      ? sql`true`
      : sql`${sql.raw(alias)}.account_id in (${sql.join(
          accountIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const parts = [];
  if (months !== null) {
    parts.push(sql`
      select pb.account_id, pb.dimension_set_id, ${columns.debit} as debits, ${columns.credit} as credits
      from period_balances pb
      join periods p on p.company_id = pb.company_id and p.id = pb.period_id
      where ${months.from === null ? sql`true` : sql`p.period >= ${months.from}`}
        and p.period <= ${months.to} and ${accounts('pb')}`);
  }
  for (const [from, to] of days) {
    parts.push(sql`
      select l.account_id, l.dimension_set_id,
        greatest(${columns.line}, 0) as debits, greatest(-${columns.line}, 0) as credits
      from journal_lines l
      join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      where e.entry_date between ${from} and ${to} and ${accounts('l')}`);
  }
  if (parts.length === 0) return [];
  const result = await tx.execute<{
    account_id: string;
    dimension_set_id: string;
    debits: string;
    credits: string;
    net: string;
  }>(sql`
    select s.account_id, s.dimension_set_id, sum(s.debits)::text as debits,
      sum(s.credits)::text as credits, (sum(s.debits) - sum(s.credits))::text as net
    from (${sql.join(parts, sql` union all `)}) s
    group by s.account_id, s.dimension_set_id`);
  return result.rows.map((row) => ({
    accountId: row.account_id,
    setId: row.dimension_set_id,
    debits: BigInt(row.debits),
    credits: BigInt(row.credits),
    net: BigInt(row.net),
  }));
}

/** The sums per account, summed over dimension sets in SQL. */
async function accountSums(
  tx: Transaction,
  ledger: Ledger,
  range: { readonly from: string | null; readonly to: string },
): Promise<Map<string, { debits: bigint; credits: bigint; net: bigint }>> {
  const { months, days } = segmentsOf(range.from, range.to);
  const columns = ledgerColumns(ledger);
  const parts = [];
  if (months !== null) {
    parts.push(sql`
      select pb.account_id, ${columns.debit} as debits, ${columns.credit} as credits
      from period_balances pb
      join periods p on p.company_id = pb.company_id and p.id = pb.period_id
      where ${months.from === null ? sql`true` : sql`p.period >= ${months.from}`}
        and p.period <= ${months.to}`);
  }
  for (const [from, to] of days) {
    parts.push(sql`
      select l.account_id, greatest(${columns.line}, 0) as debits, greatest(-${columns.line}, 0) as credits
      from journal_lines l
      join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      where e.entry_date between ${from} and ${to}`);
  }
  if (parts.length === 0) return new Map();
  const result = await tx.execute<{
    account_id: string;
    debits: string;
    credits: string;
    net: string;
  }>(sql`
    select s.account_id, sum(s.debits)::text as debits, sum(s.credits)::text as credits,
      (sum(s.debits) - sum(s.credits))::text as net
    from (${sql.join(parts, sql` union all `)}) s
    group by s.account_id`);
  return new Map(
    result.rows.map((row) => [
      row.account_id,
      { debits: BigInt(row.debits), credits: BigInt(row.credits), net: BigInt(row.net) },
    ]),
  );
}

/**
 * S10 rule 32: the debits and credits per account of the opening entries (the opening, its
 * reversal and a new opening, all of source `opening` on the books start) dated in a range, which
 * a trial balance, general ledger or account statement reads as its opening balance.
 */
async function openingEntrySums(
  tx: Transaction,
  ledger: Ledger,
  range: { readonly from: string; readonly to: string },
): Promise<Map<string, { debits: bigint; credits: bigint }>> {
  const { line } = ledgerColumns(ledger);
  const result = await tx.execute<{ account_id: string; debits: string; credits: string }>(sql`
    select l.account_id, sum(greatest(${line}, 0))::text as debits,
      sum(greatest(-${line}, 0))::text as credits
    from journal_lines l
    join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    where e.source = 'opening' and e.entry_date between ${range.from} and ${range.to}
    group by l.account_id`);
  return new Map(
    result.rows.map((row) => [
      row.account_id,
      { debits: BigInt(row.debits), credits: BigInt(row.credits) },
    ]),
  );
}

/** Whether an opening entry is dated in a range (S10 rule 32's mark). */
async function holdsOpeningEntry(
  tx: Transaction,
  range: { readonly from: string; readonly to: string },
): Promise<boolean> {
  const [row] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      sql`${journalEntries.source} = 'opening' and ${journalEntries.entryDate} between ${range.from} and ${range.to}`,
    )
    .limit(1);
  return row !== undefined;
}

/**
 * S10 rule 32 in SQL over `e` (an entry): its lines are before a range starting on `from` when
 * dated before it, or when it is an opening entry dated up to `to` (the opening column); they are
 * in the range otherwise when dated in it.
 */
const beforeRange = (from: string, to: string) =>
  sql`(e.entry_date < ${from} or (e.source = 'opening' and e.entry_date <= ${to}))`;
const inRange = (from: string, to: string) =>
  sql`(e.entry_date between ${from} and ${to} and e.source <> 'opening')`;

// --- Headers and marks (rule 4) ---

async function hasLinesIn(tx: Transaction, from: string | null, to: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      from === null
        ? sql`${journalEntries.entryDate} <= ${to}`
        : sql`${journalEntries.entryDate} between ${from} and ${to}`,
    )
    .limit(1);
  return row !== undefined;
}

/** What a column's S10 marks depend on besides its dates. */
interface ColumnKind {
  /** A trial balance, general ledger or account statement: it reads the opening entry apart. */
  readonly opensWithEntry?: boolean;
  readonly incomeStatement?: boolean;
}

async function columnOf(
  tx: Transaction,
  context: ReportContext,
  range: { readonly from: string | null; readonly to: string },
  kind: ColumnKind,
): Promise<ReportColumn> {
  const closed = await readClosedPeriods(tx);
  // A balance reads from the start of the books: the company's first period.
  const start =
    range.from ?? (context.firstPeriod === null ? range.to : `${context.firstPeriod}-01`);
  const anyMonthOpen = monthsBetween(start < range.to ? start : range.to, range.to).some(
    (month) => !isClosedPeriod(closed, month),
  );
  const monthEnd = range.to === lastDayOfMonth(range.to);
  const revaluationCurrent =
    monthEnd &&
    (await revaluationCheck(tx, periodOf(range.to), context.ledger)).state === 'current';
  return {
    from: range.from,
    to: range.to,
    marks: reportMarks({
      anyMonthOpen,
      to: range.to,
      revaluationCurrent,
      booksStart: booksStartMarks({
        booksStart: context.booksStart,
        from: range.from,
        to: range.to,
        fiscalYearStartMonth: context.fiscalYearStartMonth,
        readsOpeningEntry:
          kind.opensWithEntry === true &&
          range.from !== null &&
          (await holdsOpeningEntry(tx, { from: range.from, to: range.to })),
        incomeStatement: kind.incomeStatement === true,
      }),
    }),
    hasLines: await hasLinesIn(tx, range.from, range.to),
  };
}

async function headerOf(
  tx: Transaction,
  context: ReportContext,
  current: { readonly from: string | null; readonly to: string },
  compare: { readonly from: string | null; readonly to: string } | null,
  now: Date,
  kind: ColumnKind = {},
): Promise<ReportHeader> {
  const [latest] = await tx
    .select({ fiscalYear: journalEntries.fiscalYear, number: journalEntries.number })
    .from(journalEntries)
    .where(sql`${journalEntries.entryDate} <= ${current.to}`)
    .orderBy(sql`${journalEntries.sequence} desc`)
    .limit(1);
  return {
    ledger: context.ledger,
    currency: context.currency,
    producedAt: now.toISOString(),
    latestEntry: latest ?? null,
    booksStart: context.booksStart,
    current: await columnOf(tx, context, current, kind),
    // A trial balance's comparative is a balance at its end: no opening column of its own.
    compare:
      compare === null
        ? null
        : await columnOf(tx, context, compare, { incomeStatement: kind.incomeStatement === true }),
  };
}

/** A period's comparative: the one asked, none, or rule 5's default. */
function comparativeOf(query: {
  from: string;
  to: string;
  compare: boolean;
  compareFrom?: string | undefined;
  compareTo?: string | undefined;
}): { from: string; to: string } | null {
  if (query.compareFrom !== undefined && query.compareTo !== undefined) {
    return { from: query.compareFrom, to: query.compareTo };
  }
  return query.compare ? previousPeriod(query.from, query.to) : null;
}

const text = (amount: bigint) => amount.toString();
const textOrNull = (amount: bigint | null) => (amount === null ? null : amount.toString());

// --- Trial balance (rule 9) ---

/** `GET /api/reports/trial-balance`. */
export async function readTrialBalance(
  tx: Transaction,
  query: TrialBalanceQuery,
  now: Date,
): Promise<TrialBalance> {
  const context = await contextOf(tx, query.ledger);
  const chart = await readChart(tx);
  const compare = comparativeOf(query);
  const net = (rows: Map<string, { net: bigint }>) =>
    new Map([...rows.entries()].map(([id, row]) => [id, row.net]));
  // S10 rule 32: the opening entry is the opening column, the period's columns start after it.
  const { opening, movements } = withOpeningEntry(
    net(await accountSums(tx, context.ledger, { from: null, to: dayBefore(query.from) })),
    await accountSums(tx, context.ledger, { from: query.from, to: query.to }),
    await openingEntrySums(tx, context.ledger, { from: query.from, to: query.to }),
  );
  const compared =
    compare === null
      ? null
      : net(await accountSums(tx, context.ledger, { from: null, to: compare.to }));
  const { rows, totals } = trialBalance({
    accounts: chart,
    opening,
    movements,
    compare: compared,
    level: query.level,
    nonZero: query.nonZero,
    codeFrom: query.codeFrom,
    codeTo: query.codeTo,
  });
  const account = chartIndex(chart);
  return {
    header: await headerOf(tx, context, { from: query.from, to: query.to }, compare, now, {
      opensWithEntry: true,
    }),
    rows: rows.map((row) => ({
      account: account(row.accountId).report,
      opening: text(row.opening),
      debits: text(row.debits),
      credits: text(row.credits),
      closing: text(row.closing),
      compare: textOrNull(row.compare),
    })),
    totals: {
      openingDebit: text(totals.openingDebit),
      openingCredit: text(totals.openingCredit),
      debits: text(totals.debits),
      credits: text(totals.credits),
      closingDebit: text(totals.closingDebit),
      closingCredit: text(totals.closingCredit),
      compareDebit: textOrNull(totals.compareDebit),
      compareCredit: textOrNull(totals.compareCredit),
    },
  };
}

// --- Lines with running balances (rules 10, 11) ---

interface LineCursor {
  readonly code: string;
  readonly date: string;
  readonly number: number;
  readonly line: number;
}

function encodeCursor(cursor: LineCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(cursor: string | undefined): LineCursor | null {
  if (cursor === undefined) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as LineCursor;
    if (
      typeof value.code === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      Number.isInteger(value.number) &&
      Number.isInteger(value.line)
    ) {
      return value;
    }
  } catch {
    // Answered below.
  }
  throw new DomainError('VALIDATION_FAILED', 'Unreadable cursor', { field: 'cursor' });
}

type RunningRow = {
  account_id: string;
  code: string;
  entry_id: string;
  fiscal_year: number;
  number: number;
  entry_date: string;
  line_no: number;
  description: string;
  memo: string | null;
  dimension_set_id: string;
  currency: string;
  amount: string;
  balance: string;
  balance_before: string;
  transaction_amount: string;
  transaction_balance: string;
  item_id: string | null;
  item_reference: string | null;
  hub_document: ReportLine['hubDocument'];
};

/**
 * The lines of some accounts over a range in `(code, entry_date, number, line)` order, with the
 * ledger balance after each from the account's opening and the running balance of its currency,
 * summed in SQL, after the cursor, one more than a page.
 */
async function runningLines(
  tx: Transaction,
  ledger: Ledger,
  input: {
    readonly accountIds: readonly string[];
    readonly from: string;
    readonly to: string;
    readonly dims: readonly string[];
    readonly currency?: string | undefined;
    readonly cursor: LineCursor | null;
  },
): Promise<RunningRow[]> {
  if (input.accountIds.length === 0) return [];
  const amount =
    ledger === 'book' ? sql.raw('l.book_minor') : sql.raw('coalesce(l.parallel_minor, 0)');
  const filters = sql.join(
    [
      sql`l.account_id in (${sql.join(
        input.accountIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
      input.currency === undefined ? sql`true` : sql`l.currency = ${input.currency}`,
      ...input.dims.map(
        (valueId) => sql`exists (select 1 from dimension_set_values v
          where v.company_id = l.company_id and v.set_id = l.dimension_set_id and v.value_id = ${valueId}::uuid)`,
      ),
    ],
    sql` and `,
  );
  const cursor = input.cursor;
  const result = await tx.execute<RunningRow>(sql`
    with opening as (
      select l.account_id, l.currency, sum(${amount}) as ledger, sum(l.amount_minor) as transaction
      from journal_lines l
      join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      where ${filters} and ${beforeRange(input.from, input.to)}
      group by l.account_id, l.currency
    ),
    opening_ledger as (
      select account_id, sum(ledger) as ledger from opening group by account_id
    ),
    ranged as (
      select l.account_id, a.code, l.entry_id, e.fiscal_year, e.number,
        to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.entry_date as sort_date, l.line_no,
        e.description, l.memo, l.dimension_set_id, l.currency, e.hub_document,
        (${amount})::text as amount,
        (coalesce(ol.ledger, 0) + sum(${amount}) over (partition by l.account_id
          order by e.entry_date, e.number, l.line_no rows between unbounded preceding and current row))::text as balance,
        (coalesce(ol.ledger, 0) + coalesce(sum(${amount}) over (partition by l.account_id
          order by e.entry_date, e.number, l.line_no rows between unbounded preceding and 1 preceding), 0))::text
          as balance_before,
        l.amount_minor::text as transaction_amount,
        (coalesce(o.transaction, 0) + sum(l.amount_minor) over (partition by l.account_id, l.currency
          order by e.entry_date, e.number, l.line_no rows between unbounded preceding and current row))::text
          as transaction_balance,
        m.item_id, i.reference as item_reference
      from journal_lines l
      join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      join chart_accounts a on a.company_id = l.company_id and a.id = l.account_id
      left join opening_ledger ol on ol.account_id = l.account_id
      left join opening o on o.account_id = l.account_id and o.currency = l.currency
      left join open_item_movements m on m.company_id = l.company_id and m.line_id = l.id
      left join open_items i on i.company_id = m.company_id and i.id = m.item_id
      where ${filters} and ${inRange(input.from, input.to)}
    )
    select * from ranged
    where ${
      cursor === null
        ? sql`true`
        : sql`(code, sort_date, number, line_no) > (${cursor.code}, ${cursor.date}::date, ${cursor.number}, ${cursor.line})`
    }
    order by code, sort_date, number, line_no
    limit ${REPORT_PAGE_LINES + 1}`);
  return result.rows;
}

function reportLineOf(row: RunningRow, values: Map<string, ReportValue[]>): ReportLine {
  return {
    entryId: row.entry_id,
    fiscalYear: row.fiscal_year,
    number: row.number,
    entryDate: row.entry_date,
    lineNo: row.line_no,
    description: row.description,
    memo: row.memo,
    values: values.get(row.dimension_set_id) ?? [],
    amount: row.amount,
    balance: row.balance,
    currency: row.currency as CurrencyCode,
    transactionAmount: row.transaction_amount,
    transactionBalance: row.transaction_balance,
    openItem:
      row.item_id === null ? null : { id: row.item_id, reference: row.item_reference ?? '' },
    hubDocument: row.hub_document,
  };
}

const cursorOf = (row: RunningRow): LineCursor => ({
  code: row.code,
  date: row.entry_date,
  number: row.number,
  line: row.line_no,
});

/** `GET /api/reports/general-ledger`: the accounts of a code range, 200 lines a page. */
export async function readGeneralLedger(
  tx: Transaction,
  query: GeneralLedgerQuery,
  now: Date,
): Promise<GeneralLedger> {
  const context = await contextOf(tx, query.ledger);
  const chart = (await readChart(tx)).filter(
    (account) =>
      account.postable &&
      (query.codeFrom === undefined ||
        account.code.slice(0, query.codeFrom.length) >= query.codeFrom) &&
      (query.codeTo === undefined || account.code.slice(0, query.codeTo.length) <= query.codeTo),
  );
  const closing = await accountSums(tx, context.ledger, { from: null, to: query.to });
  // S10 rule 32: the opening entry is in the opening balance, the lines start after it.
  const balances = await accountSums(tx, context.ledger, { from: null, to: dayBefore(query.from) });
  const { opening, movements } = withOpeningEntry(
    new Map([...balances.entries()].map(([id, row]) => [id, row.net])),
    await accountSums(tx, context.ledger, { from: query.from, to: query.to }),
    await openingEntrySums(tx, context.ledger, { from: query.from, to: query.to }),
  );
  const shown = chart.filter(
    (account) =>
      (opening.get(account.id) ?? 0n) !== 0n ||
      (movements.get(account.id)?.debits ?? 0n) !== 0n ||
      (movements.get(account.id)?.credits ?? 0n) !== 0n,
  );
  const cursor = decodeCursor(query.cursor);
  const rows = await runningLines(tx, context.ledger, {
    accountIds: shown.map((account) => account.id),
    from: query.from,
    to: query.to,
    dims: [],
    cursor,
  });
  const page = rows.slice(0, REPORT_PAGE_LINES);
  const more = rows.length > REPORT_PAGE_LINES;
  const last = page.at(-1);
  const values = await setValues(
    tx,
    page.map((row) => row.dimension_set_id),
  );
  // The accounts of this page: from the cursor's account to the last line's, or to the end.
  const accounts = shown.filter(
    (account) =>
      (cursor === null ||
        account.code > cursor.code ||
        (account.code === cursor.code && page.some((row) => row.account_id === account.id))) &&
      (!more || last === undefined || account.code <= last.code),
  );
  return {
    header: await headerOf(tx, context, { from: query.from, to: query.to }, null, now, {
      opensWithEntry: true,
    }),
    accounts: accounts.map((account) => {
      const lines = page.filter((row) => row.account_id === account.id);
      const first = lines[0];
      return {
        account: account.report,
        // Before its first line on this page: the opening, or the balance it continues from.
        opening: first === undefined ? text(opening.get(account.id) ?? 0n) : first.balance_before,
        lines: lines.map((row) => reportLineOf(row, values)),
        closing: text(closing.get(account.id)?.net ?? 0n),
      };
    }),
    nextCursor: more && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}

/** `GET /api/reports/accounts/:id/statement` (rule 11). */
export async function readAccountStatement(
  tx: Transaction,
  accountId: string,
  query: AccountStatementQuery,
  now: Date,
): Promise<AccountStatement> {
  const context = await contextOf(tx, query.ledger);
  const [row] = (await readChart(tx)).filter((account) => account.id === accountId);
  if (row === undefined || !row.postable) throw new DomainError('NOT_FOUND', 'No such account');
  const cursor = decodeCursor(query.cursor);
  const lines = await runningLines(tx, context.ledger, {
    accountIds: [accountId],
    from: query.from,
    to: query.to,
    dims: query.dims,
    currency: query.currency,
    cursor,
  });
  const page = lines.slice(0, REPORT_PAGE_LINES);
  const more = lines.length > REPORT_PAGE_LINES;
  const last = page.at(-1);
  const values = await setValues(
    tx,
    page.map((line) => line.dimension_set_id),
  );
  const amount =
    context.ledger === 'book' ? sql.raw('l.book_minor') : sql.raw('coalesce(l.parallel_minor, 0)');
  const filters = sql.join(
    [
      sql`l.account_id = ${accountId}::uuid`,
      query.currency === undefined ? sql`true` : sql`l.currency = ${query.currency}`,
      ...query.dims.map(
        (valueId) => sql`exists (select 1 from dimension_set_values v
          where v.company_id = l.company_id and v.set_id = l.dimension_set_id and v.value_id = ${valueId}::uuid)`,
      ),
    ],
    sql` and `,
  );
  // Each currency's opening and closing on the account, and the ledger's, over the same lines;
  // the opening entry in the opening (S10 rule 32).
  const opened = beforeRange(query.from, query.to);
  const balances = await tx.execute<{
    currency: string;
    opening: string;
    closing: string;
    ledger_opening: string;
    ledger_closing: string;
  }>(sql`
    select l.currency,
      coalesce(sum(l.amount_minor) filter (where ${opened}), 0)::text as opening,
      coalesce(sum(l.amount_minor), 0)::text as closing,
      coalesce(sum(${amount}) filter (where ${opened}), 0)::text as ledger_opening,
      coalesce(sum(${amount}), 0)::text as ledger_closing
    from journal_lines l
    join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    where ${filters} and e.entry_date <= ${query.to}
    group by l.currency
    order by l.currency`);
  const totals = await tx.execute<{ opening: string; closing: string }>(sql`
    select coalesce(sum(${amount}) filter (where ${opened}), 0)::text as opening,
      coalesce(sum(${amount}), 0)::text as closing
    from journal_lines l
    join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    where ${filters} and e.entry_date <= ${query.to}`);
  const first = page[0];
  return {
    header: await headerOf(tx, context, { from: query.from, to: query.to }, null, now, {
      opensWithEntry: true,
    }),
    account: row.report,
    opening:
      cursor !== null && first !== undefined
        ? first.balance_before
        : (totals.rows[0]?.opening ?? '0'),
    lines: page.map((line) => reportLineOf(line, values)),
    closing: totals.rows[0]?.closing ?? '0',
    currencies: balances.rows
      .filter(
        (balance) =>
          balance.opening !== '0' ||
          balance.closing !== '0' ||
          page.some((line) => line.currency === balance.currency),
      )
      .map((balance) => ({
        currency: balance.currency as CurrencyCode,
        opening: balance.opening,
        closing: balance.closing,
      })),
    nextCursor: more && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}

// --- Journal (rule 12) ---

interface EntryCursor {
  readonly date: string;
  readonly number: number;
}

/** `GET /api/reports/journal`: whole entries in `(entry_date, number)` order, about 200 lines a page. */
export async function readJournal(
  tx: Transaction,
  query: JournalQuery,
  now: Date,
): Promise<Journal> {
  const context = await contextOf(tx, query.ledger);
  let cursor: EntryCursor | null = null;
  if (query.cursor !== undefined) {
    const decoded = decodeCursor(query.cursor);
    cursor = decoded === null ? null : { date: decoded.date, number: decoded.number };
  }
  const entries = await tx.execute<{
    id: string;
    fiscal_year: number;
    number: number;
    entry_date: string;
    source: string;
    description: string;
    reference: string | null;
    hub_document: ReportLine['hubDocument'];
    running: number;
  }>(sql`
    with ranged as (
      select e.id, e.fiscal_year, e.number, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date,
        e.entry_date as sort_date, e.source, e.description, e.reference, e.hub_document,
        sum(e.line_count) over (order by e.entry_date, e.number
          rows between unbounded preceding and current row)::int as running
      from journal_entries e
      where e.entry_date between ${query.from} and ${query.to}
        and ${cursor === null ? sql`true` : sql`(e.entry_date, e.number) > (${cursor.date}::date, ${cursor.number})`}
    )
    select * from ranged
    where running <= ${REPORT_PAGE_LINES}
      or running = (select min(r.running) from ranged r)
    order by sort_date, number
    limit ${REPORT_PAGE_LINES + 1}`);
  const ids = entries.rows.map((entry) => entry.id);
  const more =
    ids.length > 0 &&
    (
      await tx.execute<{ more: boolean }>(sql`
        select exists (select 1 from journal_entries e
          where e.entry_date between ${query.from} and ${query.to}
            and (e.entry_date, e.number) > (${entries.rows.at(-1)?.entry_date ?? query.to}::date, ${entries.rows.at(-1)?.number ?? 0})) as more`)
    ).rows[0]?.more === true;
  const amount =
    context.ledger === 'book' ? sql.raw('l.book_minor') : sql.raw('coalesce(l.parallel_minor, 0)');
  const lines =
    ids.length === 0
      ? []
      : (
          await tx.execute<{
            entry_id: string;
            line_no: number;
            account_id: string;
            code: string;
            name: string;
            memo: string | null;
            dimension_set_id: string;
            debit: string;
            credit: string;
          }>(sql`
            select l.entry_id, l.line_no, l.account_id, a.code, a.name, l.memo, l.dimension_set_id,
              greatest(${amount}, 0)::text as debit, greatest(-${amount}, 0)::text as credit
            from journal_lines l
            join chart_accounts a on a.company_id = l.company_id and a.id = l.account_id
            where l.entry_id in (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
            order by l.entry_id, l.line_no`)
        ).rows;
  const values = await setValues(
    tx,
    lines.map((line) => line.dimension_set_id),
  );
  const last = entries.rows.at(-1);
  return {
    header: await headerOf(tx, context, { from: query.from, to: query.to }, null, now),
    entries: entries.rows.map((entry) => ({
      entryId: entry.id,
      fiscalYear: entry.fiscal_year,
      number: entry.number,
      entryDate: entry.entry_date,
      source: entry.source,
      description: entry.description,
      reference: entry.reference,
      hubDocument: entry.hub_document,
      lines: lines
        .filter((line) => line.entry_id === entry.id)
        .map((line) => ({
          lineNo: line.line_no,
          account: { id: line.account_id, code: line.code, name: line.name },
          memo: line.memo,
          values: values.get(line.dimension_set_id) ?? [],
          debit: line.debit,
          credit: line.credit,
        })),
    })),
    nextCursor:
      more && last !== undefined
        ? encodeCursor({ code: '', date: last.entry_date, number: last.number, line: 0 })
        : null,
  };
}

// --- Income statement (rules 13, 14) ---

/** `GET /api/reports/income-statement`. */
export async function readIncomeStatement(
  tx: Transaction,
  query: IncomeStatementQuery,
  now: Date,
): Promise<IncomeStatement> {
  const context = await contextOf(tx, query.ledger);
  const chart = await readChart(tx);
  const compare = comparativeOf(query);
  const netOf = async (range: { from: string; to: string }) =>
    new Map(
      [...(await accountSums(tx, context.ledger, range)).entries()]
        .filter(([id]) => INCOME_LINE_CODES.has(chartIndex(chart)(id).statementLine ?? ''))
        .map(([id, row]) => [id, row.net]),
    );
  const statement = incomeStatement({
    accounts: chart,
    current: await netOf(query),
    compare: compare === null ? null : await netOf(compare),
  });
  const account = chartIndex(chart);
  const subtotals = (value: (typeof statement)['subtotals']) => ({
    operatingProfit: text(value.operatingProfit),
    profitBeforeFinancingAndIncomeTaxes: textOrNull(value.profitBeforeFinancingAndIncomeTaxes),
    profitBeforeTax: text(value.profitBeforeTax),
    profit: text(value.profit),
  });
  return {
    header: await headerOf(tx, context, { from: query.from, to: query.to }, compare, now, {
      incomeStatement: true,
    }),
    lines: statement.lines.map((line) => ({
      line: line.line,
      amount: text(line.amount),
      compare: textOrNull(line.compare),
      accounts: line.accounts.map((part) => ({
        account: account(part.accountId).report,
        amount: text(part.amount),
        compare: textOrNull(part.compare),
      })),
    })),
    subtotals: subtotals(statement.subtotals),
    compareSubtotals:
      statement.compareSubtotals === null ? null : subtotals(statement.compareSubtotals),
  };
}

// --- Balance sheet (rules 15–19) ---

/**
 * The balance-sheet accounts' balances at a date per client and contract, and classes 4–5's net
 * debit of the fiscal year and of the years before it.
 */
async function balanceColumn(
  tx: Transaction,
  context: ReportContext,
  chart: readonly ChartRow[],
  asOf: string,
) {
  const account = chartIndex(chart);
  const rows = await ledgerSums(tx, context.ledger, { from: null, to: asOf });
  const sets = await setValues(
    tx,
    rows.map((row) => row.setId),
  );
  const valueOfSet = (setId: string, type: string) =>
    sets.get(setId)?.find((value) => value.typeCode === type)?.id ?? null;
  const balances: PresentationBalance[] = [];
  for (const row of rows) {
    if (INCOME_LINE_CODES.has(account(row.accountId).statementLine ?? '')) continue;
    balances.push({
      accountId: row.accountId,
      clientId: valueOfSet(row.setId, 'client'),
      contractId: valueOfSet(row.setId, 'contract'),
      amount: row.net,
    });
  }
  const yearStart = fiscalYearStart(asOf, context.fiscalYearStartMonth);
  const incomeNet = async (range: { from: string | null; to: string }) => {
    const sums = await accountSums(tx, context.ledger, range);
    return [...sums.entries()]
      .filter(([id]) => INCOME_LINE_CODES.has(account(id).statementLine ?? ''))
      .map(([, row]) => row.net);
  };
  // S10 rule 31: in the books start's fiscal year, the result before it is the year's.
  const booksStartYear =
    context.booksStart !== null &&
    fiscalYearStart(context.booksStart, context.fiscalYearStartMonth) === yearStart;
  return {
    balances,
    yearNet: sumAmounts(await incomeNet({ from: yearStart, to: asOf })),
    unclosedNet: sumAmounts(await incomeNet({ from: null, to: dayBefore(yearStart) })),
    yearResultAccountIds: booksStartYear ? context.preOpeningAccountIds : [],
  };
}

/** `GET /api/reports/balance-sheet`. */
export async function readBalanceSheet(
  tx: Transaction,
  query: BalanceSheetQuery,
  now: Date,
): Promise<BalanceSheet> {
  const context = await contextOf(tx, query.ledger);
  const chart = await readChart(tx);
  const compareAsOf =
    query.compareAsOf ??
    (query.compare
      ? balanceSheetComparative(query.asOf, context.fiscalYearStartMonth, context.firstPeriod)
      : null);
  const sheet = balanceSheet({
    accounts: chart,
    current: await balanceColumn(tx, context, chart, query.asOf),
    compare: compareAsOf === null ? null : await balanceColumn(tx, context, chart, compareAsOf),
  });
  const account = chartIndex(chart);
  const values = await valuesById(
    tx,
    sheet.lines.flatMap((line) =>
      line.parts.flatMap((part) => [part.clientId, part.contractId].filter((id) => id !== null)),
    ),
  );
  const valueRef = (id: string | null): ReportValue | null => {
    if (id === null) return null;
    const value = values.get(id);
    if (value === undefined) throw new Error('A part names a value that is not there');
    const { contractKind: _kind, ...ref } = value;
    return ref;
  };
  const totals = (value: (typeof sheet)['totals']) => ({
    assets: text(value.assets),
    liabilities: text(value.liabilities),
    equity: text(value.equity),
    liabilitiesAndEquity: text(value.liabilitiesAndEquity),
  });
  return {
    header: await headerOf(
      tx,
      context,
      { from: null, to: query.asOf },
      compareAsOf === null ? null : { from: null, to: compareAsOf },
      now,
    ),
    lines: sheet.lines.map((line) => ({
      line: line.line,
      amount: text(line.amount),
      compare: textOrNull(line.compare),
      reclassified: text(line.reclassified),
      unclosedYears: textOrNull(line.unclosedYears),
      compareUnclosedYears: textOrNull(line.compareUnclosedYears),
      parts: line.parts.map((part) => ({
        account: account(part.accountId).report,
        client: valueRef(part.clientId),
        contract: valueRef(part.contractId),
        amount: text(part.amount),
        reclassified: part.reclassified,
        oppositeSide: part.oppositeSide,
      })),
    })),
    yearResult: text(sheet.yearResult),
    compareYearResult: textOrNull(sheet.compareYearResult),
    yearResultPreOpening: text(sheet.yearResultPreOpening),
    compareYearResultPreOpening: textOrNull(sheet.compareYearResultPreOpening),
    totals: totals(sheet.totals),
    compareTotals: sheet.compareTotals === null ? null : totals(sheet.compareTotals),
  };
}

// --- Profitability (rules 20–23) ---

/**
 * The revenue and direct-cost lines of a range per the chosen dimension's value. A department is
 * a line's own, else its service's in force on its date (rule 22); a line with neither is
 * "غير موزع".
 */
async function profitabilityAmounts(
  tx: Transaction,
  ledger: Ledger,
  by: ProfitabilityDimension,
  range: { from: string; to: string },
  chart: readonly ChartRow[],
  side: 'current' | 'compare',
): Promise<ProfitabilityAmount[]> {
  const accounts = chart.filter(
    (account) =>
      account.statementLine === 'is.revenue' || account.statementLine === 'is.direct_costs',
  );
  if (accounts.length === 0) return [];
  const amount =
    ledger === 'book' ? sql.raw('l.book_minor') : sql.raw('coalesce(l.parallel_minor, 0)');
  const typeId = await builtinTypeId(tx, by);
  const serviceType = await builtinTypeId(tx, 'service');
  const rows = await tx.execute<{
    account_id: string;
    value_id: string | null;
    service_id: string | null;
    entry_date: string;
    net: string;
  }>(sql`
    select l.account_id, v.value_id, s.value_id as service_id,
      to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, sum(${amount})::text as net
    from journal_lines l
    join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    left join dimension_set_values v on v.company_id = l.company_id
      and v.set_id = l.dimension_set_id and v.type_id = ${typeId}::uuid
    left join dimension_set_values s on s.company_id = l.company_id
      and s.set_id = l.dimension_set_id and s.type_id = ${serviceType}::uuid
    where e.entry_date between ${range.from} and ${range.to}
      and l.account_id in (${sql.join(
        accounts.map((account) => sql`${account.id}::uuid`),
        sql`, `,
      )})
    group by l.account_id, v.value_id, s.value_id, e.entry_date`);
  const history =
    by === 'department'
      ? await readServiceDepartmentRows(tx, [
          ...new Set(rows.rows.flatMap((row) => (row.service_id === null ? [] : [row.service_id]))),
        ])
      : [];
  const account = chartIndex(chart);
  return rows.rows.map((row) => {
    const statementLine = account(row.account_id).statementLine ?? '';
    // Rule 22: a revenue line without a department takes its service's; a cost line does not.
    const valueId =
      row.value_id ??
      (by === 'department' && statementLine === 'is.revenue' && row.service_id !== null
        ? departmentInForce(history, row.service_id, row.entry_date)
        : null);
    const net = BigInt(row.net);
    return {
      statementLine,
      valueId,
      current: side === 'current' ? net : 0n,
      compare: side === 'compare' ? net : 0n,
    };
  });
}

/** `GET /api/reports/profitability`; the parallel ledger by default when the company keeps one. */
export async function readProfitability(
  tx: Transaction,
  query: ProfitabilityQuery,
  now: Date,
): Promise<Profitability> {
  const settings = await contextOf(tx, undefined);
  const context = await contextOf(tx, query.ledger ?? (settings.hasParallel ? 'parallel' : 'book'));
  const chart = await readChart(tx);
  const compare = comparativeOf(query);
  const amounts = [
    ...(await profitabilityAmounts(tx, context.ledger, query.by, query, chart, 'current')),
    ...(compare === null
      ? []
      : await profitabilityAmounts(tx, context.ledger, query.by, compare, chart, 'compare')),
  ];
  const report = profitability({ amounts, compared: compare !== null });
  const values = await valuesById(
    tx,
    report.rows.flatMap((row) => (row.valueId === null ? [] : [row.valueId])),
  );
  const figures = (value: (typeof report)['totals']['current']) => ({
    revenue: text(value.revenue),
    directCosts: text(value.directCosts),
    contribution: text(value.contribution),
    margin: value.margin,
  });
  const sortKey = (id: string | null) => {
    if (id === null) return '￿';
    const value = values.get(id);
    return `${value?.code ?? ''}\u0000${value?.name ?? ''}`;
  };
  return {
    header: await headerOf(tx, context, { from: query.from, to: query.to }, compare, now),
    by: query.by,
    rows: [...report.rows]
      .sort((a, b) => (sortKey(a.valueId) < sortKey(b.valueId) ? -1 : 1))
      .map((row) => {
        const value = row.valueId === null ? undefined : values.get(row.valueId);
        return {
          value:
            value === undefined
              ? null
              : {
                  id: value.id,
                  typeCode: value.typeCode,
                  code: value.code,
                  name: value.name,
                  archived: value.archived,
                },
          current: figures(row.current),
          compare: row.compare === null ? null : figures(row.compare),
        };
      }),
    totals: {
      current: figures(report.totals.current),
      compare: report.totals.compare === null ? null : figures(report.totals.compare),
    },
  };
}

// --- Contract position and release schedule (rules 24, 25) ---

/** `GET /api/reports/contract-position`. */
export async function readContractPosition(
  tx: Transaction,
  query: ContractPositionQuery,
  now: Date,
): Promise<ContractPosition> {
  const context = await contextOf(tx, query.ledger);
  const chart = await readChart(tx);
  const column = await balanceColumn(tx, context, chart, query.asOf);
  const balances = column.balances.filter(
    (row) => query.client === undefined || row.clientId === query.client,
  );
  const position = contractPosition({ accounts: chart, balances });
  const values = await valuesById(
    tx,
    position.rows.flatMap((row) => [
      row.contractId,
      ...(row.clientId === null ? [] : [row.clientId]),
    ]),
  );
  const ref = (id: string | null): ReportValue | null => {
    const value = id === null ? undefined : values.get(id);
    if (value === undefined) return null;
    return {
      id: value.id,
      typeCode: value.typeCode,
      code: value.code,
      name: value.name,
      archived: value.archived,
    };
  };
  return {
    header: await headerOf(tx, context, { from: null, to: query.asOf }, null, now),
    rows: position.rows
      .map((row) => ({
        contract: ref(row.contractId) as ReportValue,
        client: ref(row.clientId),
        kind: (values.get(row.contractId)?.contractKind ??
          null) as ContractPosition['rows'][number]['kind'],
        assets: text(row.assets),
        liabilities: text(row.liabilities),
        net: text(row.net),
      }))
      .sort((a, b) =>
        (a.contract.code ?? a.contract.name) < (b.contract.code ?? b.contract.name) ? -1 : 1,
      ),
    totals: {
      contractAssets: text(position.totals.contractAssets),
      contractLiabilities: text(position.totals.contractLiabilities),
      withoutContractAssets: text(position.totals.withoutContractAssets),
      withoutContractLiabilities: text(position.totals.withoutContractLiabilities),
    },
  };
}

/**
 * `GET /api/reports/revenue-schedule` (rule 25): each over-time schedule's months from `from` not
 * released yet at their planned parts, and each point-in-time schedule's remaining under "عند
 * الإنجاز", in the report's ledger, per contract.
 */
export async function readRevenueReleaseSchedule(
  tx: Transaction,
  query: RevenueReleaseScheduleQuery,
  now: Date,
): Promise<RevenueReleaseSchedule> {
  const context = await contextOf(tx, query.ledger);
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const ledgers = ledgersOf(settings);
  const schedules = await tx
    .select()
    .from(recognitionSchedules)
    .where(
      query.contract === undefined
        ? undefined
        : eq(recognitionSchedules.contractValueId, query.contract),
    )
    .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id));
  const amountIn = (amounts: { bookMinor: bigint; parallelMinor: bigint | null }) =>
    context.ledger === 'book' ? amounts.bookMinor : (amounts.parallelMinor ?? 0n);
  const parts: ReleasePart[] = [];
  const overTime = schedules.filter((schedule) => schedule.pattern === 'over_time');
  for (const state of await overTimeStates(tx, overTime, ledgers)) {
    if (state.voided) continue;
    for (const [month, part] of state.parts) {
      if (month < query.from || state.released.has(month)) continue;
      if (part.transaction.amountMinor === 0n) continue;
      parts.push({ contractId: state.schedule.contractValueId, month, amount: amountIn(part) });
    }
  }
  const pointInTime = schedules.filter((schedule) => schedule.pattern !== 'over_time');
  const movements = await movementsOf(
    tx,
    pointInTime.map((schedule) => schedule.id),
  );
  for (const schedule of pointInTime) {
    const currency = schedule.currency as CurrencyCode;
    const remaining = sumCarried(
      (movements.get(schedule.id) ?? []).map((movement) => amountsOf(movement, currency)),
      currency,
      ledgers.parallel !== null,
    );
    if (remaining.transaction.amountMinor === 0n) continue;
    parts.push({ contractId: schedule.contractValueId, month: null, amount: amountIn(remaining) });
  }
  const schedule = releaseSchedule(parts);
  const values = await valuesById(
    tx,
    schedule.rows.flatMap((row) => (row.contractId === null ? [] : [row.contractId])),
  );
  const contractIds = [...values.keys()];
  const clients =
    contractIds.length === 0
      ? []
      : await tx
          .select({ id: dimensionValues.id, parent: dimensionValues.parentValueId })
          .from(dimensionValues)
          .where(inArray(dimensionValues.id, contractIds));
  const clientValues = await valuesById(
    tx,
    clients.flatMap((row) => (row.parent === null ? [] : [row.parent])),
  );
  const ref = (value: (ReportValue & { contractKind: string | null }) | undefined) =>
    value === undefined
      ? null
      : {
          id: value.id,
          typeCode: value.typeCode,
          code: value.code,
          name: value.name,
          archived: value.archived,
        };
  const monthsOf = (map: ReadonlyMap<string, bigint>) =>
    schedule.months.map((month) => ({ month, amount: text(map.get(month) ?? 0n) }));
  return {
    header: await headerOf(
      tx,
      context,
      { from: `${query.from}-01`, to: lastDayOfMonth(`${query.from}-01`) },
      null,
      now,
    ),
    months: schedule.months,
    rows: schedule.rows.map((row) => {
      const parent = clients.find((client) => client.id === row.contractId)?.parent ?? null;
      return {
        contract: ref(row.contractId === null ? undefined : values.get(row.contractId)),
        client: ref(parent === null ? undefined : clientValues.get(parent)),
        months: monthsOf(row.months),
        atDone: text(row.atDone),
        total: text(row.total),
      };
    }),
    totals: {
      months: monthsOf(schedule.totals.months),
      atDone: text(schedule.totals.atDone),
      total: text(schedule.totals.total),
    },
  };
}

// --- The lines behind a figure (rule 6) ---

/** `GET /api/reports/lines`: the lines behind a figure, 200 a page, and the sum of all of them. */
export async function readReportLines(
  tx: Transaction,
  query: ReportLinesQuery,
  now: Date,
): Promise<ReportLines> {
  const context = await contextOf(tx, query.ledger);
  const chart = await readChart(tx);
  // An account and its subtree, or every postable account on the statement line.
  const descendants = (id: string): string[] => [
    id,
    ...chart
      .filter((account) => account.parentId === id)
      .flatMap((account) => descendants(account.id)),
  ];
  const accountIds = (
    query.account !== undefined
      ? descendants(query.account)
      : chart
          .filter((account) => account.statementLine === query.statementLine)
          .map((account) => account.id)
  ).filter((id) => chart.some((account) => account.id === id && account.postable));
  if (query.account !== undefined && !chart.some((account) => account.id === query.account)) {
    throw new DomainError('NOT_FOUND', 'No such account');
  }
  const amount =
    context.ledger === 'book' ? sql.raw('l.book_minor') : sql.raw('coalesce(l.parallel_minor, 0)');
  const has = (valueId: string) => sql`exists (select 1 from dimension_set_values v
    where v.company_id = l.company_id and v.set_id = l.dimension_set_id and v.value_id = ${valueId}::uuid)`;
  const conditions = [
    accountIds.length === 0
      ? sql`false`
      : sql`l.account_id in (${sql.join(
          accountIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
    query.from === undefined ? sql`true` : sql`e.entry_date >= ${query.from}`,
    sql`e.entry_date <= ${query.to}`,
    // S10 rule 32: the opening column's lines, or a range's without them.
    query.openingEntry
      ? sql`e.source = 'opening'`
      : query.from === undefined
        ? sql`true`
        : sql`e.source <> 'opening'`,
    query.side === 'debit'
      ? sql`${amount} > 0`
      : query.side === 'credit'
        ? sql`${amount} < 0`
        : sql`true`,
    ...[query.client, query.contract, ...query.dims].flatMap((id) =>
      id === undefined ? [] : [has(id)],
    ),
  ];
  let departmentLines: Set<string> | null = null;
  if (query.profitabilityBy !== undefined) {
    const typeId = await builtinTypeId(tx, query.profitabilityBy);
    const byType = sql`(select v.value_id from dimension_set_values v
      where v.company_id = l.company_id and v.set_id = l.dimension_set_id and v.type_id = ${typeId}::uuid)`;
    if (query.profitabilityBy === 'department') {
      // A department is the line's own, or its service's in force on its date: read in TS.
      const serviceType = await builtinTypeId(tx, 'service');
      const candidates = await tx.execute<{
        id: string;
        account_id: string;
        own: string | null;
        service: string | null;
        entry_date: string;
      }>(sql`
        select l.id, l.account_id, ${byType} as own,
          (select v.value_id from dimension_set_values v where v.company_id = l.company_id
            and v.set_id = l.dimension_set_id and v.type_id = ${serviceType}::uuid) as service,
          to_char(e.entry_date, 'YYYY-MM-DD') as entry_date
        from journal_lines l
        join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
        where ${sql.join(conditions, sql` and `)}`);
      const history = await readServiceDepartmentRows(tx);
      departmentLines = new Set(
        candidates.rows
          .filter((row) => {
            const revenue = chartIndex(chart)(row.account_id).statementLine === 'is.revenue';
            const department =
              row.own ??
              (row.service === null || !revenue
                ? null
                : departmentInForce(history, row.service, row.entry_date));
            return department === (query.profitabilityValue ?? null);
          })
          .map((row) => row.id),
      );
    } else {
      conditions.push(
        query.profitabilityValue === undefined
          ? sql`${byType} is null`
          : sql`${byType} = ${query.profitabilityValue}::uuid`,
      );
    }
  }
  if (departmentLines !== null) {
    conditions.push(
      departmentLines.size === 0
        ? sql`false`
        : // One array parameter, whatever the number of lines.
          sql`l.id = any(${`{${[...departmentLines].join(',')}}`}::uuid[])`,
    );
  }
  const where = sql.join(conditions, sql` and `);
  const [total] = (
    await tx.execute<{ sum: string; count: number }>(sql`
      select coalesce(sum(${amount}), 0)::text as sum, count(*)::int as count
      from journal_lines l
      join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      where ${where}`)
  ).rows;
  const cursor = decodeCursor(query.cursor);
  const rows = (
    await tx.execute<{
      entry_id: string;
      fiscal_year: number;
      number: number;
      entry_date: string;
      line_no: number;
      account_id: string;
      code: string;
      name: string;
      description: string;
      memo: string | null;
      dimension_set_id: string;
      amount: string;
      currency: string;
      transaction_amount: string;
      hub_document: ReportLine['hubDocument'];
    }>(sql`
      select l.entry_id, e.fiscal_year, e.number, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date,
        l.line_no, l.account_id, a.code, a.name, e.description, l.memo, l.dimension_set_id,
        (${amount})::text as amount, l.currency, l.amount_minor::text as transaction_amount, e.hub_document
      from journal_lines l
      join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      join chart_accounts a on a.company_id = l.company_id and a.id = l.account_id
      where ${where}
        and ${cursor === null ? sql`true` : sql`(e.entry_date, e.number, l.line_no) > (${cursor.date}::date, ${cursor.number}, ${cursor.line})`}
      order by e.entry_date, e.number, l.line_no
      limit ${REPORT_PAGE_LINES + 1}`)
  ).rows;
  const page = rows.slice(0, REPORT_PAGE_LINES);
  const last = page.at(-1);
  const values = await setValues(
    tx,
    page.map((row) => row.dimension_set_id),
  );
  return {
    header: await headerOf(tx, context, { from: query.from ?? null, to: query.to }, null, now),
    lines: page.map((row) => ({
      entryId: row.entry_id,
      fiscalYear: row.fiscal_year,
      number: row.number,
      entryDate: row.entry_date,
      lineNo: row.line_no,
      account: { id: row.account_id, code: row.code, name: row.name },
      description: row.description,
      memo: row.memo,
      values: values.get(row.dimension_set_id) ?? [],
      amount: row.amount,
      currency: row.currency as CurrencyCode,
      transactionAmount: row.transaction_amount,
      hubDocument: row.hub_document,
    })),
    sum: total?.sum ?? '0',
    count: total?.count ?? 0,
    nextCursor:
      rows.length > REPORT_PAGE_LINES && last !== undefined
        ? encodeCursor({ code: '', date: last.entry_date, number: last.number, line: last.line_no })
        : null,
  };
}

// --- The journal book (rules 26, 27) ---

/**
 * The journal book of months of one fiscal year (rules 26, 27): the book ledger's entries of the
 * year from its start to the end of `to`, paginated by `journalBookPages()`, with the range's
 * pages. `official` when every month of the range is closed (rule 28).
 */
export async function readJournalBook(
  tx: Transaction,
  query: JournalBookQuery,
  now: Date,
): Promise<JournalBook> {
  const context = await contextOf(tx, query.ledger);
  const yearStart = `${String(query.fiscalYear).padStart(4, '0')}-${String(context.fiscalYearStartMonth).padStart(2, '0')}-01`;
  const nextYearStart = `${String(query.fiscalYear + 1).padStart(4, '0')}${yearStart.slice(4)}`;
  const months = monthsBetween(yearStart, dayBefore(nextYearStart));
  if (!months.includes(query.from) || !months.includes(query.to)) {
    throw new DomainError('VALIDATION_FAILED', 'The months are of the fiscal year', {
      field: 'from',
    });
  }
  const end = lastDayOfMonth(`${query.to}-01`);
  const entries = await tx
    .select({
      id: journalEntries.id,
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
      entryDate: journalEntries.entryDate,
      description: journalEntries.description,
      reference: journalEntries.reference,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.fiscalYear, query.fiscalYear),
        sql`${journalEntries.entryDate} <= ${end}`,
      ),
    )
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.number));
  const lines =
    entries.length === 0
      ? []
      : await tx
          .select({
            entryId: journalLines.entryId,
            lineNo: journalLines.lineNo,
            code: chartAccounts.code,
            name: chartAccounts.name,
            memo: journalLines.memo,
            bookMinor: journalLines.bookMinor,
            parallelMinor: journalLines.parallelMinor,
          })
          .from(journalLines)
          .innerJoin(chartAccounts, eq(chartAccounts.id, journalLines.accountId))
          .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
          .where(
            and(
              eq(journalEntries.fiscalYear, query.fiscalYear),
              sql`${journalEntries.entryDate} <= ${end}`,
            ),
          )
          .orderBy(asc(journalLines.entryId), asc(journalLines.lineNo));
  const byEntry = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byEntry.get(line.entryId) ?? [];
    list.push(line);
    byEntry.set(line.entryId, list);
  }
  const pages = journalBookPages(
    entries.map((entry) => ({
      fiscalYear: entry.fiscalYear,
      number: entry.number,
      entryDate: entry.entryDate,
      description: entry.description,
      reference: entry.reference,
      lines: (byEntry.get(entry.id) ?? []).map((line) => ({
        accountCode: line.code,
        accountName: line.name,
        memo: line.memo,
        amount: context.ledger === 'book' ? line.bookMinor : (line.parallelMinor ?? 0n),
      })),
    })),
    { from: query.from, to: query.to },
  );
  const closed = await readClosedPeriods(tx);
  const range = monthsBetween(`${query.from}-01`, end);
  const debitsCredits = (value: { debits: bigint; credits: bigint }) => ({
    debits: text(value.debits),
    credits: text(value.credits),
  });
  return {
    header: await headerOf(tx, context, { from: `${query.from}-01`, to: end }, null, now),
    fiscalYear: query.fiscalYear,
    from: query.from,
    to: query.to,
    official: context.ledger === 'book' && range.every((month) => isClosedPeriod(closed, month)),
    pages: pages.map((page) => ({
      page: page.page,
      month: page.month,
      rows: page.rows.map((row) =>
        row.kind === 'line' ? { ...row, debit: text(row.debit), credit: text(row.credit) } : row,
      ),
      totals: debitsCredits(page.totals),
      broughtForward: debitsCredits(page.broughtForward),
      cumulative: debitsCredits(page.cumulative),
    })),
  };
}
