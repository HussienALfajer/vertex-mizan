import type {
  Account,
  BalanceSheet,
  ContractPosition,
  IncomeStatement,
  Journal,
  JournalBookPrint,
  Profitability,
  ReportAccount,
  ReportFile,
  ReportHeader,
  ReportLines,
  ReportValue,
  RevenueReleaseSchedule,
  ServiceDepartmentHistory,
  TrialBalance,
} from '@vertex-mizan/contracts';
import { accountOf } from './chart-mocks';
import { hubClient, hubContract, manualClient, typeOf } from './dimension-mocks';
import { ownerRef, purchase } from './entry-mocks';
import { periodsReads } from './periods-mocks';

/*
 * Synthetic answers of the reports (S09), in SYP books with a USD parallel ledger, around the
 * tests' today (2026-11-09): November open and not revalued (both marks), its comparative the nine
 * days before it; the balance sheet as the spec's worked example in small (a client in debit on
 * ad funds reclassified to trade receivables, a project's contract balances netted); profitability
 * by department with an unassigned row; October's official print and a superseded one.
 */

const id = (group: string, n: number) =>
  `01900000-0000-7000-${group}-${String(n).padStart(12, '0')}`;

/** An account of the mock chart as the reports name it. */
export const reportAccount = (code: string, fields: Partial<ReportAccount> = {}): ReportAccount => {
  const account: Account = accountOf(code);
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    nameLatin: account.nameLatin,
    level: account.level as 1 | 2 | 3 | 4,
    postable: account.kind === 'postable',
    statementLine: account.statementLine,
    archived: false,
    blocked: false,
    ...fields,
  };
};

const reportValueOf = (value: {
  id: string;
  code: string | null;
  name: string;
  typeId: string;
}): ReportValue => ({
  id: value.id,
  typeCode: value.typeId === typeOf('client').id ? 'client' : 'contract',
  code: value.code,
  name: value.name,
  archived: false,
});

export const clientValue = reportValueOf(manualClient);
export const fundsClient = reportValueOf(hubClient);
export const contractValue = reportValueOf(hubContract);
export const projectValue: ReportValue = {
  id: id('8b01', 1),
  typeCode: 'contract',
  code: 'P-1',
  name: 'مشروع تجريبي',
  archived: false,
};
export const designDepartment: ReportValue = {
  id: id('8b01', 2),
  typeCode: 'department',
  code: 'design',
  name: 'قسم التصميم',
  archived: false,
};

/** November so far, open and not revalued; its comparative the nine days before, closed. */
export const novemberHeader: ReportHeader = {
  ledger: 'book',
  currency: 'SYP',
  producedAt: '2026-11-09T06:00:00.000Z',
  latestEntry: { fiscalYear: 2026, number: 45 },
  booksStart: null,
  current: {
    from: '2026-11-01',
    to: '2026-11-09',
    marks: ['period_open', 'before_revaluation'],
    hasLines: true,
  },
  compare: { from: '2026-10-23', to: '2026-10-31', marks: [], hasLines: true },
};

/** October as a closed, revalued month: no mark. */
export const octoberHeader: ReportHeader = {
  ...novemberHeader,
  current: { from: '2026-10-01', to: '2026-10-31', marks: [], hasLines: true },
  compare: { from: '2026-09-01', to: '2026-09-30', marks: [], hasLines: false },
};

const balanceHeader: ReportHeader = {
  ...novemberHeader,
  current: {
    from: null,
    to: '2026-11-09',
    marks: ['period_open', 'before_revaluation'],
    hasLines: true,
  },
  compare: { from: null, to: '2025-12-31', marks: [], hasLines: false },
};

export const cash = reportAccount('111001');
export const receivables = reportAccount('112001');
export const adFunds = reportAccount('213001');
export const revenue = reportAccount('411001');
export const projectCost = reportAccount('511001');
export const contractAssets = reportAccount('113001');
export const contractLiabilities = reportAccount('212001');

export const trialBalance: TrialBalance = {
  header: novemberHeader,
  rows: [
    {
      account: cash,
      opening: '50000000',
      debits: '12000000',
      credits: '0',
      closing: '62000000',
      compare: '50000000',
    },
    {
      account: receivables,
      opening: '60000000',
      debits: '0',
      credits: '12000000',
      closing: '48000000',
      compare: '60000000',
    },
    {
      account: adFunds,
      opening: '-11760000',
      debits: '0',
      credits: '0',
      closing: '-11760000',
      compare: '-11760000',
    },
    {
      account: { ...revenue, blocked: true },
      opening: '-98240000',
      debits: '0',
      credits: '0',
      closing: '-98240000',
      compare: '-98240000',
    },
  ],
  totals: {
    openingDebit: '110000000',
    openingCredit: '110000000',
    debits: '12000000',
    credits: '12000000',
    closingDebit: '110000000',
    closingCredit: '110000000',
    compareDebit: '110000000',
    compareCredit: '110000000',
  },
};

/** The lines behind the cash debits: one receipt, its sum the figure. */
export const cashLines: ReportLines = {
  header: novemberHeader,
  lines: [
    {
      entryId: purchase.id,
      fiscalYear: 2026,
      number: 41,
      entryDate: '2026-11-03',
      lineNo: 1,
      account: { id: cash.id, code: cash.code, name: cash.name },
      description: 'تحصيل من عميل تجريبي',
      memo: null,
      values: [clientValue],
      amount: '12000000',
      currency: 'SYP',
      transactionAmount: '12000000',
      hubDocument: { type: 'payment', id: id('9000', 7), number: 'PAY-0007' },
    },
  ],
  sum: '12000000',
  count: 1,
  nextCursor: null,
};

export const incomeStatement: IncomeStatement = {
  header: novemberHeader,
  lines: [
    {
      line: 'is.revenue',
      amount: '98240000',
      compare: '40000000',
      accounts: [{ account: revenue, amount: '98240000', compare: '40000000' }],
    },
    {
      line: 'is.direct_costs',
      amount: '-30000000',
      compare: '-12000000',
      accounts: [{ account: projectCost, amount: '-30000000', compare: '-12000000' }],
    },
  ],
  subtotals: {
    operatingProfit: '68240000',
    profitBeforeFinancingAndIncomeTaxes: null,
    profitBeforeTax: '68240000',
    profit: '68240000',
  },
  compareSubtotals: {
    operatingProfit: '28000000',
    profitBeforeFinancingAndIncomeTaxes: null,
    profitBeforeTax: '28000000',
    profit: '28000000',
  },
};

/**
 * The worked example in small: receivables 480,000.00 (5,000.00 of it on a manual line with no
 * client) plus 2,400.00 reclassified from a client in
 * debit on ad funds; ad funds 120,000.00; P-1's deposit and done milestone netted to one contract
 * liability of 700,000.00; R-1's contract asset 300,000.00.
 */
export const balanceSheet: BalanceSheet = {
  header: balanceHeader,
  lines: [
    {
      line: 'bs.cash',
      amount: '62000000',
      compare: null,
      reclassified: '0',
      unclosedYears: null,
      compareUnclosedYears: null,
      parts: [
        {
          account: cash,
          client: null,
          contract: null,
          amount: '62000000',
          reclassified: false,
          oppositeSide: false,
        },
      ],
    },
    {
      line: 'bs.trade_receivables',
      amount: '48240000',
      compare: null,
      reclassified: '240000',
      unclosedYears: null,
      compareUnclosedYears: null,
      parts: [
        {
          account: receivables,
          client: clientValue,
          contract: null,
          amount: '47500000',
          reclassified: false,
          oppositeSide: false,
        },
        // A manual line with no client (edge case 16): the lines filter cannot isolate it.
        {
          account: receivables,
          client: null,
          contract: null,
          amount: '500000',
          reclassified: false,
          oppositeSide: false,
        },
        {
          account: adFunds,
          client: fundsClient,
          contract: null,
          amount: '240000',
          reclassified: true,
          oppositeSide: false,
        },
      ],
    },
    {
      line: 'bs.contract_assets',
      amount: '30000000',
      compare: null,
      reclassified: '0',
      unclosedYears: null,
      compareUnclosedYears: null,
      parts: [
        {
          account: contractAssets,
          client: null,
          contract: contractValue,
          amount: '30000000',
          reclassified: false,
          oppositeSide: false,
        },
      ],
    },
    {
      line: 'bs.contract_liabilities',
      amount: '70000000',
      compare: null,
      reclassified: '0',
      unclosedYears: null,
      compareUnclosedYears: null,
      parts: [
        {
          account: contractLiabilities,
          client: null,
          contract: projectValue,
          amount: '120000000',
          reclassified: false,
          oppositeSide: false,
        },
        {
          account: contractAssets,
          client: null,
          contract: projectValue,
          amount: '-50000000',
          reclassified: false,
          oppositeSide: false,
        },
      ],
    },
    {
      line: 'bs.client_money',
      amount: '12000000',
      compare: null,
      reclassified: '0',
      unclosedYears: null,
      compareUnclosedYears: null,
      parts: [
        {
          account: adFunds,
          client: clientValue,
          contract: null,
          amount: '12000000',
          reclassified: false,
          oppositeSide: false,
        },
      ],
    },
    {
      line: 'bs.retained_earnings',
      amount: '0',
      compare: null,
      reclassified: '0',
      unclosedYears: null,
      compareUnclosedYears: null,
      parts: [],
    },
  ],
  yearResult: '58240000',
  compareYearResult: null,
  yearResultPreOpening: '0',
  compareYearResultPreOpening: null,
  totals: {
    assets: '140240000',
    liabilities: '82000000',
    equity: '58240000',
    liabilitiesAndEquity: '140240000',
  },
  compareTotals: null,
};

export const profitability: Profitability = {
  header: { ...novemberHeader, ledger: 'parallel', currency: 'USD' },
  by: 'department',
  rows: [
    {
      value: designDepartment,
      current: { revenue: '50000', directCosts: '15600', contribution: '34400', margin: '68.8' },
      compare: { revenue: '20000', directCosts: '8000', contribution: '12000', margin: '60.0' },
    },
    {
      value: null,
      current: { revenue: '0', directCosts: '4400', contribution: '-4400', margin: null },
      compare: { revenue: '0', directCosts: '0', contribution: '0', margin: null },
    },
  ],
  totals: {
    current: { revenue: '50000', directCosts: '20000', contribution: '30000', margin: '60.0' },
    compare: { revenue: '20000', directCosts: '8000', contribution: '12000', margin: '60.0' },
  },
};

export const contractPosition: ContractPosition = {
  header: balanceHeader,
  rows: [
    {
      contract: projectValue,
      client: clientValue,
      kind: 'project',
      assets: '50000000',
      liabilities: '120000000',
      net: '-70000000',
    },
    {
      contract: contractValue,
      client: fundsClient,
      kind: 'retainer',
      assets: '30000000',
      liabilities: '0',
      net: '30000000',
    },
  ],
  totals: {
    contractAssets: '30000000',
    contractLiabilities: '70000000',
    withoutContractAssets: '0',
    withoutContractLiabilities: '0',
  },
};

export const revenueSchedule: RevenueReleaseSchedule = {
  header: { ...novemberHeader, compare: null },
  months: ['2026-11', '2026-12'],
  rows: [
    {
      contract: contractValue,
      client: fundsClient,
      months: [
        { month: '2026-11', amount: '10000000' },
        { month: '2026-12', amount: '10000000' },
      ],
      atDone: '0',
      total: '20000000',
    },
    {
      contract: projectValue,
      client: clientValue,
      months: [],
      atDone: '50000000',
      total: '50000000',
    },
  ],
  totals: {
    months: [
      { month: '2026-11', amount: '10000000' },
      { month: '2026-12', amount: '10000000' },
    ],
    atDone: '50000000',
    total: '70000000',
  },
};

export const journal: Journal = {
  header: novemberHeader,
  entries: [
    {
      entryId: purchase.id,
      fiscalYear: 2026,
      number: 41,
      entryDate: '2026-11-03',
      source: 'hub',
      description: 'تحصيل من عميل تجريبي',
      reference: 'PAY-0007',
      hubDocument: { type: 'payment', id: id('9000', 7), number: 'PAY-0007' },
      lines: [
        {
          lineNo: 1,
          account: { id: cash.id, code: cash.code, name: cash.name },
          memo: null,
          values: [],
          debit: '12000000',
          credit: '0',
        },
        {
          lineNo: 2,
          account: { id: receivables.id, code: receivables.code, name: receivables.name },
          memo: 'الفاتورة INV-0003',
          values: [clientValue],
          debit: '0',
          credit: '12000000',
        },
      ],
    },
  ],
  nextCursor: null,
};

const sha = (digit: string) => digit.repeat(64);

/** October's official print, and September's superseded by a reopen. */
export const prints: JournalBookPrint[] = [
  {
    id: id('8c01', 1),
    reportFileId: id('8c02', 1),
    fiscalYear: 2026,
    from: '2026-10',
    to: '2026-10',
    firstPage: 3,
    lastPage: 7,
    entryCount: 38,
    lineCount: 104,
    debitTotal: '512000000',
    creditTotal: '512000000',
    currency: 'SYP',
    contentSha256: sha('a'),
    fileSha256: sha('b'),
    printedBy: ownerRef,
    createdAt: '2026-11-05T08:00:00.000Z',
    superseded: false,
    supersededAt: null,
  },
  {
    id: id('8c01', 2),
    reportFileId: id('8c02', 2),
    fiscalYear: 2026,
    from: '2026-09',
    to: '2026-09',
    firstPage: 1,
    lastPage: 2,
    entryCount: 12,
    lineCount: 30,
    debitTotal: '98000000',
    creditTotal: '98000000',
    currency: 'SYP',
    contentSha256: sha('c'),
    fileSha256: sha('d'),
    printedBy: ownerRef,
    createdAt: '2026-10-06T08:00:00.000Z',
    superseded: true,
    supersededAt: '2026-10-08T09:00:00.000Z',
  },
];

/** A PDF file in a state. */
export const reportFile = (
  state: ReportFile['state'],
  fields: Partial<ReportFile> = {},
): ReportFile => ({
  id: id('8c03', 1),
  report: 'trial_balance',
  params: {},
  format: 'pdf',
  official: false,
  state,
  sizeBytes: state === 'ready' ? 48_000 : null,
  error: null,
  createdAt: '2026-11-09T06:00:00.000Z',
  readyAt: state === 'ready' ? '2026-11-09T06:00:10.000Z' : null,
  expiresAt: state === 'ready' ? '2026-11-10T06:00:10.000Z' : null,
  ...fields,
});

/** A Hub service and its department history. */
export const serviceHistory: ServiceDepartmentHistory = {
  service: { id: id('8b01', 3), code: 'logo', name: 'تصميم شعار', archived: false },
  fromHub: false,
  rows: [
    {
      id: id('8b02', 1),
      department: { id: designDepartment.id, code: 'design', name: 'قسم التصميم', archived: false },
      effectiveFrom: '2026-10-01',
      source: 'manual',
      inboundEventId: null,
      recordedBy: ownerRef,
      reason: 'القسم المنفّذ للخدمة',
      createdAt: '2026-10-01T08:00:00.000Z',
    },
  ],
};

/** Every read of the report screens, with the periods' and the receivables' reads. */
export const reportsReads = {
  ...periodsReads,
  'GET /api/reports/trial-balance': { status: 200, json: trialBalance },
  'GET /api/reports/lines': { status: 200, json: cashLines },
  'GET /api/reports/income-statement': { status: 200, json: incomeStatement },
  'GET /api/reports/balance-sheet': { status: 200, json: balanceSheet },
  'GET /api/reports/profitability': { status: 200, json: profitability },
  'GET /api/reports/contract-position': { status: 200, json: contractPosition },
  'GET /api/reports/revenue-schedule': { status: 200, json: revenueSchedule },
  'GET /api/reports/journal': { status: 200, json: journal },
  'GET /api/reports/journal-book/prints': { status: 200, json: prints },
};
