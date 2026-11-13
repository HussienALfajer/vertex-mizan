import { JOURNAL_BOOK_ROWS_PER_PAGE } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type JournalBookEntryInput,
  journalBookEntryRows,
  journalBookPages,
  wrapText,
} from './journal-book.js';
import { addDays, dayBefore, daysBetween } from './periods.js';
import {
  balanceSheet,
  balanceSheetComparative,
  booksStartMarks,
  codeInRange,
  contractPosition,
  departmentInForce,
  incomeStatement,
  marginOf,
  monthsBetween,
  type PresentationBalance,
  previousPeriod,
  profitability,
  type ReportChartAccount,
  releaseSchedule,
  reportMarks,
  trialBalance,
  withOpeningEntry,
} from './reports.js';

// A synthetic chart in the service-agency template's codes (S02): headers at levels 1–3 and the
// postable accounts at level 4 the scenario `reports/statement-presentation` uses.
/** Assets and expenses are debit accounts, the rest credit ones (S02). */
const normalOf = (code: string) => (/^[15]/.test(code) ? 'debit' : 'credit');

const header = (code: string, parent: string | null, level: number): ReportChartAccount => ({
  id: `a${code}`,
  code,
  parentId: parent === null ? null : `a${parent}`,
  level,
  postable: false,
  statementLine: null,
  control: false,
  normalBalance: normalOf(code),
  archived: false,
});
const postable = (
  code: string,
  parent: string,
  statementLine: string,
  control = false,
  normalBalance: 'debit' | 'credit' = normalOf(code),
): ReportChartAccount => ({
  id: `a${code}`,
  code,
  parentId: `a${parent}`,
  level: 4,
  postable: true,
  statementLine,
  control,
  normalBalance,
  archived: false,
});

const CHART: ReportChartAccount[] = [
  header('1', null, 1),
  header('11', '1', 2),
  header('111', '11', 3),
  postable('111003', '111', 'bs.cash'),
  postable('111004', '111', 'bs.cash'),
  header('112', '11', 3),
  postable('112001', '112', 'bs.trade_receivables', true),
  header('113', '11', 3),
  postable('113001', '113', 'bs.contract_assets', true),
  header('12', '1', 2),
  header('121', '12', 3),
  postable('121001', '121', 'bs.ppe'),
  // Accumulated depreciation: a contra account, credit in its normal position on an asset line.
  postable('121003', '121', 'bs.ppe', false, 'credit'),
  header('2', null, 1),
  header('21', '2', 2),
  header('211', '21', 3),
  postable('211002', '211', 'bs.trade_payables'),
  postable('211003', '211', 'bs.trade_payables'),
  header('212', '21', 3),
  postable('212001', '212', 'bs.contract_liabilities'),
  header('213', '21', 3),
  postable('213001', '213', 'bs.client_money', true),
  postable('214001', '213', 'bs.tax_liabilities'),
  header('3', null, 1),
  header('31', '3', 2),
  header('311', '31', 3),
  postable('311001', '311', 'bs.share_capital'),
  header('312', '31', 3),
  postable('312001', '312', 'bs.retained_earnings'),
  // The result before the books start (S10, role `pre_opening_result`).
  postable('312002', '312', 'bs.retained_earnings'),
  header('4', null, 1),
  header('41', '4', 2),
  header('411', '41', 3),
  postable('411001', '411', 'is.revenue'),
  header('42', '4', 2),
  header('421', '42', 3),
  postable('421001', '421', 'is.fx_differences'),
  postable('422001', '421', 'is.other_income'),
  header('5', null, 1),
  header('51', '5', 2),
  header('511', '51', 3),
  postable('511001', '511', 'is.direct_costs'),
  header('52', '5', 2),
  header('521', '52', 3),
  postable('521001', '521', 'is.employee_benefits'),
  postable('531001', '521', 'is.other_expenses'),
  postable('532005', '521', 'is.finance_costs'),
  postable('551001', '521', 'is.income_tax'),
];

const id = (code: string) => `a${code}`;
const POSTABLE = CHART.filter((account) => account.postable);
const classOf = (accountId: string) => accountId.slice(1, 2);

describe('the dates of a report (rules 4, 5)', () => {
  it('compares a period with as many days ending the day before it', () => {
    expect(previousPeriod('2027-01-01', '2027-01-31')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    // Counted in days: 29 February 2028 is a day like any other (edge case 22).
    expect(previousPeriod('2028-03-01', '2028-03-31')).toEqual({
      from: '2028-01-30',
      to: '2028-02-29',
    });
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    fc.assert(
      fc.property(
        fc.integer({ min: -400_000, max: 400_000 }),
        fc.integer({ min: -800, max: 800 }),
        (start, days) => {
          const date = addDays('2000-01-01', start);
          expect(daysBetween(date, addDays(date, days))).toBe(days);
        },
      ),
    );
  });

  it("compares a balance sheet with the previous year's end, or the day before the books", () => {
    expect(balanceSheetComparative('2027-01-31', 1, '2026-12')).toBe('2026-12-31');
    // The first fiscal year: the day before the first period (edge case 19).
    expect(balanceSheetComparative('2026-12-31', 1, '2026-10')).toBe('2026-09-30');
    expect(balanceSheetComparative('2027-03-10', 7, null)).toBe('2026-06-30');
  });

  it('marks an open month and a day other than a revalued month end', () => {
    expect(reportMarks({ anyMonthOpen: true, to: '2026-12-31', revaluationCurrent: true })).toEqual(
      ['period_open'],
    );
    expect(
      reportMarks({ anyMonthOpen: false, to: '2026-12-10', revaluationCurrent: true }),
    ).toEqual(['before_revaluation']);
    expect(
      reportMarks({ anyMonthOpen: false, to: '2026-12-31', revaluationCurrent: false }),
    ).toEqual(['before_revaluation']);
    expect(monthsBetween('2026-11-15', '2027-01-02')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('the trial balance (rule 9)', () => {
  // The `syp` case's January 2027: classes 4–5 open with 2026's balances.
  const opening = new Map([
    [id('111003'), 85_000_000n],
    [id('112001'), 40_000_000n],
    [id('311001'), -100_000_000n],
    [id('411001'), -40_000_000n],
    [id('531001'), 15_000_000n],
  ]);
  const movements = new Map([
    [id('111003'), { debits: 40_000_000n, credits: 12_000_000n }],
    [id('112001'), { debits: 30_000_000n, credits: 40_000_000n }],
    [id('411001'), { debits: 0n, credits: 30_000_000n }],
    [id('521001'), { debits: 12_000_000n, credits: 0n }],
  ]);

  it("gives the scenario's rows and balanced totals at level 4", () => {
    const { rows, totals } = trialBalance({
      accounts: CHART,
      opening,
      movements,
      compare: null,
      level: 4,
      nonZero: true,
    });
    expect(
      rows.map((row) => [row.accountId, row.opening, row.debits, row.credits, row.closing]),
    ).toEqual([
      [id('111003'), 85_000_000n, 40_000_000n, 12_000_000n, 113_000_000n],
      [id('112001'), 40_000_000n, 30_000_000n, 40_000_000n, 30_000_000n],
      [id('311001'), -100_000_000n, 0n, 0n, -100_000_000n],
      [id('411001'), -40_000_000n, 0n, 30_000_000n, -70_000_000n],
      [id('521001'), 0n, 12_000_000n, 0n, 12_000_000n],
      [id('531001'), 15_000_000n, 0n, 0n, 15_000_000n],
    ]);
    expect(totals).toEqual({
      openingDebit: 140_000_000n,
      openingCredit: 140_000_000n,
      debits: 82_000_000n,
      credits: 82_000_000n,
      closingDebit: 170_000_000n,
      closingCredit: 170_000_000n,
      compareDebit: null,
      compareCredit: null,
    });
  });

  it('sums each subtree at a header level and filters by a code range', () => {
    const { rows } = trialBalance({
      accounts: CHART,
      opening,
      movements,
      compare: new Map(),
      level: 1,
      nonZero: true,
    });
    expect(rows.map((row) => [row.accountId, row.closing, row.compare])).toEqual([
      [id('1'), 143_000_000n, 0n],
      [id('3'), -100_000_000n, 0n],
      [id('4'), -70_000_000n, 0n],
      [id('5'), 27_000_000n, 0n],
    ]);
    const ranged = trialBalance({
      accounts: CHART,
      opening,
      movements,
      compare: null,
      level: 4,
      nonZero: false,
      codeFrom: '4',
      codeTo: '4',
    });
    expect(ranged.rows.map((row) => row.accountId)).toEqual([
      id('411001'),
      id('421001'),
      id('422001'),
    ]);
    expect(codeInRange('112001', '11', '12')).toBe(true);
    expect(codeInRange('211001', '11', '12')).toBe(false);
  });
});

describe('the income statement (rules 13, 14)', () => {
  it("presents the `usd-syp` case's lines and subtotals", () => {
    const net = new Map([
      [id('411001'), -500_000n],
      [id('422001'), -20_000n],
      [id('511001'), 150_000n],
      [id('521001'), 100_000n],
      [id('531001'), 40_000n],
      [id('421001'), -4_167n],
      [id('532005'), 3_000n],
      [id('551001'), 30_000n],
    ]);
    const statement = incomeStatement({ accounts: CHART, current: net, compare: null });
    expect(statement.lines.map((line) => [line.line, line.amount])).toEqual([
      ['is.revenue', 500_000n],
      ['is.other_income', 20_000n],
      ['is.direct_costs', -150_000n],
      ['is.employee_benefits', -100_000n],
      ['is.other_expenses', -40_000n],
      ['is.fx_differences', 4_167n],
      ['is.finance_costs', -3_000n],
      ['is.income_tax', -30_000n],
    ]);
    expect(statement.subtotals).toEqual({
      operatingProfit: 234_167n,
      profitBeforeFinancingAndIncomeTaxes: null,
      profitBeforeTax: 231_167n,
      profit: 201_167n,
    });
  });
});

describe("the templates' version 3 lines in the statements", () => {
  // The review of 2026-11-13: each new line in its place by the catalogue's order.
  const chart: ReportChartAccount[] = [
    ...CHART,
    postable('122001', '121', 'bs.intangible_assets'),
    postable('122002', '121', 'bs.intangible_assets', false, 'credit'),
    postable('214002', '213', 'bs.other_taxes_payable'),
    postable('216001', '213', 'bs.borrowings'),
    postable('314001', '311', 'bs.reserves'),
    postable('532006', '521', 'is.impairment_losses'),
    postable('533003', '521', 'is.depreciation'),
  ];

  it('presents impairment losses after depreciation and amortisation, as operating', () => {
    const net = new Map([
      [id('411001'), -100_000n],
      [id('531001'), 10_000n],
      [id('532006'), 4_000n],
      [id('533003'), 1_000n],
    ]);
    const statement = incomeStatement({ accounts: chart, current: net, compare: null });
    expect(statement.lines.map((line) => [line.line, line.amount])).toEqual([
      ['is.revenue', 100_000n],
      ['is.other_income', 0n],
      ['is.direct_costs', 0n],
      ['is.employee_benefits', 0n],
      ['is.depreciation', -1_000n],
      ['is.impairment_losses', -4_000n],
      ['is.other_expenses', -10_000n],
      ['is.fx_differences', 0n],
      ['is.finance_costs', 0n],
      ['is.income_tax', 0n],
    ]);
    expect(statement.subtotals.operatingProfit).toBe(85_000n);
  });

  it('places intangible assets, borrowings, other taxes and reserves in their sections', () => {
    const balances: PresentationBalance[] = [
      { accountId: id('111003'), clientId: null, contractId: null, amount: 100_000n },
      { accountId: id('122001'), clientId: null, contractId: null, amount: 30_000n },
      { accountId: id('122002'), clientId: null, contractId: null, amount: -5_000n },
      { accountId: id('214002'), clientId: null, contractId: null, amount: -7_000n },
      { accountId: id('216001'), clientId: null, contractId: null, amount: -40_000n },
      { accountId: id('311001'), clientId: null, contractId: null, amount: -60_000n },
      { accountId: id('314001'), clientId: null, contractId: null, amount: -18_000n },
    ];
    const sheet = balanceSheet({
      accounts: chart,
      current: { balances, yearNet: 0n, unclosedNet: 0n },
      compare: null,
    });
    const lines = sheet.lines.filter((line) => line.amount !== 0n).map((line) => line.line);
    expect(lines).toEqual([
      'bs.cash',
      'bs.intangible_assets',
      'bs.borrowings',
      'bs.other_taxes_payable',
      'bs.share_capital',
      'bs.reserves',
    ]);
    expect(sheet.lines.find((line) => line.line === 'bs.intangible_assets')?.amount).toBe(25_000n);
    expect(sheet.totals).toMatchObject({ assets: 125_000n, liabilitiesAndEquity: 125_000n });
  });
});

describe('the balance sheet (rules 15–19)', () => {
  // S09's worked example in the book ledger, per counterparty and contract.
  const balances: PresentationBalance[] = [
    { accountId: id('111003'), clientId: null, contractId: null, amount: 125_000_000n },
    { accountId: id('111004'), clientId: null, contractId: null, amount: 11_760_000n },
    { accountId: id('112001'), clientId: 'C1', contractId: null, amount: 60_000_000n },
    { accountId: id('113001'), clientId: 'C1', contractId: 'P1', amount: 50_000_000n },
    { accountId: id('113001'), clientId: 'C3', contractId: 'R1', amount: 30_000_000n },
    { accountId: id('211003'), clientId: null, contractId: null, amount: -5_000_000n },
    { accountId: id('212001'), clientId: 'C1', contractId: 'P1', amount: -120_000_000n },
    { accountId: id('213001'), clientId: 'C1', contractId: null, amount: -12_000_000n },
    { accountId: id('213001'), clientId: 'C3', contractId: null, amount: 240_000n },
  ];

  it('reclassifies a client in debit on ad funds and nets each contract', () => {
    const sheet = balanceSheet({
      accounts: CHART,
      current: { balances, yearNet: -140_000_000n, unclosedNet: 0n },
      compare: null,
    });
    const shown = sheet.lines
      .filter((line) => line.amount !== 0n)
      .map((line) => [line.line, line.amount, line.reclassified]);
    expect(shown).toEqual([
      ['bs.cash', 136_760_000n, 0n],
      ['bs.trade_receivables', 60_240_000n, 240_000n],
      ['bs.contract_assets', 30_000_000n, 0n],
      ['bs.trade_payables', 5_000_000n, 0n],
      ['bs.contract_liabilities', 70_000_000n, 0n],
      ['bs.client_money', 12_000_000n, 0n],
    ]);
    const liabilities = sheet.lines.find((line) => line.line === 'bs.contract_liabilities');
    expect(
      liabilities?.parts.map((part) => [part.accountId, part.contractId, part.amount]),
    ).toEqual([
      [id('113001'), 'P1', -50_000_000n],
      [id('212001'), 'P1', 120_000_000n],
    ]);
    expect(sheet.yearResult).toBe(140_000_000n);
    expect(sheet.totals).toEqual({
      assets: 227_000_000n,
      liabilities: 87_000_000n,
      equity: 140_000_000n,
      liabilitiesAndEquity: 227_000_000n,
    });
    const position = contractPosition({ accounts: CHART, balances });
    expect(position.rows).toEqual([
      {
        contractId: 'P1',
        clientId: 'C1',
        assets: 50_000_000n,
        liabilities: 120_000_000n,
        net: -70_000_000n,
      },
      { contractId: 'R1', clientId: 'C3', assets: 30_000_000n, liabilities: 0n, net: 30_000_000n },
    ]);
    expect(position.totals).toEqual({
      contractAssets: 30_000_000n,
      contractLiabilities: 70_000_000n,
      withoutContractAssets: 0n,
      withoutContractLiabilities: 0n,
    });
  });

  it('shows earlier unclosed years in retained earnings and flags a non-control account in credit', () => {
    const sheet = balanceSheet({
      accounts: CHART,
      current: {
        balances: [
          { accountId: id('111003'), clientId: null, contractId: null, amount: -1_000n },
          { accountId: id('112001'), clientId: 'C1', contractId: null, amount: 44_000n },
          { accountId: id('121001'), clientId: null, contractId: null, amount: 10_000n },
          { accountId: id('121003'), clientId: null, contractId: null, amount: -4_000n },
          { accountId: id('311001'), clientId: null, contractId: null, amount: -6_000n },
        ],
        yearNet: -18_000n,
        unclosedNet: -25_000n,
      },
      compare: { balances: [], yearNet: 0n, unclosedNet: 0n },
    });
    const line = (code: string) => sheet.lines.find((candidate) => candidate.line === code);
    expect(line('bs.retained_earnings')).toMatchObject({ amount: 25_000n, unclosedYears: 25_000n });
    expect(line('bs.cash')?.parts).toEqual([
      expect.objectContaining({ amount: -1_000n, oppositeSide: true }),
    ]);
    // A contra account in its normal position is not flagged; the line is net.
    expect(line('bs.ppe')).toMatchObject({ amount: 6_000n });
    expect(line('bs.ppe')?.parts.map((part) => part.oppositeSide)).toEqual([false, false]);
    expect(sheet.totals.assets).toBe(sheet.totals.liabilitiesAndEquity);
    expect(sheet.compareTotals).toEqual({
      assets: 0n,
      liabilities: 0n,
      equity: 0n,
      liabilitiesAndEquity: 0n,
    });
  });
});

describe('the opening in the reports (S10 rules 31–33, `reports/opening-presentation`)', () => {
  const marks = (input: { from: string | null; to: string; income?: boolean; reads?: boolean }) =>
    booksStartMarks({
      booksStart: '2026-10-01',
      from: input.from,
      to: input.to,
      fiscalYearStartMonth: 1,
      readsOpeningEntry: input.reads ?? false,
      incomeStatement: input.income ?? false,
    });

  it('marks a range from before the books start, the opening column and the income statements of its year', () => {
    expect(marks({ from: '2026-10-01', to: '2026-10-31', reads: true })).toEqual(['opening_entry']);
    expect(marks({ from: '2026-09-01', to: '2026-10-31', reads: true })).toEqual([
      'opening_entry',
      'before_books_start',
    ]);
    expect(marks({ from: '2027-01-01', to: '2027-01-31' })).toEqual([]);
    expect(marks({ from: '2026-01-01', to: '2026-12-31', income: true })).toEqual([
      'before_books_start',
      'pre_opening_result_in_equity',
    ]);
    // Any income statement of 2026, whatever its range; none of 2027; one across both is marked.
    expect(marks({ from: '2026-11-01', to: '2026-11-30', income: true })).toEqual([
      'pre_opening_result_in_equity',
    ]);
    expect(marks({ from: '2027-01-01', to: '2027-03-31', income: true })).toEqual([]);
    expect(marks({ from: '2026-12-01', to: '2027-01-31', income: true })).toEqual([
      'pre_opening_result_in_equity',
    ]);
    // A balance (no start) is never before the books start.
    expect(marks({ from: null, to: '2026-12-31' })).toEqual([]);
    expect(
      booksStartMarks({
        booksStart: null,
        from: '2026-01-01',
        to: '2026-12-31',
        fiscalYearStartMonth: 1,
        readsOpeningEntry: false,
        incomeStatement: true,
      }),
    ).toEqual([]);
    // A fiscal year from July: the books start of 2026-10 is in 2026-27.
    expect(
      booksStartMarks({
        booksStart: '2026-10-01',
        from: '2027-06-01',
        to: '2027-06-30',
        fiscalYearStartMonth: 7,
        readsOpeningEntry: false,
        incomeStatement: true,
      }),
    ).toEqual(['pre_opening_result_in_equity']);
    expect(
      reportMarks({
        anyMonthOpen: true,
        to: '2026-10-31',
        revaluationCurrent: true,
        booksStart: ['opening_entry', 'before_books_start'],
      }),
    ).toEqual(['period_open', 'opening_entry', 'before_books_start']);
  });

  it("moves the opening entry into the trial balance's opening column", () => {
    // October from the books start: the opening entry and the rent of the same date in the lines.
    const { opening, movements } = withOpeningEntry(
      new Map(),
      new Map([
        [id('111003'), { debits: 80_000_000n, credits: 10_000_000n }],
        [id('311001'), { debits: 0n, credits: 50_000_000n }],
        [id('312001'), { debits: 0n, credits: 18_000_000n }],
        [id('312002'), { debits: 0n, credits: 12_000_000n }],
        [id('531001'), { debits: 10_000_000n, credits: 0n }],
      ]),
      new Map([
        [id('111003'), { debits: 80_000_000n, credits: 0n }],
        [id('311001'), { debits: 0n, credits: 50_000_000n }],
        [id('312001'), { debits: 0n, credits: 18_000_000n }],
        [id('312002'), { debits: 0n, credits: 12_000_000n }],
      ]),
    );
    const { rows, totals } = trialBalance({
      accounts: CHART,
      opening,
      movements,
      compare: null,
      level: 4,
      nonZero: true,
    });
    const row = (code: string) => rows.find((candidate) => candidate.accountId === id(code));
    expect(row('111003')).toMatchObject({
      opening: 80_000_000n,
      debits: 0n,
      credits: 10_000_000n,
      closing: 70_000_000n,
    });
    expect(row('312002')).toMatchObject({ opening: -12_000_000n, debits: 0n, credits: 0n });
    expect(totals).toMatchObject({
      openingDebit: 80_000_000n,
      openingCredit: 80_000_000n,
      debits: 10_000_000n,
      credits: 10_000_000n,
    });
    expect(() =>
      withOpeningEntry(
        new Map(),
        new Map(),
        new Map([[id('111003'), { debits: 1n, credits: 0n }]]),
      ),
    ).toThrow(RangeError);
  });

  it("adds the result before the books start to its year's result, and to retained earnings later", () => {
    const row = (code: string, amount: bigint, clientId: string | null = null) => ({
      accountId: id(code),
      clientId,
      contractId: null,
      amount,
    });
    // At 31 January 2027, compared with 31 December 2026 (the books start's year).
    const sheet = balanceSheet({
      accounts: CHART,
      current: {
        balances: [
          row('111003', 54_000_000n),
          row('112001', 50_000_000n, 'C1'),
          row('311001', -50_000_000n),
          row('312001', -18_000_000n),
          row('312002', -12_000_000n),
        ],
        yearNet: -10_000_000n,
        unclosedNet: -14_000_000n,
        yearResultAccountIds: [],
      },
      compare: {
        balances: [
          row('111003', 64_000_000n),
          row('112001', 30_000_000n, 'C1'),
          row('311001', -50_000_000n),
          row('312001', -18_000_000n),
          row('312002', -12_000_000n),
        ],
        yearNet: -14_000_000n,
        unclosedNet: 0n,
        yearResultAccountIds: [id('312002')],
      },
    });
    const retained = sheet.lines.find((line) => line.line === 'bs.retained_earnings');
    expect(retained).toMatchObject({
      amount: 44_000_000n,
      compare: 18_000_000n,
      unclosedYears: 14_000_000n,
      compareUnclosedYears: 0n,
    });
    expect(retained?.parts.map((part) => [part.accountId, part.amount])).toEqual([
      [id('312001'), 18_000_000n],
      [id('312002'), 12_000_000n],
    ]);
    expect(sheet).toMatchObject({
      yearResult: 10_000_000n,
      yearResultPreOpening: 0n,
      compareYearResult: 26_000_000n,
      compareYearResultPreOpening: 12_000_000n,
      totals: { assets: 104_000_000n, equity: 104_000_000n },
      compareTotals: { assets: 94_000_000n, equity: 94_000_000n },
    });
    // A loss before the books start (S10 edge case 20) lowers the year's result.
    const loss = balanceSheet({
      accounts: CHART,
      current: {
        balances: [row('111003', 1_000n), row('312002', 400n), row('312001', -1_400n)],
        yearNet: 0n,
        unclosedNet: 0n,
        yearResultAccountIds: [id('312002')],
      },
      compare: null,
    });
    expect(loss).toMatchObject({ yearResult: -400n, yearResultPreOpening: -400n });
    expect(loss.totals.assets).toBe(loss.totals.liabilitiesAndEquity);
  });
});

describe('profitability (rules 20–23)', () => {
  it('gives the scenario\'s margins, half away from zero, and "—" with no revenue', () => {
    expect(marginOf(80_000n, 55_000n)).toBe('68.8');
    expect(marginOf(270_000n, 215_000n)).toBe('79.6');
    expect(marginOf(-1_000n, 500n)).toBe('-50.0');
    expect(marginOf(0n, -55_000n)).toBeNull();
    const report = profitability({
      compared: false,
      amounts: [
        { statementLine: 'is.revenue', valueId: 'design', current: -150_000n, compare: 0n },
        { statementLine: 'is.direct_costs', valueId: 'design', current: 30_000n, compare: 0n },
        { statementLine: 'is.revenue', valueId: null, current: -40_000n, compare: 0n },
        { statementLine: 'is.revenue', valueId: 'photography', current: -80_000n, compare: 0n },
        { statementLine: 'is.direct_costs', valueId: 'photography', current: 25_000n, compare: 0n },
        // Other income never enters (rule 20).
        { statementLine: 'is.other_income', valueId: null, current: -10_000n, compare: 0n },
      ],
    });
    expect(report.rows.map((row) => [row.valueId, row.current.margin])).toEqual([
      ['design', '80.0'],
      ['photography', '68.8'],
      [null, '100.0'],
    ]);
    expect(report.totals.current).toEqual({
      revenue: 270_000n,
      directCosts: 55_000n,
      contribution: 215_000n,
      margin: '79.6',
    });
  });

  it("takes a service's department in force on a date, the latest row among equals", () => {
    const rows = [
      {
        serviceId: 'S1',
        departmentId: 'design',
        effectiveFrom: '2026-12-03',
        createdAt: '1',
        id: 'a',
      },
      {
        serviceId: 'S1',
        departmentId: 'photography',
        effectiveFrom: '2026-12-15',
        createdAt: '2',
        id: 'b',
      },
      {
        serviceId: 'S1',
        departmentId: 'video',
        effectiveFrom: '2026-12-15',
        createdAt: '3',
        id: 'c',
      },
      // Two rows of one transaction (one `created_at`): the later id wins, in any order read.
      {
        serviceId: 'S2',
        departmentId: 'video',
        effectiveFrom: '2026-12-15',
        createdAt: '4',
        id: 'e',
      },
      {
        serviceId: 'S2',
        departmentId: 'design',
        effectiveFrom: '2026-12-15',
        createdAt: '4',
        id: 'd',
      },
    ];
    expect(departmentInForce(rows, 'S1', '2026-12-02')).toBeNull();
    expect(departmentInForce(rows, 'S1', '2026-12-14')).toBe('design');
    expect(departmentInForce(rows, 'S1', '2026-12-20')).toBe('video');
    expect(departmentInForce(rows, 'S2', '2026-12-20')).toBe('video');
    expect(departmentInForce([...rows].reverse(), 'S2', '2026-12-20')).toBe('video');
    expect(departmentInForce(rows, 'S3', '2026-12-20')).toBeNull();
  });
});

describe('the revenue release schedule (rule 25)', () => {
  it('sums each contract per month and at its done', () => {
    const schedule = releaseSchedule([
      { contractId: 'R1', month: '2027-01', amount: 100n },
      { contractId: 'R1', month: '2027-02', amount: 100n },
      { contractId: 'P1', month: null, amount: 500n },
      { contractId: 'R1', month: '2027-01', amount: 50n },
    ]);
    expect(schedule.months).toEqual(['2027-01', '2027-02']);
    expect(schedule.totals.total).toBe(750n);
    expect(schedule.totals.atDone).toBe(500n);
    expect(schedule.rows[0]?.months.get('2027-01')).toBe(150n);
  });
});

describe('the journal book (rules 26, 27)', () => {
  const entry = (number: number, date: string, amount: bigint): JournalBookEntryInput => ({
    fiscalYear: 2026,
    number,
    entryDate: date,
    description: 'اشتراك برمجيات',
    reference: null,
    lines: [
      { accountCode: '531004', accountName: 'اشتراكات البرمجيات', memo: null, amount },
      { accountCode: '111003', accountName: 'المصرف — ليرة سورية', memo: null, amount: -amount },
    ],
  });
  // The `syp` case: 11 entries in November, 2 in December, 3 rows each.
  const year = [
    entry(1, '2026-11-02', 100_000_000n),
    ...Array.from({ length: 10 }, (_, index) =>
      entry(
        index + 2,
        `2026-11-${String(index + 3).padStart(2, '0')}`,
        BigInt(index + 2) * 100_000n,
      ),
    ),
    entry(12, '2026-12-03', 20_000_000n),
    entry(13, '2026-12-10', 20_000_000n),
  ];

  it("gives the scenario's three pages, and December alone keeps page 3 and its totals", () => {
    const pages = journalBookPages(year, { from: '2026-11', to: '2026-12' });
    expect(
      pages.map((page) => [
        page.page,
        page.month,
        page.rows.length,
        page.totals.debits,
        page.cumulative.debits,
      ]),
    ).toEqual([
      [1, '2026-11', 30, 105_400_000n, 105_400_000n],
      [2, '2026-11', 3, 1_100_000n, 106_500_000n],
      [3, '2026-12', 6, 40_000_000n, 146_500_000n],
    ]);
    const december = journalBookPages(year, { from: '2026-12', to: '2026-12' });
    expect(december).toEqual([pages[2]]);
  });

  it('continues a long entry on the next page with "تابع القيد" and wraps long text', () => {
    const long: JournalBookEntryInput = {
      ...entry(1, '2026-11-02', 1n),
      lines: Array.from({ length: 40 }, (_, index) => ({
        accountCode: '531004',
        accountName: 'اشتراكات',
        memo: null,
        amount: index % 2 === 0 ? 1n : -1n,
      })),
    };
    const pages = journalBookPages([long], { from: '2026-11', to: '2026-11' });
    expect(pages).toHaveLength(2);
    expect(pages[1]?.rows[0]).toEqual({ kind: 'continued', number: 1 });
    expect(wrapText('واحد اثنان ثلاثة', 10)).toEqual(['واحد اثنان', 'ثلاثة']);
    expect(wrapText('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
    expect(wrapText('', 5)).toEqual(['']);
    const wrapped = journalBookEntryRows({
      ...entry(1, '2026-11-02', 1n),
      description: 'كلمة '.repeat(40),
    });
    expect(wrapped.filter((row) => row.kind === 'entry_text').length).toBeGreaterThan(0);
  });
});

// --- Properties: rule 8's agreements over random posted books ---

const ledgerAmount = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });

/** A balanced entry on random postable accounts, with clients and contracts on some lines. */
const entryArbitrary = fc
  .record({
    accounts: fc.array(fc.constantFrom(...POSTABLE.map((account) => account.id)), {
      minLength: 1,
      maxLength: 5,
    }),
    amounts: fc.array(ledgerAmount, { minLength: 5, maxLength: 5 }),
    clients: fc.array(fc.constantFrom(null, 'C1', 'C2', 'C3'), { minLength: 6, maxLength: 6 }),
    contracts: fc.array(fc.constantFrom(null, 'P1', 'R1'), { minLength: 6, maxLength: 6 }),
    day: fc.integer({ min: 0, max: 89 }),
  })
  .map(({ accounts, amounts, clients, contracts, day }) => {
    const lines = accounts.map((accountId, index) => ({
      accountId,
      amount: amounts[index] ?? 0n,
      clientId: clients[index] ?? null,
      contractId: contracts[index] ?? null,
    }));
    const residual = lines.reduce((total, line) => total + line.amount, 0n);
    lines.push({
      accountId: id('111003'),
      amount: -residual,
      clientId: clients[5] ?? null,
      contractId: contracts[5] ?? null,
    });
    return { date: addDays('2026-11-01', day), lines };
  });

describe('properties of the reports (rule 8)', () => {
  it('the trial balance balances at every level, and closing is opening plus movements', () => {
    fc.assert(
      fc.property(
        fc.array(entryArbitrary, { maxLength: 30 }),
        fc.integer({ min: 1, max: 4 }),
        (entries, level) => {
          const opening = new Map<string, bigint>();
          const movements = new Map<string, { debits: bigint; credits: bigint }>();
          for (const { date, lines } of entries) {
            for (const line of lines) {
              if (date < '2026-12-01') {
                opening.set(line.accountId, (opening.get(line.accountId) ?? 0n) + line.amount);
              } else {
                const before = movements.get(line.accountId) ?? { debits: 0n, credits: 0n };
                movements.set(line.accountId, {
                  debits: before.debits + (line.amount > 0n ? line.amount : 0n),
                  credits: before.credits + (line.amount < 0n ? -line.amount : 0n),
                });
              }
            }
          }
          const { rows, totals } = trialBalance({
            accounts: CHART,
            opening,
            movements,
            compare: null,
            level,
            nonZero: true,
          });
          expect(totals.openingDebit).toBe(totals.openingCredit);
          expect(totals.debits).toBe(totals.credits);
          expect(totals.closingDebit).toBe(totals.closingCredit);
          for (const row of rows) expect(row.closing).toBe(row.opening + row.debits - row.credits);
        },
      ),
    );
  });

  it("the balance sheet balances after rules 17 and 18, and the income statement's profit is classes 4–5", () => {
    fc.assert(
      fc.property(fc.array(entryArbitrary, { maxLength: 30 }), (entries) => {
        const balances = new Map<string, PresentationBalance>();
        const incomeNet = new Map<string, bigint>();
        let yearNet = 0n;
        let unclosedNet = 0n;
        for (const { date, lines } of entries) {
          for (const line of lines) {
            const cls = classOf(line.accountId);
            if (cls === '4' || cls === '5') {
              incomeNet.set(line.accountId, (incomeNet.get(line.accountId) ?? 0n) + line.amount);
              if (date < '2026-12-01') unclosedNet += line.amount;
              else yearNet += line.amount;
              continue;
            }
            const key = `${line.accountId}|${line.clientId}|${line.contractId}`;
            const before = balances.get(key);
            balances.set(key, {
              accountId: line.accountId,
              clientId: line.clientId,
              contractId: line.contractId,
              amount: (before?.amount ?? 0n) + line.amount,
            });
          }
        }
        const sheet = balanceSheet({
          accounts: CHART,
          current: { balances: [...balances.values()], yearNet, unclosedNet },
          compare: null,
        });
        expect(sheet.totals.assets).toBe(sheet.totals.liabilitiesAndEquity);
        for (const line of sheet.lines) {
          const parts = line.parts.reduce((total, part) => total + part.amount, 0n);
          expect(parts + (line.unclosedYears ?? 0n)).toBe(line.amount);
        }
        // S10 rule 31: in the books start's year, 312002 moves from retained earnings into the
        // year's result; the sheet still balances and equity is unchanged.
        const opening = balanceSheet({
          accounts: CHART,
          current: {
            balances: [...balances.values()],
            yearNet,
            unclosedNet,
            yearResultAccountIds: [id('312002')],
          },
          compare: null,
        });
        expect(opening.totals).toEqual(sheet.totals);
        const preOpening = [...balances.values()]
          .filter((row) => row.accountId === id('312002'))
          .reduce((total, row) => total - row.amount, 0n);
        expect(opening.yearResultPreOpening).toBe(preOpening);
        expect(opening.yearResult).toBe(sheet.yearResult + preOpening);
        const statement = incomeStatement({ accounts: CHART, current: incomeNet, compare: null });
        const classes = [...incomeNet.values()].reduce((total, amount) => total + amount, 0n);
        expect(statement.subtotals.profit).toBe(-classes);
        // Profitability's totals are the income statement's revenue and direct costs (rule 23).
        const amounts = [...incomeNet.entries()].map(([accountId, current]) => ({
          statementLine: CHART.find((account) => account.id === accountId)?.statementLine ?? '',
          valueId: null,
          current,
          compare: 0n,
        }));
        const totals = profitability({ amounts, compared: false }).totals.current;
        const lineAmount = (code: string) =>
          statement.lines.find((line) => line.line === code)?.amount ?? 0n;
        expect(totals.revenue).toBe(lineAmount('is.revenue'));
        expect(-totals.directCosts).toBe(lineAmount('is.direct_costs'));
        // The contract position's totals are the balance sheet's two contract lines.
        const position = contractPosition({ accounts: CHART, balances: [...balances.values()] });
        const sheetLine = (code: string) =>
          sheet.lines.find((line) => line.line === code)?.amount ?? 0n;
        expect(position.totals.contractAssets + position.totals.withoutContractAssets).toBe(
          sheetLine('bs.contract_assets'),
        );
        expect(
          position.totals.contractLiabilities + position.totals.withoutContractLiabilities,
        ).toBe(sheetLine('bs.contract_liabilities'));
      }),
    );
  });

  it('moving the opening entry to the opening column keeps every closing and balances both columns', () => {
    type Sums = Map<string, { debits: bigint; credits: bigint }>;
    const add = (
      into: Sums,
      entries: readonly { lines: { accountId: string; amount: bigint }[] }[],
    ) => {
      for (const { lines } of entries) {
        for (const line of lines) {
          const before = into.get(line.accountId) ?? { debits: 0n, credits: 0n };
          into.set(line.accountId, {
            debits: before.debits + (line.amount > 0n ? line.amount : 0n),
            credits: before.credits + (line.amount < 0n ? -line.amount : 0n),
          });
        }
      }
      return into;
    };
    fc.assert(
      fc.property(
        fc.array(entryArbitrary, { minLength: 1, maxLength: 15 }),
        fc.array(entryArbitrary, { maxLength: 15 }),
        (openingEntries, others) => {
          const openingEntry = add(new Map(), openingEntries);
          const movements = add(add(new Map(), openingEntries), others);
          const read = (opening: Map<string, bigint>, moved: Sums) =>
            trialBalance({
              accounts: CHART,
              opening,
              movements: moved,
              compare: null,
              level: 4,
              nonZero: false,
            });
          const plain = read(new Map(), movements);
          const moved = withOpeningEntry(new Map(), movements, openingEntry);
          const withOpening = read(moved.opening, moved.movements);
          expect(withOpening.rows.map((row) => row.closing)).toEqual(
            plain.rows.map((row) => row.closing),
          );
          expect(withOpening.totals.openingDebit).toBe(withOpening.totals.openingCredit);
          expect(withOpening.totals.debits).toBe(withOpening.totals.credits);
        },
      ),
    );
  });

  it('a month of the journal book paginates alone as within the year, and totals carry forward', () => {
    const bookEntry = fc.record({
      day: fc.integer({ min: 0, max: 89 }),
      description: fc.string({ maxLength: 200 }),
      lines: fc.array(
        fc.record({
          amount: ledgerAmount,
          memo: fc.option(fc.string({ maxLength: 120 })),
          name: fc.string({ maxLength: 90 }),
        }),
        { minLength: 1, maxLength: 12 },
      ),
    });
    fc.assert(
      fc.property(fc.array(bookEntry, { maxLength: 40 }), (generated) => {
        const sorted = [...generated].sort((a, b) => a.day - b.day);
        const entries: JournalBookEntryInput[] = sorted.map((item, index) => ({
          fiscalYear: 2026,
          number: index + 1,
          entryDate: addDays('2026-10-01', item.day),
          description: item.description,
          reference: null,
          lines: item.lines.map((line) => ({
            accountCode: '531004',
            accountName: line.name,
            memo: line.memo,
            amount: line.amount,
          })),
        }));
        const year = journalBookPages(entries, { from: '2026-10', to: '2026-12' });
        for (const [index, page] of year.entries()) {
          expect(page.page).toBe(index + 1);
          expect(page.rows.length).toBeLessThanOrEqual(JOURNAL_BOOK_ROWS_PER_PAGE);
          const before = year[index - 1];
          expect(page.broughtForward).toEqual(before?.cumulative ?? { debits: 0n, credits: 0n });
        }
        for (const month of ['2026-10', '2026-11', '2026-12']) {
          expect(journalBookPages(entries, { from: month, to: month })).toEqual(
            year.filter((page) => page.month === month),
          );
        }
      }),
    );
  });
});
