/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import {
  JOURNAL_BOOK_COLUMNS,
  JOURNAL_BOOK_ROWS_PER_PAGE,
  type JournalBookPage,
  type JournalBookRow,
  type TrialBalance,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  entryNumberText,
  printFontFaces,
  renderJournalBookHtml,
  renderReportHtml,
  reportSheet,
} from '@vertex-mizan/ui/print';
import { printPdf } from '../src/core/print/pdf.js';

// The worker's Chromium checks (S09 rules 27, 36): the print layout of `@vertex-mizan/ui/print`
// printed as the render job prints it. A journal-book page of the longest values clips nothing and
// stays one page (rule 27: the renderer never reflows); the brand's faces load from the document
// itself; a long report flows over numbered pages. Every value is synthetic.

const fontFaces = printFontFaces();

/** Text of exactly `length` characters in wide Arabic letters, words of six. */
const longest = (length: number) =>
  Array.from({ length }, (_, at) => ((at + 1) % 7 === 0 ? ' ' : 'صشضم'[at % 4])).join('');

/** The largest amount a realistic book prints: 9,999,999,999,999.99. */
const LARGE = '999999999999999';

function longestPage(page: number): JournalBookPage {
  const rows: JournalBookRow[] = [
    {
      kind: 'entry',
      fiscalYear: 2026,
      number: 123_456,
      entryDate: '2026-12-31',
      description: longest(JOURNAL_BOOK_COLUMNS.description),
      reference: longest(JOURNAL_BOOK_COLUMNS.reference),
    },
  ];
  while (rows.length < JOURNAL_BOOK_ROWS_PER_PAGE) {
    rows.push(
      rows.length % 2 === 1
        ? {
            kind: 'line',
            number: 123_456,
            accountCode: '531001',
            accountName: longest(JOURNAL_BOOK_COLUMNS.accountName),
            memo: longest(JOURNAL_BOOK_COLUMNS.memo),
            debit: LARGE,
            credit: '0',
          }
        : {
            kind: 'line_text',
            number: 123_456,
            accountName: longest(JOURNAL_BOOK_COLUMNS.accountName),
            memo: longest(JOURNAL_BOOK_COLUMNS.memo),
          },
    );
  }
  const totals = { debits: LARGE, credits: LARGE };
  return { page, month: '2026-12', rows, totals, broughtForward: totals, cumulative: totals };
}

const bookHtml = (pages: JournalBookPage[], draft?: string) =>
  renderJournalBookHtml({
    company: longest(60),
    fiscalYear: '2026',
    currency: 'SYP',
    currencyLabel: ar.accounting.sypPrintedName,
    pages,
    text: {
      ...ar.reports.journalBook,
      fiscalYear: ar.reports.header.fiscalYear,
      currency: ar.reports.header.currency,
      columns: ar.reports.columns,
    },
    entryNumber: (number) => entryNumberText({ fiscalYear: 2026, number }, 7),
    ...(draft === undefined ? {} : { draft }),
    fontFaces,
  });

/** The pages of a PDF, counted from its page objects. */
const pageCount = (pdf: Buffer) =>
  pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;

test('a journal-book page of the longest values clips nothing and prints on one page', async ({
  browser,
  page,
}) => {
  const html = bookHtml([longestPage(998), longestPage(999), longestPage(1000)]);
  // The print area of a landscape A4 page with its margins, at 96 dpi: 281 mm by 190 mm.
  await page.setViewportSize({ width: 1062, height: 718 });
  await page.emulateMedia({ media: 'print' });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({
    arabic: document.fonts.check('700 10px "Noto Kufi Arabic"', 'صشضم'),
    latin: document.fonts.check('400 10px "Montserrat"', '0123'),
  }));
  expect(fonts).toEqual({ arabic: true, latin: true });
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.book-page, .book-page td, .book-page th')]
      .filter(
        (element) =>
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1,
      )
      .map((element) => `${element.tagName} ${element.textContent?.slice(0, 20)}`),
  );
  expect(clipped).toEqual([]);
  await expect(page.locator('.book-page').first()).toContainText('صفحة 998');
  await expect(page.locator('.book-page').last()).toContainText('ما قبله');

  const pdf = await printPdf(browser, html, { pageNumbers: null });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pageCount(pdf)).toBe(3);
});

test('a draft journal book prints its mark, and a long report flows over its pages', async ({
  browser,
}) => {
  const draft = await printPdf(browser, bookHtml([longestPage(1)], ar.reports.draft), {
    pageNumbers: null,
  });
  expect(pageCount(draft)).toBe(1);

  const rows = Array.from({ length: 400 }, (_, at) => ({
    account: {
      id: '019a0000-0000-7000-8000-0000000000aa',
      code: String(510000 + at),
      name: longest(30),
      nameLatin: null,
      level: 4,
      postable: true,
      statementLine: null,
      archived: false,
      blocked: false,
    },
    opening: '-123456789',
    debits: LARGE,
    credits: '0',
    closing: LARGE,
    compare: null,
  }));
  const trialBalance: TrialBalance = {
    header: {
      ledger: 'book',
      currency: 'SYP',
      producedAt: '2026-12-31T21:00:00+03:00',
      latestEntry: { fiscalYear: 2026, number: 400 },
      current: { from: '2026-12-01', to: '2026-12-31', marks: ['period_open'], hasLines: true },
      compare: null,
    },
    rows,
    totals: {
      openingDebit: '0',
      openingCredit: '0',
      debits: LARGE,
      credits: LARGE,
      closingDebit: LARGE,
      closingCredit: LARGE,
      compareDebit: null,
      compareCredit: null,
    },
  };
  const html = renderReportHtml({
    company: 'شركة تجريبية',
    sheet: reportSheet(
      { report: 'trial_balance', data: trialBalance },
      {
        text: {
          reports: ar.reports,
          accounting: ar.accounting,
          openItems: ar.openItems,
          chart: ar.chart,
        },
        fiscalYearStartMonth: 1,
      },
    ),
    none: ar.reports.none,
    fontFaces,
  });
  const pdf = await printPdf(browser, html, { pageNumbers: ar.reports.pageOf });
  expect(pageCount(pdf)).toBeGreaterThan(5);
});
