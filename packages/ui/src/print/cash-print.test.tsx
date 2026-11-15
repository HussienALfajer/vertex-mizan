import type { CashPosition, CashStatement, CurrencyCode } from '@vertex-mizan/contracts';
import { amountInWords, ar } from '@vertex-mizan/i18n';
import { describe, expect, it } from 'vitest';
import { renderReportHtml, renderVoucherHtml } from './render.js';
import { reportSheet, voucherNumberText } from './sheets.js';
import type { VoucherPrintData } from './voucher.js';

// The cash prints of S11 on synthetic data: the cash position and a cash account's statement as
// sheets (one model for Excel and PDF), and the printed voucher. Chromium's page checks are the
// worker's.

const text = {
  reports: ar.reports,
  accounting: ar.accounting,
  openItems: ar.openItems,
  chart: ar.chart,
  cash: ar.cash,
};
const context = { text, fiscalYearStartMonth: 1 };
const id = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const usd = (amountMinor: string) => ({ amountMinor, currency: 'USD' as const });
const syp = (amountMinor: string) => ({ amountMinor, currency: 'SYP' as const });

const box = (n: number, code: string, currency: CurrencyCode) => ({
  id: id(n),
  code,
  name: `صندوق ${currency}`,
  nameLatin: null,
  cashKind: 'box' as const,
  currency,
});

const position: CashPosition = {
  asOf: '2026-12-03',
  bookCurrency: 'USD',
  parallelCurrency: 'SYP',
  groups: [
    {
      currency: 'USD',
      accounts: [
        {
          ...box(1, '111002', 'USD'),
          balance: usd('99000'),
          book: usd('99000'),
          parallel: syp('11880000'),
        },
      ],
      total: usd('99000'),
      book: usd('99000'),
      parallel: syp('11880000'),
    },
    {
      currency: 'TRY',
      accounts: [
        {
          ...box(2, '111005', 'TRY'),
          balance: { amountMinor: '0', currency: 'TRY' },
          book: usd('0'),
          parallel: syp('0'),
        },
      ],
      total: { amountMinor: '0', currency: 'TRY' },
      book: usd('0'),
      parallel: syp('0'),
    },
  ],
  book: usd('99000'),
  parallel: syp('11880000'),
};

const statement: CashStatement = {
  account: box(1, '111002', 'USD'),
  from: '2026-12-01',
  to: '2026-12-31',
  ledgers: ['book'],
  bookCurrency: 'USD',
  parallelCurrency: 'SYP',
  opening: { amount: usd('200000'), book: usd('200000'), parallel: null },
  rows: [
    {
      kind: 'line',
      date: '2026-12-01',
      entry: { id: id(10), fiscalYear: 2026, number: 4, lineNo: 3 },
      voucher: { id: id(11), kind: 'transfer', fiscalYear: 2026, number: 1 },
      description: 'صرف عملة',
      counterAccount: null,
      severalCounterAccounts: true,
      counterparty: null,
      contract: null,
      in: '0',
      out: '101000',
      balance: '99000',
      book: '-101000',
      parallel: null,
      expectedMinor: null,
      countedMinor: null,
    },
    {
      kind: 'count',
      date: '2026-12-02',
      entry: null,
      voucher: { id: id(12), kind: 'count', fiscalYear: 2026, number: 1 },
      description: 'جرد نهاية اليوم',
      counterAccount: null,
      severalCounterAccounts: false,
      counterparty: null,
      contract: null,
      in: '0',
      out: '0',
      balance: '99000',
      book: null,
      parallel: null,
      expectedMinor: '99000',
      countedMinor: '99000',
    },
  ],
  totalIn: '0',
  totalOut: '101000',
  closing: { amount: usd('99000'), book: usd('99000'), parallel: null },
};

describe('the cash sheets', () => {
  it('groups the cash position by currency with totals per currency and per ledger', () => {
    const sheet = reportSheet(
      { report: 'cash_position', data: position, producedAt: '2026-12-03T09:00:00Z' },
      context,
    );
    expect(sheet.title).toBe('المركز النقدي');
    expect(sheet.columns.map((column) => column.key)).toEqual([
      'code',
      'name',
      'kind',
      'currency',
      'balance',
      'book',
      'parallel',
    ]);
    expect(sheet.rows.map((row) => row.emphasis ?? 'line')).toEqual([
      'section',
      'line',
      'subtotal',
      'section',
      'line',
      'subtotal',
      'total',
    ]);
    expect(sheet.rows[1]?.cells).toMatchObject({ code: '111002', kind: 'صندوق', balance: '99000' });
    expect(sheet.rows.at(-1)?.cells).toMatchObject({ book: '99000', parallel: '11880000' });
  });

  it('leaves out the parallel column without a parallel ledger', () => {
    const sheet = reportSheet(
      {
        report: 'cash_position',
        data: { ...position, parallelCurrency: null, parallel: null },
        producedAt: '2026-12-03T09:00:00Z',
      },
      context,
    );
    expect(sheet.columns.map((column) => column.key)).not.toContain('parallel');
  });

  it('prints a statement with its opening, lines, count, totals and closing', () => {
    const sheet = reportSheet(
      { report: 'cash_statement', data: statement, producedAt: '2026-12-31T09:00:00Z' },
      context,
    );
    expect(sheet.title).toBe('كشف صندوق: 111002 صندوق USD');
    expect(sheet.columns.map((column) => column.key)).toEqual([
      'date',
      'entry',
      'voucher',
      'description',
      'counterAccount',
      'counterparty',
      'contract',
      'in',
      'out',
      'balance',
      'book',
      'expected',
      'counted',
    ]);
    const [opening, exchange, count, totals, closing] = sheet.rows;
    expect(opening?.cells).toMatchObject({ description: 'الرصيد الافتتاحي', balance: '200000' });
    expect(exchange?.cells).toMatchObject({
      entry: '2026/4',
      voucher: 'سند تحويل 2026/1',
      counterAccount: 'متعدد',
      out: '101000',
      book: '-101000',
    });
    // A count moves nothing: no in, no out, its expected and counted amounts.
    expect(count?.cells).toMatchObject({ voucher: 'محضر جرد 2026/1', expected: '99000' });
    expect(count?.cells.in).toBeUndefined();
    expect(totals?.cells).toMatchObject({ in: '0', out: '101000' });
    expect(closing?.emphasis).toBe('total');
    const html = renderReportHtml({ company: 'شركة تجريبية', sheet, none: '—', fontFaces: '' });
    expect(html).toContain('1,010.00');
    expect(html).toContain('متعدد');
  });

  it('names a voucher by its kind and number', () => {
    expect(voucherNumberText({ kind: 'receipt', fiscalYear: 2026, number: 15 }, context)).toBe(
      'سند قبض 2026/15',
    );
  });
});

const receipt: VoucherPrintData = {
  kind: 'receipt',
  fiscalYear: 2026,
  number: 15,
  date: '2026-12-02',
  state: 'posted',
  cashAccount: { code: '111002', name: 'صندوق الدولار', currency: 'USD' },
  counterCashAccount: null,
  amountMinor: '150000',
  partyName: 'عميل تجريبي',
  description: 'دفعة من مستخلص',
  entry: { fiscalYear: 2026, number: 9 },
  reversal: null,
  expectedMinor: null,
  countedMinor: null,
  differenceMinor: null,
  destinationMinor: null,
  feeMinor: null,
  exchangedMinor: null,
  dealtRate: null,
  preparedBy: 'محاسب تجريبي',
  approvedBy: null,
  lines: [
    {
      lineNo: 2,
      account: { code: '112001', name: 'ذمم العملاء' },
      currency: 'USD',
      amountMinor: '150000',
      counterparty: 'عميل تجريبي',
      contract: 'مشروع تجريبي',
      memo: null,
    },
  ],
};

const printed = (voucher: VoucherPrintData) =>
  renderVoucherHtml({
    company: 'شركة تجريبية',
    voucher,
    text: ar.cash,
    amountInWords: amountInWords(
      BigInt(
        voucher.kind === 'count'
          ? (voucher.countedMinor ?? '0')
          : (voucher.exchangedMinor ?? voucher.amountMinor),
      ),
      voucher.cashAccount.currency,
    ),
    currencyName: (currency) =>
      currency === 'SYP' ? ar.accounting.sypPrintedName : ar.accounting.currencies[currency],
    fiscalYearStartMonth: 1,
    fontFaces: '',
  });

describe('the printed voucher', () => {
  it('prints a receipt on A5 with the amount in figures and words, party, lines and signatures', () => {
    const html = printed(receipt);
    expect(html).toContain('size: A5 portrait');
    expect(html).toContain('سند قبض');
    expect(html).toContain('2026/15');
    expect(html).toContain('1,500.00');
    expect(html).toContain('فقط ألف وخمسمئة دولار أمريكي لا غير');
    expect(html).toContain('استلمنا من');
    expect(html).toContain('عميل تجريبي');
    expect(html).toContain('مشروع تجريبي');
    for (const label of ['المستلم', 'أمين الصندوق', 'المحاسب', 'المدير']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('ملغى');
  });

  it('prints "ملغى" with the reversal\'s number on a cancelled voucher', () => {
    const html = printed({
      ...receipt,
      state: 'cancelled',
      reversal: { fiscalYear: 2026, number: 12 },
    });
    expect(html).toContain('ملغى بالقيد رقم <bdi');
    expect(html).toContain('2026/12');
  });

  it('prints an exchange with both accounts, both amounts and the dealt rate', () => {
    const html = printed({
      ...receipt,
      kind: 'transfer',
      partyName: null,
      amountMinor: '101000',
      counterCashAccount: { code: '111005', name: 'صندوق الليرة التركية', currency: 'TRY' },
      destinationMinor: '3450000',
      feeMinor: '1000',
      exchangedMinor: '100000',
      dealtRate: { base: 'USD', quote: 'TRY', rate: '34.5' },
      lines: [
        {
          lineNo: 2,
          account: { code: '532002', name: 'عمولات مصرفية' },
          currency: 'USD',
          amountMinor: '1000',
          counterparty: null,
          contract: null,
          memo: null,
        },
      ],
    });
    expect(html).toContain('سند تحويل (صرف عملة)');
    // What it exchanged, net of the fee, agrees with its rate: 1,000.00 × 34.5 = 34,500.00.
    expect(html).toMatch(/المبلغ المحوَّل<\/th><td><bdi class="num">1,000\.00<\/bdi>/);
    expect(html).toContain('34,500.00');
    expect(html).toMatch(/إجمالي الصادر من الحساب<\/th><td><bdi class="num">1,010\.00<\/bdi>/);
    expect(html).toContain('1 USD = 34.5 TRY');
    expect(html).toContain('10.00');
    expect(html).not.toContain('استلمنا من');
  });

  it('prints a count with its expected and counted amounts and the reason, SYP as the new pound', () => {
    const html = printed({
      ...receipt,
      kind: 'count',
      cashAccount: { code: '111001', name: 'صندوق الليرة', currency: 'SYP' },
      amountMinor: '0',
      partyName: null,
      description: 'جرد مفاجئ',
      expectedMinor: '500000',
      countedMinor: '490000',
      differenceMinor: '-10000',
      lines: [
        {
          lineNo: 2,
          account: { code: '532007', name: 'عجز الصناديق' },
          currency: 'SYP',
          amountMinor: '10000',
          counterparty: null,
          contract: null,
          memo: null,
        },
      ],
    });
    expect(html).toContain('محضر جرد');
    expect(html).toContain('الرصيد المتوقع');
    expect(html).toContain('5,000.00');
    expect(html).toContain('4,900.00');
    expect(html).toContain('-100.00');
    expect(html).toContain('الليرة السورية الجديدة');
    expect(html).toContain('ليرة سورية جديدة');
    // Every figure names its currency as printed: never the bare code for SYP.
    expect(html).not.toMatch(/>SYP</);
    expect(html.match(/الليرة السورية الجديدة/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('جرد مفاجئ');
  });
});
