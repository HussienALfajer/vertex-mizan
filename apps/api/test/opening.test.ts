import type { INestApplication } from '@nestjs/common';
import {
  type Company,
  eventExamplesV1,
  type OpeningEntryResult,
  type OpeningSnapshotResult,
  type OpeningViewAnswer,
  openingSnapshotExampleV1,
  openingSnapshotKeyV1,
  type RevenueSchedulePage,
} from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPENING_RETRY_AFTER_SECONDS } from '../src/core/errors/error.filter.js';
import { createTestApp } from './app.js';
import { type Books, books, draftOf, line } from './books.js';
import { expectGuarded } from './guards.js';
import { type HubClient, hubClient, v1 } from './hub.js';
import { reauthenticate, testDatabase } from './people.js';

// S10's opening over HTTP ("API", "Acceptance" tests): the books start in `PUT /api/company/ledgers`
// and its lock, `POST /v1/opening/snapshot` with its replay, conflict, validation and scope,
// `OPENING_NOT_POSTED` with `Retry-After` on `/v1/events` and on a manual post before the opening,
// `/api/opening`'s view with S10's worked example (its seven lines and checks), the save's version,
// the owner's post with the fingerprint and a fresh code, the whole reversal while the opening is
// the only entry, the opening's schedules on `/api/revenue`, another company and missing
// permissions. Every value is synthetic.

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

const snapshotOf = (hub: HubClient, body: object, key = openingSnapshotKeyV1(BOOKS_START)) =>
  v1(app, hub.key, hub.address).post('/v1/opening/snapshot', body, { 'idempotency-key': key });

describe('the books start (S10 rules 1–2)', () => {
  it('is set by the owner, answered on the company, locked by a snapshot, never cleared', async () => {
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
    // A snapshot locks it (rule 2).
    const back = await setBooksStart(book, BOOKS_START, false);
    expect(back.status).toBe(200);
    const hub = await hubClient(app, book.owner, {
      scopes: ['events:write', 'opening:write'],
      reconcileFrom: BOOKS_START,
    });
    expect((await snapshotOf(hub, openingSnapshotExampleV1(BOOKS_START))).status).toBe(201);
    const locked = await setBooksStart(book, '2026-11-01', false);
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('BOOKS_START_LOCKED');
  });
});

describe('POST /v1/opening/snapshot (S10 rules 5–9)', () => {
  it('stores once, answers a replay, refuses a conflict, a wrong eve and a missing scope', async () => {
    const book = await startedBooks();
    const hub = await hubClient(app, book.owner, {
      scopes: ['events:write', 'opening:write'],
      reconcileFrom: BOOKS_START,
    });
    const snapshot = openingSnapshotExampleV1(BOOKS_START);
    const stored = await snapshotOf(hub, snapshot);
    expect(stored.status, JSON.stringify(stored.body)).toBe(201);
    const result = stored.body as OpeningSnapshotResult;
    expect(result).toMatchObject({
      as_of: '2026-09-30',
      replayed: false,
      counts: { invoices: 1, credits: 0, milestones: 0, wallets: 1, prior_documents: 1 },
    });
    expect(result.totals).toEqual(
      expect.arrayContaining([
        { list: 'invoices', currency: 'USD', amount: 30_000 },
        { list: 'wallets', currency: 'USD', amount: 50_000 },
      ]),
    );
    const replay = await snapshotOf(hub, snapshot);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ snapshot_id: result.snapshot_id, replayed: true });
    const other = { ...snapshot, wallets: [{ ...snapshot.wallets[0], balance: 40_000 }] };
    const conflict = await snapshotOf(hub, other);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    const wrongEve = await snapshotOf(hub, { ...snapshot, as_of: '2026-09-29' }, 'eve-2');
    expect(wrongEve.status).toBe(422);
    expect(wrongEve.body.code).toBe('VALIDATION_FAILED');
    const invalid = await snapshotOf(
      hub,
      { ...snapshot, invoices: [{ ...snapshot.invoices[0], outstanding: 40_000 }] },
      'invalid',
    );
    expect(invalid.status).toBe(422);
    const noKey = await v1(app, hub.key, hub.address).post('/v1/opening/snapshot', snapshot);
    expect(noKey.body.code).toBe('VALIDATION_FAILED');
    expect((await v1(app, null, hub.address).post('/v1/opening/snapshot', snapshot)).status).toBe(
      401,
    );
    const eventsOnly = await hubClient(app, book.owner, {
      scopes: ['periods:read'],
    });
    expect((await snapshotOf(eventsOnly, snapshot, 'scope')).status).toBe(403);
  });

  it('refuses a company without a books start (NO_BOOKS_START), reading only its own', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner, { scopes: ['opening:write'] });
    const refused = await snapshotOf(hub, openingSnapshotExampleV1(BOOKS_START));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('NO_BOOKS_START');
    expect((await book.owner.browser.get('/api/opening')).body.code).toBe('NO_BOOKS_START');
  });

  it('takes a snapshot larger than the general body limit, up to 5 MB', async () => {
    const book = await startedBooks();
    const hub = await hubClient(app, book.owner, { scopes: ['opening:write'] });
    const snapshot = openingSnapshotExampleV1(BOOKS_START);
    const filler = Array.from({ length: 3000 }, (_, index) => ({
      invoice: {
        id: `01934b6e-0000-7000-8000-${String(500_000 + index).padStart(12, '0')}`,
        number: `OLD-${index}`,
      },
      issued_on: '2026-01-15',
    }));
    const large = {
      ...snapshot,
      prior_documents: {
        ...snapshot.prior_documents,
        invoices: [...snapshot.prior_documents.invoices, ...filler],
      },
    };
    expect(JSON.stringify(large).length).toBeGreaterThan(256 * 1024);
    const stored = await snapshotOf(hub, large, 'large');
    expect(stored.status, JSON.stringify(stored.body)).toBe(201);
    expect(stored.body.counts.prior_documents).toBe(3001);
  });
});

describe('before the opening posts (S10 rule 3)', () => {
  it('refuses Hub events and manual posts with OPENING_NOT_POSTED and Retry-After', async () => {
    const book = await startedBooks();
    const hub = await hubClient(app, book.owner, {
      scopes: ['events:write', 'opening:write'],
      reconcileFrom: BOOKS_START,
    });
    const [invoice] = eventExamplesV1('2026-10-20');
    if (!invoice) throw new Error('No example');
    const refused = await hub.send(invoice);
    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe('OPENING_NOT_POSTED');
    expect(refused.headers['retry-after']).toBe(String(OPENING_RETRY_AFTER_SECONDS));
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
  it("previews, saves and posts S10's worked example, then carries on", async () => {
    const book = await startedBooks();
    const hub = await hubClient(app, book.owner, {
      scopes: ['events:write', 'opening:write'],
      reconcileFrom: BOOKS_START,
    });
    expect((await snapshotOf(hub, openingSnapshotExampleV1(BOOKS_START))).status).toBe(201);
    const first = (await book.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    expect(first).toMatchObject({
      booksStart: BOOKS_START,
      asOf: '2026-09-30',
      hubClient: true,
      state: null,
      version: 0,
      lines: [],
    });
    expect(first.hubItems.map((item) => [item.slot, item.reference])).toEqual([
      ['receivable', 'INV-EX-0007'],
      ['ad_funds', 'C-EX'],
    ]);
    const failing = first.checks.filter((check) => !check.passed).map((check) => check.check);
    expect(failing).toEqual(expect.arrayContaining(['rates', 'records_agree']));
    const rates = first.checks.find((check) => check.check === 'rates');
    expect(rates?.failures.map((failure) => failure.on)).toEqual(
      expect.arrayContaining(['2026-09-10', '2026-09-30']),
    );

    await rate(book, '2026-09-10', '114.0000', 'bulletin');
    await rate(book, '2026-09-30', '115.0000', 'bulletin');
    await rate(book, '2026-09-30', '118.0000', 'market');
    const read = (await book.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    const clientValue = read.differences[0]?.client;
    if (clientValue === undefined) throw new Error('No difference to agree');
    const draft = {
      version: 0,
      lines: [
        recordLine(book, '111001', 'SYP', '200000000'),
        recordLine(book, '311001', 'SYP', '-100000000', { parallel: '-1000000' }),
        recordLine(book, '312002', 'SYP', '-30000000', { parallel: '-260000' }),
      ],
      recordFigures: [
        { slot: 'receivable', clientValueId: clientValue, currency: 'USD', amount: '30000' },
        { slot: 'ad_funds', clientValueId: clientValue, currency: 'USD', amount: '50000' },
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
      ['hub', '30000', '3450000', '30000'],
      ['hub', '-50000', '-5750000', '-50000'],
      ['schedule', '-15000', '-1710000', '-15000'],
      ['records', '200000000', '200000000', '1694915'],
      ['records', '-100000000', '-100000000', '-1000000'],
      ['records', '-30000000', '-30000000', '-260000'],
      ['balancing', '-65990000', '-65990000', '-399915'],
    ]);
    expect(view.schedules).toHaveLength(1);
    expect((await auditor.browser.get('/api/opening')).status).toBe(200);
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
    const late = await snapshotOf(hub, openingSnapshotExampleV1(BOOKS_START), 'late');
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('OPENING_POSTED');
    expect((await accountant.browser.put('/api/opening', { ...draft, version: 1 })).body.code).toBe(
      'OPENING_POSTED',
    );

    // The opening's schedule on `/api/revenue`, apart from the events' (additive).
    const schedules = (await book.owner.browser.get('/api/revenue/schedules'))
      .body as RevenueSchedulePage;
    expect(schedules.schedules).toEqual([]);
    expect(schedules.openingSchedules).toHaveLength(1);
    expect(schedules.openingSchedules[0]).toMatchObject({
      openingId: posted.body.openingId,
      invoiceNumber: 'INV-EX-0007',
      remaining: { transactionMinor: '15000', bookMinor: '1710000', parallelMinor: '15000' },
    });

    // Hub's events post from now on, and the opening is no longer the only entry.
    const [invoice] = eventExamplesV1('2026-10-20');
    if (!invoice) throw new Error('No example');
    const received = await hub.send(invoice);
    expect([201, 202]).toContain(received.status);
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
      recordFigures: [],
    };
    const saved = await book.owner.browser.put('/api/opening', draft);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const view = saved.body as OpeningViewAnswer;
    // No Hub client: no snapshot needed (rule 10).
    expect(view.hubClient).toBe(false);
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
    await mine.owner.browser.put('/api/opening', { version: 0, lines: [], recordFigures: [] });
    const theirs = await books(app, db);
    expect((await theirs.owner.browser.get('/api/opening')).body.code).toBe('NO_BOOKS_START');
    const other = await startedBooks();
    const read = (await other.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    expect(read.state).toBeNull();
    expect(read.version).toBe(0);
  });

  it('is guarded', async () => {
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/opening' },
      { method: 'put', path: '/api/opening' },
      { method: 'post', path: '/api/opening/post' },
      { method: 'post', path: '/api/opening/reverse' },
    ]);
  });
});
