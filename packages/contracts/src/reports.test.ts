import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  SERVICE_DEPARTMENT_SOURCES,
  serviceDepartmentHistorySchema,
  setServiceDepartmentSchema,
} from './dimensions.js';
import {
  accountStatementFileQuerySchema,
  accountStatementQuerySchema,
  balanceSheetQuerySchema,
  balanceSheetSchema,
  cashStatementFileQuerySchema,
  EXCEL_REPORT_QUERIES,
  EXCEL_REPORTS,
  incomeStatementQuerySchema,
  JOURNAL_BOOK_COLUMNS,
  JOURNAL_BOOK_ROWS_PER_PAGE,
  journalBookPrintSchema,
  journalBookQuerySchema,
  journalBookSchema,
  materialQuantitiesExportQuerySchema,
  materialQuantitiesQuerySchema,
  materialQuantitiesSchema,
  profitabilityQuerySchema,
  profitabilitySchema,
  projectDocumentFileQuerySchema,
  projectListQuerySchema,
  projectListSchema,
  projectReportExportQuerySchema,
  projectReportFileQuerySchema,
  projectReportQuerySchema,
  projectReportSchema,
  REPORT_FILE_QUERIES,
  REPORT_MARKS,
  REPORTS,
  RETIRED_REPORTS,
  reportFileRequestSchema,
  reportFileSchema,
  reportLinesQuerySchema,
  trialBalanceQuerySchema,
  trialBalanceSchema,
  voucherFileQuerySchema,
} from './reports.js';

const issuePaths = (schema: z.ZodType, input: unknown) => {
  const parsed = schema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
};

describe('the report identities and marks', () => {
  it('lists rule 37 in order, rule 4 its two marks and S10 its three', () => {
    expect(REPORTS).toEqual([
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
    ]);
    // S10 rules 32–33's marks appended after rule 4's two.
    expect(REPORT_MARKS).toEqual([
      'period_open',
      'before_revaluation',
      'opening_entry',
      'before_books_start',
      'pre_opening_result_in_equity',
    ]);
  });

  it('holds 30 rows a page of the journal book, owner 2026-11-12', () => {
    expect(JOURNAL_BOOK_ROWS_PER_PAGE).toBe(30);
    for (const width of Object.values(JOURNAL_BOOK_COLUMNS)) expect(width).toBeGreaterThan(10);
  });
});

describe('the report queries', () => {
  it('default the ledger to the book, level 4, non-zero rows and the default comparative', () => {
    expect(trialBalanceQuerySchema.parse({ from: '2026-12-01', to: '2026-12-31' })).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
      ledger: 'book',
      level: 4,
      nonZero: true,
      compare: true,
    });
    expect(
      trialBalanceQuerySchema.parse({
        from: '2026-12-01',
        to: '2026-12-31',
        level: '2',
        nonZero: 'false',
        compare: 'false',
      }),
    ).toMatchObject({ level: 2, nonZero: false, compare: false });
  });

  it('refuse a range out of order, half a comparative, and a level outside 1–4', () => {
    expect(issuePaths(trialBalanceQuerySchema, { from: '2026-12-31', to: '2026-12-01' })).toEqual([
      'from',
    ]);
    expect(
      issuePaths(incomeStatementQuerySchema, {
        from: '2026-12-01',
        to: '2026-12-31',
        compareFrom: '2026-11-01',
      }),
    ).toEqual(['compareFrom']);
    expect(
      issuePaths(trialBalanceQuerySchema, { from: '2026-12-01', to: '2026-12-31', level: 5 }),
    ).toEqual(['level']);
    expect(
      issuePaths(trialBalanceQuerySchema, {
        from: '2026-12-01',
        to: '2026-12-31',
        codeFrom: '4',
        codeTo: '3',
      }),
    ).toEqual(['codeFrom']);
  });

  it('leave profitability its ledger to the company (rule 23)', () => {
    const query = profitabilityQuerySchema.parse({
      by: 'department',
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(query.ledger).toBeUndefined();
    expect(
      issuePaths(profitabilityQuerySchema, { by: 'region', from: '2026-12-01', to: '2026-12-31' }),
    ).toEqual(['by']);
  });

  it('read the dimension filter as value ids', () => {
    const id = '01934b6e-0000-7000-8000-000000000001';
    expect(
      accountStatementQuerySchema.parse({ from: '2026-12-01', to: '2026-12-10', dims: id }).dims,
    ).toEqual([id]);
    expect(
      issuePaths(accountStatementQuerySchema, { from: '2026-12-01', to: '2026-12-10', dims: 'C1' }),
    ).toEqual(['dims']);
  });

  it('name one of an account and a statement line for the lines behind a figure', () => {
    const account = '01934b6e-0000-7000-8000-000000000001';
    expect(issuePaths(reportLinesQuerySchema, { to: '2026-12-31' })).toEqual(['account']);
    expect(
      issuePaths(reportLinesQuerySchema, { to: '2026-12-31', account, statementLine: 'bs.cash' }),
    ).toEqual(['account']);
    expect(
      issuePaths(reportLinesQuerySchema, { to: '2026-12-31', statementLine: 'bs.nothing' }),
    ).toEqual(['statementLine']);
    expect(
      issuePaths(reportLinesQuerySchema, {
        to: '2026-12-31',
        account,
        profitabilityValue: account,
      }),
    ).toEqual(['profitabilityValue']);
  });

  it('read a balance sheet at a date and a journal book over months of one range', () => {
    expect(balanceSheetQuerySchema.parse({ asOf: '2026-12-31' })).toEqual({
      asOf: '2026-12-31',
      ledger: 'book',
      compare: true,
    });
    expect(
      issuePaths(journalBookQuerySchema, { fiscalYear: '2026', from: '2026-12', to: '2026-11' }),
    ).toEqual(['from']);
  });
});

describe('the service department', () => {
  it('comes from Hub or by hand, and is set from a date with a reason', () => {
    expect(SERVICE_DEPARTMENT_SOURCES).toEqual(['hub', 'manual']);
    const id = '01934b6e-0000-7000-8000-000000000001';
    expect(
      issuePaths(setServiceDepartmentSchema, {
        departmentValueId: id,
        effectiveFrom: '2026-12-01',
      }),
    ).toEqual(['reason']);
  });
});

describe('the JSON Schema of the reports', () => {
  it('converts every answer with its id', () => {
    for (const [schema, id] of [
      [trialBalanceSchema, 'TrialBalance'],
      [balanceSheetSchema, 'BalanceSheet'],
      [profitabilitySchema, 'Profitability'],
      [journalBookSchema, 'JournalBook'],
      [reportFileSchema, 'ReportFile'],
      [journalBookPrintSchema, 'JournalBookPrint'],
      [reportFileRequestSchema, 'ReportFileRequest'],
      [serviceDepartmentHistorySchema, 'ServiceDepartmentHistory'],
    ] as const) {
      expect(z.toJSONSchema(schema, { io: 'output' })).toBeTruthy();
      expect(z.globalRegistry.get(schema)?.id).toBe(id);
    }
  });
});

describe('the exports and files', () => {
  it('names a query for every report still asked: Excel for seven, PDF for all ten', () => {
    expect(Object.keys(REPORT_FILE_QUERIES)).toEqual(
      REPORTS.filter((report) => !(RETIRED_REPORTS as readonly string[]).includes(report)),
    );
    expect(Object.keys(EXCEL_REPORT_QUERIES)).toEqual([...EXCEL_REPORTS]);
    expect(EXCEL_REPORTS).not.toContain('ageing');
    // The reports removed with Hub (ADR 0021) stay named for the files that carry them.
    expect(RETIRED_REPORTS).toEqual(['contract_position', 'revenue_schedule']);
    for (const report of RETIRED_REPORTS) {
      expect(reportFileRequestSchema.safeParse({ report }).success, report).toBe(false);
      expect(reportFileSchema.shape.report.safeParse(report).success, report).toBe(true);
    }
  });

  it('keeps an official print for the journal book alone', () => {
    expect(
      issuePaths(reportFileRequestSchema, { report: 'trial_balance', params: {}, official: true }),
    ).toEqual(['official']);
    expect(
      reportFileRequestSchema.parse({ report: 'journal_book', params: {}, official: true }),
    ).toMatchObject({ official: true });
    expect(reportFileRequestSchema.parse({ report: 'chart' })).toEqual({
      report: 'chart',
      params: {},
      official: false,
    });
  });

  it('reads a statement file with its account, and a journal book in the book ledger by default', () => {
    const account = '019a0000-0000-7000-8000-000000000001';
    expect(
      accountStatementFileQuerySchema.parse({ account, from: '2026-10-01', to: '2026-10-31' }),
    ).toMatchObject({ account, ledger: 'book', dims: [] });
    expect(
      issuePaths(accountStatementFileQuerySchema, { from: '2026-10-01', to: '2026-10-31' }),
    ).toEqual(['account']);
    expect(
      journalBookQuerySchema.parse({ fiscalYear: '2026', from: '2026-10', to: '2026-11' }),
    ).toEqual({ fiscalYear: 2026, from: '2026-10', to: '2026-11', ledger: 'book' });
  });

  it('reads the cash files of S11: a statement with its cash account, a voucher by its id', () => {
    const account = '019a0000-0000-7000-8000-000000000001';
    expect(
      cashStatementFileQuerySchema.parse({ account, from: '2026-12-01', to: '2026-12-31' }),
    ).toEqual({ account, from: '2026-12-01', to: '2026-12-31', ledgers: [] });
    expect(
      issuePaths(cashStatementFileQuerySchema, { from: '2026-12-01', to: '2026-12-31' }),
    ).toEqual(['account']);
    expect(voucherFileQuerySchema.parse({ voucher: account })).toEqual({ voucher: account });
    expect(issuePaths(voucherFileQuerySchema, { voucher: 'x' })).toEqual(['voucher']);
    expect(REPORT_FILE_QUERIES.cash_position.parse({})).toEqual({});
  });

  it('reads the files of S12: a project report with its project, a document by its id', () => {
    const contract = '019a0000-0000-7000-8000-000000000002';
    expect(
      projectReportFileQuerySchema.parse({ contract, from: '2026-12-01', to: '2026-12-31' }),
    ).toEqual({ contract, from: '2026-12-01', to: '2026-12-31', ledger: 'book' });
    expect(
      issuePaths(projectReportFileQuerySchema, { from: '2026-12-01', to: '2026-12-31' }),
    ).toEqual(['contract']);
    expect(projectDocumentFileQuerySchema.parse({ document: contract })).toEqual({
      document: contract,
    });
    expect(REPORT_FILE_QUERIES.project_document).toBe(projectDocumentFileQuerySchema);
    expect(REPORT_FILE_QUERIES.material_quantities).toBe(materialQuantitiesQuerySchema);
  });
});

describe('the project reports (S12 "Reports")', () => {
  it('defaults to the book ledger and refuses a range out of order', () => {
    expect(projectReportQuerySchema.parse({ from: '2026-12-01', to: '2026-12-31' })).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
      ledger: 'book',
    });
    expect(issuePaths(projectReportQuerySchema, { from: '2026-12-31', to: '2026-12-01' })).toEqual([
      'from',
    ]);
    expect(
      issuePaths(projectReportExportQuerySchema, { from: '2026-12-01', to: '2026-12-31' }),
    ).toEqual(['format']);
    expect(projectListQuerySchema.parse({})).toEqual({ ledger: 'book', archived: false });
    expect(projectListQuerySchema.parse({ archived: 'true', asOf: '2026-12-31' })).toEqual({
      ledger: 'book',
      archived: true,
      asOf: '2026-12-31',
    });
    expect(
      materialQuantitiesExportQuerySchema.parse({
        from: '2026-12-01',
        to: '2026-12-31',
        format: 'xlsx',
      }),
    ).toEqual({ from: '2026-12-01', to: '2026-12-31', ledger: 'book', format: 'xlsx' });
    expect(
      issuePaths(materialQuantitiesQuerySchema, {
        from: '2026-12-01',
        to: '2026-12-31',
        material: 'x',
      }),
    ).toEqual(['material']);
  });

  it('takes the material filter on the lines behind a figure', () => {
    const material = '019a0000-0000-7000-8000-000000000003';
    expect(
      reportLinesQuerySchema.parse({
        to: '2026-12-31',
        statementLine: 'is.direct_costs',
        material,
      }),
    ).toMatchObject({ material });
    expect(
      issuePaths(reportLinesQuerySchema, {
        to: '2026-12-31',
        statementLine: 'is.direct_costs',
        material: 'x',
      }),
    ).toEqual(['material']);
  });

  it('converts each answer to JSON Schema with its id', () => {
    for (const [schema, id] of [
      [projectListSchema, 'ProjectList'],
      [projectReportSchema, 'ProjectReport'],
      [materialQuantitiesSchema, 'MaterialQuantities'],
    ] as const) {
      expect(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })).toBeTruthy();
      expect(z.globalRegistry.get(schema)?.id).toBe(id);
    }
  });
});
