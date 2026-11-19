import { z } from 'zod';
import { cursorSchema } from './audit.js';
import { cashPositionQuerySchema, cashStatementQuerySchema } from './cash.js';
import { STATEMENT_LINES } from './chart.js';
import { entryHubDocumentSchema } from './entries.js';
import { currencyCodeSchema, ledgerSchema } from './money.js';
import { materialCostQuerySchema } from './movements.js';
import { ageingQuerySchema, counterpartyStatementQuerySchema } from './open-items.js';
import { voucherNumberSchema } from './vouchers.js';
import { entryNumberSchema, minorUnitsSchema, personRefSchema } from './wire.js';

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
  'cash_position',
  'cash_statement',
  'voucher',
  'project_report',
  'material_quantities',
  'project_document',
  'projects_overview',
  'project_statement',
  'material_costs',
] as const;

export const reportSchema = z.enum(REPORTS).meta({ id: 'Report' });

export type Report = z.infer<typeof reportSchema>;

/**
 * The reports removed with Hub (ADR 0021): the contract position and the revenue release schedule,
 * which only Hub's events fed. They stay in `REPORTS`, since stored files name them, and are never
 * asked again or reused.
 */
export const RETIRED_REPORTS = [
  'contract_position',
  'revenue_schedule',
] as const satisfies readonly Report[];

/** A report that can still be asked for. */
export type ActiveReport = Exclude<Report, (typeof RETIRED_REPORTS)[number]>;

export const activeReportSchema = reportSchema
  .exclude([...RETIRED_REPORTS])
  .meta({ id: 'ActiveReport' });

/**
 * A PDF file's states (S09 rule 36): `queued` when asked, then `ready` with its file or `failed`
 * with an error code; a ready file that is not an official print `expired` after 24 hours.
 */
export const REPORT_FILE_STATES = ['queued', 'ready', 'failed', 'expired'] as const;

export const reportFileStateSchema = z.enum(REPORT_FILE_STATES).meta({ id: 'ReportFileState' });

export type ReportFileState = z.infer<typeof reportFileStateSchema>;

/**
 * Rule 4's marks: `period_open` ("ط؛ظٹط± ظ†ظ‡ط§ط¦ظٹط©: ط§ظ„ظپطھط±ط© ظ…ظپطھظˆط­ط©") when a month the report reads is
 * open or reopened; `before_revaluation` ("ظ‚ط¨ظ„ ط¥ط¹ط§ط¯ط© ط§ظ„طھظ‚ظٹظٹظ…") when its end is not a month's last
 * day, or that month's revaluation in the report's ledger is not `current`. S10 rules 32â€“33
 * (appended): `opening_entry` ("ط§ظ„ط±طµظٹط¯ ط§ظ„ط§ظپطھطھط§ط­ظٹ ظ…ظ† ظ‚ظٹط¯ ط§ظ„ط§ظپطھطھط§ط­") on a trial balance, general
 * ledger or account statement whose range holds the opening entry, read as its opening balance;
 * `before_books_start` ("طھط¨ط¯ط£ ط§ظ„ط¯ظپط§طھط± ظپظٹ <date>") on a range that starts before the books start,
 * read from it; `pre_opening_result_in_equity` ("ظ†طھظٹط¬ط© ظ…ط§ ظ‚ط¨ظ„ ط¨ط¯ط، ط§ظ„ط¯ظپط§طھط± ط¶ظ…ظ† ط­ظ‚ظˆظ‚ ط§ظ„ظ…ظ„ظƒظٹط©") on an
 * income statement of the books start's fiscal year.
 */
export const REPORT_MARKS = [
  'period_open',
  'before_revaluation',
  'opening_entry',
  'before_books_start',
  'pre_opening_result_in_equity',
] as const;

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
    /** Whether any posted line is in the column (a comparative with none shows "â€”", rule 5). */
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
    /** The company's books start (S10), the date `before_books_start` names; null without one. */
    booksStart: dateSchema.nullable(),
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
    /** The voucher its entry posted (S11 "Reports": the account statement's voucher column). */
    voucher: voucherNumberSchema.extend({ id: z.uuid() }).nullable().default(null),
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
 * Rule 14's subtotals by the lines' IFRS 18 categories; "ط§ظ„ط±ط¨ط­ ظ‚ط¨ظ„ ط§ظ„طھظ…ظˆظٹظ„ ظˆط¶ط±ط§ط¦ط¨ ط§ظ„ط¯ط®ظ„" only when
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

// --- Balance sheet (rules 15â€“19) ---

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
 * A balance a line is made of: an account's, per contract where rule 17 nets it, per counterparty
 * where rule 18 reads it, signed as it adds to the line. `reclassified` marks a counterparty's
 * balance rule 18 moved to the opposite side; `oppositeSide` a non-control account's balance
 * against its normal balance, such as a bank account in credit, flagged (Q17); a contra account
 * in its normal position (accumulated depreciation) is not.
 */
export const balanceSheetPartSchema = z
  .object({
    account: reportAccountSchema,
    /** A client, a supplier or a worker: the value of a control account's counterparty type. */
    counterparty: reportValueSchema.nullable(),
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
    /** The sum of the parts moved here by rule 18 ("ط£ط¹ظٹط¯ طھط¨ظˆظٹط¨ ظ„ظ„ط¹ط±ط¶"). */
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
    /** "ط±ط¨ط­ (ط®ط³ط§ط±ط©) ط§ظ„ط³ظ†ط© ط§ظ„ط­ط§ظ„ظٹط©": classes 4â€“5 from the fiscal year's start (rule 16). */
    yearResult: minorUnitsSchema,
    compareYearResult: minorUnitsSchema.nullable(),
    /**
     * S10 rule 31: the balance of the result before the books start (`pre_opening_result`) that
     * the year's result includes, in the books start's fiscal year ("طھط´ظ…ظ„ ظ†طھظٹط¬ط© ظ…ط§ ظ‚ط¨ظ„ ط¨ط¯ط،
     * ط§ظ„ط¯ظپط§طھط±" when not zero); zero in a later year, where it is in retained earnings.
     */
    yearResultPreOpening: minorUnitsSchema,
    compareYearResultPreOpening: minorUnitsSchema.nullable(),
    totals: balanceSheetTotalsSchema,
    compareTotals: balanceSheetTotalsSchema.nullable(),
  })
  .meta({ id: 'BalanceSheet' });

export type BalanceSheet = z.infer<typeof balanceSheetSchema>;

// --- Profitability (rules 20â€“23) ---

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
    /** A percentage with one decimal ("68.8"), null ("â€”") when revenue is zero. */
    margin: z
      .string()
      .regex(/^-?\d+\.\d$/)
      .nullable(),
  })
  .meta({ id: 'ProfitabilityFigures' });

export type ProfitabilityFigures = z.infer<typeof profitabilityFiguresSchema>;

/** A value's row; `value` null is "ط؛ظٹط± ظ…ظˆط²ط¹". */
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

// --- Projects (S12 "Reports") ---

/** A percentage with one decimal ("30.0"), half away from zero; null ("—") without a base. */
const percentSchema = z
  .string()
  .regex(/^-?\d+\.\d$/)
  .nullable();

/** A quantity as text with its 3 places ("12.500", "-5.000"). */
const quantityTextSchema = z.string().regex(/^-?\d+\.\d{3}$/);

/** An average unit cost with 4 places ("3150.0000"); null at a quantity of zero. */
const averageSchema = z
  .string()
  .regex(/^-?\d+\.\d{4}$/)
  .nullable();

/** A project's contract balances at a date, in the report's ledger. */
const projectBalancesShape = {
  /** The client's retentions on `113002` for the project, positive as receivable. */
  retentionReceivable: minorUnitsSchema,
  /** The client's advance on `212002` for the project, positive as owed. */
  clientAdvance: minorUnitsSchema,
};

/**
 * `GET /api/projects`: every project (a contract value of kind `project`) with its figures from the
 * start of the books to `asOf` (today by default) in a ledger (the book by default); archived
 * projects only on request.
 */
export const projectListQuerySchema = z
  .object({
    asOf: dateSchema.optional(),
    ledger: ledgerSchema.default('book'),
    archived: flagSchema('false'),
  })
  .meta({ id: 'ProjectListQuery' });

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

/** A project's terms as the reports show them (S12 "Data"). */
export const projectReportTermsSchema = z
  .object({
    currency: currencyCodeSchema,
    contractValueMinor: minorUnitsSchema,
    retentionBp: z.int().min(0).max(10_000),
    advanceRecoveryBp: z.int().min(0).max(10_000),
  })
  .meta({ id: 'ProjectReportTerms' });

export type ProjectReportTerms = z.infer<typeof projectReportTermsSchema>;

/** One row of the projects list: its life-to-date figures at `asOf`. */
export const projectListRowSchema = z
  .object({
    project: reportValueSchema,
    client: reportValueSchema.nullable(),
    /** Null until the project's terms are set. */
    terms: projectReportTermsSchema.nullable(),
    /** The latest standing billing's cumulative at `asOf`, in the terms' currency. */
    cumulativeMinor: minorUnitsSchema,
    /** The cumulative's share of the contract value; null without a contract value. */
    billed: percentSchema,
    ...profitabilityFiguresSchema.shape,
    ...projectBalancesShape,
    /** The budget's total in the terms' currency; null without terms. */
    budgetMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'ProjectListRow' });

export type ProjectListRow = z.infer<typeof projectListRowSchema>;

export const projectListSchema = z
  .object({ header: reportHeaderSchema, projects: z.array(projectListRowSchema) })
  .meta({ id: 'ProjectList' });

export type ProjectList = z.infer<typeof projectListSchema>;

const projectReportQueryShape = {
  from: dateSchema,
  to: dateSchema,
  ledger: ledgerSchema.default('book'),
};

/** `GET /api/projects/:valueId/report`: a range and a ledger, the book by default. */
export const projectReportQuerySchema = z
  .object(projectReportQueryShape)
  .superRefine(checkRange)
  .meta({ id: 'ProjectReportQuery' });

export type ProjectReportQuery = z.infer<typeof projectReportQuerySchema>;

/** `GET /api/projects/:valueId/report/export`: the report's query and `format=xlsx`. */
export const projectReportExportQuerySchema = z
  .object({ ...projectReportQueryShape, format: z.enum(['xlsx']) })
  .superRefine(checkRange)
  .meta({ id: 'ProjectReportExportQuery' });

export type ProjectReportExportQuery = z.infer<typeof projectReportExportQuerySchema>;

/** The summary: S09's profitability of the project, its billing to `to` and its balances at `to`. */
export const projectSummarySchema = z
  .object({
    /** The latest standing billing's cumulative at `to`, in the terms' currency. */
    cumulativeMinor: minorUnitsSchema,
    billed: percentSchema,
    ...profitabilityFiguresSchema.shape,
    ...projectBalancesShape,
    /** The subcontractors' retentions on `211006` for the project, positive as owed. */
    subcontractRetention: minorUnitsSchema,
    /** The advances paid on `114002` for the project, positive as receivable. */
    subcontractAdvance: minorUnitsSchema,
  })
  .meta({ id: 'ProjectSummary' });

export type ProjectSummary = z.infer<typeof projectSummarySchema>;

/**
 * A direct cost against the budget: the range's cost, the cost to `to`, the budget in the terms'
 * currency ("0" without one), and the variance (budget less cost to date) and share used only when
 * the terms are in the book currency and the ledger is the book (S12 answer 15).
 */
export const projectCostFiguresSchema = z
  .object({
    inRange: minorUnitsSchema,
    toDate: minorUnitsSchema,
    budgetMinor: minorUnitsSchema,
    variance: minorUnitsSchema.nullable(),
    used: percentSchema,
  })
  .meta({ id: 'ProjectCostFigures' });

export type ProjectCostFigures = z.infer<typeof projectCostFiguresSchema>;

export const projectCostRowSchema = z
  .object({ account: reportAccountSchema, ...projectCostFiguresSchema.shape })
  .meta({ id: 'ProjectCostRow' });

export type ProjectCostRow = z.infer<typeof projectCostRowSchema>;

/** A material as the reports name it. */
export const reportMaterialSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    unit: z.string(),
    archived: z.boolean(),
  })
  .meta({ id: 'ReportMaterial' });

export type ReportMaterial = z.infer<typeof reportMaterialSchema>;

/**
 * A material in one transaction currency: the net quantity of the range's lines of the project, the
 * amount in that currency and in the ledger, and the average unit cost in that currency. A price
 * adjustment counts in the amounts only.
 */
export const projectMaterialRowSchema = z
  .object({
    material: reportMaterialSchema,
    currency: currencyCodeSchema,
    quantity: quantityTextSchema,
    amountMinor: minorUnitsSchema,
    ledgerAmount: minorUnitsSchema,
    average: averageSchema,
  })
  .meta({ id: 'ProjectMaterialRow' });

export type ProjectMaterialRow = z.infer<typeof projectMaterialRowSchema>;

/**
 * A worker with a wage-sheet line on the project in the range: the days, the lump sums and the
 * amount in the ledger, and the worker's running balance at `to` (every project's), positive as
 * owed to the worker.
 */
export const projectWageRowSchema = z
  .object({
    worker: reportValueSchema,
    days: quantityTextSchema,
    lumpSum: minorUnitsSchema,
    amount: minorUnitsSchema,
    balance: minorUnitsSchema,
  })
  .meta({ id: 'ProjectWageRow' });

export type ProjectWageRow = z.infer<typeof projectWageRowSchema>;

/**
 * A subcontract of the project: its value and the cumulative certified to `to` in its currency,
 * the retention held and the advance carried for the project at `to`, and the supplier's payments
 * in the range, in the ledger.
 */
export const projectSubcontractRowSchema = z
  .object({
    subcontractId: z.uuid(),
    supplier: reportValueSchema,
    currency: currencyCodeSchema,
    valueMinor: minorUnitsSchema.nullable(),
    cumulativeMinor: minorUnitsSchema,
    retention: minorUnitsSchema,
    advance: minorUnitsSchema,
    paid: minorUnitsSchema,
  })
  .meta({ id: 'ProjectSubcontractRow' });

export type ProjectSubcontractRow = z.infer<typeof projectSubcontractRowSchema>;

/** A client's billing of the project dated on or before `to`, in the terms' currency. */
export const projectBillingRowSchema = z
  .object({
    documentId: z.uuid(),
    entryId: z.uuid(),
    projectSequence: z.int().min(1),
    fiscalYear: z.int(),
    number: z.int().min(1),
    documentDate: dateSchema,
    cumulativeMinor: minorUnitsSchema,
    previousMinor: minorUnitsSchema,
    periodMinor: minorUnitsSchema,
    retentionMinor: minorUnitsSchema,
    advanceMinor: minorUnitsSchema,
    netMinor: minorUnitsSchema,
    /** Cancelled once its entry is reversed on or before `to`. */
    state: z.enum(['posted', 'cancelled']),
    /** What remains of its receivable on `112001` at `to`, in the terms' currency. */
    outstandingMinor: minorUnitsSchema,
  })
  .meta({ id: 'ProjectBillingRow' });

export type ProjectBillingRow = z.infer<typeof projectBillingRowSchema>;

/** `GET /api/projects/:valueId/report` (S12 "Reports"). */
export const projectReportSchema = z
  .object({
    header: reportHeaderSchema,
    project: reportValueSchema,
    client: reportValueSchema.nullable(),
    /** Null until the project's terms are set. */
    terms: projectReportTermsSchema.nullable(),
    summary: projectSummarySchema,
    costs: z.object({ rows: z.array(projectCostRowSchema), totals: projectCostFiguresSchema }),
    materials: z.array(projectMaterialRowSchema),
    wages: z.array(projectWageRowSchema),
    subcontracts: z.array(projectSubcontractRowSchema),
    billings: z.array(projectBillingRowSchema),
  })
  .meta({ id: 'ProjectReport' });

export type ProjectReport = z.infer<typeof projectReportSchema>;

const materialQuantitiesQueryShape = {
  from: dateSchema,
  to: dateSchema,
  contract: z.uuid().optional(),
  material: z.uuid().optional(),
  ledger: ledgerSchema.default('book'),
};

/** `GET /api/reports/material-quantities`: a range and a ledger, optionally a project or a material. */
export const materialQuantitiesQuerySchema = z
  .object(materialQuantitiesQueryShape)
  .superRefine(checkRange)
  .meta({ id: 'MaterialQuantitiesQuery' });

export type MaterialQuantitiesQuery = z.infer<typeof materialQuantitiesQuerySchema>;

/** `GET /api/reports/material-quantities/export`: the report's query and `format=xlsx`. */
export const materialQuantitiesExportQuerySchema = z
  .object({ ...materialQuantitiesQueryShape, format: z.enum(['xlsx']) })
  .superRefine(checkRange)
  .meta({ id: 'MaterialQuantitiesExportQuery' });

export type MaterialQuantitiesExportQuery = z.infer<typeof materialQuantitiesExportQuerySchema>;

/**
 * A project's material in one transaction currency over the range: the quantities in (lines above
 * zero), out (below zero, as a negative) and net, the amount in that currency, the average unit
 * cost, and the ledger's amount.
 */
export const materialQuantityRowSchema = z
  .object({
    /** Null for lines with no project ("غير موزع"). */
    project: reportValueSchema.nullable(),
    material: reportMaterialSchema,
    currency: currencyCodeSchema,
    quantityIn: quantityTextSchema,
    quantityOut: quantityTextSchema,
    quantity: quantityTextSchema,
    amountMinor: minorUnitsSchema,
    average: averageSchema,
    ledgerAmount: minorUnitsSchema,
  })
  .meta({ id: 'MaterialQuantityRow' });

export type MaterialQuantityRow = z.infer<typeof materialQuantityRowSchema>;

/**
 * The rows by project then material code and currency; `ledgerTotal` equals the lines of the
 * `requires_material` accounts in the range (S12 "Reports").
 */
export const materialQuantitiesSchema = z
  .object({
    header: reportHeaderSchema,
    rows: z.array(materialQuantityRowSchema),
    ledgerTotal: minorUnitsSchema,
  })
  .meta({ id: 'MaterialQuantities' });

export type MaterialQuantities = z.infer<typeof materialQuantitiesSchema>;

// --- The lines behind a figure (rule 6) ---

/**
 * `GET /api/reports/lines`: one account (and its subtree) or one statement line, optionally a
 * side, a client, a contract, values every line carries, or a profitability value; `from` absent
 * reads from the start of the books (a balance). `profitabilityBy` with no `profitabilityValue`
 * is "ط؛ظٹط± ظ…ظˆط²ط¹".
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
    /** S12: only the lines whose quantity names this material. */
    material: z.uuid().optional(),
    /**
     * S10 rule 32: only the opening entries' lines (source `opening`) up to `to`, the figure of
     * an opening column read from the opening entry. Without it, a range with `from` leaves them
     * out, as the period's columns do.
     */
    openingEntry: flagSchema('false'),
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
 * description or reference, a line, a continuation of a line's name or memo, or the "طھط§ط¨ط¹ ط§ظ„ظ‚ظٹط¯
 * ط±ظ‚ظ… n" row that opens a page an entry continues on. Amounts are the book ledger's.
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
 * from the year's earlier pages ("ظ…ط§ ظ‚ط¨ظ„ظ‡") and the cumulative totals ("ط§ظ„ظ…ط¬ظ…ظˆط¹ ط­طھظ‰ ظ‡ط°ظ‡ ط§ظ„طµظپط­ط©").
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
    /** The book ledger's journal is the legal book; the parallel ledger's prints as a draft (rule 30). */
    ledger: ledgerSchema.default('book'),
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

// --- Exports and files (rules 28â€“30, 35â€“37) ---

/** An Excel export holds at most this many rows (rule 35): `REPORT_TOO_LARGE` beyond. */
export const REPORT_EXCEL_ROW_LIMIT = 100_000;

/** A person has at most this many PDF files queued at once (rule 36): `RATE_LIMITED` beyond. */
export const REPORT_FILE_QUEUE_LIMIT = 3;

/** A ready PDF is downloadable for this long, unless it is an official print (rule 36). */
export const REPORT_FILE_TTL_HOURS = 24;

/** A file left queued this long was lost by the queue: the hourly job fails it (`RENDER_LOST`). */
export const REPORT_FILE_LOST_AFTER_HOURS = 1;

/**
 * The reports `GET /api/reports/:report/export` writes to Excel (rule 35); the ageing, the client
 * statement and the chart keep their own Excel routes (S04, S02). The journal book's Excel is the
 * journal of `/reports/journal` (rule 12); its PDF is the printed book (rules 26â€“31).
 */
export const EXCEL_REPORTS = [
  'trial_balance',
  'general_ledger',
  'account_statement',
  'journal_book',
  'income_statement',
  'balance_sheet',
  'profitability',
] as const satisfies readonly ActiveReport[];

export type ExcelReport = (typeof EXCEL_REPORTS)[number];

export const excelReportSchema = z.enum(EXCEL_REPORTS).meta({ id: 'ExcelReport' });

/** An account statement's file names its account, as its route does. */
export const accountStatementFileQuerySchema = z
  .intersection(z.object({ account: z.uuid() }), accountStatementQuerySchema)
  .meta({ id: 'AccountStatementFileQuery' });

export type AccountStatementFileQuery = z.infer<typeof accountStatementFileQuerySchema>;

/** A counterparty statement's file names its counterparty under the key `client` its stored rows keep (S04, S11). */
export const clientStatementFileQuerySchema = z
  .intersection(z.object({ client: z.uuid() }), counterpartyStatementQuerySchema)
  .meta({ id: 'ClientStatementFileQuery' });

export type ClientStatementFileQuery = z.infer<typeof clientStatementFileQuerySchema>;

/** The chart's PDF takes no parameter: every account, archived ones included, as its Excel. */
export const chartFileQuerySchema = z.object({}).meta({ id: 'ChartFileQuery' });

/** A cash account's statement file names its cash account (S11 rule 17). */
export const cashStatementFileQuerySchema = z
  .intersection(z.object({ account: z.uuid() }), cashStatementQuerySchema)
  .meta({ id: 'CashStatementFileQuery' });

export type CashStatementFileQuery = z.infer<typeof cashStatementFileQuerySchema>;

/** A printed voucher names its voucher (S11 "Printing and legal books"). */
export const voucherFileQuerySchema = z
  .object({ voucher: z.uuid() })
  .meta({ id: 'VoucherFileQuery' });

export type VoucherFileQuery = z.infer<typeof voucherFileQuerySchema>;

/** A project report's file names its project (S12 "Printing and legal books"). */
export const projectReportFileQuerySchema = z
  .intersection(z.object({ contract: z.uuid() }), projectReportQuerySchema)
  .meta({ id: 'ProjectReportFileQuery' });

export type ProjectReportFileQuery = z.infer<typeof projectReportFileQuerySchema>;

/** A printed project document names its document (S12 "Printing and legal books"). */
export const projectDocumentFileQuerySchema = z
  .object({ document: z.uuid() })
  .meta({ id: 'ProjectDocumentFileQuery' });

export type ProjectDocumentFileQuery = z.infer<typeof projectDocumentFileQuerySchema>;

/**
 * S13 "Printing": the PDF of all projects takes no parameter, every project from its start to the
 * print's day, as the dashboard reads them.
 */
export const projectsOverviewFileQuerySchema = z
  .object({})
  .meta({ id: 'ProjectsOverviewFileQuery' });

/** S13 "Printing": one project's PDF names its project, from its start to the print's day. */
export const projectStatementFileQuerySchema = z
  .object({ project: z.uuid() })
  .meta({ id: 'ProjectStatementFileQuery' });

export type ProjectStatementFileQuery = z.infer<typeof projectStatementFileQuerySchema>;

/** S13 "Printing": the materials' PDF over the range and project of `/materials`. */
export const materialCostsFileQuerySchema = materialCostQuerySchema;

/** The query of each report's Excel export, `format=xlsx` aside. */
export const EXCEL_REPORT_QUERIES = {
  trial_balance: trialBalanceQuerySchema,
  general_ledger: generalLedgerQuerySchema,
  account_statement: accountStatementFileQuerySchema,
  journal_book: journalQuerySchema,
  income_statement: incomeStatementQuerySchema,
  balance_sheet: balanceSheetQuerySchema,
  profitability: profitabilityQuerySchema,
} as const satisfies Record<ExcelReport, z.ZodType>;

/** The parameters of each report's PDF, as stored with its file and read again by the worker. */
export const REPORT_FILE_QUERIES = {
  trial_balance: trialBalanceQuerySchema,
  general_ledger: generalLedgerQuerySchema,
  account_statement: accountStatementFileQuerySchema,
  journal_book: journalBookQuerySchema,
  income_statement: incomeStatementQuerySchema,
  balance_sheet: balanceSheetQuerySchema,
  profitability: profitabilityQuerySchema,
  ageing: ageingQuerySchema,
  client_statement: clientStatementFileQuerySchema,
  chart: chartFileQuerySchema,
  cash_position: cashPositionQuerySchema,
  cash_statement: cashStatementFileQuerySchema,
  voucher: voucherFileQuerySchema,
  project_report: projectReportFileQuerySchema,
  material_quantities: materialQuantitiesQuerySchema,
  project_document: projectDocumentFileQuerySchema,
  projects_overview: projectsOverviewFileQuerySchema,
  project_statement: projectStatementFileQuerySchema,
  material_costs: materialCostsFileQuerySchema,
} as const satisfies Record<ActiveReport, z.ZodType>;

export type ReportFileQuery<R extends ActiveReport> = z.output<(typeof REPORT_FILE_QUERIES)[R]>;

/**
 * `GET /api/reports/:report/export`: the format, beside the report's own query
 * (`EXCEL_REPORT_QUERIES`), which the API reads from the same query string.
 */
export const reportExportQuerySchema = z
  .looseObject({ format: z.enum(['xlsx']) })
  .meta({ id: 'ReportExportQuery' });

export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;

export const reportExportParamsSchema = z
  .object({ report: excelReportSchema })
  .meta({ id: 'ReportExportParams' });

export type ReportExportParams = z.infer<typeof reportExportParamsSchema>;

/**
 * `POST /api/reports/files` (rule 36): a report's PDF with its parameters, validated by the
 * report's query (`REPORT_FILE_QUERIES`; a cursor is ignored, the file carries every page). An
 * official print is of the book ledger's journal book (rule 28).
 */
export const reportFileRequestSchema = z
  .object({
    report: activeReportSchema,
    params: z.record(z.string(), z.unknown()).default({}),
    official: z.boolean().default(false),
  })
  .refine((request) => !request.official || request.report === 'journal_book', {
    message: 'Only the journal book has an official print',
    path: ['official'],
  })
  .meta({ id: 'ReportFileRequest' });

export type ReportFileRequest = z.infer<typeof reportFileRequestSchema>;

/** A PDF file as its requester sees it; `error` is an error code. */
export const reportFileSchema = z
  .object({
    id: z.uuid(),
    report: reportSchema,
    params: z.record(z.string(), z.unknown()),
    format: z.literal('pdf'),
    official: z.boolean(),
    state: reportFileStateSchema,
    sizeBytes: z.int().positive().nullable(),
    error: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    readyAt: z.iso.datetime({ offset: true }).nullable(),
    /** Null for an official print, which is kept (rule 28). */
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'ReportFile' });

export type ReportFile = z.infer<typeof reportFileSchema>;

export const reportFilesSchema = z
  .object({ files: z.array(reportFileSchema) })
  .meta({ id: 'ReportFiles' });

export type ReportFiles = z.infer<typeof reportFilesSchema>;

/** `GET /api/reports/journal-book/prints`: one fiscal year's register. */
export const journalBookPrintsQuerySchema = z
  .object({ fiscalYear: z.coerce.number().int().min(2000).max(9999) })
  .meta({ id: 'JournalBookPrintsQuery' });

export type JournalBookPrintsQuery = z.infer<typeof journalBookPrintsQuerySchema>;

/**
 * An official print in the register (rule 29): its range, pages in the year's numbering (none for
 * a range with no entries), counts and book totals, its hashes, who and when; `superseded` once a
 * month of its range was reopened after it.
 */
export const journalBookPrintSchema = z
  .object({
    id: z.uuid(),
    reportFileId: z.uuid(),
    fiscalYear: z.int(),
    from: monthSchema,
    to: monthSchema,
    firstPage: z.int().min(1).nullable(),
    lastPage: z.int().min(1).nullable(),
    entryCount: z.int().min(0),
    lineCount: z.int().min(0),
    debitTotal: minorUnitsSchema,
    creditTotal: minorUnitsSchema,
    currency: currencyCodeSchema,
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
    printedBy: personRefSchema,
    createdAt: z.iso.datetime({ offset: true }),
    superseded: z.boolean(),
    /** The first reopen of a month of the range after the print. */
    supersededAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'JournalBookPrint' });

export type JournalBookPrint = z.infer<typeof journalBookPrintSchema>;

export const journalBookPrintsSchema = z
  .object({ prints: z.array(journalBookPrintSchema) })
  .meta({ id: 'JournalBookPrints' });

export type JournalBookPrints = z.infer<typeof journalBookPrintsSchema>;

/** The queue of `reportsRenderJobSchema`, worked by the worker (S09 "Jobs and events"). */
export const REPORTS_RENDER_QUEUE = 'reports.render';

/** The job the API sends once a file's row commits (S09 "Jobs and events"). */
export const reportsRenderJobSchema = z
  .object({ companyId: z.uuid(), fileId: z.uuid() })
  .meta({ id: 'ReportsRenderJob' });

export type ReportsRenderJob = z.infer<typeof reportsRenderJobSchema>;
