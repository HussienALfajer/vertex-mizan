import type { JournalBookPage, TrialBalance } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { describe, expect, it } from 'vitest';
import { renderJournalBookHtml, renderReportHtml } from './render.js';
import { entryNumberText, reportSheet, sides } from './sheets.js';

// The print layout (S09 rules 26, 27, 36) on synthetic reports: the sheet a report becomes, its
// printed table, and the journal book's fixed pages. Chromium's own check that a page of the
// longest values never overflows is the worker's (`apps/worker`).

const text = {
  reports: ar.reports,
  accounting: ar.accounting,
  openItems: ar.openItems,
  chart: ar.chart,
};
const context = { text, fiscalYearStartMonth: 1 };

const account = (code: string, name: string, level: number, postable: boolean) => ({
  id: '019a0000-0000-7000-8000-0000000000aa',
  code,
  name,
  nameLatin: null,
  level,
  postable,
  statementLine: null,
  archived: false,
  blocked: false,
});

const trialBalance: TrialBalance = {
  header: {
    ledger: 'book',
    currency: 'SYP',
    producedAt: '2026-11-12T09:30:00+03:00',
    latestEntry: { fiscalYear: 2026, number: 42 },
    booksStart: null,
    current: { from: '2026-10-01', to: '2026-10-31', marks: ['period_open'], hasLines: true },
    compare: { from: '2026-09-01', to: '2026-09-30', marks: [], hasLines: false },
  },
  rows: [
    {
      account: account('11', 'الأصول المتداولة', 2, false),
      opening: '100000',
      debits: '50000',
      credits: '0',
      closing: '150000',
      compare: '0',
    },
    {
      account: { ...account('211003', 'ذمم دائنة أخرى', 4, true), archived: true },
      opening: '-100000',
      debits: '0',
      credits: '50000',
      closing: '-150000',
      compare: '0',
    },
  ],
  totals: {
    openingDebit: '100000',
    openingCredit: '100000',
    debits: '50000',
    credits: '50000',
    closingDebit: '150000',
    closingCredit: '150000',
    compareDebit: '0',
    compareCredit: '0',
  },
};

describe('the sheets', () => {
  it('puts a signed balance on its side', () => {
    expect(sides('150000')).toEqual({ debit: '150000', credit: undefined });
    expect(sides('-150000')).toEqual({ debit: undefined, credit: '150000' });
    expect(sides('0')).toEqual({ debit: undefined, credit: undefined });
  });

  it('names entries as accountants read them, across two calendar years too', () => {
    expect(entryNumberText({ fiscalYear: 2026, number: 7 }, 1)).toBe('2026/7');
    expect(entryNumberText({ fiscalYear: 2026, number: 7 }, 7)).toBe('2026-27/7');
  });

  it('makes the trial balance six columns and a comparative, with its totals and marks', () => {
    const sheet = reportSheet({ report: 'trial_balance', data: trialBalance }, context);
    expect(sheet.title).toBe('ميزان المراجعة');
    expect(sheet.currencyLabel).toBe('الليرة السورية الجديدة');
    expect(sheet.marks).toEqual(['غير نهائية: الفترة مفتوحة']);
    // S10 rules 32–33: the books start's date in its mark.
    const opened = reportSheet(
      {
        report: 'trial_balance',
        data: {
          ...trialBalance,
          header: {
            ...trialBalance.header,
            booksStart: '2026-10-01',
            current: {
              ...trialBalance.header.current,
              from: '2026-09-01',
              marks: ['period_open', 'before_books_start', 'opening_entry'],
            },
          },
        },
      },
      context,
    );
    expect(opened.marks).toEqual([
      'غير نهائية: الفترة مفتوحة',
      'تبدأ الدفاتر في 2026-10-01',
      'الرصيد الافتتاحي من قيد الافتتاح',
    ]);
    expect(sheet.columns.map((column) => column.key)).toEqual([
      'code',
      'account',
      'openingDebit',
      'openingCredit',
      'debits',
      'credits',
      'closingDebit',
      'closingCredit',
      'compareDebit',
      'compareCredit',
    ]);
    const [header, payable, total] = sheet.rows;
    expect(header).toMatchObject({ level: 0, emphasis: 'subtotal' });
    expect(payable?.level).toBe(2);
    expect(payable?.cells).toMatchObject({
      account: 'ذمم دائنة أخرى (مؤرشف)',
      openingCredit: '100000',
      closingCredit: '150000',
      // A comparative with no posted line is "—", never zero (rule 5).
      compareDebit: null,
    });
    expect(total).toMatchObject({ emphasis: 'total', cells: { closingDebit: '150000' } });
  });
});

describe('the printed report', () => {
  it('is an RTL document with its header, marks, grouped columns and exact amounts', () => {
    const html = renderReportHtml({
      company: 'شركة تجريبية',
      sheet: reportSheet({ report: 'trial_balance', data: trialBalance }, context),
      none: ar.reports.none,
      fontFaces: '',
    });
    expect(html.startsWith('<!doctype html><html lang="ar" dir="rtl">')).toBe(true);
    expect(html).toContain('@page { size: A4;');
    expect(html).toContain('شركة تجريبية');
    expect(html).toContain('غير نهائية: الفترة مفتوحة');
    expect(html).toMatch(/colspan="2"/i);
    expect(html).toContain('رصيد أول المدة');
    expect(html).toContain('1,500.00');
    expect(html).toContain('2026/42');
    expect(html).toContain('<td class="num">—</td>');
    expect(html).toContain('main col:nth-child(1) { inline-size:');
    expect(html).not.toMatch(/style="/);
  });

  it('marks a draft on every report it prints', () => {
    const html = renderReportHtml({
      company: 'شركة تجريبية',
      sheet: reportSheet({ report: 'trial_balance', data: trialBalance }, context),
      none: ar.reports.none,
      draft: ar.reports.draft,
      fontFaces: '',
    });
    expect(html).toContain('<div class="draft">مسودة — غير رسمية</div>');
  });
});

describe('the printed journal book', () => {
  const page = (number: number, rows: JournalBookPage['rows']): JournalBookPage => ({
    page: number,
    month: '2026-10',
    rows,
    totals: { debits: '50000', credits: '50000' },
    broughtForward: { debits: '25000', credits: '25000' },
    cumulative: { debits: '75000', credits: '75000' },
  });
  const props = {
    company: 'شركة تجريبية',
    fiscalYear: '2026',
    currency: 'SYP' as const,
    currencyLabel: 'الليرة السورية الجديدة',
    text: {
      ...ar.reports.journalBook,
      fiscalYear: ar.reports.header.fiscalYear,
      currency: ar.reports.header.currency,
      columns: ar.reports.columns,
    },
    entryNumber: (number: number) => entryNumberText({ fiscalYear: 2026, number }, 1),
    fontFaces: '',
  };

  it('prints Mizan’s pages with their numbers, continuations and carried totals', () => {
    const html = renderJournalBookHtml({
      ...props,
      pages: [
        page(7, [
          {
            kind: 'entry',
            fiscalYear: 2026,
            number: 12,
            entryDate: '2026-10-08',
            description: 'قيد تجريبي',
            reference: null,
          },
          {
            kind: 'line',
            number: 12,
            accountCode: '111003',
            accountName: 'حساب تجريبي',
            memo: null,
            debit: '50000',
            credit: '0',
          },
        ]),
        page(8, [{ kind: 'continued', number: 12 }]),
      ],
    });
    expect(html).toContain('صفحة 7');
    expect(html).toContain('صفحة 8');
    expect(html).toContain('تابع القيد رقم 2026/12');
    expect(html).toContain('ما قبله');
    expect(html).toContain('المجموع حتى هذه الصفحة');
    expect(html).toContain('مرتب حسب تاريخ القيد ثم رقمه');
    expect(html).toContain('750.00');
    expect(html.match(/class="book-page"/g)).toHaveLength(2);
    expect(html).not.toContain('مسودة');
  });

  it('says a range with no entries has none', () => {
    const html = renderJournalBookHtml({ ...props, pages: [] });
    expect(html).toContain('لا قيود في الأشهر المطبوعة');
  });
});

describe('the statements’ sheets', () => {
  const header = {
    ...trialBalance.header,
    current: { from: '2026-10-01', to: '2026-10-31', marks: [], hasLines: true },
    compare: null,
  };

  it('puts the income statement’s subtotals after their IFRS 18 categories (rule 14)', () => {
    const sheet = reportSheet(
      {
        report: 'income_statement',
        data: {
          header,
          lines: [
            { line: 'is.revenue', amount: '900000', compare: null, accounts: [] },
            { line: 'is.income_tax', amount: '-50000', compare: null, accounts: [] },
          ],
          subtotals: {
            operatingProfit: '900000',
            profitBeforeFinancingAndIncomeTaxes: null,
            profitBeforeTax: '900000',
            profit: '850000',
          },
          compareSubtotals: null,
        },
      },
      context,
    );
    expect(sheet.columns.map((column) => column.key)).toEqual(['line', 'current']);
    expect(sheet.rows.map((row) => row.cells.line)).toEqual([
      'إيرادات العقود مع العملاء',
      'الربح التشغيلي',
      'الربح قبل الضريبة',
      'مصروف ضريبة الدخل',
      'ربح (خسارة) الفترة',
    ]);
    expect(sheet.rows.at(-1)).toMatchObject({ emphasis: 'total', cells: { current: '850000' } });
  });

  it('notes a reclassification and computes the year’s result in equity (rules 16, 18)', () => {
    const sheet = reportSheet(
      {
        report: 'balance_sheet',
        data: {
          header: { ...header, current: { ...header.current, from: null } },
          lines: [
            {
              line: 'bs.trade_receivables',
              amount: '602400',
              compare: null,
              reclassified: '2400',
              unclosedYears: null,
              compareUnclosedYears: null,
              parts: [],
            },
          ],
          yearResult: '850000',
          compareYearResult: null,
          yearResultPreOpening: '120000',
          compareYearResultPreOpening: null,
          totals: {
            assets: '602400',
            liabilities: '0',
            equity: '602400',
            liabilitiesAndEquity: '602400',
          },
          compareTotals: null,
        },
      },
      context,
    );
    const lines = sheet.rows.map((row) => row.cells.line);
    expect(lines).toContain('أعيد تبويب للعرض');
    expect(lines).toContain('ربح (خسارة) السنة الحالية');
    // S10 rule 31: the year's result names its part from before the books start.
    expect(
      sheet.rows.find((row) => row.cells.line === 'تشمل نتيجة ما قبل بدء الدفاتر'),
    ).toMatchObject({ emphasis: 'note', cells: { current: '120000' } });
    expect(sheet.parameters[0]).toEqual({ label: 'كما في', value: '2026-10-31' });
    expect(sheet.rows.at(-1)).toMatchObject({
      emphasis: 'total',
      cells: { line: 'مجموع الالتزامات وحقوق الملكية', current: '602400' },
    });
  });
});

describe('the comparatives (rule 5; IAS 1.38)', () => {
  const compared = {
    ...trialBalance.header,
    compare: { from: '2026-09-01', to: '2026-09-30', marks: [], hasLines: true },
  };

  it('leaves a balance’s other side blank in the comparative, "—" only for a period with no line', () => {
    const sheet = reportSheet(
      {
        report: 'trial_balance',
        data: {
          ...trialBalance,
          header: compared,
          rows: [{ ...(trialBalance.rows[1] as TrialBalance['rows'][number]), compare: '-40000' }],
        },
      },
      context,
    );
    expect(sheet.rows[0]?.cells).toMatchObject({ compareDebit: undefined, compareCredit: '40000' });
  });

  it('shows profit before financing and income taxes when only the comparative has an investing line', () => {
    const sheet = reportSheet(
      {
        report: 'income_statement',
        data: {
          header: compared,
          lines: [{ line: 'is.revenue', amount: '2000000', compare: '1800000', accounts: [] }],
          subtotals: {
            operatingProfit: '2000000',
            profitBeforeFinancingAndIncomeTaxes: null,
            profitBeforeTax: '1950000',
            profit: '1950000',
          },
          compareSubtotals: {
            operatingProfit: '1800000',
            profitBeforeFinancingAndIncomeTaxes: '1900000',
            profitBeforeTax: '1900000',
            profit: '1900000',
          },
        },
      },
      context,
    );
    expect(sheet.rows.find((row) => row.cells.line === 'الربح قبل التمويل وضرائب الدخل')).toEqual({
      emphasis: 'subtotal',
      cells: {
        line: 'الربح قبل التمويل وضرائب الدخل',
        current: '2000000',
        compare: '1900000',
      },
    });
  });
});
