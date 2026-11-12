import { z } from 'zod';
import { cursorSchema } from './audit.js';
import { STATEMENT_LINES } from './chart.js';
import { contractKindSchema } from './dimensions.js';
import { entryHubDocumentSchema } from './entries.js';
import { currencyCodeSchema, ledgerSchema } from './money.js';
import { entryNumberSchema, minorUnitsSchema } from './wire.js';

/**
 * The reports of S09 (F13): the queries of `/api/reports/*` and their answers. Every amount is a
 * `MinorUnits` string of the report's ledger currency, the exact sum of stored ledger amounts
 * (rule 3); nothing is converted, and only the margin is rounded (rule 21). Balances are signed,
 * positive debit and negative credit; a period's debits and credits are magnitudes.
 */

/** The report identities (S09 rule 37), append-only: an export or a stored file names one. */
export const REPORTS = [
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

export const reportSchema = z.enum(REPORTS).meta({ id: 'Report' });

export type Report = z.infer<typeof reportSchema>;

/**
 * Rule 4's marks: `period_open` ("غير نهائية: الفترة مفتوحة") when a month the report reads is
 * open or reopened; `before_revaluation` ("قبل إعادة التقييم") when its end is not a month's last
 * day, or that month's revaluation in the report's ledger is not `current`.
 */
export const REPORT_MARKS = ['period_open', 'before_revaluation'] as const;

export const reportMarkSchema = z.enum(REPORT_MARKS).meta({ id: 'ReportMark' });

export type ReportMark = z.infer<typeof reportMarkSchema>;

/** The dimensions profitability reads (rule 20). */
export const PROFITABILITY_DIMENSIONS = ['client', 'contract', 'department', 'service'] as const;

export const profitabilityDimensionSchema = z
  .enum(PROFITABILITY_DIMENSIONS)
  .meta({ id: 'ProfitabilityDimension' });

export type ProfitabilityDimension = z.infer<typeof profitabilityDimensionSchema>;

const dateSchema = z.iso.date();
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month YYYY-MM');
const accountCodeQuerySchema = z.string().regex(/^\d{1,12}$/, 'Expected an account code');
const flagSchema = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((text) => text === 'true');

/** A comparative period's ends, both or neither, in order (rule 5). */
function checkRange(
  range: {
    from?: string | undefined;
    to?: string | undefined;
    compareFrom?: string | undefined;
    compareTo?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (range.from !== undefined && range.to !== undefined && range.from > range.to) {
    context.addIssue({ code: 'custom', message: 'from is after to', path: ['from'] });
  }
  if ((range.compareFrom === undefined) !== (range.compareTo === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'A comparative names compareFrom and compareTo',
      path: ['compareFrom'],
    });
  } else if (
    range.compareFrom !== undefined &&
    range.compareTo !== undefined &&
    range.compareFrom > range.compareTo
  ) {
    context.addIssue({
      code: 'custom',
      message: 'compareFrom is after compareTo',
      path: ['compareFrom'],
    });
  }
}

function checkCodeRange(
  range: { codeFrom?: string | undefined; codeTo?: string | undefined },
  context: z.RefinementCtx,
) {
  if (range.codeFrom !== undefined && range.codeTo !== undefined && range.codeFrom > range.codeTo) {
    context.addIssue({ code: 'custom', message: 'codeFrom is after codeTo', path: ['codeFrom'] });
  }
}

const dimsQuerySchema = z
  .string()
  .optional()
  .transform((text, context) => {
    const ids = text ? text.split(',').filter((id) => id !== '') : [];
    for (const id of ids) {
      if (!z.uuid().safeParse(id).success) {
        context.addIssue({ code: 'custom', message: 'Expected dimension value ids' });
        return z.NEVER;
      }
    }
    return ids;
  });

// --- What every report says about itself (rule 4) ---

/** One column of a report: the dates it reads and its marks. A balance's `from` is null. */
export const reportColumnSchema = z
  .object({
    from: dateSchema.nullable(),
    to: dateSchema,
    marks: z.array(reportMarkSchema),
    /** Whether any posted line is in the column (a comparative with none shows "—", rule 5). */
    hasLines: z.boolean(),
  })
  .meta({ id: 'ReportColumn' });

export type ReportColumn = z.infer<typeof reportColumnSchema>;

/** The header of every report: its ledger and currency, when it was read, and its columns. */
export const reportHeaderSchema = z
  .object({
    ledger: ledgerSchema,
    currency: currencyCodeSchema,
    producedAt: z.iso.datetime({ offset: true }),
    /** The latest posted entry the report includes (rule 4), by posting order. */
    latestEntry: entryNumberSchema.nullable(),
    current: reportColumnSchema,
    compare: reportColumnSchema.nullable(),
  })
  .meta({ id: 'ReportHeader' });

export type ReportHeader = z.infer<typeof reportHeaderSchema>;

/** An account as the reports name it, archived and blocked marked (rule 7). */
export const reportAccountSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    nameLatin: z.string().nullable(),
    level: z.int().min(1).max(4),
    postable: z.boolean(),
    statementLine: z.string().nullable(),
    archived: z.boolean(),
    blocked: z.boolean(),
  })
  .meta({ id: 'ReportAccount' });

export type ReportAccount = z.infer<typeof reportAccountSchema>;

/** A dimension value as the reports name it, its type's code with it. */
export const reportValueSchema = z
  .object({
    id: z.uuid(),
    typeCode: z.string(),
    code: z.string().nullable(),
    name: z.string(),
    archived: z.boolean(),
  })
  .meta({ id: 'ReportValue' });

export type ReportValue = z.infer<typeof reportValueSchema>;

// --- Trial balance (rule 9) ---

/**
 * `GET /api/reports/trial-balance`. The comparative defaults to the previous period of as many
 * days ending the day before `from`; `compare=false` removes it, and `compareFrom`/`compareTo`
 * name another (rule 5).
 */
export const trialBalanceQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    ledger: ledgerSchema.default('book'),
    level: z.coerce.number().int().min(1).max(4).default(4),
    codeFrom: accountCodeQuerySchema.optional(),
    codeTo: accountCodeQuerySchema.optional(),
    nonZero: flagSchema('true'),
    compare: flagSchema('true'),
    compareFrom: dateSchema.optional(),
    compareTo: dateSchema.optional(),
  })
  .superRefine(checkRange)
  .superRefine(checkCodeRange)
  .meta({ id: 'TrialBalanceQuery' });

export type TrialBalanceQuery = z.infer<typeof trialBalanceQuerySchema>;

/** A row: an account at the query's level with its subtree's sums, or a childless one above. */
export const trialBalanceRowSchema = z
  .object({
    account: reportAccountSchema,
    opening: minorUnitsSchema,
    debits: minorUnitsSchema,
    credits: minorUnitsSchema,
    closing: minorUnitsSchema,
    /** The comparative period's closing balance; null without a comparative. */
    compare: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'TrialBalanceRow' });

export type TrialBalanceRow = z.infer<typeof trialBalanceRowSchema>;

export const trialBalanceTotalsSchema = z
  .object({
    openingDebit: minorUnitsSchema,
    openingCredit: minorUnitsSchema,
    debits: minorUnitsSchema,
    credits: minorUnitsSchema,
    closingDebit: minorUnitsSchema,
    closingCredit: minorUnitsSchema,
    compareDebit: minorUnitsSchema.nullable(),
    compareCredit: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'TrialBalanceTotals' });

export type TrialBalanceTotals = z.infer<typeof trialBalanceTotalsSchema>;

export const trialBalanceSchema = z
  .object({
    header: reportHeaderSchema,
    rows: z.array(trialBalanceRowSchema),
    totals: trialBalanceTotalsSchema,
  })
  .meta({ id: 'TrialBalance' });

export type TrialBalance = z.infer<typeof trialBalanceSchema>;

// --- General ledger, account statement (rules 10, 11) ---

/** A line as the general ledger and the account statement show it, with its running balances. */
export const reportLineSchema = z
  .object({
    entryId: z.uuid(),
    ...entryNumberSchema.shape,
    entryDate: dateSchema,
    lineNo: z.int().min(1),
    description: z.string(),
    memo: z.string().nullable(),
    values: z.array(reportValueSchema),
    /** The line's amount in the report's ledger and the ledger balance after it. */
    amount: minorUnitsSchema,
    balance: minorUnitsSchema,
    /** Its transaction amount and the running balance of its currency on the account. */
    currency: currencyCodeSchema,
    transactionAmount: minorUnitsSchema,
    transactionBalance: minorUnitsSchema,
    /** The open item a control account's line moves (rule 11). */
    openItem: z.object({ id: z.uuid(), reference: z.string() }).nullable(),
    hubDocument: entryHubDocumentSchema.nullable(),
  })
  .meta({ id: 'ReportLine' });

export type ReportLine = z.infer<typeof reportLineSchema>;

/** A currency's transaction balances on an account over the range. */
export const currencyBalanceSchema = z
  .object({ currency: currencyCodeSchema, opening: minorUnitsSchema, closing: minorUnitsSchema })
  .meta({ id: 'CurrencyBalance' });

export type CurrencyBalance = z.infer<typeof currencyBalanceSchema>;

/** `GET /api/reports/general-ledger`: a code range, 200 lines a page, accounts in code order. */
export const generalLedgerQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    ledger: ledgerSchema.default('book'),
    codeFrom: accountCodeQuerySchema.optional(),
    codeTo: accountCodeQuerySchema.optional(),
    cursor: cursorSchema.optional(),
  })
  .superRefine(checkRange)
  .superRefine(checkCodeRange)
  .meta({ id: 'GeneralLedgerQuery' });

export type GeneralLedgerQuery = z.infer<typeof generalLedgerQuerySchema>;

/**
 * One account of a page: its balance before the range and at its end, and the page's lines. An
 * account continued on the next page repeats with the next lines.
 */
export const generalLedgerAccountSchema = z
  .object({
    account: reportAccountSchema,
    opening: minorUnitsSchema,
    lines: z.array(reportLineSchema),
    closing: minorUnitsSchema,
  })
  .meta({ id: 'GeneralLedgerAccount' });

export const generalLedgerSchema = z
  .object({
    header: reportHeaderSchema,
    accounts: z.array(generalLedgerAccountSchema),
    nextCursor: cursorSchema.nullable(),
  })
  .meta({ id: 'GeneralLedger' });

export type GeneralLedger = z.infer<typeof generalLedgerSchema>;

/** `GET /api/reports/accounts/:id/statement`: the lines carrying every value of `dims`. */
export const accountStatementQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    ledger: ledgerSchema.default('book'),
    dims: dimsQuerySchema,
    currency: currencyCodeSchema.optional(),
    cursor: cursorSchema.optional(),
  })
  .superRefine(checkRange)
  .meta({ id: 'AccountStatementQuery' });

export type AccountStatementQuery = z.infer<typeof accountStatementQuerySchema>;

export const accountStatementSchema = z
  .object({
    header: reportHeaderSchema,
    account: reportAccountSchema,
    opening: minorUnitsSchema,
    lines: z.array(reportLineSchema),
    closing: minorUnitsSchema,
    /** Each transaction currency on the account over the range, in transaction amounts. */
    currencies: z.array(currencyBalanceSchema),
    nextCursor: cursorSchema.nullable(),
  })
  .meta({ id: 'AccountStatement' });

export type AccountStatement = z.infer<typeof accountStatementSchema>;

// --- Journal (rule 12) ---

export const journalQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    ledger: ledgerSchema.default('book'),
    cursor: cursorSchema.optional(),
  })
  .superRefine(checkRange)
  .meta({ id: 'JournalQuery' });

export type JournalQuery = z.infer<typeof journalQuerySchema>;

export const journalLineSchema = z
  .object({
    lineNo: z.int().min(1),
    account: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    memo: z.string().nullable(),
    values: z.array(reportValueSchema),
    debit: minorUnitsSchema,
    credit: minorUnitsSchema,
  })
  .meta({ id: 'JournalLine' });

export const journalEntrySchema = z
  .object({
    entryId: z.uuid(),
    ...entryNumberSchema.shape,
    entryDate: dateSchema,
    source: z.string(),
    description: z.string(),
    reference: z.string().nullable(),
    hubDocument: entryHubDocumentSchema.nullable(),
    lines: z.array(journalLineSchema),
  })
  .meta({ id: 'JournalEntry' });

export type JournalEntry = z.infer<typeof journalEntrySchema>;

/** Posted entries in `(entry_date, number)` order, 200 lines a page by whole entries. */
export const journalSchema = z
  .object({
    header: reportHeaderSchema,
    entries: z.array(journalEntrySchema),
    nextCursor: cursorSchema.nullable(),
  })
  .meta({ id: 'Journal' });

export type Journal = z.infer<typeof journalSchema>;

// --- Income statement (rules 13, 14) ---

export const incomeStatementQuerySchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    ledger: ledgerSchema.default('book'),
    compare: flagSchema('true'),
    compareFrom: dateSchema.optional(),
    compareTo: dateSchema.optional(),
  })
  .superRefine(checkRange)
  .meta({ id: 'IncomeStatementQuery' });

export type IncomeStatementQuery = z.infer<typeof incomeStatementQuerySchema>;

/** An account's part of a statement line, as presented. */
export const statementAccountSchema = z
  .object({
    account: reportAccountSchema,
    amount: minorUnitsSchema,
    compare: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'StatementAccount' });

/** A line of the income statement: income positive, expenses negative. */
export const incomeStatementLineSchema = z
  .object({
    line: z.string(),
    amount: minorUnitsSchema,
    compare: minorUnitsSchema.nullable(),
    accounts: z.array(statementAccountSchema),
  })
  .meta({ id: 'IncomeStatementLine' });

/**
 * Rule 14's subtotals by the lines' IFRS 18 categories; "الربح قبل التمويل وضرائب الدخل" only when
 * an investing line has an amount.
 */
export const incomeSubtotalsSchema = z
  .object({
    operatingProfit: minorUnitsSchema,
    profitBeforeFinancingAndIncomeTaxes: minorUnitsSchema.nullable(),
    profitBeforeTax: minorUnitsSchema,
    profit: minorUnitsSchema,
  })
  .meta({ id: 'IncomeSubtotals' });

export type IncomeSubtotals = z.infer<typeof incomeSubtotalsSchema>;

export const incomeStatementSchema = z
  .object({
    header: reportHeaderSchema,
    lines: z.array(incomeStatementLineSchema),
    subtotals: incomeSubtotalsSchema,
    compareSubtotals: incomeSubtotalsSchema.nullable(),
  })
  .meta({ id: 'IncomeStatement' });

export type IncomeStatement = z.infer<typeof incomeStatementSchema>;

// --- Balance sheet (rules 15–19) ---

/** The comparative defaults to the end of the previous fiscal year (rule 5). */
export const balanceSheetQuerySchema = z
  .object({
    asOf: dateSchema,
    ledger: ledgerSchema.default('book'),
    compare: flagSchema('true'),
    compareAsOf: dateSchema.optional(),
  })
  .meta({ id: 'BalanceSheetQuery' });

export type BalanceSheetQuery = z.infer<typeof balanceSheetQuerySchema>;

/**
 * A balance a line is made of: an account's, per contract where rule 17 nets it, per client
 * where rule 18 reads it, signed as it adds to the line. `reclassified` marks a counterparty's
 * balance rule 18 moved to the opposite side; `oppositeSide` a non-control account's balance
 * against its normal balance, such as a bank account in credit, flagged (Q17); a contra account
 * in its normal position (accumulated depreciation) is not.
 */
export const balanceSheetPartSchema = z
  .object({
    account: reportAccountSchema,
    client: reportValueSchema.nullable(),
    contract: reportValueSchema.nullable(),
    amount: minorUnitsSchema,
    reclassified: z.boolean(),
    oppositeSide: z.boolean(),
  })
  .meta({ id: 'BalanceSheetPart' });

export type BalanceSheetPart = z.infer<typeof balanceSheetPartSchema>;

/** A line as presented, positive on its own side; `unclosedYears` on retained earnings only. */
export const balanceSheetLineSchema = z
  .object({
    line: z.string(),
    amount: minorUnitsSchema,
    compare: minorUnitsSchema.nullable(),
    /** The sum of the parts moved here by rule 18 ("أعيد تبويب للعرض"). */
    reclassified: minorUnitsSchema,
    /** Earlier fiscal years not yet closed, in `bs.retained_earnings` (rule 16). */
    unclosedYears: minorUnitsSchema.nullable(),
    compareUnclosedYears: minorUnitsSchema.nullable(),
    parts: z.array(balanceSheetPartSchema),
  })
  .meta({ id: 'BalanceSheetLine' });

export type BalanceSheetLine = z.infer<typeof balanceSheetLineSchema>;

export const balanceSheetTotalsSchema = z
  .object({
    assets: minorUnitsSchema,
    liabilities: minorUnitsSchema,
    equity: minorUnitsSchema,
    liabilitiesAndEquity: minorUnitsSchema,
  })
  .meta({ id: 'BalanceSheetTotals' });

export type BalanceSheetTotals = z.infer<typeof balanceSheetTotalsSchema>;

export const balanceSheetSchema = z
  .object({
    header: reportHeaderSchema,
    lines: z.array(balanceSheetLineSchema),
    /** "ربح (خسارة) السنة الحالية": classes 4–5 from the fiscal year's start (rule 16). */
    yearResult: minorUnitsSchema,
    compareYearResult: minorUnitsSchema.nullable(),
    totals: balanceSheetTotalsSchema,
    compareTotals: balanceSheetTotalsSchema.nullable(),
  })
  .meta({ id: 'BalanceSheet' });

export type BalanceSheet = z.infer<typeof balanceSheetSchema>;

// --- Profitability (rules 20–23) ---

/** The ledger defaults to the parallel when the company keeps one, else the book (rule 23). */
export const profitabilityQuerySchema = z
  .object({
    by: profitabilityDimensionSchema,
    from: dateSchema,
    to: dateSchema,
    ledger: ledgerSchema.optional(),
    compare: flagSchema('true'),
    compareFrom: dateSchema.optional(),
    compareTo: dateSchema.optional(),
  })
  .superRefine(checkRange)
  .meta({ id: 'ProfitabilityQuery' });

export type ProfitabilityQuery = z.infer<typeof profitabilityQuerySchema>;

/** Revenue positive as income, direct costs positive as a cost; the margin with one decimal. */
export const profitabilityFiguresSchema = z
  .object({
    revenue: minorUnitsSchema,
    directCosts: minorUnitsSchema,
    contribution: minorUnitsSchema,
    /** A percentage with one decimal ("68.8"), null ("—") when revenue is zero. */
    margin: z
      .string()
      .regex(/^-?\d+\.\d$/)
      .nullable(),
  })
  .meta({ id: 'ProfitabilityFigures' });

export type ProfitabilityFigures = z.infer<typeof profitabilityFiguresSchema>;

/** A value's row; `value` null is "غير موزع". */
export const profitabilityRowSchema = z
  .object({
    value: reportValueSchema.nullable(),
    current: profitabilityFiguresSchema,
    compare: profitabilityFiguresSchema.nullable(),
  })
  .meta({ id: 'ProfitabilityRow' });

export type ProfitabilityRow = z.infer<typeof profitabilityRowSchema>;

export const profitabilitySchema = z
  .object({
    header: reportHeaderSchema,
    by: profitabilityDimensionSchema,
    rows: z.array(profitabilityRowSchema),
    totals: z.object({
      current: profitabilityFiguresSchema,
      compare: profitabilityFiguresSchema.nullable(),
    }),
  })
  .meta({ id: 'Profitability' });

export type Profitability = z.infer<typeof profitabilitySchema>;

// --- Contract position and revenue release schedule (rules 24, 25) ---

export const contractPositionQuerySchema = z
  .object({ asOf: dateSchema, ledger: ledgerSchema.default('book'), client: z.uuid().optional() })
  .meta({ id: 'ContractPositionQuery' });

export type ContractPositionQuery = z.infer<typeof contractPositionQuerySchema>;

/** A contract's gross positions and their net, presented on its side (rule 17). */
export const contractPositionRowSchema = z
  .object({
    contract: reportValueSchema,
    client: reportValueSchema.nullable(),
    kind: contractKindSchema.nullable(),
    /** The debit balances on the contract-asset accounts, positive. */
    assets: minorUnitsSchema,
    /** The credit balances on the contract-liability accounts, positive. */
    liabilities: minorUnitsSchema,
    /** `assets − liabilities`: a debit is a contract asset, a credit a contract liability. */
    net: minorUnitsSchema,
  })
  .meta({ id: 'ContractPositionRow' });

export type ContractPositionRow = z.infer<typeof contractPositionRowSchema>;

/**
 * The totals as the balance sheet presents them: the contracts' net debits and net credits, and
 * the balances that carry no contract, each on its own line.
 */
export const contractPositionTotalsSchema = z
  .object({
    contractAssets: minorUnitsSchema,
    contractLiabilities: minorUnitsSchema,
    withoutContractAssets: minorUnitsSchema,
    withoutContractLiabilities: minorUnitsSchema,
  })
  .meta({ id: 'ContractPositionTotals' });

export const contractPositionSchema = z
  .object({
    header: reportHeaderSchema,
    rows: z.array(contractPositionRowSchema),
    totals: contractPositionTotalsSchema,
  })
  .meta({ id: 'ContractPosition' });

export type ContractPosition = z.infer<typeof contractPositionSchema>;

export const revenueReleaseScheduleQuerySchema = z
  .object({
    from: monthSchema,
    ledger: ledgerSchema.default('book'),
    contract: z.uuid().optional(),
  })
  .meta({ id: 'RevenueReleaseScheduleQuery' });

export type RevenueReleaseScheduleQuery = z.infer<typeof revenueReleaseScheduleQuerySchema>;

/** A contract's releases still to post per month, and what waits for a done ("عند الإنجاز"). */
export const revenueReleaseRowSchema = z
  .object({
    contract: reportValueSchema.nullable(),
    client: reportValueSchema.nullable(),
    months: z.array(z.object({ month: monthSchema, amount: minorUnitsSchema })),
    atDone: minorUnitsSchema,
    total: minorUnitsSchema,
  })
  .meta({ id: 'RevenueReleaseRow' });

export type RevenueReleaseRow = z.infer<typeof revenueReleaseRowSchema>;

export const revenueReleaseScheduleSchema = z
  .object({
    header: reportHeaderSchema,
    /** Every month with a release still to post, from `from`, in order. */
    months: z.array(monthSchema),
    rows: z.array(revenueReleaseRowSchema),
    totals: z.object({
      months: z.array(z.object({ month: monthSchema, amount: minorUnitsSchema })),
      atDone: minorUnitsSchema,
      total: minorUnitsSchema,
    }),
  })
  .meta({ id: 'RevenueReleaseSchedule' });

export type RevenueReleaseSchedule = z.infer<typeof revenueReleaseScheduleSchema>;

// --- The lines behind a figure (rule 6) ---

/**
 * `GET /api/reports/lines`: one account (and its subtree) or one statement line, optionally a
 * side, a client, a contract, values every line carries, or a profitability value; `from` absent
 * reads from the start of the books (a balance). `profitabilityBy` with no `profitabilityValue`
 * is "غير موزع".
 */
export const reportLinesQuerySchema = z
  .object({
    ledger: ledgerSchema.default('book'),
    from: dateSchema.optional(),
    to: dateSchema,
    account: z.uuid().optional(),
    statementLine: z
      .string()
      .refine((code) => STATEMENT_LINES.some((line) => line.code === code), 'Unknown line')
      .optional(),
    side: z.enum(['debit', 'credit']).optional(),
    client: z.uuid().optional(),
    contract: z.uuid().optional(),
    dims: dimsQuerySchema,
    profitabilityBy: profitabilityDimensionSchema.optional(),
    profitabilityValue: z.uuid().optional(),
    cursor: cursorSchema.optional(),
  })
  .superRefine((query, context) => {
    checkRange(query, context);
    if ((query.account === undefined) === (query.statementLine === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Name one of account and statementLine',
        path: ['account'],
      });
    }
    if (query.profitabilityValue !== undefined && query.profitabilityBy === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'profitabilityValue needs profitabilityBy',
        path: ['profitabilityValue'],
      });
    }
  })
  .meta({ id: 'ReportLinesQuery' });

export type ReportLinesQuery = z.infer<typeof reportLinesQuerySchema>;

export const reportLinesLineSchema = z
  .object({
    entryId: z.uuid(),
    ...entryNumberSchema.shape,
    entryDate: dateSchema,
    lineNo: z.int().min(1),
    account: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    description: z.string(),
    memo: z.string().nullable(),
    values: z.array(reportValueSchema),
    amount: minorUnitsSchema,
    currency: currencyCodeSchema,
    transactionAmount: minorUnitsSchema,
    hubDocument: entryHubDocumentSchema.nullable(),
  })
  .meta({ id: 'ReportLinesLine' });

/** A page of 200 lines in `(entry_date, number, line)` order and the sum of all of them. */
export const reportLinesSchema = z
  .object({
    header: reportHeaderSchema,
    lines: z.array(reportLinesLineSchema),
    sum: minorUnitsSchema,
    count: z.int().min(0),
    nextCursor: cursorSchema.nullable(),
  })
  .meta({ id: 'ReportLines' });

export type ReportLines = z.infer<typeof reportLinesSchema>;

// --- The journal book (rules 26, 27, 31) ---

/** A page of the printed journal book holds this many rows (owner, 2026-11-12). */
export const JOURNAL_BOOK_ROWS_PER_PAGE = 30;

/**
 * The characters a column of the printed journal book holds; longer text continues on the next
 * row, split at a word boundary (rule 27). The print layout sizes its columns to these.
 */
export const JOURNAL_BOOK_COLUMNS = {
  description: 70,
  reference: 24,
  accountName: 40,
  memo: 40,
} as const;

/**
 * A row of the journal book (rule 31's canonical rows): an entry's header, a continuation of its
 * description or reference, a line, a continuation of a line's name or memo, or the "تابع القيد
 * رقم n" row that opens a page an entry continues on. Amounts are the book ledger's.
 */
export const journalBookRowSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('entry'),
      ...entryNumberSchema.shape,
      entryDate: dateSchema,
      description: z.string(),
      reference: z.string().nullable(),
    }),
    z.object({
      kind: z.literal('entry_text'),
      number: z.int().min(1),
      description: z.string().nullable(),
      reference: z.string().nullable(),
    }),
    z.object({ kind: z.literal('continued'), number: z.int().min(1) }),
    z.object({
      kind: z.literal('line'),
      number: z.int().min(1),
      accountCode: z.string(),
      accountName: z.string(),
      memo: z.string().nullable(),
      debit: minorUnitsSchema,
      credit: minorUnitsSchema,
    }),
    z.object({
      kind: z.literal('line_text'),
      number: z.int().min(1),
      accountName: z.string().nullable(),
      memo: z.string().nullable(),
    }),
  ])
  .meta({ id: 'JournalBookRow' });

export type JournalBookRow = z.infer<typeof journalBookRowSchema>;

export const debitsAndCreditsSchema = z
  .object({ debits: minorUnitsSchema, credits: minorUnitsSchema })
  .meta({ id: 'DebitsAndCredits' });

/**
 * A page: its number in the fiscal year, its month, its rows, its totals, those brought forward
 * from the year's earlier pages ("ما قبله") and the cumulative totals ("المجموع حتى هذه الصفحة").
 */
export const journalBookPageSchema = z
  .object({
    page: z.int().min(1),
    month: monthSchema,
    rows: z.array(journalBookRowSchema),
    totals: debitsAndCreditsSchema,
    broughtForward: debitsAndCreditsSchema,
    cumulative: debitsAndCreditsSchema,
  })
  .meta({ id: 'JournalBookPage' });

export type JournalBookPage = z.infer<typeof journalBookPageSchema>;

/** A range of months of one fiscal year, as the journal book prints it. */
export const journalBookQuerySchema = z
  .object({
    fiscalYear: z.coerce.number().int().min(2000).max(9999),
    from: monthSchema,
    to: monthSchema,
  })
  .refine((query) => query.from <= query.to, { message: 'from is after to', path: ['from'] })
  .meta({ id: 'JournalBookQuery' });

export type JournalBookQuery = z.infer<typeof journalBookQuerySchema>;

export const journalBookSchema = z
  .object({
    header: reportHeaderSchema,
    fiscalYear: z.int(),
    from: monthSchema,
    to: monthSchema,
    /** Every month of the range closed: printable as the official book (rule 28). */
    official: z.boolean(),
    pages: z.array(journalBookPageSchema),
  })
  .meta({ id: 'JournalBook' });

export type JournalBook = z.infer<typeof journalBookSchema>;
