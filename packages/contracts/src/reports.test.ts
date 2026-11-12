import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  SERVICE_DEPARTMENT_SOURCES,
  serviceDepartmentHistorySchema,
  setServiceDepartmentSchema,
} from './dimensions.js';
import {
  accountStatementQuerySchema,
  balanceSheetQuerySchema,
  balanceSheetSchema,
  incomeStatementQuerySchema,
  JOURNAL_BOOK_COLUMNS,
  JOURNAL_BOOK_ROWS_PER_PAGE,
  journalBookQuerySchema,
  journalBookSchema,
  profitabilityQuerySchema,
  profitabilitySchema,
  REPORT_MARKS,
  REPORTS,
  reportLinesQuerySchema,
  trialBalanceQuerySchema,
  trialBalanceSchema,
} from './reports.js';

const issuePaths = (schema: z.ZodType, input: unknown) => {
  const parsed = schema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
};

describe('the report identities and marks', () => {
  it('lists rule 37 in order, and rule 4 its two marks', () => {
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
    ]);
    expect(REPORT_MARKS).toEqual(['period_open', 'before_revaluation']);
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
      [serviceDepartmentHistorySchema, 'ServiceDepartmentHistory'],
    ] as const) {
      expect(z.toJSONSchema(schema, { io: 'output' })).toBeTruthy();
      expect(z.globalRegistry.get(schema)?.id).toBe(id);
    }
  });
});
