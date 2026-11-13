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
import { type Database, sessions } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPENING_RETRY_AFTER_SECONDS } from '../src/core/errors/error.filter.js';
import { createTestApp } from './app.js';
import { type Books, books, draftOf, line, posted } from './books.js';
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
    // Over 5 MB: refused as S10 rule 6 says, nothing stored.
    const oversized = { ...snapshot, padding: 'x'.repeat(5 * 1024 * 1024) };
    const refused = await snapshotOf(hub, oversized, 'oversized');
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('VALIDATION_FAILED');
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

describe('documents before the books start (S10 rule 28)', () => {
  /** A held event's reason and detail, from `/v1/events`' answer. */
  const heldAs = (body: { status: string; reason?: string; detail?: string | null }) =>
    body.status === 'held' ? `${body.reason}:${body.detail ?? ''}` : body.status;

  it('holds every void, change, archive and reopen of a listed document, and clears its schedule by hand', async () => {
    const book = await startedBooks();
    const hub = await hubClient(app, book.owner, {
      scopes: ['events:write', 'opening:write'],
      reconcileFrom: BOOKS_START,
    });
    const examples = eventExamplesV1('2026-10-05');
    const example = (type: string) => {
      const found = examples.find((event) => event.type === type);
      if (!found) throw new Error(`No example of ${type}`);
      return found;
    };
    const fresh = (type: string, payload: Record<string, unknown> = {}) => ({
      ...example(type),
      id: uuidv7(),
      payload: { ...example(type).payload, ...payload },
    });
    const otherClient = { external_id: uuidv7(), code: 'C-EX2', name: 'عميل مثال آخر' };
    const secondUpdate = { id: uuidv7(), number: 'U-EX-0002' };
    const secondExpense = { id: uuidv7(), number: 'EXP-EX-0002' };
    const pick = <T>(type: string, field: string) => example(type).payload[field] as T;
    const payment = pick<{ id: string; number: string }>('payment.voided', 'payment');
    const paidInvoice = pick<{ id: string; number: string }>('payment.voided', 'invoice');
    const refund = pick<{ id: string; number: string }>('ad_wallet.entry_voided', 'entry');
    const client = pick<{ external_id: string }>('ad_wallet.entry_voided', 'client');
    const update = pick<{ id: string; number: string }>('ad_spend.changed', 'update');
    const campaign = pick<{ id: string; number: string }>('ad_spend.changed', 'campaign');
    const expense = pick<{ id: string; number: string }>('project_expense.changed', 'expense');
    const milestone = pick<{ id: string; number: string }>('milestone.reopened', 'milestone');
    const base = openingSnapshotExampleV1(BOOKS_START);
    const snapshot = {
      ...base,
      prior_documents: {
        ...base.prior_documents,
        invoices: [
          ...base.prior_documents.invoices,
          { invoice: paidInvoice, issued_on: '2026-09-05' },
        ],
        payments: [{ payment, invoice: paidInvoice, paid_on: '2026-09-12' }],
        wallet_entries: [{ entry: refund, client, entered_on: '2026-09-14' }],
        spend_updates: [
          { update, campaign, client, period_to: '2026-09-30' },
          { update: secondUpdate, campaign, client: otherClient, period_to: '2026-09-30' },
        ],
        project_expenses: [
          { expense, spent_on: '2026-09-18' },
          { expense: secondExpense, spent_on: '2026-09-19' },
        ],
        milestone_dones: [{ milestone, done_on: '2026-09-25' }],
      },
    };
    expect((await snapshotOf(hub, snapshot)).status).toBe(201);
    await rate(book, '2026-09-10', '114.0000', 'bulletin');
    await rate(book, '2026-09-30', '115.0000', 'bulletin');
    await rate(book, '2026-09-30', '118.0000', 'market');
    const read = (await book.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    const clientValue = read.differences[0]?.client;
    if (clientValue === undefined) throw new Error('No difference to agree');
    const saved = await book.owner.browser.put('/api/opening', {
      version: 0,
      lines: [
        recordLine(book, '111001', 'SYP', '200000000'),
        recordLine(book, '311001', 'SYP', '-100000000', { parallel: '-1000000' }),
      ],
      recordFigures: [
        { slot: 'receivable', clientValueId: clientValue, currency: 'USD', amount: '30000' },
        { slot: 'ad_funds', clientValueId: clientValue, currency: 'USD', amount: '50000' },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    await reauthenticate(book.owner.browser, book.owner.person);
    const opening = await book.owner.browser.post('/api/opening/post', {
      fingerprint: (saved.body as OpeningViewAnswer).fingerprint,
    });
    expect(opening.status, JSON.stringify(opening.body)).toBe(200);

    // Each type of rule 28 on a listed document; events of one item wait behind the first held.
    const [openingInvoice] = base.invoices;
    if (!openingInvoice) throw new Error('No opening invoice');
    const sent: [string, object][] = [
      ['invoice.voided', fresh('invoice.voided', { invoice: openingInvoice.invoice })],
      ['payment.voided', fresh('payment.voided')],
      ['ad_wallet.entry_voided', fresh('ad_wallet.entry_voided')],
      ['ad_spend.changed', fresh('ad_spend.changed')],
      [
        'ad_spend.archived',
        fresh('ad_spend.archived', { update: secondUpdate, client: otherClient }),
      ],
      ['project_expense.changed', fresh('project_expense.changed')],
      ['project_expense.archived', fresh('project_expense.archived', { expense: secondExpense })],
      ['milestone.reopened', fresh('milestone.reopened')],
      ['second payment.voided', fresh('payment.voided')],
      [
        'unlisted payment.voided',
        fresh('payment.voided', {
          payment: { id: uuidv7(), number: 'R-EX-0099' },
          invoice: { id: uuidv7(), number: 'INV-EX-0099' },
        }),
      ],
    ];
    const answers = new Map<string, { inbox_id: string; outcome: string }>();
    for (const [name, envelope] of sent) {
      const answer = await hub.send(envelope as { id: string });
      expect(answer.status, JSON.stringify(answer.body)).toBe(202);
      answers.set(name, { inbox_id: answer.body.inbox_id, outcome: heldAs(answer.body) });
    }
    const outcomes = Object.fromEntries([...answers].map(([name, { outcome }]) => [name, outcome]));
    expect(outcomes).toEqual({
      'invoice.voided': 'NEEDS_DECISION:before_books_start',
      'payment.voided': 'NEEDS_DECISION:before_books_start',
      'ad_wallet.entry_voided': 'NEEDS_DECISION:before_books_start',
      'ad_spend.changed': 'WAITING_FOR_EARLIER_EVENT:',
      'ad_spend.archived': 'NEEDS_DECISION:before_books_start',
      'project_expense.changed': 'NEEDS_DECISION:before_books_start',
      'project_expense.archived': 'NEEDS_DECISION:before_books_start',
      'milestone.reopened': 'NEEDS_DECISION:before_books_start',
      'second payment.voided': 'WAITING_FOR_EARLIER_EVENT:',
      'unlisted payment.voided': expect.not.stringContaining('before_books_start'),
    });
    const idOf = (name: string) => answers.get(name)?.inbox_id as string;
    // A retry leaves a listed document's event held; the one behind it is held in its turn.
    const retried = await book.owner.browser.post(`/api/inbox/${idOf('payment.voided')}/retry`);
    expect(retried.body).toMatchObject({ reason: 'NEEDS_DECISION', detail: 'before_books_start' });
    const dismissed = await book.owner.browser.post(
      `/api/inbox/${idOf('ad_wallet.entry_voided')}/dismiss`,
      { reason: 'أعادها المصرف قبل بدء الدفاتر' },
    );
    expect(dismissed.status, JSON.stringify(dismissed.body)).toBe(200);
    const behind = await book.owner.browser.post(`/api/inbox/${idOf('ad_spend.changed')}/retry`);
    expect(behind.body).toMatchObject({ reason: 'NEEDS_DECISION', detail: 'before_books_start' });

    // The invoice's void resolved by hand: its receivable cleared, its schedule named and cleared at
    // what it carries, the correction against retained earnings (IAS 8.42).
    await rate(book, '2026-10-08', '117.0000', 'bulletin');
    await rate(book, '2026-10-08', '119.0000', 'market');
    const schedules = (await book.owner.browser.get('/api/revenue/schedules'))
      .body as RevenueSchedulePage;
    const schedule = schedules.openingSchedules[0];
    if (!schedule) throw new Error('No opening schedule');
    const items = await book.owner.browser.get('/api/open-items', {
      state: 'all',
      text: openingInvoice.invoice.number,
    });
    const item = items.body.items[0] as { id: string };
    const correction = (scheduleAmount: string, extra: object[] = []) => ({
      entryDate: '2026-10-08',
      description: 'إلغاء فاتورة سابقة لبدء الدفاتر',
      reference: openingInvoice.invoice.number,
      dealtRates: [],
      lines: [
        {
          ...line(book, '112001', 'USD', '-30000', 'إلغاء الفاتورة'),
          openItemId: item.id,
        },
        {
          ...line(book, '212001', 'USD', scheduleAmount, 'إقفال جدول الفاتورة'),
          scheduleId: schedule.id,
        },
        line(book, '312001', 'USD', String(30000 - Number(scheduleAmount))),
        ...extra,
      ],
    });
    const otherAmount = await draftOf(book.owner.browser, correction('10000'));
    const refusedAmount = await book.owner.browser.post(`/api/drafts/${otherAmount.id}/post`);
    expect(refusedAmount.body.code, JSON.stringify(refusedAmount.body)).toBe('VALIDATION_FAILED');
    // Beside a newly measured line, the correction is refused: it posts on its own.
    const measured = await draftOf(book.owner.browser, {
      ...correction('15000'),
      lines: [
        ...correction('15000').lines.slice(0, 2),
        line(book, '312001', 'USD', '15100'),
        line(book, '111004', 'USD', '-100'),
      ],
    });
    const refusedMeasured = await book.owner.browser.post(`/api/drafts/${measured.id}/post`);
    expect(refusedMeasured.body.code, JSON.stringify(refusedMeasured.body)).toBe(
      'VALIDATION_FAILED',
    );
    const entry = await posted(book.owner.browser, correction('15000'));
    const resolved = await book.owner.browser.post(`/api/inbox/${idOf('invoice.voided')}/resolve`, {
      entryId: entry.id,
      reason: 'فاتورة مكررة في أيلول؛ خطأ جوهري',
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    const after = (await book.owner.browser.get('/api/revenue/schedules'))
      .body as RevenueSchedulePage;
    expect(after.openingSchedules[0]?.remaining).toMatchObject({
      transactionMinor: '0',
      bookMinor: '0',
      parallelMinor: '0',
    });
    const shown = await book.owner.browser.get(`/api/entries/${entry.id}`);
    const onEquity = (shown.body.lines as { accountId: string; bookMinor: string }[]).filter(
      (entryLine) => entryLine.accountId === book.accounts.get('312001'),
    );
    // The residual on retained earnings too (150.00 SYP of 117 against the eve's 115), so equity
    // takes 17,550.00 − 150.00 = 17,400.00 SYP: what the receivable carried, 34,500.00 SYP, less
    // what the schedule carried, 17,100.00 SYP.
    expect(onEquity.map((entryLine) => entryLine.bookMinor).sort()).toEqual(['-15000', '1755000']);
    // The correction is never reversed by hand: the schedule it stopped would not come back.
    const reversal = await book.owner.browser.post(`/api/entries/${entry.id}/reverse`, {
      date: '2026-10-09',
      description: 'عكس التصحيح',
    });
    expect(reversal.body.code, JSON.stringify(reversal.body)).toBe('ENTRY_NOT_REVERSIBLE');
    // Another company names the schedule as unknown, never another company's.
    const other = await books(app, db);
    const foreign = await other.owner.browser.post('/api/drafts', {
      entryDate: '2026-10-08',
      description: 'جدول شركة أخرى',
      reference: null,
      dealtRates: [],
      lines: [
        { ...line(other, '212001', 'USD', '15000'), scheduleId: schedule.id },
        line(other, '111004', 'USD', '-15000'),
      ],
    });
    expect(foreign.body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(foreign.body)).toContain('scheduleId');
    // A schedule cleared stands no more: naming it again is refused.
    const again = await draftOf(book.owner.browser, correction('15000'));
    expect((await book.owner.browser.post(`/api/drafts/${again.id}/post`)).body.code).toBe(
      'VALIDATION_FAILED',
    );
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
    // Step 3 lists every client and currency, agreeing ones included; the read before the figures
    // held both of Hub's without a records' figure.
    expect(first.agreement.map((pair) => [pair.slot, pair.recordsMinor])).toEqual([
      ['ad_funds', null],
      ['receivable', null],
    ]);
    expect(view.agreement).toEqual([
      {
        slot: 'ad_funds',
        client: clientValue,
        currency: 'USD',
        hubMinor: '50000',
        recordsMinor: '50000',
        differenceMinor: '0',
      },
      {
        slot: 'receivable',
        client: clientValue,
        currency: 'USD',
        hubMinor: '30000',
        recordsMinor: '30000',
        differenceMinor: '0',
      },
    ]);
    expect(view.differences).toEqual([]);
    // The Excel of the preview and of the agreement (S10 "Screens"), read by the auditor, audited.
    const preview = await auditor.browser.download('/api/opening/export', { part: 'preview' });
    expect(preview.status).toBe(200);
    expect(preview.headers['content-disposition']).toBe(
      `attachment; filename="opening-preview-${BOOKS_START}.xlsx"`,
    );
    const previewRows = await workbookRows(preview.body as Buffer);
    expect(previewRows[0]).toEqual(['تاريخ بدء الدفاتر', BOOKS_START]);
    const balancing = previewRows.find((row) => row[0] === 7);
    expect(balancing?.slice(2, 3)).toEqual(['312001']);
    expect(balancing?.slice(6, 10)).toEqual(['الليرة السورية الجديدة', -659900, -659900, -3999.15]);
    const agreement = await accountant.browser.download('/api/opening/export', {
      part: 'agreement',
    });
    const agreementRows = await workbookRows(agreement.body as Buffer);
    expect(agreementRows.slice(-2).map((row) => [row[0], row[3], row[4], row[5], row[6]])).toEqual([
      ['أموال إعلانات العملاء', 500, 500, 0, 'متطابق'],
      ['الذمم المدينة', 300, 300, 0, 'متطابق'],
    ]);
    expect(
      (await accountant.browser.get('/api/opening/export', { part: 'snapshot' })).body.code,
    ).toBe('VALIDATION_FAILED');
    const audit = await book.owner.browser.get('/api/audit', { action: 'export.opening' });
    expect(audit.status, JSON.stringify(audit.body)).toBe(200);
    expect(
      (audit.body.entries as { after: { part: string } }[]).map((entry) => entry.after.part).sort(),
    ).toEqual(['agreement', 'preview']);
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

  it('needs opening.read, opening.prepare and opening.post, and a fresh code to post or reverse', async () => {
    const book = await startedBooks();
    for (const role of ['viewer', 'approver'] as const) {
      const member = await book.join(role);
      expect((await member.browser.get('/api/opening')).body.code, role).toBe('FORBIDDEN');
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

  it("never shows a company another company's snapshot", async () => {
    const mine = await startedBooks();
    const hub = await hubClient(app, mine.owner, { scopes: ['opening:write'] });
    expect((await snapshotOf(hub, openingSnapshotExampleV1(BOOKS_START))).status).toBe(201);
    expect(
      ((await mine.owner.browser.get('/api/opening')).body as OpeningViewAnswer).snapshot,
    ).not.toBeNull();
    const theirs = await startedBooks();
    const read = (await theirs.owner.browser.get('/api/opening')).body as OpeningViewAnswer;
    expect(read.snapshot).toBeNull();
    expect(read.hubItems).toEqual([]);
    expect(read.schedules).toEqual([]);
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
