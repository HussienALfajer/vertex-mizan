import {
  divideHalfAwayFromZero,
  STATEMENT_LINES,
  type StatementLine,
} from '@vertex-mizan/contracts';
import {
  addDays,
  dayBefore,
  daysBetween,
  fiscalYearOf,
  lastDayOfMonth,
  periodOf,
} from './periods.js';

/**
 * The reports' presentation (S09): pure functions over balances the reports' readers in
 * `packages/db` sum in SQL, in one ledger. Every figure is an exact sum of ledger amounts; the
 * only rounding is the margin (rule 21). A balance is signed, positive debit; a period's debits
 * and credits are magnitudes.
 */

/** An account of the chart as the reports read it. */
export interface ReportChartAccount {
  readonly id: string;
  readonly code: string;
  readonly parentId: string | null;
  readonly level: number;
  readonly postable: boolean;
  readonly statementLine: string | null;
  /** A control account (S04): its balance is read per client (rule 18). */
  readonly control: boolean;
  /** The account's normal balance: a balance on the other side is flagged (Q17). */
  readonly normalBalance: 'debit' | 'credit';
  readonly archived: boolean;
}

export interface DebitsCredits {
  readonly debits: bigint;
  readonly credits: bigint;
}

const sum = (amounts: Iterable<bigint>): bigint => {
  let total = 0n;
  for (const amount of amounts) total += amount;
  return total;
};

const debitPart = (balance: bigint) => (balance > 0n ? balance : 0n);
const creditPart = (balance: bigint) => (balance < 0n ? -balance : 0n);

const catalogueLine = (code: string): StatementLine => {
  const found = STATEMENT_LINES.find((line) => line.code === code);
  if (found === undefined) throw new RangeError(`No statement line ${code}`);
  return found;
};

// --- Dates of a report (rules 4, 5) ---

/** Rule 5's default comparative of a period: as many days, ending the day before `from`. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = daysBetween(from, to) + 1;
  if (days < 1) throw new RangeError(`${from} is after ${to}`);
  const end = dayBefore(from);
  return { from: addDays(end, 1 - days), to: end };
}

/** The first day of the fiscal year a date falls in. */
export function fiscalYearStart(date: string, startMonth: number): string {
  const year = fiscalYearOf(date, startMonth);
  return `${String(year).padStart(4, '0')}-${String(startMonth).padStart(2, '0')}-01`;
}

/**
 * Rule 5's default comparative of a balance sheet: the end of the previous fiscal year, or the
 * day before the company's first period (`YYYY-MM`) when that is later.
 */
export function balanceSheetComparative(
  asOf: string,
  startMonth: number,
  firstPeriod: string | null,
): string {
  const previousYearEnd = dayBefore(fiscalYearStart(asOf, startMonth));
  if (firstPeriod === null) return previousYearEnd;
  const beforeBooks = dayBefore(`${firstPeriod}-01`);
  return beforeBooks > previousYearEnd ? beforeBooks : previousYearEnd;
}

/** The months `YYYY-MM` from one date's month to another's, in order. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let month = periodOf(from);
  const last = periodOf(to);
  while (month <= last) {
    months.push(month);
    month = periodOf(addDays(lastDayOfMonth(`${month}-01`), 1));
  }
  return months;
}

/**
 * Rule 4's marks of a column: `period_open` when a month it reads is not closed;
 * `before_revaluation` when it ends on a day other than a month's last, or that month's
 * revaluation in the report's ledger is not current (IAS 21.23).
 */
export function reportMarks(input: {
  readonly anyMonthOpen: boolean;
  readonly to: string;
  readonly revaluationCurrent: boolean;
  /** S10's marks of the column, from `booksStartMarks()`. */
  readonly booksStart?: readonly BooksStartMark[] | undefined;
}): ReportMarkValue[] {
  const marks: ReportMarkValue[] = [];
  if (input.anyMonthOpen) marks.push('period_open');
  if (input.to !== lastDayOfMonth(input.to) || !input.revaluationCurrent) {
    marks.push('before_revaluation');
  }
  marks.push(...(input.booksStart ?? []));
  return marks;
}

export type BooksStartMark =
  | 'opening_entry'
  | 'before_books_start'
  | 'pre_opening_result_in_equity';

export type ReportMarkValue = 'period_open' | 'before_revaluation' | BooksStartMark;

/** The first day of the fiscal year after the one a date falls in. */
function nextFiscalYearStart(date: string, startMonth: number): string {
  const start = fiscalYearStart(date, startMonth);
  return `${String(Number(start.slice(0, 4)) + 1).padStart(4, '0')}${start.slice(4)}`;
}

/**
 * S10 rules 32–33's marks of a column in a company with a books start: `before_books_start` when
 * the range starts before it (the report reads from it); `opening_entry` when the report reads
 * the opening entry as its opening balance (`readsOpeningEntry`, a trial balance, general ledger
 * or account statement whose range holds the entry); `pre_opening_result_in_equity` on an income
 * statement whose range touches the books start's fiscal year. None without a books start.
 */
export function booksStartMarks(input: {
  readonly booksStart: string | null;
  readonly from: string | null;
  readonly to: string;
  readonly fiscalYearStartMonth: number;
  readonly readsOpeningEntry: boolean;
  readonly incomeStatement: boolean;
}): BooksStartMark[] {
  const marks: BooksStartMark[] = [];
  const { booksStart } = input;
  if (booksStart === null) return marks;
  if (input.readsOpeningEntry) marks.push('opening_entry');
  if (input.from !== null && input.from < booksStart) marks.push('before_books_start');
  if (input.incomeStatement) {
    const yearStart = fiscalYearStart(booksStart, input.fiscalYearStartMonth);
    const nextYear = nextFiscalYearStart(booksStart, input.fiscalYearStartMonth);
    if ((input.from === null || input.from < nextYear) && input.to >= yearStart) {
      marks.push('pre_opening_result_in_equity');
    }
  }
  return marks;
}

/**
 * S10 rule 32's opening column: the opening entry's lines (and those of its reversal and a new
 * opening, all on the books start), read in the range's movements, moved to the opening balance,
 * so the period's debits and credits start after it, an entry of the same date included.
 */
export function withOpeningEntry(
  opening: ReadonlyMap<string, bigint>,
  movements: ReadonlyMap<string, DebitsCredits>,
  openingEntry: ReadonlyMap<string, DebitsCredits>,
): { opening: Map<string, bigint>; movements: Map<string, DebitsCredits> } {
  const nextOpening = new Map(opening);
  const nextMovements = new Map(movements);
  for (const [accountId, lines] of openingEntry) {
    const movement = nextMovements.get(accountId) ?? { debits: 0n, credits: 0n };
    if (movement.debits < lines.debits || movement.credits < lines.credits) {
      throw new RangeError(`The opening entry's lines on ${accountId} are not in the movements`);
    }
    nextOpening.set(accountId, (nextOpening.get(accountId) ?? 0n) + lines.debits - lines.credits);
    nextMovements.set(accountId, {
      debits: movement.debits - lines.debits,
      credits: movement.credits - lines.credits,
    });
  }
  return { opening: nextOpening, movements: nextMovements };
}

// --- Trial balance (rule 9) ---

export interface TrialBalanceInput {
  readonly accounts: readonly ReportChartAccount[];
  /** Postable accounts' balances at the day before `from`. */
  readonly opening: ReadonlyMap<string, bigint>;
  /** Postable accounts' debits and credits from `from` to `to`. */
  readonly movements: ReadonlyMap<string, DebitsCredits>;
  /** Postable accounts' balances at the comparative period's end; null without one. */
  readonly compare: ReadonlyMap<string, bigint> | null;
  readonly level: number;
  readonly nonZero: boolean;
  readonly codeFrom?: string | undefined;
  readonly codeTo?: string | undefined;
}

export interface TrialBalanceRowValue {
  readonly accountId: string;
  readonly opening: bigint;
  readonly debits: bigint;
  readonly credits: bigint;
  readonly closing: bigint;
  readonly compare: bigint | null;
}

export interface TrialBalanceTotalsValue {
  readonly openingDebit: bigint;
  readonly openingCredit: bigint;
  readonly debits: bigint;
  readonly credits: bigint;
  readonly closingDebit: bigint;
  readonly closingCredit: bigint;
  readonly compareDebit: bigint | null;
  readonly compareCredit: bigint | null;
}

/** Whether a code is in a code range, each end read as a prefix of its own length. */
export function codeInRange(code: string, from?: string, to?: string): boolean {
  if (from !== undefined && code.slice(0, from.length) < from) return false;
  if (to !== undefined && code.slice(0, to.length) > to) return false;
  return true;
}

/**
 * The rows of a trial balance at a level: each account at the level with its subtree's sums, and
 * each postable account above it; rows in code order, with "non-zero" those with a balance or a
 * movement. The totals are the rows' sums, each balance on its debit or credit side.
 */
export function trialBalance(input: TrialBalanceInput): {
  rows: TrialBalanceRowValue[];
  totals: TrialBalanceTotalsValue;
} {
  if (!Number.isInteger(input.level) || input.level < 1 || input.level > 4) {
    throw new RangeError(`A trial balance level is 1 to 4, not ${input.level}`);
  }
  const byId = new Map(input.accounts.map((account) => [account.id, account]));
  // The row an account's figures add to: itself at or above the level, else its ancestor at it.
  const rowOf = (account: ReportChartAccount): ReportChartAccount => {
    let current = account;
    while (current.level > input.level) {
      const parent = current.parentId === null ? undefined : byId.get(current.parentId);
      if (parent === undefined) throw new RangeError(`Account ${current.code} has no parent`);
      current = parent;
    }
    return current;
  };
  interface Sums {
    opening: bigint;
    debits: bigint;
    credits: bigint;
    compare: bigint;
  }
  const sums = new Map<string, Sums>();
  for (const account of input.accounts) {
    if (account.level === input.level || (account.postable && account.level < input.level)) {
      sums.set(account.id, { opening: 0n, debits: 0n, credits: 0n, compare: 0n });
    }
  }
  for (const account of input.accounts) {
    if (!account.postable) continue;
    const row = sums.get(rowOf(account).id);
    if (row === undefined) throw new RangeError(`Account ${account.code} has no row`);
    const movement = input.movements.get(account.id);
    row.opening += input.opening.get(account.id) ?? 0n;
    row.debits += movement?.debits ?? 0n;
    row.credits += movement?.credits ?? 0n;
    row.compare += input.compare?.get(account.id) ?? 0n;
  }
  const rows: TrialBalanceRowValue[] = [];
  const ordered = [...sums.entries()]
    .map(([id, value]) => ({ account: byId.get(id) as ReportChartAccount, value }))
    .sort((a, b) =>
      a.account.code < b.account.code ? -1 : a.account.code > b.account.code ? 1 : 0,
    );
  for (const { account, value } of ordered) {
    if (!codeInRange(account.code, input.codeFrom, input.codeTo)) continue;
    const closing = value.opening + value.debits - value.credits;
    const empty =
      value.opening === 0n && value.debits === 0n && value.credits === 0n && value.compare === 0n;
    if (input.nonZero && empty) continue;
    rows.push({
      accountId: account.id,
      opening: value.opening,
      debits: value.debits,
      credits: value.credits,
      closing,
      compare: input.compare === null ? null : value.compare,
    });
  }
  const compared = input.compare !== null;
  return {
    rows,
    totals: {
      openingDebit: sum(rows.map((row) => debitPart(row.opening))),
      openingCredit: sum(rows.map((row) => creditPart(row.opening))),
      debits: sum(rows.map((row) => row.debits)),
      credits: sum(rows.map((row) => row.credits)),
      closingDebit: sum(rows.map((row) => debitPart(row.closing))),
      closingCredit: sum(rows.map((row) => creditPart(row.closing))),
      compareDebit: compared ? sum(rows.map((row) => debitPart(row.compare ?? 0n))) : null,
      compareCredit: compared ? sum(rows.map((row) => creditPart(row.compare ?? 0n))) : null,
    },
  };
}

// --- Income statement (rules 13, 14) ---

export interface IncomeStatementLineValue {
  readonly line: string;
  readonly amount: bigint;
  readonly compare: bigint | null;
  readonly accounts: readonly { accountId: string; amount: bigint; compare: bigint | null }[];
}

export interface IncomeSubtotalsValue {
  readonly operatingProfit: bigint;
  readonly profitBeforeFinancingAndIncomeTaxes: bigint | null;
  readonly profitBeforeTax: bigint;
  readonly profit: bigint;
}

const INCOME_LINES = STATEMENT_LINES.filter((line) => line.statement === 'income_statement').sort(
  (a, b) => a.order - b.order,
);
const BALANCE_LINES = STATEMENT_LINES.filter((line) => line.statement === 'balance_sheet').sort(
  (a, b) => a.order - b.order,
);

/**
 * Rule 14's subtotals from the lines as presented, by their IFRS 18 category: operating, then
 * investing (its subtotal only when an investing line has an amount), financing and income taxes.
 */
export function incomeSubtotals(amounts: ReadonlyMap<string, bigint>): IncomeSubtotalsValue {
  const of = (category: string) =>
    sum(
      INCOME_LINES.filter((line) => line.ifrs18Category === category).map(
        (line) => amounts.get(line.code) ?? 0n,
      ),
    );
  const operating = of('operating');
  const investing = of('investing');
  const hasInvesting = INCOME_LINES.some(
    (line) => line.ifrs18Category === 'investing' && (amounts.get(line.code) ?? 0n) !== 0n,
  );
  const beforeTax = operating + investing + of('financing');
  return {
    operatingProfit: operating,
    profitBeforeFinancingAndIncomeTaxes: hasInvesting ? operating + investing : null,
    profitBeforeTax: beforeTax,
    profit: beforeTax + of('income_taxes'),
  };
}

/** Accounts carrying a line: active ones, and archived ones with an amount (rule 7). */
const carries = (
  account: ReportChartAccount,
  line: string,
  amounts: (accountId: string) => readonly bigint[],
) =>
  account.postable &&
  account.statementLine === line &&
  (!account.archived || amounts(account.id).some((amount) => amount !== 0n));

/**
 * The income statement from the income-statement accounts' net debits over the period and its
 * comparative: each line income positive and expenses negative, in catalogue order; a line with
 * no account and no amount in either column hidden; the subtotals of each column.
 */
export function incomeStatement(input: {
  readonly accounts: readonly ReportChartAccount[];
  readonly current: ReadonlyMap<string, bigint>;
  readonly compare: ReadonlyMap<string, bigint> | null;
}): {
  lines: IncomeStatementLineValue[];
  subtotals: IncomeSubtotalsValue;
  compareSubtotals: IncomeSubtotalsValue | null;
} {
  const presented = (net: bigint | undefined) => -(net ?? 0n);
  const figures = (id: string) => [
    input.current.get(id) ?? 0n,
    ...(input.compare ? [input.compare.get(id) ?? 0n] : []),
  ];
  const lines: IncomeStatementLineValue[] = [];
  for (const line of INCOME_LINES) {
    const accounts = input.accounts
      .filter((account) => carries(account, line.code, figures))
      .sort((a, b) => (a.code < b.code ? -1 : 1));
    const amount = sum(accounts.map((account) => presented(input.current.get(account.id))));
    const compare = input.compare
      ? sum(accounts.map((account) => presented(input.compare?.get(account.id))))
      : null;
    if (accounts.length === 0 && amount === 0n && (compare ?? 0n) === 0n) continue;
    lines.push({
      line: line.code,
      amount,
      compare,
      accounts: accounts
        .map((account) => ({
          accountId: account.id,
          amount: presented(input.current.get(account.id)),
          compare: input.compare ? presented(input.compare.get(account.id)) : null,
        }))
        .filter((part) => part.amount !== 0n || (part.compare ?? 0n) !== 0n),
    });
  }
  const amounts = (pick: (line: IncomeStatementLineValue) => bigint | null) =>
    new Map(lines.map((line) => [line.line, pick(line) ?? 0n]));
  return {
    lines,
    subtotals: incomeSubtotals(amounts((line) => line.amount)),
    compareSubtotals: input.compare ? incomeSubtotals(amounts((line) => line.compare)) : null,
  };
}

// --- Balance sheet (rules 15–19) ---

/** A balance-sheet account's balance at a date for one client and one contract. */
export interface PresentationBalance {
  readonly accountId: string;
  readonly clientId: string | null;
  readonly contractId: string | null;
  /** Net debit. */
  readonly amount: bigint;
}

/** A balance sheet's figures at one date. */
export interface BalanceSheetColumn {
  readonly balances: readonly PresentationBalance[];
  /** Classes 4–5's net debit from the fiscal year's start to the date. */
  readonly yearNet: bigint;
  /** Classes 4–5's net debit before the fiscal year's start, not yet closed (phase 1). */
  readonly unclosedNet: bigint;
  /**
   * S10 rule 31: in the books start's fiscal year, the accounts of the result before the books
   * start (`pre_opening_result`), whose balance the year's result includes instead of retained
   * earnings; empty in any other year, where it stays in retained earnings by its account.
   */
  readonly yearResultAccountIds?: readonly string[] | undefined;
}

export interface BalanceSheetPartValue {
  readonly accountId: string;
  readonly clientId: string | null;
  readonly contractId: string | null;
  readonly amount: bigint;
  readonly reclassified: boolean;
  readonly oppositeSide: boolean;
}

export interface BalanceSheetLineValue {
  readonly line: string;
  readonly amount: bigint;
  readonly compare: bigint | null;
  readonly reclassified: bigint;
  readonly unclosedYears: bigint | null;
  readonly compareUnclosedYears: bigint | null;
  readonly parts: readonly BalanceSheetPartValue[];
}

export interface BalanceSheetTotalsValue {
  readonly assets: bigint;
  readonly liabilities: bigint;
  readonly equity: bigint;
  readonly liabilitiesAndEquity: bigint;
}

const ASSET_SECTIONS = new Set(['current_assets', 'non_current_assets']);

const isAssetLine = (code: string) => ASSET_SECTIONS.has(catalogueLine(code).section);

/** A net debit as it adds to a line: positive on the line's own side. */
const onLine = (line: string, netDebit: bigint) => (isAssetLine(line) ? netDebit : -netDebit);

const CONTRACT_LINES = new Set(['bs.contract_assets', 'bs.contract_liabilities']);

/**
 * The parts of each line at one date (rules 17, 18): the contract lines' balances netted per
 * contract, then each control account's balance per client on its own side or moved to the
 * opposite side, and every other account net on its line.
 */
function presentBalances(
  accounts: ReadonlyMap<string, ReportChartAccount>,
  balances: readonly PresentationBalance[],
): Map<string, BalanceSheetPartValue[]> {
  const parts = new Map<string, BalanceSheetPartValue[]>();
  const add = (line: string, part: BalanceSheetPartValue) => {
    if (part.amount === 0n) return;
    const list = parts.get(line) ?? [];
    list.push(part);
    parts.set(line, list);
  };
  const accountOf = (id: string) => {
    const account = accounts.get(id);
    if (account?.statementLine == null) throw new RangeError(`Account ${id} has no statement line`);
    return { account, line: account.statementLine };
  };
  // Sum the balances per key, so the order they come in never matters.
  const grouped = <K extends string>(
    rows: readonly PresentationBalance[],
    keyOf: (row: PresentationBalance) => K,
  ) => {
    const groups = new Map<K, { first: PresentationBalance; amount: bigint }>();
    for (const row of rows) {
      const key = keyOf(row);
      const group = groups.get(key);
      if (group === undefined) groups.set(key, { first: row, amount: row.amount });
      else group.amount += row.amount;
    }
    return [...groups.values()];
  };

  // Rule 17: per contract, the contract lines' accounts net; the net decides the line.
  const contractRows = balances.filter(
    (row) => row.contractId !== null && CONTRACT_LINES.has(accountOf(row.accountId).line),
  );
  const contractIds = [...new Set(contractRows.map((row) => row.contractId as string))];
  for (const contractId of contractIds) {
    const rows = grouped(
      contractRows.filter((row) => row.contractId === contractId),
      (row) => `${row.accountId}|${row.clientId ?? ''}`,
    );
    const net = sum(rows.map((row) => row.amount));
    if (net === 0n) continue;
    const line = net > 0n ? 'bs.contract_assets' : 'bs.contract_liabilities';
    for (const { first, amount } of rows) {
      add(line, {
        accountId: first.accountId,
        clientId: first.clientId,
        contractId,
        amount: onLine(line, amount),
        reclassified: false,
        oppositeSide: false,
      });
    }
  }

  const rest = balances.filter((row) => !contractRows.includes(row));
  // Rule 18: a control account per client (no client is one counterparty), on its own side.
  const controlRows = grouped(
    rest.filter((row) => accountOf(row.accountId).account.control),
    (row) => `${row.accountId}|${row.clientId ?? ''}`,
  );
  for (const { first, amount } of controlRows) {
    const { line } = accountOf(first.accountId);
    const ownSide = isAssetLine(line) ? amount >= 0n : amount <= 0n;
    const target = ownSide
      ? line
      : isAssetLine(line)
        ? 'bs.trade_payables'
        : 'bs.trade_receivables';
    add(target, {
      accountId: first.accountId,
      clientId: first.clientId,
      contractId: null,
      amount: onLine(target, amount),
      reclassified: !ownSide,
      oppositeSide: false,
    });
  }
  // Every other account net on its line; one against its line's side is flagged (Q17).
  const otherRows = grouped(
    rest.filter((row) => !accountOf(row.accountId).account.control),
    (row) => row.accountId,
  );
  for (const { first, amount } of otherRows) {
    const { account, line } = accountOf(first.accountId);
    const presented = onLine(line, amount);
    add(line, {
      accountId: first.accountId,
      clientId: null,
      contractId: null,
      amount: presented,
      reclassified: false,
      // Against the account's normal balance, not its line's: a contra account such as
      // accumulated depreciation is in its normal position on an asset line.
      oppositeSide: account.normalBalance === 'debit' ? amount < 0n : amount > 0n,
    });
  }
  for (const list of parts.values()) {
    list.sort((a, b) => {
      const codeA = accounts.get(a.accountId)?.code ?? '';
      const codeB = accounts.get(b.accountId)?.code ?? '';
      if (codeA !== codeB) return codeA < codeB ? -1 : 1;
      const keyA = `${a.clientId ?? ''}|${a.contractId ?? ''}`;
      const keyB = `${b.clientId ?? ''}|${b.contractId ?? ''}`;
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    });
  }
  return parts;
}

function balanceSheetTotals(
  amounts: ReadonlyMap<string, bigint>,
  yearResult: bigint,
): BalanceSheetTotalsValue {
  const of = (sections: readonly string[]) =>
    sum(
      BALANCE_LINES.filter((line) => sections.includes(line.section)).map(
        (line) => amounts.get(line.code) ?? 0n,
      ),
    );
  const assets = of(['current_assets', 'non_current_assets']);
  const liabilities = of(['current_liabilities']);
  const equity = of(['equity']) + yearResult;
  return { assets, liabilities, equity, liabilitiesAndEquity: liabilities + equity };
}

/**
 * A column's balances as the lines present them, the result before the books start taken out
 * for the year's result in the books start's fiscal year (S10 rule 31), credit positive.
 */
function presentedColumn(column: BalanceSheetColumn): {
  balances: readonly PresentationBalance[];
  preOpening: bigint;
} {
  const ids = new Set(column.yearResultAccountIds ?? []);
  if (ids.size === 0) return { balances: column.balances, preOpening: 0n };
  return {
    balances: column.balances.filter((row) => !ids.has(row.accountId)),
    preOpening: -sum(column.balances.filter((row) => ids.has(row.accountId)).map((r) => r.amount)),
  };
}

/**
 * The balance sheet at a date and its comparative: the lines of the catalogue in order, each the
 * sum of its parts, the year's result computed in equity and earlier unclosed years in retained
 * earnings (rule 16), a line with no account and no amount in either column hidden.
 */
export function balanceSheet(input: {
  readonly accounts: readonly ReportChartAccount[];
  readonly current: BalanceSheetColumn;
  readonly compare: BalanceSheetColumn | null;
}): {
  lines: BalanceSheetLineValue[];
  yearResult: bigint;
  compareYearResult: bigint | null;
  yearResultPreOpening: bigint;
  compareYearResultPreOpening: bigint | null;
  totals: BalanceSheetTotalsValue;
  compareTotals: BalanceSheetTotalsValue | null;
} {
  const byId = new Map(input.accounts.map((account) => [account.id, account]));
  const current = presentedColumn(input.current);
  const compareColumn = input.compare ? presentedColumn(input.compare) : null;
  const parts = presentBalances(byId, current.balances);
  const compareParts = compareColumn ? presentBalances(byId, compareColumn.balances) : null;
  const unclosed = -input.current.unclosedNet;
  const compareUnclosed = input.compare ? -input.compare.unclosedNet : null;
  const balanceOf = (id: string) => [
    sum(input.current.balances.filter((row) => row.accountId === id).map((row) => row.amount)),
    ...(input.compare
      ? [sum(input.compare.balances.filter((row) => row.accountId === id).map((row) => row.amount))]
      : []),
  ];
  const lines: BalanceSheetLineValue[] = [];
  for (const line of BALANCE_LINES) {
    const retained = line.code === 'bs.retained_earnings';
    const own = parts.get(line.code) ?? [];
    const amount = sum(own.map((part) => part.amount)) + (retained ? unclosed : 0n);
    const compare = compareParts
      ? sum((compareParts.get(line.code) ?? []).map((part) => part.amount)) +
        (retained ? (compareUnclosed ?? 0n) : 0n)
      : null;
    const hasAccount = input.accounts.some((account) => carries(account, line.code, balanceOf));
    if (!hasAccount && amount === 0n && (compare ?? 0n) === 0n && own.length === 0) continue;
    lines.push({
      line: line.code,
      amount,
      compare,
      reclassified: sum(own.filter((part) => part.reclassified).map((part) => part.amount)),
      unclosedYears: retained ? unclosed : null,
      compareUnclosedYears: retained ? compareUnclosed : null,
      parts: own,
    });
  }
  const yearResult = -input.current.yearNet + current.preOpening;
  const compareYearResult =
    input.compare && compareColumn ? -input.compare.yearNet + compareColumn.preOpening : null;
  return {
    lines,
    yearResult,
    compareYearResult,
    yearResultPreOpening: current.preOpening,
    compareYearResultPreOpening: compareColumn ? compareColumn.preOpening : null,
    totals: balanceSheetTotals(new Map(lines.map((line) => [line.line, line.amount])), yearResult),
    compareTotals:
      input.compare && compareYearResult !== null
        ? balanceSheetTotals(
            new Map(lines.map((line) => [line.line, line.compare ?? 0n])),
            compareYearResult,
          )
        : null,
  };
}

// --- Contract position (rule 24) ---

export interface ContractPositionRowValue {
  readonly contractId: string;
  readonly clientId: string | null;
  readonly assets: bigint;
  readonly liabilities: bigint;
  readonly net: bigint;
}

/**
 * Each contract's balances on the contract-asset and contract-liability accounts at a date and
 * their net (rule 24), with totals that agree with the balance sheet's two lines: the contracts'
 * net debits and net credits, and what those lines hold without a contract.
 */
export function contractPosition(input: {
  readonly accounts: readonly ReportChartAccount[];
  readonly balances: readonly PresentationBalance[];
}): {
  rows: ContractPositionRowValue[];
  totals: {
    contractAssets: bigint;
    contractLiabilities: bigint;
    withoutContractAssets: bigint;
    withoutContractLiabilities: bigint;
  };
} {
  const byId = new Map(input.accounts.map((account) => [account.id, account]));
  const lineOf = (row: PresentationBalance) => byId.get(row.accountId)?.statementLine ?? null;
  const rows = new Map<string, { clientId: string | null; assets: bigint; liabilities: bigint }>();
  for (const row of input.balances) {
    const line = lineOf(row);
    if (row.contractId === null || line === null || !CONTRACT_LINES.has(line)) continue;
    const entry = rows.get(row.contractId) ?? {
      clientId: row.clientId,
      assets: 0n,
      liabilities: 0n,
    };
    if (line === 'bs.contract_assets') entry.assets += row.amount;
    else entry.liabilities -= row.amount;
    entry.clientId ??= row.clientId;
    rows.set(row.contractId, entry);
  }
  const positions = [...rows.entries()]
    .map(([contractId, entry]) => ({
      contractId,
      clientId: entry.clientId,
      assets: entry.assets,
      liabilities: entry.liabilities,
      net: entry.assets - entry.liabilities,
    }))
    .filter((row) => row.assets !== 0n || row.liabilities !== 0n);
  const presented = presentBalances(byId, input.balances);
  const lineTotal = (line: string) => sum((presented.get(line) ?? []).map((part) => part.amount));
  const contractAssets = sum(positions.filter((row) => row.net > 0n).map((row) => row.net));
  const contractLiabilities = sum(positions.filter((row) => row.net < 0n).map((row) => -row.net));
  return {
    rows: positions,
    totals: {
      contractAssets,
      contractLiabilities,
      withoutContractAssets: lineTotal('bs.contract_assets') - contractAssets,
      withoutContractLiabilities: lineTotal('bs.contract_liabilities') - contractLiabilities,
    },
  };
}

// --- Profitability (rules 20–23) ---

/** A dated department of a service (rule 32). */
export interface ServiceDepartmentRow {
  readonly serviceId: string;
  readonly departmentId: string;
  readonly effectiveFrom: string;
  /** For the order among rows of one date: the latest wins, then the latest id (UUIDv7). */
  readonly createdAt: string;
  readonly id: string;
}

/**
 * The department in force for a service on a date (rule 32): its row with the latest
 * `effectiveFrom` on or before the date, the latest `createdAt` among equals; none before its
 * first row.
 */
export function departmentInForce(
  rows: readonly ServiceDepartmentRow[],
  serviceId: string,
  date: string,
): string | null {
  let found: ServiceDepartmentRow | null = null;
  for (const row of rows) {
    if (row.serviceId !== serviceId || row.effectiveFrom > date) continue;
    if (
      found === null ||
      row.effectiveFrom > found.effectiveFrom ||
      (row.effectiveFrom === found.effectiveFrom &&
        (row.createdAt > found.createdAt ||
          (row.createdAt === found.createdAt && row.id > found.id)))
    ) {
      found = row;
    }
  }
  return found?.departmentId ?? null;
}

/** Rule 21: contribution over revenue as a percentage with one decimal, half away from zero. */
export function marginOf(revenue: bigint, contribution: bigint): string | null {
  if (revenue === 0n) return null;
  const tenths =
    revenue > 0n
      ? divideHalfAwayFromZero(contribution * 1000n, revenue)
      : divideHalfAwayFromZero(-contribution * 1000n, -revenue);
  const sign = tenths < 0n ? '-' : '';
  const magnitude = tenths < 0n ? -tenths : tenths;
  return `${sign}${magnitude / 10n}.${magnitude % 10n}`;
}

export interface ProfitabilityFiguresValue {
  readonly revenue: bigint;
  readonly directCosts: bigint;
  readonly contribution: bigint;
  readonly margin: string | null;
}

/** Lines of `is.revenue` or `is.direct_costs` summed per value of the chosen dimension. */
export interface ProfitabilityAmount {
  readonly statementLine: string;
  /** Null: "غير موزع". */
  readonly valueId: string | null;
  /** Net debit in the period, and in the comparative. */
  readonly current: bigint;
  readonly compare: bigint;
}

const figuresOf = (revenueNet: bigint, costsNet: bigint): ProfitabilityFiguresValue => {
  const revenue = -revenueNet;
  const contribution = revenue - costsNet;
  return { revenue, directCosts: costsNet, contribution, margin: marginOf(revenue, contribution) };
};

/**
 * Profitability by a dimension (rule 20): each value's revenue (income positive), direct costs
 * (a cost positive), contribution and margin, "غير موزع" (`valueId` null) last, and the totals,
 * which equal the income statement's two lines (rule 23). No other line enters.
 */
export function profitability(input: {
  readonly amounts: readonly ProfitabilityAmount[];
  readonly compared: boolean;
}): {
  rows: {
    valueId: string | null;
    current: ProfitabilityFiguresValue;
    compare: ProfitabilityFiguresValue | null;
  }[];
  totals: { current: ProfitabilityFiguresValue; compare: ProfitabilityFiguresValue | null };
} {
  interface Sums {
    revenue: bigint;
    costs: bigint;
    compareRevenue: bigint;
    compareCosts: bigint;
  }
  const empty = (): Sums => ({ revenue: 0n, costs: 0n, compareRevenue: 0n, compareCosts: 0n });
  const values = new Map<string | null, Sums>();
  const total = empty();
  for (const amount of input.amounts) {
    const revenue = amount.statementLine === 'is.revenue';
    if (!revenue && amount.statementLine !== 'is.direct_costs') continue;
    const sums = values.get(amount.valueId) ?? empty();
    values.set(amount.valueId, sums);
    for (const target of [sums, total]) {
      if (revenue) {
        target.revenue += amount.current;
        target.compareRevenue += amount.compare;
      } else {
        target.costs += amount.current;
        target.compareCosts += amount.compare;
      }
    }
  }
  const nonZero = (sums: Sums) =>
    sums.revenue !== 0n ||
    sums.costs !== 0n ||
    (input.compared && (sums.compareRevenue !== 0n || sums.compareCosts !== 0n));
  const rows = [...values.entries()]
    .filter(([, sums]) => nonZero(sums))
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : 0))
    .map(([valueId, sums]) => ({
      valueId,
      current: figuresOf(sums.revenue, sums.costs),
      compare: input.compared ? figuresOf(sums.compareRevenue, sums.compareCosts) : null,
    }));
  return {
    rows,
    totals: {
      current: figuresOf(total.revenue, total.costs),
      compare: input.compared ? figuresOf(total.compareRevenue, total.compareCosts) : null,
    },
  };
}

// --- Revenue release schedule (rule 25) ---

/** A part still to release: in a month, or at its done (`month` null, "عند الإنجاز"). */
export interface ReleasePart {
  readonly contractId: string | null;
  readonly month: string | null;
  readonly amount: bigint;
}

/** The releases still to post per contract and month, and in total (rule 25). */
export function releaseSchedule(parts: readonly ReleasePart[]): {
  months: string[];
  rows: { contractId: string | null; months: Map<string, bigint>; atDone: bigint; total: bigint }[];
  totals: { months: Map<string, bigint>; atDone: bigint; total: bigint };
} {
  const months = [
    ...new Set(parts.flatMap((part) => (part.month === null ? [] : [part.month]))),
  ].sort();
  const rows = new Map<
    string | null,
    { months: Map<string, bigint>; atDone: bigint; total: bigint }
  >();
  const totals = { months: new Map<string, bigint>(), atDone: 0n, total: 0n };
  for (const part of parts) {
    const row = rows.get(part.contractId) ?? { months: new Map(), atDone: 0n, total: 0n };
    rows.set(part.contractId, row);
    for (const target of [row, totals]) {
      if (part.month === null) target.atDone += part.amount;
      else target.months.set(part.month, (target.months.get(part.month) ?? 0n) + part.amount);
      target.total += part.amount;
    }
  }
  return {
    months,
    rows: [...rows.entries()]
      .filter(([, row]) => row.total !== 0n || row.atDone !== 0n || row.months.size > 0)
      .map(([contractId, row]) => ({ contractId, ...row })),
    totals,
  };
}

/** A balance's debit and credit magnitudes, for a reader that shows a balance on its side. */
export function sidesOf(balance: bigint): DebitsCredits {
  return { debits: debitPart(balance), credits: creditPart(balance) };
}

/** The exact sum of amounts, for a reader that sums what SQL already split. */
export function sumAmounts(amounts: Iterable<bigint>): bigint {
  return sum(amounts);
}

/** `opening + debits − credits`. */
export function closingOf(opening: bigint, movement: DebitsCredits): bigint {
  return opening + movement.debits - movement.credits;
}
