import type { MaterialQuantities, ProjectReport, ReportHeader } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { describe, expect, it } from 'vitest';
import { renderReportHtml } from './render.js';
import { reportSheet } from './sheets.js';

// The project prints of S12 on synthetic data (`reports/project-report.md`'s December): the
// project report as one sheet with its parts, and the material quantities. Chromium's page checks
// are the worker's.

const text = {
  reports: ar.reports,
  accounting: ar.accounting,
  openItems: ar.openItems,
  chart: ar.chart,
  cash: ar.cash,
};
const context = { text, fiscalYearStartMonth: 1 };
const id = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const header: ReportHeader = {
  ledger: 'book',
  currency: 'USD',
  producedAt: '2026-12-31T10:00:00Z',
  latestEntry: { fiscalYear: 2026, number: 11 },
  booksStart: null,
  current: { from: '2026-12-01', to: '2026-12-31', marks: ['period_open'], hasLines: true },
  compare: null,
};

const value = (n: number, typeCode: string, code: string, name: string) => ({
  id: id(n),
  typeCode,
  code,
  name,
  archived: false,
});

const account = (n: number, code: string, name: string) => ({
  id: id(n),
  code,
  name,
  nameLatin: null,
  level: 4,
  postable: true,
  statementLine: 'is.direct_costs',
  archived: false,
  blocked: false,
});

const cement = { id: id(40), code: 'CEM', name: 'أسمنت بورتلاندي', unit: 'طن', archived: false };

const report: ProjectReport = {
  header,
  project: value(1, 'contract', 'P1', 'مشروع البناء التجريبي'),
  client: value(2, 'client', 'C1', 'العميل التجريبي'),
  terms: {
    currency: 'USD',
    contractValueMinor: '10000000',
    retentionBp: 1000,
    advanceRecoveryBp: 2000,
  },
  summary: {
    cumulativeMinor: '3000000',
    billed: '30.0',
    revenue: '3000000',
    directCosts: '1555809',
    contribution: '1444191',
    margin: '48.1',
    retentionReceivable: '300000',
    clientAdvance: '1400000',
    subcontractRetention: '120000',
    subcontractAdvance: '260000',
  },
  costs: {
    rows: [
      {
        account: account(10, '511001', 'مواد مباشرة'),
        inRange: '300809',
        toDate: '300809',
        budgetMinor: '4000000',
        variance: '3699191',
        used: '7.5',
      },
    ],
    totals: {
      inRange: '300809',
      toDate: '300809',
      budgetMinor: '4000000',
      variance: '3699191',
      used: '7.5',
    },
  },
  materials: [
    {
      material: cement,
      currency: 'TRY',
      quantity: '12.500',
      amountMinor: '3937500',
      ledgerAmount: '115809',
      average: '3150.0000',
    },
  ],
  wages: [
    {
      worker: value(3, 'worker', 'W2', 'حرفي'),
      days: '0.000',
      lumpSum: '40000',
      amount: '40000',
      balance: '10000',
    },
  ],
  subcontracts: [
    {
      subcontractId: id(50),
      supplier: value(4, 'supplier', 'S2', 'مقاول الباطن'),
      currency: 'USD',
      valueMinor: '5000000',
      cumulativeMinor: '1200000',
      retention: '120000',
      advance: '260000',
      paid: '500000',
    },
  ],
  billings: [
    {
      documentId: id(60),
      entryId: id(61),
      projectSequence: 1,
      fiscalYear: 2026,
      number: 1,
      documentDate: '2026-12-31',
      cumulativeMinor: '3000000',
      previousMinor: '0',
      periodMinor: '3000000',
      retentionMinor: '300000',
      advanceMinor: '600000',
      netMinor: '2100000',
      state: 'posted',
      outstandingMinor: '2100000',
    },
  ],
};

describe('the project report as a sheet (S12 "Reports")', () => {
  it('heads the summary and lists the five parts, each in its currency', () => {
    const sheet = reportSheet({ report: 'project_report', data: report }, context);
    expect(sheet.title).toBe(ar.reports.names.project_report);
    expect(sheet.parameters.map((parameter) => parameter.value)).toContain(
      'P1 مشروع البناء التجريبي',
    );
    expect(sheet.rows.map((row) => row.cells.value)).toEqual([
      '10000000',
      '3000000',
      '3000000',
      '1555809',
      '1444191',
      '300000',
      '1400000',
      '120000',
      '260000',
    ]);
    expect(sheet.rows[1]?.cells.share).toBe('30.0%');
    expect(sheet.parts?.map((part) => part.title)).toEqual(
      Object.values(ar.reports.project.sections).slice(1),
    );
    const [costs, materials, , , billings] = sheet.parts ?? [];
    expect(costs?.rows.at(-1)).toMatchObject({
      emphasis: 'total',
      cells: { variance: '3699191', used: '7.5%', budget: '4000000', termsCurrency: 'USD' },
    });
    expect(materials?.rows[0]?.cells).toMatchObject({
      currency: 'TRY',
      quantity: '12.500',
      amount: '3937500',
      average: '3150.0000',
    });
    expect(billings?.rows[0]?.cells).toMatchObject({
      number: '2026/1',
      state: ar.reports.project.states.posted,
      net: '2100000',
    });
  });

  it('notes a project without terms and leaves its contract value blank', () => {
    const sheet = reportSheet(
      { report: 'project_report', data: { ...report, terms: null } },
      context,
    );
    expect(sheet.rows[0]).toEqual({
      emphasis: 'note',
      cells: { item: ar.reports.project.summary.noTerms },
    });
    expect(sheet.rows[1]?.cells.value).toBeNull();
  });

  it('prints every part as its own table with its widths, amounts in their currencies', () => {
    const sheet = reportSheet({ report: 'project_report', data: report }, context);
    const html = renderReportHtml({ company: 'شركة تجريبية', sheet, none: '—', fontFaces: '' });
    expect(html.match(/<table/g)).toHaveLength(6);
    expect(html).toContain('main table.part-4 col:nth-child(1) { inline-size:');
    expect(html).toContain(ar.reports.project.sections.billings);
    // 39,375.00 TRY in its own currency; 1,158.09 in the USD ledger.
    expect(html).toContain('39,375.00');
    expect(html).toContain('1,158.09');
  });
});

describe('the material quantities as a sheet', () => {
  it('names each project and material, with the ledger total', () => {
    const data: MaterialQuantities = {
      header,
      rows: [
        {
          project: report.project,
          material: cement,
          currency: 'TRY',
          quantityIn: '12.500',
          quantityOut: '0.000',
          quantity: '12.500',
          amountMinor: '3937500',
          average: '3150.0000',
          ledgerAmount: '115809',
        },
        {
          project: null,
          material: cement,
          currency: 'USD',
          quantityIn: '0.000',
          quantityOut: '-1.000',
          quantity: '-1.000',
          amountMinor: '-9500',
          average: '95.0000',
          ledgerAmount: '-9500',
        },
      ],
      ledgerTotal: '106309',
    };
    const sheet = reportSheet({ report: 'material_quantities', data }, context);
    expect(sheet.rows.map((row) => row.cells.project)).toEqual([
      'P1 مشروع البناء التجريبي',
      ar.reports.materialQuantities.unassigned,
      ar.reports.totals.total,
    ]);
    expect(sheet.rows.at(-1)?.cells.ledgerAmount).toBe('106309');
  });
});
