import {
  type Account,
  type AccountStatement,
  AGEING_BUCKETS,
  type AgeingReport,
  type BalanceSheet,
  type ClientStatement,
  type CurrencyCode,
  type GeneralLedger,
  type IncomeStatement,
  type Journal,
  type Ledger,
  type Profitability,
  type ProfitabilityFigures,
  type ReportHeader,
  type ReportMark,
  type ReportValue,
  STATEMENT_LINES,
  type TrialBalance,
} from '@vertex-mizan/contracts';
import { type Catalog, displayTimeZone, formatLocale } from '@vertex-mizan/i18n';
import type { ReportSheet, SheetCell, SheetColumn, SheetParameter, SheetRow } from './sheet.js';

export type {
  ReportSheet,
  SheetCell,
  SheetCellKind,
  SheetColumn,
  SheetEmphasis,
  SheetParameter,
  SheetRow,
} from './sheet.js';

/** The catalogs a sheet reads its text from. */
export type SheetText = Pick<Catalog, 'reports' | 'accounting' | 'openItems' | 'chart'>;

/** What a sheet needs beyond the report: the company's fiscal year (its entry numbers). */
export interface SheetContext {
  readonly text: SheetText;
  readonly fiscalYearStartMonth: number;
}

/** One report's answer, named by its identity; `journal` is the journal book's Excel (rule 12). */
export type SheetInput =
  | { readonly report: 'trial_balance'; readonly data: TrialBalance }
  | { readonly report: 'general_ledger'; readonly data: GeneralLedger }
  | { readonly report: 'account_statement'; readonly data: AccountStatement }
  | { readonly report: 'journal'; readonly data: Journal }
  | { readonly report: 'income_statement'; readonly data: IncomeStatement }
  | { readonly report: 'balance_sheet'; readonly data: BalanceSheet }
  | { readonly report: 'profitability'; readonly data: Profitability }
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

/** The sheet of a report (S09 rules 35, 36). */
export function reportSheet(input: SheetInput, context: SheetContext): ReportSheet {
  switch (input.report) {
    case 'trial_balance':
      return trialBalanceSheet(input.data, context);
    case 'general_ledger':
      return generalLedgerSheet(input.data, context);
    case 'account_statement':
      return accountStatementSheet(input.data, context);
    case 'journal':
      return journalSheet(input.data, context);
    case 'income_statement':
      return incomeStatementSheet(input.data, context);
    case 'balance_sheet':
      return balanceSheetSheet(input.data, context);
    case 'profitability':
      return profitabilitySheet(input.data, context);
    case 'ageing':
      return ageingSheet(input.data, input.producedAt, context);
    case 'client_statement':
      return clientStatementSheet(input.data, input.producedAt, context);
    case 'chart':
      return chartSheet(input.data, input.bookCurrency, input.producedAt, context);
  }
}

// --- Shared parts ---

const dateTime = new Intl.DateTimeFormat(formatLocale, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: displayTimeZone,
});

/** A moment as people in Syria read it, Latin digits. */
export function formatProducedAt(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** A currency's printed name: SYP is "الليرة السورية الجديدة" on printed output (ADR 0007). */
export function printedCurrency(currency: CurrencyCode, text: SheetText): string {
  return currency === 'SYP' ? text.accounting.sypPrintedName : text.accounting.currencies[currency];
}

/** A mark's words, the books start's date in `before_books_start` (S10 rule 33). */
export function reportMarkText(
  mark: ReportMark,
  header: Pick<ReportHeader, 'booksStart'>,
  text: SheetText,
): string {
  return text.reports.marks[mark].replace('{date}', header.booksStart ?? '');
}

/** An entry's number as accountants read it: `2026/123`, or `2026-27/123` across two years. */
export function entryNumberText(
  entry: { readonly fiscalYear: number; readonly number: number },
  fiscalYearStartMonth: number,
): string {
  const year =
    fiscalYearStartMonth === 1
      ? `${entry.fiscalYear}`
      : `${entry.fiscalYear}-${String((entry.fiscalYear + 1) % 100).padStart(2, '0')}`;
  return `${year}/${entry.number}`;
}

/** A signed balance as its side: positive debit, negative credit; zero on neither. */
export function sides(balance: string): { readonly debit: SheetCell; readonly credit: SheetCell } {
  if (balance === '0') return { debit: undefined, credit: undefined };
  return balance.startsWith('-')
    ? { debit: undefined, credit: balance.slice(1) }
    : { debit: balance, credit: undefined };
}

/** A margin with its percent sign; null prints "—" (rule 21). */
const percent = (margin: string | null): SheetCell => (margin === null ? null : `${margin}%`);

const range = (from: string | null, to: string, text: SheetText) =>
  from === null ? `${text.reports.header.asOf} ${to}` : `${from} – ${to}`;

const named = (name: string, archived: boolean, text: SheetText) =>
  archived ? `${name} (${text.reports.archived})` : name;

const valueName = (value: ReportValue | null, text: SheetText) =>
  value === null
    ? text.reports.profitability.unassigned
    : named(value.code ? `${value.code} ${value.name}` : value.name, value.archived, text);

const valuesText = (values: readonly ReportValue[]) => values.map((value) => value.name).join('، ');

const statementLineName = (code: string) =>
  STATEMENT_LINES.find((line) => line.code === code)?.name ?? code;

/** The header's parameters and marks (rule 4), the comparative's marks named as its own. */
function headerParts(
  header: ReportHeader,
  context: SheetContext,
  extra: readonly SheetParameter[] = [],
): Pick<ReportSheet, 'parameters' | 'marks' | 'currency' | 'currencyLabel'> {
  const { text } = context;
  const h = text.reports.header;
  const parameters: SheetParameter[] = [
    {
      label: header.current.from === null ? h.asOf : h.period,
      value:
        header.current.from === null
          ? header.current.to
          : `${header.current.from} – ${header.current.to}`,
    },
    ...extra,
    { label: h.ledger, value: ledgerName(header.ledger, text) },
    { label: h.currency, value: printedCurrency(header.currency, text) },
  ];
  if (header.compare !== null) {
    parameters.push({
      label: h.compare,
      value: range(header.compare.from, header.compare.to, text),
    });
  }
  parameters.push(
    { label: h.producedAt, value: formatProducedAt(header.producedAt) },
    {
      label: h.latestEntry,
      value:
        header.latestEntry === null
          ? h.noEntry
          : entryNumberText(header.latestEntry, context.fiscalYearStartMonth),
    },
  );
  const marks = header.current.marks.map((mark) => reportMarkText(mark, header, text));
  for (const mark of header.compare?.marks ?? []) {
    marks.push(`${h.compare}: ${reportMarkText(mark, header, text)}`);
  }
  return {
    parameters,
    marks,
    currency: header.currency,
    currencyLabel: printedCurrency(header.currency, text),
  };
}

const ledgerName = (ledger: Ledger, text: SheetText) => text.accounting.ledger[ledger];

/** A comparative cell: "—" when the comparative period has no posted line (rule 5). */
/**
 * A comparative cell: none without a comparative; "—" when the comparative period has no posted
 * line (rule 5); otherwise its value, a blank side staying blank.
 */
const compareCell = (header: ReportHeader, value: SheetCell): SheetCell =>
  header.compare === null ? undefined : header.compare.hasLines ? value : null;

const amount = (key: string, label: string, width = 16, group?: string): SheetColumn =>
  group === undefined
    ? { key, label, kind: 'amount', width }
    : { key, label, kind: 'amount', width, group };

const text = (key: string, label: string, width: number): SheetColumn => ({
  key,
  label,
  kind: 'text',
  width,
});

const code = (key: string, label: string, width: number): SheetColumn => ({
  key,
  label,
  kind: 'code',
  width,
});

const date = (key: string, label: string): SheetColumn => ({ key, label, kind: 'date', width: 11 });

// --- Trial balance (rule 9) ---

function trialBalanceSheet(data: TrialBalance, context: SheetContext): ReportSheet {
  const t = context.text.reports;
  const c = t.columns;
  const columns: SheetColumn[] = [
    code('code', c.code, 10),
    text('account', c.account, 36),
    amount('openingDebit', c.debit, 16, c.opening),
    amount('openingCredit', c.credit, 16, c.opening),
    amount('debits', c.debit, 16, c.movement),
    amount('credits', c.credit, 16, c.movement),
    amount('closingDebit', c.debit, 16, c.closing),
    amount('closingCredit', c.credit, 16, c.closing),
  ];
  if (data.header.compare !== null) {
    columns.push(
      amount('compareDebit', c.debit, 16, c.compare),
      amount('compareCredit', c.credit, 16, c.compare),
    );
  }
  const top = Math.min(4, ...data.rows.map((row) => row.account.level));
  const rows: SheetRow[] = data.rows.map((row) => {
    const opening = sides(row.opening);
    const closing = sides(row.closing);
    const compare = row.compare === null ? null : sides(row.compare);
    return {
      level: row.account.level - top,
      ...(row.account.postable ? {} : { emphasis: 'subtotal' as const }),
      cells: {
        code: row.account.code,
        account: accountName(row.account, context.text),
        openingDebit: opening.debit,
        openingCredit: opening.credit,
        debits: row.debits === '0' ? undefined : row.debits,
        credits: row.credits === '0' ? undefined : row.credits,
        closingDebit: closing.debit,
        closingCredit: closing.credit,
        compareDebit: compareCell(data.header, compare?.debit),
        compareCredit: compareCell(data.header, compare?.credit),
      },
    };
  });
  rows.push({
    emphasis: 'total',
    cells: {
      account: t.totals.total,
      openingDebit: data.totals.openingDebit,
      openingCredit: data.totals.openingCredit,
      debits: data.totals.debits,
      credits: data.totals.credits,
      closingDebit: data.totals.closingDebit,
      closingCredit: data.totals.closingCredit,
      compareDebit: compareCell(data.header, data.totals.compareDebit),
      compareCredit: compareCell(data.header, data.totals.compareCredit),
    },
  });
  return {
    report: 'trial_balance',
    title: t.names.trial_balance,
    ...headerParts(data.header, context),
    columns,
    rows,
  };
}

const accountName = (
  account: { readonly name: string; readonly archived: boolean; readonly blocked: boolean },
  sheetText: SheetText,
) => {
  const marks = [
    account.archived ? sheetText.reports.archived : null,
    account.blocked ? sheetText.reports.blocked : null,
  ].filter((mark) => mark !== null);
  return marks.length === 0 ? account.name : `${account.name} (${marks.join('، ')})`;
};

// --- General ledger and account statement (rules 10, 11) ---

function ledgerLineColumns(context: SheetContext, withTransaction: boolean): SheetColumn[] {
  const c = context.text.reports.columns;
  const columns: SheetColumn[] = [
    date('date', c.date),
    code('entry', c.entry, 11),
    text('description', c.description, 34),
    text('memo', c.memo, 24),
    text('dimensions', c.dimensions, 22),
    amount('debit', c.debit),
    amount('credit', c.credit),
    amount('balance', c.balance),
  ];
  if (withTransaction) {
    columns.push(
      code('currency', c.currency, 8),
      { ...amount('transactionAmount', c.transactionAmount), currencyKey: 'currency' },
      { ...amount('transactionBalance', c.transactionBalance), currencyKey: 'currency' },
      text('openItem', c.openItem, 16),
    );
  }
  return columns;
}

function ledgerLineRow(
  line: GeneralLedger['accounts'][number]['lines'][number],
  context: SheetContext,
  withTransaction: boolean,
): SheetRow {
  const side = sides(line.amount);
  const cells: Record<string, SheetCell> = {
    date: line.entryDate,
    entry: entryNumberText(line, context.fiscalYearStartMonth),
    description: line.description,
    memo: line.memo ?? undefined,
    dimensions: valuesText(line.values),
    debit: side.debit,
    credit: side.credit,
    balance: line.balance,
  };
  if (withTransaction) {
    cells.currency = line.currency;
    cells.transactionAmount = line.transactionAmount;
    cells.transactionBalance = line.transactionBalance;
    cells.openItem = line.openItem?.reference;
  }
  return { cells, level: 1 };
}

function generalLedgerSheet(data: GeneralLedger, context: SheetContext): ReportSheet {
  const t = context.text.reports;
  const rows: SheetRow[] = [];
  for (const account of data.accounts) {
    rows.push({
      emphasis: 'section',
      cells: {
        entry: account.account.code,
        description: accountName(account.account, context.text),
      },
    });
    rows.push({
      level: 1,
      emphasis: 'note',
      cells: { description: t.totals.opening, balance: account.opening },
    });
    for (const line of account.lines) rows.push(ledgerLineRow(line, context, false));
    rows.push({
      level: 1,
      emphasis: 'subtotal',
      cells: { description: t.totals.closing, balance: account.closing },
    });
  }
  return {
    report: 'general_ledger',
    title: t.names.general_ledger,
    ...headerParts(data.header, context),
    columns: ledgerLineColumns(context, false),
    rows,
  };
}

function accountStatementSheet(data: AccountStatement, context: SheetContext): ReportSheet {
  const t = context.text.reports;
  const rows: SheetRow[] = [
    { emphasis: 'note', cells: { description: t.totals.opening, balance: data.opening } },
    ...data.lines.map((line) => ledgerLineRow(line, context, true)),
    { emphasis: 'subtotal', cells: { description: t.totals.closing, balance: data.closing } },
  ];
  for (const currency of data.currencies) {
    rows.push({
      emphasis: 'note',
      cells: {
        description: `${t.columns.transactionBalance}: ${t.totals.opening} / ${t.totals.closing}`,
        currency: currency.currency,
        transactionAmount: currency.opening,
        transactionBalance: currency.closing,
      },
    });
  }
  return {
    report: 'account_statement',
    title: `${t.names.account_statement}: ${data.account.code} ${data.account.name}`,
    ...headerParts(data.header, context, [
      { label: t.header.account, value: `${data.account.code} ${data.account.name}` },
    ]),
    columns: ledgerLineColumns(context, true),
    rows,
  };
}

// --- Journal (rule 12) ---

function journalSheet(data: Journal, context: SheetContext): ReportSheet {
  const t = context.text.reports;
  const c = t.columns;
  const columns: SheetColumn[] = [
    date('date', c.date),
    code('entry', c.entry, 11),
    code('code', c.code, 10),
    text('account', c.account, 30),
    text('description', c.description, 36),
    text('dimensions', c.dimensions, 22),
    amount('debit', c.debit),
    amount('credit', c.credit),
  ];
  const rows: SheetRow[] = [];
  for (const entry of data.entries) {
    rows.push({
      emphasis: 'section',
      cells: {
        date: entry.entryDate,
        entry: entryNumberText(entry, context.fiscalYearStartMonth),
        description: entry.reference
          ? `${entry.description} — ${entry.reference}`
          : entry.description,
      },
    });
    for (const line of entry.lines) {
      rows.push({
        level: 1,
        cells: {
          code: line.account.code,
          account: line.account.name,
          description: line.memo ?? undefined,
          dimensions: valuesText(line.values),
          debit: line.debit === '0' ? undefined : line.debit,
          credit: line.credit === '0' ? undefined : line.credit,
        },
      });
    }
  }
  return {
    report: 'journal_book',
    title: t.journal,
    ...headerParts(data.header, context),
    columns,
    rows,
  };
}

// --- Income statement and balance sheet (rules 13–19) ---

function statementColumns(header: ReportHeader, context: SheetContext): SheetColumn[] {
  const c = context.text.reports.columns;
  const columns: SheetColumn[] = [text('line', c.line, 48), amount('current', c.current, 20)];
  if (header.compare !== null) columns.push(amount('compare', c.compare, 20));
  return columns;
}

function incomeStatementSheet(data: IncomeStatement, context: SheetContext): ReportSheet {
  const t = context.text.reports;
  const s = t.statements;
  const category = (code: string) =>
    STATEMENT_LINES.find((line) => line.code === code)?.ifrs18Category ?? 'operating';
  const subtotal = (
    label: string,
    key: 'operatingProfit' | 'profitBeforeFinancingAndIncomeTaxes' | 'profitBeforeTax' | 'profit',
    emphasis: 'subtotal' | 'total' = 'subtotal',
  ): SheetRow => ({
    emphasis,
    cells: {
      line: label,
      current: data.subtotals[key],
      compare: compareCell(data.header, data.compareSubtotals?.[key] ?? null),
    },
  });
  const lineRow = (line: IncomeStatement['lines'][number]): SheetRow => ({
    level: 1,
    cells: {
      line: statementLineName(line.line),
      current: line.amount,
      compare: compareCell(data.header, line.compare),
    },
  });
  const of = (wanted: readonly string[]) =>
    data.lines.filter((line) => wanted.includes(category(line.line))).map(lineRow);
  const rows: SheetRow[] = [
    ...of(['operating']),
    subtotal(s.operatingProfit, 'operatingProfit'),
    ...of(['investing']),
  ];
  // Shown when either column has an investing amount (rule 14), with its comparative (IAS 1.38): in
  // a column without one, profit before financing and income taxes is its operating profit.
  const beforeFinancing = (subtotals: IncomeStatement['subtotals'] | null) =>
    subtotals === null
      ? null
      : (subtotals.profitBeforeFinancingAndIncomeTaxes ?? subtotals.operatingProfit);
  if (
    data.subtotals.profitBeforeFinancingAndIncomeTaxes !== null ||
    (data.compareSubtotals?.profitBeforeFinancingAndIncomeTaxes ?? null) !== null
  ) {
    rows.push({
      emphasis: 'subtotal',
      cells: {
        line: s.profitBeforeFinancingAndIncomeTaxes,
        current: beforeFinancing(data.subtotals),
        compare: compareCell(data.header, beforeFinancing(data.compareSubtotals)),
      },
    });
  }
  rows.push(
    ...of(['financing']),
    subtotal(s.profitBeforeTax, 'profitBeforeTax'),
    ...of(['income_taxes']),
    subtotal(s.profit, 'profit', 'total'),
  );
  return {
    report: 'income_statement',
    title: t.names.income_statement,
    ...headerParts(data.header, context),
    columns: statementColumns(data.header, context),
    rows,
  };
}

function balanceSheetSheet(data: BalanceSheet, context: SheetContext): ReportSheet {
  const t = context.text.reports;
  const s = t.statements;
  const sectionOf = (code: string) => STATEMENT_LINES.find((line) => line.code === code)?.section;
  const linesOf = (section: string): SheetRow[] =>
    data.lines
      .filter((line) => sectionOf(line.line) === section)
      .flatMap((line) => {
        const rows: SheetRow[] = [
          {
            level: 1,
            cells: {
              line: statementLineName(line.line),
              current: line.amount,
              compare: compareCell(data.header, line.compare),
            },
          },
        ];
        if (line.reclassified !== '0') {
          rows.push({
            level: 2,
            emphasis: 'note',
            cells: { line: s.reclassified, current: line.reclassified },
          });
        }
        if (line.unclosedYears !== null && line.unclosedYears !== '0') {
          rows.push({
            level: 2,
            emphasis: 'note',
            cells: {
              line: s.unclosedYears,
              current: line.unclosedYears,
              compare: compareCell(data.header, line.compareUnclosedYears),
            },
          });
        }
        for (const part of line.parts.filter((candidate) => candidate.oppositeSide)) {
          rows.push({
            level: 2,
            emphasis: 'note',
            cells: {
              line: `${s.oppositeSide}: ${part.account.code} ${part.account.name}`,
              current: part.amount,
            },
          });
        }
        return rows;
      });
  const section = (key: keyof typeof s.sections): SheetRow[] => [
    { emphasis: 'section', cells: { line: s.sections[key] } },
    ...linesOf(key),
  ];
  const total = (
    label: string,
    key: keyof BalanceSheet['totals'],
    emphasis: 'subtotal' | 'total',
  ) => ({
    emphasis,
    cells: {
      line: label,
      current: data.totals[key],
      compare: compareCell(data.header, data.compareTotals?.[key] ?? null),
    },
  });
  const rows: SheetRow[] = [
    ...section('current_assets'),
    ...section('non_current_assets'),
    total(t.totals.assets, 'assets', 'total'),
    ...section('current_liabilities'),
    total(t.totals.liabilities, 'liabilities', 'subtotal'),
    ...section('equity'),
    {
      level: 1,
      cells: {
        line: s.yearResult,
        current: data.yearResult,
        compare: compareCell(data.header, data.compareYearResult),
      },
    },
    ...(data.yearResultPreOpening !== '0' || (data.compareYearResultPreOpening ?? '0') !== '0'
      ? [
          {
            level: 2,
            emphasis: 'note' as const,
            cells: {
              line: s.yearResultPreOpening,
              current: data.yearResultPreOpening,
              compare: compareCell(data.header, data.compareYearResultPreOpening),
            },
          },
        ]
      : []),
    total(t.totals.equity, 'equity', 'subtotal'),
    total(t.totals.liabilitiesAndEquity, 'liabilitiesAndEquity', 'total'),
  ];
  return {
    report: 'balance_sheet',
    title: t.names.balance_sheet,
    ...headerParts(data.header, context),
    columns: statementColumns(data.header, context),
    rows,
  };
}

// --- Profitability (rules 20–23) ---

function profitabilitySheet(data: Profitability, context: SheetContext): ReportSheet {
  const t = context.text.reports;
  const c = t.columns;
  const compared = data.header.compare !== null;
  const columns: SheetColumn[] = [
    text('value', t.profitability.by[data.by], 36),
    amount('revenue', c.revenue, 18, c.current),
    amount('directCosts', c.directCosts, 18, c.current),
    amount('contribution', c.contribution, 18, c.current),
    { key: 'margin', label: c.margin, kind: 'percent', width: 10, group: c.current },
  ];
  if (compared) {
    columns.push(
      amount('compareRevenue', c.revenue, 18, c.compare),
      amount('compareContribution', c.contribution, 18, c.compare),
      { key: 'compareMargin', label: c.margin, kind: 'percent', width: 10, group: c.compare },
    );
  }
  const figures = (
    current: ProfitabilityFigures,
    compare: ProfitabilityFigures | null,
  ): Record<string, SheetCell> => ({
    revenue: current.revenue,
    directCosts: current.directCosts,
    contribution: current.contribution,
    margin: percent(current.margin),
    ...(compared
      ? {
          compareRevenue: compareCell(data.header, compare?.revenue ?? null),
          compareContribution: compareCell(data.header, compare?.contribution ?? null),
          compareMargin: compare === null ? null : percent(compare.margin),
        }
      : {}),
  });
  const rows: SheetRow[] = data.rows.map((row) => ({
    cells: { value: valueName(row.value, context.text), ...figures(row.current, row.compare) },
  }));
  rows.push({
    emphasis: 'total',
    cells: { value: t.totals.total, ...figures(data.totals.current, data.totals.compare) },
  });
  return {
    report: 'profitability',
    title: t.names.profitability,
    ...headerParts(data.header, context, [
      { label: t.header.by, value: t.profitability.by[data.by] },
    ]),
    columns,
    rows,
  };
}

// --- The receivables (S04) and the chart (S02) ---

function plainHeader(
  producedAt: string,
  currency: CurrencyCode,
  parameters: readonly SheetParameter[],
  context: SheetContext,
): Pick<ReportSheet, 'parameters' | 'marks' | 'currency' | 'currencyLabel'> {
  const h = context.text.reports.header;
  return {
    parameters: [
      ...parameters,
      { label: h.currency, value: printedCurrency(currency, context.text) },
      { label: h.producedAt, value: formatProducedAt(producedAt) },
    ],
    marks: [],
    currency,
    currencyLabel: printedCurrency(currency, context.text),
  };
}

function ageingSheet(data: AgeingReport, producedAt: string, context: SheetContext): ReportSheet {
  const t = context.text.reports;
  const o = context.text.openItems;
  const c = t.columns;
  const columns: SheetColumn[] = [
    text('client', `${c.client} / ${c.reference}`, 30),
    date('dueOn', o.labels.dueOn),
    code('days', o.labels.daysPastDue, 8),
    code('currency', c.currency, 8),
    { ...amount('open', c.amount), currencyKey: 'currency' },
    ...AGEING_BUCKETS.map((bucket) => amount(bucket, o.buckets[bucket], 15)),
    amount('total', c.total),
  ];
  const rows: SheetRow[] = [];
  for (const client of data.clients) {
    rows.push({
      emphasis: 'subtotal',
      cells: {
        client: client.client === null ? t.ageing.noClient : client.client.name,
        ...client.buckets,
        total: client.totalMinor,
      },
    });
    for (const item of client.items) {
      rows.push({
        level: 1,
        cells: {
          client: `${item.account.code} · ${item.reference}`,
          dueOn: item.dueOn,
          days: String(item.daysPastDue),
          currency: item.currency,
          open: item.openMinor,
          [item.bucket]: item.carryingMinor,
          total: item.carryingMinor,
        },
      });
    }
  }
  rows.push({
    emphasis: 'total',
    cells: { client: t.ageing.total, ...data.buckets, total: data.totalMinor },
  });
  return {
    report: 'ageing',
    title: t.names.ageing,
    ...plainHeader(
      producedAt,
      data.ledgerCurrency,
      [
        { label: t.header.asOf, value: data.asOf },
        { label: t.header.ledger, value: ledgerName(data.ledger, context.text) },
        {
          label: t.header.account,
          value: data.accounts.map((account) => `${account.code} ${account.name}`).join('، '),
        },
      ],
      context,
    ),
    columns,
    rows,
  };
}

function clientStatementSheet(
  data: ClientStatement,
  producedAt: string,
  context: SheetContext,
): ReportSheet {
  const t = context.text.reports;
  const c = t.columns;
  const rows: SheetRow[] = [];
  for (const balance of data.opening) {
    rows.push({
      emphasis: 'note',
      cells: {
        description: t.totals.opening,
        currency: balance.currency,
        balance: balance.amountMinor,
        ledgerAmount: balance.ledgerMinor,
      },
    });
  }
  rows.push({
    emphasis: 'note',
    cells: { description: t.totals.opening, ledgerBalance: data.openingLedgerMinor },
  });
  for (const line of data.lines) {
    rows.push({
      level: 1,
      cells: {
        date: line.entryDate,
        entry: entryNumberText(line, context.fiscalYearStartMonth),
        description: line.memo ? `${line.description} — ${line.memo}` : line.description,
        reference: `${line.account.code} · ${line.itemReference}`,
        currency: line.currency,
        amount: line.amountMinor,
        balance: line.balanceMinor,
        ledgerAmount: line.ledgerMinor,
        ledgerBalance: line.ledgerBalanceMinor,
      },
    });
  }
  for (const balance of data.closing) {
    rows.push({
      emphasis: 'subtotal',
      cells: {
        description: t.totals.closing,
        currency: balance.currency,
        balance: balance.amountMinor,
        ledgerAmount: balance.ledgerMinor,
      },
    });
  }
  rows.push({
    emphasis: 'total',
    cells: { description: t.totals.closing, ledgerBalance: data.closingLedgerMinor },
  });
  return {
    report: 'client_statement',
    title: `${t.names.client_statement}: ${data.client.name}`,
    ...plainHeader(
      producedAt,
      data.ledgerCurrency,
      [
        { label: t.header.client, value: data.client.name },
        { label: t.header.period, value: range(data.from, data.to, context.text) },
        { label: t.header.ledger, value: ledgerName(data.ledger, context.text) },
        {
          label: t.columns.currency,
          value: data.currency === null ? t.header.allCurrencies : data.currency,
        },
      ],
      context,
    ),
    columns: [
      date('date', c.date),
      code('entry', c.entry, 11),
      text('description', c.description, 34),
      text('reference', c.reference, 22),
      code('currency', c.currency, 8),
      { ...amount('amount', c.transactionAmount), currencyKey: 'currency' },
      { ...amount('balance', c.transactionBalance), currencyKey: 'currency' },
      amount('ledgerAmount', c.amount),
      amount('ledgerBalance', c.balance),
    ],
    rows,
  };
}

function chartSheet(
  accounts: readonly Account[],
  bookCurrency: CurrencyCode,
  producedAt: string,
  context: SheetContext,
): ReportSheet {
  const t = context.text.reports;
  const ch = context.text.chart;
  const yesNo = (value: boolean) => (value ? t.yes : t.no);
  return {
    report: 'chart',
    title: t.names.chart,
    ...plainHeader(producedAt, bookCurrency, [], context),
    columns: [
      code('code', ch.export.code, 10),
      text('name', ch.export.name, 36),
      text('kind', ch.export.kind, 12),
      text('class', ch.export.class, 14),
      text('normalBalance', ch.export.normalBalance, 10),
      text('statementLine', ch.export.statementLine, 30),
      text('currency', ch.export.currency, 16),
      text('control', ch.export.control, 8),
      text('blocked', ch.export.blocked, 8),
      text('archived', ch.export.archived, 8),
    ],
    rows: accounts.map((account) => ({
      level: account.level - 1,
      ...(account.kind === 'header' ? { emphasis: 'subtotal' as const } : {}),
      cells: {
        code: account.code,
        name: account.name,
        kind: ch.kinds[account.kind],
        class: ch.classes[account.class],
        normalBalance: ch.normalBalances[account.normalBalance],
        statementLine:
          account.statementLine === null ? undefined : statementLineName(account.statementLine),
        currency:
          account.currency === null ? undefined : printedCurrency(account.currency, context.text),
        control: yesNo(account.isControl),
        blocked: yesNo(account.blocked !== null),
        archived: yesNo(account.archived !== null),
      },
    })),
  };
}
