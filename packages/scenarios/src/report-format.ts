import {
  divideHalfAwayFromZero,
  minorAmountSchema,
  STATEMENT_LINES,
} from '@vertex-mizan/contracts';
import { z } from 'zod';

/**
 * A case's `reports` (S09; `docs/scenarios/README.md`, "Reports"): the figures a report presents
 * after the case's steps, read through the reports' readers. Strict objects in the README's
 * snake_case, parsed into camelCase. The checks here are the ones a figure must pass whatever the
 * system answers: the trial balance's pairs balance and its rows add up, a balance-sheet line is
 * the sum of its parts and the sheet balances, the income statement's subtotals are the sums of
 * their categories' lines, a contribution and its margin follow from revenue and direct costs, and
 * the journal book's totals carry forward from page to page.
 */

const WHEN_VALID = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

const dateSchema = z.iso.date();
const periodSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Expected a period YYYY-MM');
const accountSchema = z
  .string({ error: 'Expected an account code in quotes ("1210")' })
  .regex(/^\S+$/, 'Expected an account code');
const amountSchema = z
  .bigint({ error: 'Expected an amount in whole minor units' })
  .pipe(minorAmountSchema);
const magnitudeSchema = amountSchema.refine((amount) => amount >= 0n, 'Expected a magnitude ≥ 0');
const countSchema = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .bigint({ error: 'Expected a whole number' })
    .refine((value) => value >= BigInt(min) && value <= BigInt(max), {
      message: `Expected a whole number from ${min} to ${max}`,
    })
    .transform(Number);
const dimensionsSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/, 'Expected a dimension name in snake_case'),
  z.string().min(1),
);
const ledgerSchema = z.enum(['book', 'parallel'], {
  error: 'Expected the ledger: book or parallel',
});

/** S09 rule 4's marks, the exact set: "غير نهائية: الفترة مفتوحة" and "قبل إعادة التقييم". */
export const REPORT_MARKS = ['period_open', 'before_revaluation'] as const;

const marksSchema = z
  .array(z.enum(REPORT_MARKS))
  .refine((marks) => new Set(marks).size === marks.length, 'A mark is stated twice');

const marks = { marks: marksSchema, compare_marks: marksSchema.optional() };

const issueAt = (context: z.RefinementCtx, message: string, path: PropertyKey[]) =>
  context.addIssue({ code: 'custom', message, path });

const sum = (amounts: readonly bigint[]) => amounts.reduce((total, amount) => total + amount, 0n);

/** A period's comparative is stated with both of its ends, and its figures only with it (rule 5). */
function checkComparative(
  report: { params: Record<string, unknown> } & Record<string, unknown>,
  ends: readonly string[],
  figures: readonly string[],
  context: z.RefinementCtx,
): void {
  const named = ends.filter((end) => report.params[end] !== undefined);
  if (named.length !== 0 && named.length !== ends.length) {
    issueAt(context, `A comparative names ${ends.join(' and ')}`, ['params']);
  }
  const compared = named.length === ends.length;
  for (const figure of figures) {
    if (!compared && report[figure] !== undefined) {
      issueAt(context, `${figure} needs a comparative in params`, [figure]);
    }
  }
}

// --- Trial balance (S09 rule 9) ---

const trialBalanceRowSchema = z
  .strictObject({
    account: accountSchema,
    opening: amountSchema,
    debits: magnitudeSchema,
    credits: magnitudeSchema,
    closing: amountSchema,
  })
  .refine((row) => row.opening + row.debits - row.credits === row.closing, {
    message: 'The closing balance is the opening balance plus debits less credits',
    path: ['closing'],
  });

const trialBalanceTotalsSchema = z
  .strictObject({
    opening_debit: magnitudeSchema,
    opening_credit: magnitudeSchema,
    debits: magnitudeSchema,
    credits: magnitudeSchema,
    closing_debit: magnitudeSchema,
    closing_credit: magnitudeSchema,
  })
  .superRefine((totals, context) => {
    // ADR 0005: each pair of the trial balance balances.
    const pairs = [
      ['opening_debit', 'opening_credit'],
      ['debits', 'credits'],
      ['closing_debit', 'closing_credit'],
    ] as const;
    for (const [debit, credit] of pairs) {
      if (totals[debit] !== totals[credit]) {
        issueAt(context, `${debit} and ${credit} differ`, [credit]);
      }
    }
  })
  .transform((totals) => ({
    openingDebit: totals.opening_debit,
    openingCredit: totals.opening_credit,
    debits: totals.debits,
    credits: totals.credits,
    closingDebit: totals.closing_debit,
    closingCredit: totals.closing_credit,
  }));

const trialBalanceSchema = z
  .strictObject({
    report: z.literal('trial_balance'),
    params: z.strictObject({
      from: dateSchema,
      to: dateSchema,
      ledger: ledgerSchema.optional(),
      level: countSchema(1, 4).optional(),
      non_zero: z.boolean().optional(),
      code_from: accountSchema.optional(),
      code_to: accountSchema.optional(),
      compare_from: dateSchema.optional(),
      compare_to: dateSchema.optional(),
    }),
    ...marks,
    rows: z.array(trialBalanceRowSchema),
    totals: trialBalanceTotalsSchema,
  })
  .superRefine((report, context) => {
    checkComparative(report, ['compare_from', 'compare_to'], ['compare_marks'], context);
    const accounts = report.rows.map((row) => row.account);
    if (new Set(accounts).size !== accounts.length)
      issueAt(context, 'An account is twice', ['rows']);
    // With "non-zero" on (the default), the rows are the exact set, so they add up to the totals.
    if (report.params.non_zero === false) return;
    const { rows, totals } = report;
    const sums = {
      openingDebit: sum(rows.map((row) => (row.opening > 0n ? row.opening : 0n))),
      openingCredit: sum(rows.map((row) => (row.opening < 0n ? -row.opening : 0n))),
      debits: sum(rows.map((row) => row.debits)),
      credits: sum(rows.map((row) => row.credits)),
      closingDebit: sum(rows.map((row) => (row.closing > 0n ? row.closing : 0n))),
      closingCredit: sum(rows.map((row) => (row.closing < 0n ? -row.closing : 0n))),
    };
    for (const [key, value] of Object.entries(sums) as [keyof typeof sums, bigint][]) {
      if (totals[key] !== value) {
        issueAt(context, `The rows add up to ${value} for ${key}, not ${totals[key]}`, ['totals']);
      }
    }
  }, WHEN_VALID)
  .transform(({ compare_marks, ...report }) => ({
    ...report,
    compareMarks: compare_marks ?? null,
  }));

// --- Account statement (S09 rule 11) ---

const statementLineRowSchema = z
  .strictObject({
    entry: countSchema(1),
    date: dateSchema,
    amount: amountSchema,
    balance: amountSchema,
    currency: z.string().regex(/^[A-Z]{3}$/, 'Expected a currency code'),
    transaction_amount: amountSchema,
    transaction_balance: amountSchema,
  })
  .transform(({ transaction_amount, transaction_balance, ...line }) => ({
    ...line,
    transactionAmount: transaction_amount,
    transactionBalance: transaction_balance,
  }));

const accountStatementSchema = z
  .strictObject({
    report: z.literal('account_statement'),
    params: z.strictObject({
      account: accountSchema,
      from: dateSchema,
      to: dateSchema,
      ledger: ledgerSchema.optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/, 'Expected a currency code')
        .optional(),
      dims: dimensionsSchema.optional(),
    }),
    marks: marksSchema,
    opening: amountSchema,
    lines: z.array(statementLineRowSchema),
    closing: amountSchema,
    currencies: z.array(
      z.strictObject({
        currency: z.string().regex(/^[A-Z]{3}$/, 'Expected a currency code'),
        opening: amountSchema,
        closing: amountSchema,
      }),
    ),
  })
  .superRefine((report, context) => {
    // Running balances: the ledger's from the opening, each currency's from its own opening.
    let balance = report.opening;
    const running = new Map(report.currencies.map((row) => [row.currency, row.opening]));
    for (const [index, line] of report.lines.entries()) {
      balance += line.amount;
      if (line.balance !== balance) {
        issueAt(context, `The running balance is ${balance}`, ['lines', index, 'balance']);
      }
      const before = running.get(line.currency);
      if (before === undefined) {
        const message = `${line.currency} is not in currencies`;
        issueAt(context, message, ['lines', index, 'currency']);
        continue;
      }
      running.set(line.currency, before + line.transactionAmount);
      if (line.transactionBalance !== before + line.transactionAmount) {
        const message = `The running ${line.currency} balance is ${before + line.transactionAmount}`;
        issueAt(context, message, ['lines', index, 'transaction_balance']);
      }
    }
    if (report.closing !== balance)
      issueAt(context, `The closing balance is ${balance}`, ['closing']);
    for (const [index, row] of report.currencies.entries()) {
      if (row.closing !== running.get(row.currency)) {
        const message = `The closing ${row.currency} balance is ${running.get(row.currency)}`;
        issueAt(context, message, ['currencies', index, 'closing']);
      }
    }
  }, WHEN_VALID);

// --- Income statement (S09 rules 13, 14) ---

const INCOME_LINES = STATEMENT_LINES.filter((line) => line.statement === 'income_statement');
const BALANCE_LINES = STATEMENT_LINES.filter((line) => line.statement === 'balance_sheet');

const statementLineCode = (lines: typeof STATEMENT_LINES, statement: string) =>
  z.string().refine((code) => lines.some((line) => line.code === code), {
    message: `Expected a line of the ${statement} in the statement-line catalogue`,
  });

const subtotalsSchema = z
  .strictObject({
    operating_profit: amountSchema,
    profit_before_financing_and_income_taxes: amountSchema.optional(),
    profit_before_tax: amountSchema,
    profit: amountSchema,
  })
  .transform((subtotals) => ({
    operatingProfit: subtotals.operating_profit,
    profitBeforeFinancingAndIncomeTaxes: subtotals.profit_before_financing_and_income_taxes ?? null,
    profitBeforeTax: subtotals.profit_before_tax,
    profit: subtotals.profit,
  }));

type Subtotals = z.output<typeof subtotalsSchema>;

/**
 * Rule 14's subtotals from the lines, by their IFRS 18 category: operating, then investing (the
 * subtotal shown only when an investing line has an amount), then financing, then income taxes.
 */
function subtotalsOf(amounts: ReadonlyMap<string, bigint>): Subtotals {
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

function checkSubtotals(
  stated: Subtotals,
  amounts: ReadonlyMap<string, bigint>,
  path: string,
  context: z.RefinementCtx,
): void {
  const expected = subtotalsOf(amounts);
  for (const key of Object.keys(expected) as (keyof Subtotals)[]) {
    if (stated[key] !== expected[key]) {
      const message = `The lines give ${expected[key] ?? 'no such subtotal'} for ${key}`;
      issueAt(context, message, [path]);
    }
  }
}

const incomeStatementSchema = z
  .strictObject({
    report: z.literal('income_statement'),
    params: z.strictObject({
      from: dateSchema,
      to: dateSchema,
      ledger: ledgerSchema.optional(),
      compare_from: dateSchema.optional(),
      compare_to: dateSchema.optional(),
    }),
    ...marks,
    lines: z.array(
      z.strictObject({
        line: statementLineCode(INCOME_LINES, 'income statement'),
        amount: amountSchema,
        compare: amountSchema.optional(),
      }),
    ),
    subtotals: subtotalsSchema,
    compare_subtotals: subtotalsSchema.optional(),
  })
  .superRefine((report, context) => {
    checkComparative(
      report,
      ['compare_from', 'compare_to'],
      ['compare_marks', 'compare_subtotals'],
      context,
    );
    const codes = report.lines.map((line) => line.line);
    if (new Set(codes).size !== codes.length) issueAt(context, 'A line is stated twice', ['lines']);
    checkSubtotals(
      report.subtotals,
      new Map(report.lines.map((line) => [line.line, line.amount])),
      'subtotals',
      context,
    );
    if (report.compare_subtotals) {
      const compared = new Map(report.lines.map((line) => [line.line, line.compare ?? 0n]));
      checkSubtotals(report.compare_subtotals, compared, 'compare_subtotals', context);
    }
  }, WHEN_VALID)
  .transform(({ compare_marks, compare_subtotals, ...report }) => ({
    ...report,
    compareMarks: compare_marks ?? null,
    compareSubtotals: compare_subtotals ?? null,
  }));

// --- Balance sheet (S09 rules 15–19) ---

const balanceSheetTotalsSchema = z
  .strictObject({
    assets: amountSchema,
    liabilities: amountSchema,
    equity: amountSchema,
    liabilities_and_equity: amountSchema,
  })
  .superRefine((totals, context) => {
    if (totals.liabilities + totals.equity !== totals.liabilities_and_equity) {
      issueAt(context, 'Liabilities and equity are their sum', ['liabilities_and_equity']);
    }
    // The balance sheet balances (S09 rule 15).
    if (totals.assets !== totals.liabilities_and_equity) {
      issueAt(context, 'Assets equal liabilities and equity', ['assets']);
    }
  })
  .transform(({ liabilities_and_equity, ...totals }) => ({
    ...totals,
    liabilitiesAndEquity: liabilities_and_equity,
  }));

type BalanceSheetTotals = z.output<typeof balanceSheetTotalsSchema>;

const balanceSheetLineSchema = z
  .strictObject({
    line: statementLineCode(BALANCE_LINES, 'balance sheet'),
    amount: amountSchema,
    compare: amountSchema.optional(),
    unclosed_years: amountSchema.optional(),
    compare_unclosed_years: amountSchema.optional(),
    parts: z
      .array(
        z.strictObject({
          account: accountSchema,
          dims: dimensionsSchema.default({}),
          amount: amountSchema,
          reclassified: z.boolean().default(false),
        }),
      )
      .min(1),
  })
  .superRefine((line, context) => {
    if (
      (line.unclosed_years !== undefined || line.compare_unclosed_years !== undefined) &&
      line.line !== 'bs.retained_earnings'
    ) {
      issueAt(context, 'Unclosed years are presented in bs.retained_earnings', ['unclosed_years']);
    }
    // The parts are the balances the line is made of, at the report's date (rules 17, 18).
    const total = sum(line.parts.map((part) => part.amount)) + (line.unclosed_years ?? 0n);
    if (total !== line.amount) {
      issueAt(context, `The parts add up to ${total}, not ${line.amount}`, ['parts']);
    }
  })
  .transform(({ unclosed_years, compare_unclosed_years, ...line }) => ({
    ...line,
    compare: line.compare ?? null,
    unclosedYears: unclosed_years ?? null,
    compareUnclosedYears: compare_unclosed_years ?? null,
  }));

const balanceSheetSchema = z
  .strictObject({
    report: z.literal('balance_sheet'),
    params: z.strictObject({
      as_of: dateSchema,
      ledger: ledgerSchema.optional(),
      compare_as_of: dateSchema.optional(),
    }),
    ...marks,
    lines: z.array(balanceSheetLineSchema),
    year_result: amountSchema,
    compare_year_result: amountSchema.optional(),
    totals: balanceSheetTotalsSchema,
    compare_totals: balanceSheetTotalsSchema.optional(),
  })
  .superRefine((report, context) => {
    checkComparative(
      report,
      ['compare_as_of'],
      ['compare_marks', 'compare_year_result', 'compare_totals'],
      context,
    );
    const codes = report.lines.map((line) => line.line);
    if (new Set(codes).size !== codes.length) issueAt(context, 'A line is stated twice', ['lines']);
    const sectionsOf = (pick: (line: (typeof report.lines)[number]) => bigint | null) => {
      const of = (sections: readonly string[]) =>
        sum(
          report.lines
            .filter((line) =>
              BALANCE_LINES.some((cat) => cat.code === line.line && sections.includes(cat.section)),
            )
            .map((line) => pick(line) ?? 0n),
        );
      return {
        assets: of(['current_assets', 'non_current_assets']),
        liabilities: of(['current_liabilities']),
        equity: of(['equity']),
      };
    };
    const check = (
      totals: BalanceSheetTotals,
      yearResult: bigint,
      sections: ReturnType<typeof sectionsOf>,
      path: string,
    ) => {
      // Equity holds the year's result, a computed line of no account (rule 16).
      const expected = { ...sections, equity: sections.equity + yearResult };
      for (const key of ['assets', 'liabilities', 'equity'] as const) {
        if (totals[key] !== expected[key]) {
          issueAt(context, `The lines give ${expected[key]} for ${key}`, [path, key]);
        }
      }
    };
    check(
      report.totals,
      report.year_result,
      sectionsOf((line) => line.amount),
      'totals',
    );
    if (report.compare_totals && report.compare_year_result !== undefined) {
      const compared = sectionsOf((line) => line.compare ?? null);
      check(report.compare_totals, report.compare_year_result, compared, 'compare_totals');
    }
  }, WHEN_VALID)
  .transform(({ compare_marks, year_result, compare_year_result, compare_totals, ...report }) => ({
    ...report,
    compareMarks: compare_marks ?? null,
    yearResult: year_result,
    compareYearResult: compare_year_result ?? null,
    compareTotals: compare_totals ?? null,
  }));

// --- Profitability (S09 rules 20–23) ---

/** Rule 21: contribution over revenue as a percentage with one decimal, half away from zero. */
export function marginOf(revenue: bigint, contribution: bigint): string | null {
  if (revenue === 0n) return null;
  // The money module divides by a positive denominator: a negative revenue moves its sign up.
  const tenths =
    revenue > 0n
      ? divideHalfAwayFromZero(contribution * 1000n, revenue)
      : divideHalfAwayFromZero(-contribution * 1000n, -revenue);
  const sign = tenths < 0n ? '-' : '';
  const magnitude = tenths < 0n ? -tenths : tenths;
  return `${sign}${magnitude / 10n}.${magnitude % 10n}`;
}

// Revenue and direct costs are net of reversals, so a month with a void can show either negative
// (S09 edge case 12): revenue as presented, positive for income; direct costs positive for a cost.
const profitabilityFiguresSchema = {
  revenue: amountSchema,
  direct_costs: amountSchema,
  contribution: amountSchema,
  margin: z
    .string()
    .regex(/^-?\d+\.\d$/, 'Expected a percentage with one decimal in quotes ("68.8")')
    .nullable(),
};

type ProfitabilityFigures = {
  revenue: bigint;
  direct_costs: bigint;
  contribution: bigint;
  margin: string | null;
};

function checkFigures(
  figures: ProfitabilityFigures,
  path: PropertyKey[],
  context: z.RefinementCtx,
) {
  const contribution = figures.revenue - figures.direct_costs;
  if (figures.contribution !== contribution) {
    issueAt(context, `The contribution is ${contribution}`, [...path, 'contribution']);
  }
  const margin = marginOf(figures.revenue, contribution);
  if (figures.margin !== margin) {
    issueAt(context, `The margin is ${margin ?? 'null ("—")'}`, [...path, 'margin']);
  }
}

const profitabilitySchema = z
  .strictObject({
    report: z.literal('profitability'),
    params: z.strictObject({
      by: z.enum(['client', 'contract', 'department', 'service']),
      from: dateSchema,
      to: dateSchema,
      ledger: ledgerSchema.optional(),
      compare_from: dateSchema.optional(),
      compare_to: dateSchema.optional(),
    }),
    ...marks,
    rows: z.array(z.strictObject({ value: z.string().min(1), ...profitabilityFiguresSchema })),
    totals: z.strictObject(profitabilityFiguresSchema),
  })
  .superRefine((report, context) => {
    checkComparative(report, ['compare_from', 'compare_to'], ['compare_marks'], context);
    const values = report.rows.map((row) => row.value);
    if (new Set(values).size !== values.length) issueAt(context, 'A value is twice', ['rows']);
    for (const [index, row] of report.rows.entries()) checkFigures(row, ['rows', index], context);
    checkFigures(report.totals, ['totals'], context);
    // Rule 23: the rows, "غير موزع" included, add up to the totals.
    for (const key of ['revenue', 'direct_costs'] as const) {
      const total = sum(report.rows.map((row) => row[key]));
      if (report.totals[key] !== total) {
        issueAt(context, `The rows add up to ${total} for ${key}`, ['totals', key]);
      }
    }
  }, WHEN_VALID)
  .transform(({ compare_marks, rows, totals, ...report }) => {
    const figures = ({ direct_costs, ...rest }: ProfitabilityFigures) => ({
      ...rest,
      directCosts: direct_costs,
    });
    return {
      ...report,
      compareMarks: compare_marks ?? null,
      rows: rows.map(({ value, ...row }) => ({ value, ...figures(row) })),
      totals: figures(totals),
    };
  });

// --- Journal book (S09 rules 26, 27) ---

const debitsAndCreditsSchema = z
  .strictObject({ debits: magnitudeSchema, credits: magnitudeSchema })
  .refine((totals) => totals.debits === totals.credits, {
    message: 'Debits and credits differ',
    path: ['credits'],
  });

const journalPageSchema = z
  .strictObject({
    page: countSchema(1),
    entries: z.array(countSchema(1)),
    debits: magnitudeSchema,
    credits: magnitudeSchema,
    brought_forward: debitsAndCreditsSchema,
    cumulative: debitsAndCreditsSchema,
  })
  .superRefine((page, context) => {
    if (page.debits !== page.credits) issueAt(context, 'Debits and credits differ', ['credits']);
    if (page.brought_forward.debits + page.debits !== page.cumulative.debits) {
      issueAt(context, 'The cumulative totals are those brought forward plus the page', [
        'cumulative',
      ]);
    }
  })
  .transform(({ brought_forward, ...page }) => ({ ...page, broughtForward: brought_forward }));

const journalBookSchema = z
  .strictObject({
    report: z.literal('journal_book'),
    params: z.strictObject({
      fiscal_year: countSchema(2026, 9999),
      from: periodSchema,
      to: periodSchema,
      official: z.boolean().default(false),
    }),
    marks: marksSchema,
    pages: z.array(journalPageSchema).min(1),
  })
  .superRefine((report, context) => {
    const { params, pages } = report;
    for (const month of [params.from, params.to]) {
      if (!month.startsWith(`${params.fiscal_year}-`)) {
        issueAt(context, `${month} is not in the fiscal year ${params.fiscal_year}`, ['params']);
      }
    }
    if (params.from > params.to) issueAt(context, 'from is after to', ['params', 'from']);
    // Pages run on without a gap, each carrying forward the cumulative totals of the one before.
    for (const [index, page] of pages.entries()) {
      const before = pages[index - 1];
      if (before === undefined) continue;
      if (page.page !== before.page + 1) {
        issueAt(context, `Page ${page.page} does not follow page ${before.page}`, ['pages', index]);
      }
      if (page.broughtForward.debits !== before.cumulative.debits) {
        const message = `Page ${page.page} brings forward ${before.cumulative.debits}`;
        issueAt(context, message, ['pages', index, 'brought_forward']);
      }
    }
    // Each entry is on one page, except one split across pages ("تابع القيد", rule 27): the last
    // of a page and the first of the next. The order, (entry_date, number), is checked against the
    // expected entries' dates in `format.ts`.
    const seen = new Set<number>();
    for (const [index, page] of pages.entries()) {
      for (const [at, entry] of page.entries.entries()) {
        const continued = at === 0 && pages[index - 1]?.entries.at(-1) === entry;
        if (seen.has(entry) && !continued) {
          issueAt(context, `Entry ${entry} is on two pages without continuing`, ['pages', index]);
        }
        seen.add(entry);
      }
    }
  }, WHEN_VALID)
  .transform(({ params: { fiscal_year, ...params }, ...report }) => ({
    ...report,
    params: { fiscalYear: fiscal_year, ...params },
  }));

/** One report a case states, told apart by its `report` (S09 rule 37's identities). */
export const expectedReportSchema = z.discriminatedUnion(
  'report',
  [
    trialBalanceSchema,
    accountStatementSchema,
    incomeStatementSchema,
    balanceSheetSchema,
    profitabilitySchema,
    journalBookSchema,
  ],
  {
    error:
      'Expected a report: trial_balance, account_statement, income_statement, balance_sheet, ' +
      'profitability or journal_book',
  },
);

export type ExpectedReport = z.output<typeof expectedReportSchema>;

/**
 * The entries a report names by their place in posting order, in the report's order: an account
 * statement's lines, or the journal book's entries with a continued entry named once.
 */
export function reportEntries(report: ExpectedReport): number[] {
  if (report.report === 'account_statement') return report.lines.map((line) => line.entry);
  if (report.report === 'journal_book') {
    return report.pages.flatMap((page, index) =>
      page.entries.filter(
        (entry, at) => !(at === 0 && report.pages[index - 1]?.entries.at(-1) === entry),
      ),
    );
  }
  return [];
}

/** The ledger a report reads, when it names one. */
export function reportLedger(report: ExpectedReport): 'book' | 'parallel' | null {
  return 'ledger' in report.params ? (report.params.ledger ?? null) : null;
}
