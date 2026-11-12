import type { INestApplication } from '@nestjs/common';
import type { AuditEntry, JournalBookPrint, ReportFile } from '@vertex-mizan/contracts';
import {
  type Database,
  journalBookPrints,
  periods,
  reportFiles,
  withCompany,
  writePeriodTransition,
} from '@vertex-mizan/db';
import { closeMonthByHand } from '@vertex-mizan/db/testing';
import { eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileStore } from '../src/core/files/file-store.js';
import { createTestApp } from './app.js';
import { type Books, books, line, posted, today } from './books.js';
import { expectGuarded } from './guards.js';
import { testDatabase } from './people.js';

// S09's exports and files over HTTP (rules 28–30, 35–37, "API" and "Acceptance" tests): a report
// to Excel with its figures, marks and audit row; a PDF queued and audited, three at most per
// person; the official print's refusals; a file seen and downloaded by its requester only, an
// official print by every reader; the register with `superseded` after a reopen; another
// company's files `NOT_FOUND`. Entries are dated today; every value is synthetic.

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  app = await createTestApp();
  db = testDatabase();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

/** Capital of 1,000,000.00 SYP and rent of 150,000.00 SYP paid today. */
async function booksWithEntries(): Promise<Books> {
  const book = await books(app, db);
  await posted(book.owner.browser, {
    entryDate: today(),
    description: 'رأس المال',
    reference: null,
    dealtRates: [],
    lines: [line(book, '111003', 'SYP', '100000000'), line(book, '311001', 'SYP', '-100000000')],
  });
  await posted(book.owner.browser, {
    entryDate: today(),
    description: 'إيجار',
    reference: null,
    dealtRates: [],
    lines: [line(book, '531001', 'SYP', '15000000'), line(book, '111003', 'SYP', '-15000000')],
  });
  return book;
}

const month = () => ({ from: `${today().slice(0, 7)}-01`, to: today() });
const thisMonth = () => today().slice(0, 7);
const fiscalYear = () => Number(today().slice(0, 4));

async function workbookRows(body: Buffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  const rows: unknown[][] = [];
  workbook.worksheets[0]?.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1));
  });
  return rows;
}

const auditActions = async (book: Books) =>
  ((await book.owner.browser.get('/api/audit')).body.entries as AuditEntry[]).map(
    (entry) => entry.action,
  );

describe('GET /api/reports/:report/export (rule 35)', () => {
  it('writes the trial balance to Excel with its header, marks and exact amounts, audited', async () => {
    const book = await booksWithEntries();
    const { from, to } = month();
    const viewer = await book.join('viewer');
    const answer = await viewer.browser.download('/api/reports/trial_balance/export', {
      format: 'xlsx',
      from,
      to,
    });
    expect(answer.status, String(answer.body)).toBe(200);
    expect(answer.headers['content-type']).toContain('spreadsheetml');
    const rows = await workbookRows(answer.body as Buffer);
    expect(rows[1]).toEqual(['ميزان المراجعة']);
    expect(rows.flat()).toContain('غير نهائية: الفترة مفتوحة');
    const cash = rows.find((row) => row[0] === '111003');
    // Closing debit of 850,000.00 SYP, a number in major units; the currency in its own column.
    expect(cash).toContain(850000);
    expect(cash?.at(-1)).toBe('الليرة السورية الجديدة');
    expect(await auditActions(book)).toContain('export.trial_balance');
  });

  it('exports the journal, the statement of an account and every other report', async () => {
    const book = await booksWithEntries();
    const { from, to } = month();
    const browser = book.owner.browser;
    const cash = book.accounts.get('111003') as string;
    for (const [report, query] of [
      ['general_ledger', { from, to }],
      ['account_statement', { from, to, account: cash }],
      ['journal_book', { from, to }],
      ['income_statement', { from, to }],
      ['balance_sheet', { asOf: to }],
      ['profitability', { by: 'client', from, to }],
      ['contract_position', { asOf: to }],
      ['revenue_schedule', { from: to.slice(0, 7) }],
    ] as const) {
      const answer = await browser.download(`/api/reports/${report}/export`, {
        format: 'xlsx',
        ...query,
      });
      expect(answer.status, `${report} ${String(answer.body)}`).toBe(200);
    }
    const journal = await browser.download('/api/reports/journal_book/export', {
      format: 'xlsx',
      from,
      to,
    });
    expect((await workbookRows(journal.body as Buffer)).flat()).toContain('إيجار');
  });

  it('refuses a bad query, an unknown report and another company’s account', async () => {
    const book = await booksWithEntries();
    const other = await books(app, db);
    const { from, to } = month();
    const browser = other.owner.browser;
    expect((await browser.get('/api/reports/trial_balance/export', { from, to })).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await browser.get('/api/reports/ageing/export', { format: 'xlsx' })).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await browser.get('/api/reports/trial_balance/export', { format: 'xlsx', from })).body.code,
    ).toBe('VALIDATION_FAILED');
    const cash = book.accounts.get('111003') as string;
    expect(
      (
        await browser.get('/api/reports/account_statement/export', {
          format: 'xlsx',
          from,
          to,
          account: cash,
        })
      ).body.code,
    ).toBe('NOT_FOUND');
  });
});

describe('/api/reports/files (rule 36)', () => {
  const request = (book: Books, body: object) =>
    book.owner.browser.post('/api/reports/files', body);

  it('queues a PDF with its validated parameters, three at most per person, audited', async () => {
    const book = await booksWithEntries();
    const { from, to } = month();
    const first = await request(book, { report: 'trial_balance', params: { from, to } });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      report: 'trial_balance',
      format: 'pdf',
      official: false,
      state: 'queued',
      params: { from, to, ledger: 'book', level: 4, nonZero: true, compare: true },
    });
    for (const report of ['chart', 'ageing'] as const) {
      expect((await request(book, { report, params: {} })).status).toBe(201);
    }
    const fourth = await request(book, { report: 'chart', params: {} });
    expect(fourth.status).toBe(429);
    expect(fourth.body).toMatchObject({ code: 'RATE_LIMITED', details: { limit: '3' } });
    // Another person's limit is their own.
    const accountant = await book.join('accountant');
    const theirs = await accountant.browser.post('/api/reports/files', {
      report: 'chart',
      params: {},
    });
    expect(theirs.status).toBe(201);
    const actions = await auditActions(book);
    expect(actions).toContain('export.trial_balance');
    expect(actions).toContain('export.chart');
    expect(actions).toContain('export.ageing');

    const listed = (await book.owner.browser.get('/api/reports/files')).body as ReportFile[];
    expect(listed.map((file) => file.report)).toEqual(['ageing', 'chart', 'trial_balance']);
    expect((await book.owner.browser.get(`/api/reports/files/${theirs.body.id}`)).body.code).toBe(
      'NOT_FOUND',
    );
  });

  it('refuses bad parameters and an official print other than of closed months', async () => {
    const book = await booksWithEntries();
    const { from } = month();
    expect((await request(book, { report: 'trial_balance', params: { from } })).body).toMatchObject(
      { code: 'VALIDATION_FAILED' },
    );
    expect(
      (await request(book, { report: 'trial_balance', params: {}, official: true })).body.code,
    ).toBe('VALIDATION_FAILED');
    const range = { fiscalYear: fiscalYear(), from: thisMonth(), to: thisMonth() };
    const open = await request(book, { report: 'journal_book', params: range, official: true });
    expect(open.body).toMatchObject({
      code: 'PERIOD_NOT_CLOSED',
      details: { period: thisMonth() },
    });
    expect(
      (
        await request(book, {
          report: 'journal_book',
          params: { ...range, ledger: 'parallel' },
          official: true,
        })
      ).body.code,
    ).toBe('VALIDATION_FAILED');
    // A draft of the open month, and of the parallel ledger, queue (rule 30).
    for (const params of [range, { ...range, ledger: 'parallel' }]) {
      expect((await request(book, { report: 'journal_book', params })).status).toBe(201);
    }
  });

  it('downloads a ready file for its requester within its time, audited, then LINK_INVALID', async () => {
    const book = await booksWithEntries();
    const { from, to } = month();
    const queued = (await request(book, { report: 'trial_balance', params: { from, to } }))
      .body as ReportFile;
    const browser = book.owner.browser;
    expect((await browser.get(`/api/reports/files/${queued.id}/download`)).body.code).toBe(
      'NOT_FOUND',
    );
    const pdf = Buffer.from('%PDF-1.7 synthetic');
    await app.get(FileStore).write(book.companyId, queued.id, pdf);
    const ready = (expiresAt: Date) =>
      withCompany(db, book.companyId, (tx) =>
        tx
          .update(reportFiles)
          .set({
            state: 'ready',
            storageKey: `${book.companyId}/${queued.id}`,
            sizeBytes: pdf.length,
            sha256: 'a'.repeat(64),
            readyAt: new Date(),
            expiresAt,
          })
          .where(eq(reportFiles.id, queued.id)),
      );
    await ready(new Date(Date.now() + 3600_000));
    const answer = await browser.download(`/api/reports/files/${queued.id}/download`);
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('application/pdf');
    expect((answer.body as Buffer).equals(pdf)).toBe(true);
    expect(await auditActions(book)).toContain('report_file.downloaded');
    const viewer = await book.join('viewer');
    expect((await viewer.browser.get(`/api/reports/files/${queued.id}/download`)).body.code).toBe(
      'NOT_FOUND',
    );

    const late = (await request(book, { report: 'chart', params: {} })).body as ReportFile;
    await app.get(FileStore).write(book.companyId, late.id, pdf);
    await withCompany(db, book.companyId, (tx) =>
      tx
        .update(reportFiles)
        .set({
          state: 'ready',
          storageKey: `${book.companyId}/${late.id}`,
          sizeBytes: pdf.length,
          sha256: 'a'.repeat(64),
          readyAt: new Date(Date.now() - 2000),
          expiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(reportFiles.id, late.id)),
    );
    expect((await browser.get(`/api/reports/files/${late.id}/download`)).body.code).toBe(
      'LINK_INVALID',
    );
  });

  it('shows another company none of the caller’s files', async () => {
    const book = await booksWithEntries();
    const other = await books(app, db);
    const file = (await request(book, { report: 'chart', params: {} })).body as ReportFile;
    expect((await other.owner.browser.get(`/api/reports/files/${file.id}`)).body.code).toBe(
      'NOT_FOUND',
    );
    expect((await other.owner.browser.get('/api/reports/files')).body).toEqual([]);
  });
});

describe('the journal book’s register (rules 28, 29)', () => {
  it('lists an official print to every reader, superseded once its month is reopened', async () => {
    const book = await booksWithEntries();
    const range = { fiscalYear: fiscalYear(), from: thisMonth(), to: thisMonth() };
    await closeMonthByHand(db, book.companyId, thisMonth());
    const file = (
      await book.owner.browser.post('/api/reports/files', {
        report: 'journal_book',
        params: range,
        official: true,
      })
    ).body as ReportFile;
    expect(file).toMatchObject({ official: true, state: 'queued' });
    // What the worker writes in one transaction: the file ready and its register row.
    const pdf = Buffer.from('%PDF-1.7 official');
    await app.get(FileStore).write(book.companyId, file.id, pdf);
    await withCompany(db, book.companyId, async (tx) => {
      const [period] = await tx
        .select({ id: periods.id })
        .from(periods)
        .where(eq(periods.period, thisMonth()));
      await tx.insert(journalBookPrints).values({
        companyId: book.companyId,
        reportFileId: file.id,
        fiscalYear: range.fiscalYear,
        fromPeriodId: period?.id as string,
        toPeriodId: period?.id as string,
        firstPage: 1,
        lastPage: 1,
        entryCount: 2,
        lineCount: 4,
        debitTotalMinor: 115_000_000n,
        creditTotalMinor: 115_000_000n,
        contentSha256: 'c'.repeat(64),
        fileSha256: 'd'.repeat(64),
        printedByUserId: book.owner.person.id,
      });
      await tx
        .update(reportFiles)
        .set({
          state: 'ready',
          storageKey: `${book.companyId}/${file.id}`,
          sizeBytes: pdf.length,
          sha256: 'd'.repeat(64),
          readyAt: new Date(),
        })
        .where(eq(reportFiles.id, file.id));
    });
    const viewer = await book.join('viewer');
    const register = (
      await viewer.browser.get('/api/reports/journal-book/prints', {
        fiscalYear: String(range.fiscalYear),
      })
    ).body as JournalBookPrint[];
    expect(register).toEqual([
      expect.objectContaining({
        from: thisMonth(),
        to: thisMonth(),
        firstPage: 1,
        debitTotal: '115000000',
        currency: 'SYP',
        superseded: false,
        printedBy: expect.objectContaining({ id: book.owner.person.id }),
      }),
    ]);
    // An official print is the register's: every reader downloads it, at any time.
    const download = await viewer.browser.download(`/api/reports/files/${file.id}/download`);
    expect(download.status).toBe(200);
    expect(file.expiresAt).toBeNull();

    await withCompany(db, book.companyId, (tx) =>
      writePeriodTransition(tx, {
        companyId: book.companyId,
        period: thisMonth(),
        kind: 'reopened',
        reason: 'إعادة فتح تجريبية',
        userId: book.owner.person.id,
        checklist: null,
      }),
    );
    const after = (
      await viewer.browser.get('/api/reports/journal-book/prints', {
        fiscalYear: String(range.fiscalYear),
      })
    ).body as JournalBookPrint[];
    expect(after[0]).toMatchObject({ superseded: true, supersededAt: expect.any(String) });
    expect(
      (
        await withCompany(db, book.companyId, (tx) =>
          tx.execute(sql`select count(*)::int as n from journal_book_prints`),
        )
      ).rows[0],
    ).toEqual({ n: 1 });
  });
});

describe('the files’ routes', () => {
  it('asks a session and the company of the session for a PDF, which every role and an archived company may ask', async () => {
    const book = await booksWithEntries();
    const stranger = await books(app, db);
    expect(
      (
        await stranger.owner.browser.post(
          '/api/reports/files',
          { report: 'chart' },
          {
            'x-mizan-company': book.companyId,
          },
        )
      ).body.code,
    ).toBe('COMPANY_SWITCHED');
    const viewer = await book.join('viewer');
    expect((await viewer.browser.post('/api/reports/files', { report: 'chart' })).status).toBe(201);
    await db.$client.query(
      "update companies set archived_at = now(), archived_reason = 'شركة اختبار مؤرشفة' where id = $1",
      [book.companyId],
    );
    expect((await book.owner.browser.post('/api/reports/files', { report: 'chart' })).status).toBe(
      201,
    );
  });

  it('guards every one', async () => {
    const id = '01934b6e-0000-7000-8000-000000000001';
    const { from, to } = month();
    await expectGuarded(app, db, [
      {
        method: 'get',
        path: '/api/reports/trial_balance/export',
        query: { format: 'xlsx', from, to },
      },
      { method: 'get', path: '/api/reports/files' },
      { method: 'get', path: `/api/reports/files/${id}` },
      { method: 'get', path: `/api/reports/files/${id}/download` },
      {
        method: 'get',
        path: '/api/reports/journal-book/prints',
        query: { fiscalYear: String(fiscalYear()) },
      },
    ]);
  });
});
