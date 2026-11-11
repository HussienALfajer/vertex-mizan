import type { INestApplication } from '@nestjs/common';
import type { RevaluationPostResult, RevaluationPreview } from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { type Books, books, line, posted, today } from './books.js';
import { expectGuarded } from './guards.js';
import { testDatabase } from './people.js';

// S07's `/api/revaluation/:period` over HTTP ("API", "Acceptance" tests): the preview of each ledger
// with `periods.read` (owner, accountant, auditor), the posting with `revaluation.post` (owner,
// accountant), a double submit answered with the first result, the refusals of rules 16 and 17,
// another company's month read as an empty month of the caller's, and the hand reversal of a
// revaluation entry refused. Last month's dates come from the API's clock; every value is synthetic.

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

/** The month before today's in Damascus, and its first and last days. */
function lastMonth() {
  const [year, month] = today().split('-').map(Number) as [number, number];
  const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
  const period = `${y}-${String(m).padStart(2, '0')}`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { period, first: `${period}-01`, last: `${period}-${String(days).padStart(2, '0')}` };
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

/**
 * Last month: 1,000.00 USD paid into the USD bank on its first day at the bulletin of 120 and the
 * market of 125; the bulletin of its last day 125, so the book ledger gains 5,000.00 SYP.
 */
async function lastMonthBooks(): Promise<Books> {
  const book = await books(app, db);
  const { first, last } = lastMonth();
  await rate(book, first, '120.0000', 'bulletin');
  await rate(book, first, '125.0000', 'market');
  await rate(book, last, '125.0000', 'bulletin');
  await posted(book.owner.browser, {
    entryDate: first,
    description: 'رأس مال بالدولار',
    reference: null,
    dealtRates: [],
    lines: [line(book, '111004', 'USD', '100000'), line(book, '311001', 'USD', '-100000')],
  });
  return book;
}

describe('/api/revaluation/:period', () => {
  it('previews and posts the book ledger once, its reversal on the next day', async () => {
    const book = await lastMonthBooks();
    const { period, last } = lastMonth();
    const read = await book.owner.browser.get(`/api/revaluation/${period}`, { ledger: 'book' });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const preview = read.body as RevaluationPreview;
    expect(preview).toMatchObject({
      period,
      ledger: 'book',
      ledgerCurrency: 'SYP',
      lastDay: last,
      ended: true,
      state: 'to_post',
      gainMinor: '500000',
      lossMinor: '0',
      missingRates: [],
      posted: [],
    });
    expect(preview.closingRates).toMatchObject([
      { currency: 'USD', rateType: 'bulletin', rows: [{ effectiveOn: last }] },
    ]);
    expect(preview.balances).toMatchObject([
      {
        accountCode: '111004',
        item: null,
        blocked: false,
        currency: 'USD',
        transactionMinor: '100000',
        carryingMinor: '12000000',
        targetMinor: '12500000',
        revaluedMinor: '0',
        differenceMinor: '500000',
      },
    ]);
    // The parallel ledger is in USD, the balance's currency: nothing to revalue.
    const parallel = await book.owner.browser.get(`/api/revaluation/${period}`, {
      ledger: 'parallel',
    });
    expect(parallel.body).toMatchObject({ ledgerCurrency: 'USD', state: 'current', balances: [] });

    const accountant = await book.join('accountant');
    const first = await accountant.browser.post(`/api/revaluation/${period}`, {
      ledger: 'book',
      fingerprint: preview.fingerprint,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const result = first.body as RevaluationPostResult;
    expect(result).toMatchObject({
      posted: true,
      revaluation: {
        period,
        ledger: 'book',
        adjusting: false,
        fingerprint: preview.fingerprint,
        entry: { date: last },
        userId: accountant.person.id,
      },
    });
    // A double submit answers the first result.
    const again = await book.owner.browser.post(`/api/revaluation/${period}`, {
      ledger: 'book',
      fingerprint: preview.fingerprint,
    });
    expect(again.body).toEqual(result);
    const entry = await book.owner.browser.get(`/api/entries/${result.entryId}`);
    expect(entry.body).toMatchObject({
      source: 'revaluation',
      entryDate: last,
      description: `إعادة تقييم آخر الشهر ${period} — الدفتر الأساسي`,
    });
    const after = (await book.owner.browser.get(`/api/revaluation/${period}`)).body;
    expect(after).toMatchObject({ state: 'current', posted: [{ id: result.revaluation?.id }] });
    // Nothing more to post: the current preview answers posted: false.
    const nothing = await book.owner.browser.post(`/api/revaluation/${period}`, {
      ledger: 'book',
      fingerprint: (after as RevaluationPreview).fingerprint,
    });
    expect(nothing.body).toEqual({
      posted: false,
      revaluation: null,
      entryId: null,
      reversalEntryId: null,
    });
    // A revaluation is corrected only by an adjusting revaluation (S03 rule 9).
    const reversal = await book.owner.browser.post(`/api/entries/${result.entryId}/reverse`, {
      date: today(),
      description: 'عكس يدوي',
    });
    expect(reversal.body.code).toBe('ENTRY_NOT_REVERSIBLE');
    const audit = await book.owner.browser.get('/api/audit', { action: 'revaluation.posted' });
    expect(audit.status, JSON.stringify(audit.body)).toBe(200);
    expect(audit.body.entries).toMatchObject([
      { action: 'revaluation.posted', after: { period, ledger: 'book', adjusting: false } },
    ]);
  });

  it('refuses a month not ended and a preview that changed', async () => {
    const book = await lastMonthBooks();
    const month = today().slice(0, 7);
    const current = await book.owner.browser.get(`/api/revaluation/${month}`);
    expect(current.status).toBe(200);
    expect(current.body.ended).toBe(false);
    const early = await book.owner.browser.post(`/api/revaluation/${month}`, {
      ledger: 'book',
      fingerprint: current.body.fingerprint,
    });
    expect([early.status, early.body.code]).toEqual([409, 'PERIOD_NOT_ENDED']);
    const { period } = lastMonth();
    const preview = (await book.owner.browser.get(`/api/revaluation/${period}`))
      .body as RevaluationPreview;
    const changed = await book.owner.browser.post(`/api/revaluation/${period}`, {
      ledger: 'book',
      fingerprint: 'f'.repeat(64),
    });
    expect([changed.status, changed.body.code, changed.body.details]).toEqual([
      409,
      'REVALUATION_CHANGED',
      { fingerprint: preview.fingerprint },
    ]);
    const bad = await book.owner.browser.post(`/api/revaluation/${period}`, {
      ledger: 'book',
      fingerprint: 'not-a-fingerprint',
    });
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect((await book.owner.browser.get('/api/revaluation/2026-13')).body.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('reads and posts by role, and shows another company none of it', async () => {
    const book = await lastMonthBooks();
    const { period } = lastMonth();
    const path = `/api/revaluation/${period}`;
    const preview = (await book.owner.browser.get(path)).body as RevaluationPreview;
    for (const role of ['approver', 'viewer'] as const) {
      const member = await book.join(role);
      expect((await member.browser.get(path)).body.code, role).toBe('FORBIDDEN');
    }
    const auditor = await book.join('auditor');
    expect((await auditor.browser.get(path)).status).toBe(200);
    expect(
      (await auditor.browser.post(path, { ledger: 'book', fingerprint: preview.fingerprint })).body
        .code,
    ).toBe('FORBIDDEN');
    // Another company reads the month as its own, empty one.
    const other = await books(app, db);
    expect((await other.owner.browser.get(path)).body).toMatchObject({
      state: 'current',
      balances: [],
      posted: [],
    });
    const posting = await other.owner.browser.post(path, {
      ledger: 'book',
      fingerprint: preview.fingerprint,
    });
    expect(posting.body.code).toBe('REVALUATION_CHANGED');
    expect((await book.owner.browser.get(path)).body.state).toBe('to_post');
  });

  it('guards every route', async () => {
    const { period } = lastMonth();
    await expectGuarded(app, db, [
      { method: 'get', path: `/api/revaluation/${period}` },
      { method: 'post', path: `/api/revaluation/${period}` },
    ]);
  });
});
