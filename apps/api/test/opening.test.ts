import type { INestApplication } from '@nestjs/common';
import type { Company, OpeningEntryResult, OpeningViewAnswer } from '@vertex-mizan/contracts';
import { type Database, sessions } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { type Books, books, draftOf, line } from './books.js';
import { expectGuarded } from './guards.js';
import { reauthenticate, testDatabase } from './people.js';

// S10's opening over HTTP ("API", "Acceptance" tests): the books start in `PUT /api/company/ledgers`
// and its lock, `OPENING_NOT_POSTED` on a manual post before the opening, `/api/opening`'s view
// with the records' lines and their balancing line, the save's version, the owner's post with the
// fingerprint and a fresh code, the whole reversal while the opening is the only entry, another
// company and missing permissions. Hub's snapshot and events left with ADR 0021. Every value is
// synthetic.

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

const BOOKS_START = '2026-10-01';

/** A person's last fresh code six minutes ago, past the re-authentication window. */
const ageCode = (userId: string) =>
  db
    .update(sessions)
    .set({ reauthenticatedAt: new Date(Date.now() - 6 * 60 * 1000) })
    .where(eq(sessions.userId, userId));
const ledgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

/**
 * The owner sets the books start (S10 rule 1), with a fresh code unless `fresh` is false: one
 * code serves five minutes, and each new code waits for its own time step.
 */
async function setBooksStart(book: Books, booksStart: string | null, fresh = true) {
  if (fresh) await reauthenticate(book.owner.browser, book.owner.person);
  return book.owner.browser.put('/api/company/ledgers', {
    ledgers,
    fiscalYearStartMonth: 1,
    booksStart,
  });
}

async function rate(book: Books, effectiveOn: string, value: string, type: 'bulletin' | 'market') {
  const recorded = await book.owner.browser.post('/api/rates', {
    effectiveOn,
    base: 'USD',
    quote: 'SYP',
    rate: value,
    type,
    source: 'manual',
  });
  expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
}

/** A company of Vertex Media's shape with a books start on 2026-10-01. */
async function startedBooks(): Promise<Books> {
  const book = await books(app, db);
  const set = await setBooksStart(book, BOOKS_START);
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  return book;
}

/** A line of the records (rule 14): stated amounts when given. */
const recordLine = (
  book: Books,
  code: string,
  currency: 'SYP' | 'USD',
  amount: string,
  stated: { book?: string; parallel?: string } = {},
) => ({
  accountId: book.accounts.get(code),
  dimensionValueIds: [],
  currency,
  amount,
  book: stated.book ?? null,
  parallel: stated.parallel ?? null,
});

describe('the books start (S10 rules 1–2)', () => {
  it('is set by the owner, answered on the company, never cleared', async () => {
    const book = await books(app, db);
    const before = await book.owner.browser.get('/api/company');
    expect(before.body).toMatchObject({ booksStart: null, openingState: null });
    expect((await setBooksStart(book, '2026-10-02')).body.code).toBe('VALIDATION_FAILED');
    const set = await setBooksStart(book, BOOKS_START, false);
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body as Company).toMatchObject({ booksStart: BOOKS_START, openingState: null });
    const moved = await setBooksStart(book, '2026-11-01', false);
    expect(moved.status).toBe(200);
    // Omitted, it stays; cleared, it is refused.
    const kept = await book.owner.browser.put('/api/company/ledgers', {
      ledgers,
      fiscalYearStartMonth: 1,
    });
    expect(kept.body.booksStart).toBe('2026-11-01');
    expect((await setBooksStart(book, null, false)).body.code).toBe('BOOKS_START_LOCKED');
  });
});

describe('before the opening posts (S10 rule 3)', () => {
  it('refuses manual posts with OPENING_NOT_POSTED', async () => {
    const book = await startedBooks();
    const draft = await draftOf(book.owner.browser, {
      entryDate: '2026-10-20',
      description: 'قيد قبل الافتتاح',
      reference: null,
      dealtRates: [],
      lines: [line(book, '111004', 'USD', '10000'), line(book, '311001', 'USD', '-10000')],
    });
    const post = await book.owner.browser.post(`/api/drafts/${draft.id}/post`);
    expect(post.status).toBe(503);
    expect(post.body.code).toBe('OPENING_NOT_POSTED');
  });
});

describe('/api/opening (S10 rules 10–26)', () => {
  it('previews, saves and posts the records with their balancing line, then carries on', async () => {
    const book = await startedBooks();
    const first = (await book.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    expect(first).toMatchObject({
      booksStart: BOOKS_START,
      asOf: '2026-09-30',
      state: null,
      version: 0,
      lines: [],
    });

    await rate(book, '2026-09-30', '115.0000', 'bulletin');
    await rate(book, '2026-09-30', '118.0000', 'market');
    const draft = {
      version: 0,
      lines: [
        recordLine(book, '111001', 'SYP', '200000000'),
        recordLine(book, '311001', 'SYP', '-100000000', { parallel: '-1000000' }),
        recordLine(book, '312002', 'SYP', '-30000000', { parallel: '-260000' }),
      ],
    };
    // The accountant prepares; the auditor reads; neither posts.
    const accountant = await book.join('accountant');
    const auditor = await book.join('auditor');
    expect((await auditor.browser.put('/api/opening', draft)).status).toBe(403);
    const saved = await accountant.browser.put('/api/opening', draft);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const view = saved.body as OpeningViewAnswer;
    expect(view.state).toBe('draft');
    expect(view.version).toBe(1);
    expect(view.checks.filter((check) => !check.passed)).toEqual([]);
    expect(
      view.lines.map((entryLine) => [
        entryLine.source,
        entryLine.amountMinor,
        entryLine.bookMinor,
        entryLine.parallelMinor,
      ]),
    ).toEqual([
      ['records', '200000000', '200000000', '1694915'],
      ['records', '-100000000', '-100000000', '-1000000'],
      ['records', '-30000000', '-30000000', '-260000'],
      ['balancing', '-70000000', '-70000000', '-434915'],
    ]);
    expect((await auditor.browser.get('/api/opening')).status).toBe(200);
    // The Excel of the preview (S10 "Screens"), read by the auditor, audited.
    const preview = await auditor.browser.download('/api/opening/export', { part: 'preview' });
    expect(preview.status).toBe(200);
    expect(preview.headers['content-disposition']).toBe(
      `attachment; filename="opening-preview-${BOOKS_START}.xlsx"`,
    );
    const previewRows = await workbookRows(preview.body as Buffer);
    expect(previewRows[0]).toEqual(['تاريخ بدء الدفاتر', BOOKS_START]);
    const balancing = previewRows.find((row) => row[0] === 4);
    expect(balancing?.slice(2, 3)).toEqual(['312001']);
    expect(balancing?.slice(6, 10)).toEqual(['الليرة السورية الجديدة', -700000, -700000, -4349.15]);
    expect(
      (await accountant.browser.get('/api/opening/export', { part: 'agreement' })).body.code,
    ).toBe('VALIDATION_FAILED');
    const audit = await book.owner.browser.get('/api/audit', { action: 'export.opening' });
    expect(audit.status, JSON.stringify(audit.body)).toBe(200);
    expect(
      (audit.body.entries as { after: { part: string } }[]).map((entry) => entry.after.part).sort(),
    ).toEqual(['preview']);
    const stale = await accountant.browser.put('/api/opening', draft);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('OPENING_CHANGED');

    // The owner posts with the preview's fingerprint and a fresh code (rule 23).
    const byAccountant = await accountant.browser.post('/api/opening/post', {
      fingerprint: view.fingerprint,
    });
    expect(byAccountant.body.code).toBe('FORBIDDEN');
    await reauthenticate(book.owner.browser, book.owner.person);
    const changed = await book.owner.browser.post('/api/opening/post', {
      fingerprint: '0'.repeat(64),
    });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('OPENING_CHANGED');
    const posted = await book.owner.browser.post('/api/opening/post', {
      fingerprint: view.fingerprint,
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect((posted.body as OpeningEntryResult).entry).toMatchObject({
      date: BOOKS_START,
      fiscalYear: 2026,
      number: 1,
    });
    const again = await book.owner.browser.post('/api/opening/post', {
      fingerprint: view.fingerprint,
    });
    expect(again.body.code).toBe('OPENING_POSTED');
    const after = (await book.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    expect(after.state).toBe('posted');
    expect(after.posted?.entry.number).toBe(1);
    expect((await book.owner.browser.get('/api/company')).body.openingState).toBe('posted');
    // The reports from the books start read the opening entry as their opening (S10 rules 32–33).
    const trial = await book.owner.browser.get('/api/reports/trial-balance', {
      from: '2026-09-01',
      to: '2026-10-31',
      compare: 'false',
    });
    expect(trial.status, JSON.stringify(trial.body)).toBe(200);
    expect(trial.body.header.booksStart).toBe(BOOKS_START);
    expect(trial.body.header.current.marks).toEqual(
      expect.arrayContaining(['opening_entry', 'before_books_start']),
    );
    expect(trial.body.totals).toMatchObject({ debits: '0', credits: '0' });
    expect(trial.body.totals.openingDebit).toBe(trial.body.totals.openingCredit);
    const cashRow = trial.body.rows.find(
      (row: { opening: string }) => row.opening !== '0' && BigInt(row.opening) > 0n,
    );
    const opened = await book.owner.browser.get('/api/reports/lines', {
      to: '2026-10-31',
      account: cashRow.account.id,
      openingEntry: 'true',
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(opened.body.sum).toBe(cashRow.opening);
    const income = await book.owner.browser.get('/api/reports/income-statement', {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(income.body.header.current.marks).toContain('pre_opening_result_in_equity');
    expect((await accountant.browser.put('/api/opening', { ...draft, version: 1 })).body.code).toBe(
      'OPENING_POSTED',
    );

    // Manual entries post from now on, and the opening is no longer the only entry.
    const manual = await draftOf(book.owner.browser, {
      entryDate: '2026-10-20',
      description: 'قيد بعد الافتتاح',
      reference: null,
      dealtRates: [],
      lines: [line(book, '111004', 'USD', '10000'), line(book, '311001', 'USD', '-10000')],
    });
    await rate(book, '2026-10-20', '118.0000', 'bulletin');
    await rate(book, '2026-10-20', '119.0000', 'market');
    expect((await book.owner.browser.post(`/api/drafts/${manual.id}/post`)).status).toBe(200);
    await reauthenticate(book.owner.browser, book.owner.person);
    const reverse = await book.owner.browser.post('/api/opening/reverse', { reason: 'خطأ' });
    expect(reverse.status).toBe(409);
    expect(reverse.body.code).toBe('OPENING_NOT_REVERSIBLE');
  });

  it('reverses the opening while it is the only entry, and a new draft starts from it', async () => {
    const book = await startedBooks();
    await rate(book, '2026-09-30', '115.0000', 'bulletin');
    await rate(book, '2026-09-30', '118.0000', 'market');
    const draft = {
      version: 0,
      lines: [
        recordLine(book, '111001', 'SYP', '200000000'),
        recordLine(book, '311001', 'SYP', '-100000000', { parallel: '-1000000' }),
      ],
    };
    const saved = await book.owner.browser.put('/api/opening', draft);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const view = saved.body as OpeningViewAnswer;
    expect(view.checks.every((check) => check.passed)).toBe(true);
    await reauthenticate(book.owner.browser, book.owner.person);
    const posted = await book.owner.browser.post('/api/opening/post', {
      fingerprint: view.fingerprint,
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect((await book.owner.browser.post('/api/opening/reverse', { reason: '' })).body.code).toBe(
      'VALIDATION_FAILED',
    );
    const reversed = await book.owner.browser.post('/api/opening/reverse', {
      reason: 'أرصدة السجلات صُحّحت',
    });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect((reversed.body as OpeningEntryResult).entry).toMatchObject({
      date: BOOKS_START,
      number: 2,
    });
    const after = (await book.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    expect(after.state).toBeNull();
    expect(after.version).toBe(0);
    expect(after.reversed).toMatchObject({
      entry: { number: 1 },
      reversalEntry: { number: 2 },
      reason: 'أرصدة السجلات صُحّحت',
    });
    expect(after.recordLines).toHaveLength(2);
    expect((await book.owner.browser.get('/api/company')).body.openingState).toBe('reversed');
    // Rule 3 applies again.
    const manual = await draftOf(book.owner.browser, {
      entryDate: '2026-10-20',
      description: 'قيد بعد العكس',
      reference: null,
      dealtRates: [],
      lines: [line(book, '111004', 'USD', '10000'), line(book, '311001', 'USD', '-10000')],
    });
    expect((await book.owner.browser.post(`/api/drafts/${manual.id}/post`)).body.code).toBe(
      'OPENING_NOT_POSTED',
    );
  });

  it("reads another company's opening as nothing of the caller's", async () => {
    const mine = await startedBooks();
    await rate(mine, '2026-09-30', '115.0000', 'bulletin');
    await rate(mine, '2026-09-30', '118.0000', 'market');
    const saved = await mine.owner.browser.put('/api/opening', {
      version: 0,
      lines: [recordLine(mine, '111001', 'SYP', '123456700')],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const theirs = await books(app, db);
    expect((await theirs.owner.browser.get('/api/opening')).body.code).toBe('NO_BOOKS_START');
    const other = await startedBooks();
    const read = (await other.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    expect(read.state).toBeNull();
    expect(read.version).toBe(0);
    expect(read.recordLines).toEqual([]);
    expect(read.lines).toEqual([]);
    // The preview's workbook holds the caller's lines only: mine shows its amount, theirs none.
    const amountIn = (rows: unknown[][]) => rows.some((row) => row.includes(1234567));
    const mineRows = await workbookRows(
      (await mine.owner.browser.download('/api/opening/export', { part: 'preview' }))
        .body as Buffer,
    );
    expect(amountIn(mineRows)).toBe(true);
    const otherRows = await workbookRows(
      (await other.owner.browser.download('/api/opening/export', { part: 'preview' }))
        .body as Buffer,
    );
    expect(amountIn(otherRows)).toBe(false);
    expect(otherRows.length).toBeLessThan(mineRows.length);
  });

  it('needs opening.read, opening.prepare and opening.post, and a fresh code to post or reverse', async () => {
    const book = await startedBooks();
    for (const role of ['viewer', 'approver'] as const) {
      const member = await book.join(role);
      expect((await member.browser.get('/api/opening')).body.code, role).toBe('FORBIDDEN');
      expect(
        (await member.browser.get('/api/opening/export', { part: 'preview' })).body.code,
        role,
      ).toBe('FORBIDDEN');
    }
    const accountant = await book.join('accountant');
    expect((await accountant.browser.get('/api/opening')).status).toBe(200);
    expect(
      (await accountant.browser.post('/api/opening/reverse', { reason: 'سبب' })).body.code,
    ).toBe('FORBIDDEN');
    // The owner's code from the books start is six minutes old.
    await ageCode(book.owner.person.id);
    const view = (await book.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    for (const [path, body] of [
      ['/api/opening/post', { fingerprint: view.fingerprint }],
      ['/api/opening/reverse', { reason: 'سبب' }],
    ] as const) {
      const refused = await book.owner.browser.post(path, body);
      expect(refused.body.code, path).toBe('REAUTHENTICATION_REQUIRED');
    }
  });

  it('is guarded', async () => {
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/opening' },
      { method: 'put', path: '/api/opening' },
      { method: 'post', path: '/api/opening/post' },
      { method: 'post', path: '/api/opening/reverse' },
      { method: 'get', path: '/api/opening/export?part=preview' },
    ]);
  });
});

/** A workbook's first sheet as arrays of cell values, from row 1. */
async function workbookRows(body: Buffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as never);
  const rows: unknown[][] = [];
  workbook.worksheets[0]?.eachRow({ includeEmpty: true }, (row) => {
    rows.push((row.values as unknown[]).slice(1));
  });
  return rows;
}
