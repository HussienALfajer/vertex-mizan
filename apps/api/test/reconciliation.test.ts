import type { INestApplication } from '@nestjs/common';
import {
  type ApiClient,
  parseEventEnvelope,
  type ReconciliationDay,
  type ReconciliationMonth,
  type ReconciliationResult,
  reconciliationAmountOf,
  totalsOf,
  wireAmountOf,
} from '@vertex-mizan/contracts';
import { type Database, reconciliationReports, withCompany } from '@vertex-mizan/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { type Books, books, today } from './books.js';
import { expectGuarded } from './guards.js';
import { type HubClient, hubClient, hubDocuments, invoiceIssued, v1 } from './hub.js';
import { reauthenticate, testDatabase } from './people.js';

// S08's daily reconciliation over HTTP ("API", "Acceptance"): Hub's report and the events Mizan
// received under `/v1` with `reconciliation:write`, their refusals, a replay and a conflict, the
// key's guard, another company's client seeing nothing; `/api/reconciliation` per role; the close
// refused on `reconciliation_clean` until every day is reported; the start date and its lock.
// Every value is synthetic.

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

const RECONCILING = ['events:write', 'reconciliation:write'] as const;

/** The month `back` months before today's in Damascus. */
function monthsAgo(back: number): string {
  const [year, month] = today().split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Every day of a month `YYYY-MM`. */
function daysOf(month: string): string[] {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({ length: count }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`);
}

type Envelope = ReturnType<typeof invoiceIssued>;

/** A report as Hub builds it from its own events of a date. */
function reportOf(
  date: string,
  events: readonly Envelope[],
  generatedAt = `${date}T23:59:00+03:00`,
) {
  const parsed = events.map((event) => parseEventEnvelope(event));
  return {
    id: uuidv7(),
    date,
    generated_at: generatedAt,
    events: parsed.map((event) => {
      const amount = wireAmountOf(reconciliationAmountOf(event));
      return {
        id: event.id,
        type: event.type,
        ...(amount ? { amount } : {}),
        delivery: 'delivered',
      };
    }),
    totals: totalsOf(
      parsed.map((event) => ({ type: event.type, amount: reconciliationAmountOf(event) })),
    ).map((total) => ({ ...total, amount: total.amount === null ? null : Number(total.amount) })),
  };
}

const report = (
  hub: HubClient,
  body: { readonly id: string; readonly [field: string]: unknown },
  headers: Record<string, string> = {},
) =>
  v1(app, hub.key, hub.address).post('/v1/reconciliation/daily', body, {
    'idempotency-key': body.id,
    ...headers,
  });

async function reconcilingBooks(reconcileFrom = `${today().slice(0, 7)}-01`) {
  const book = await books(app, db);
  const hub = await hubClient(app, book.owner, { scopes: [...RECONCILING], reconcileFrom });
  return { book, hub };
}

describe('POST /v1/reconciliation/daily', () => {
  it('answers the comparison, a replay, a conflict and a superseded report (rules 4, 5; acceptance 1, 2, 4)', async () => {
    const { book, hub } = await reconcilingBooks();
    const invoice = invoiceIssued(hubDocuments(), today(), 40_000);
    const missing = reportOf(today(), [invoice]);
    const first = await report(hub, missing);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body as ReconciliationResult).toMatchObject({
      status: 'differences',
      replayed: false,
      superseded: false,
      gaps: 1,
      differences: [
        {
          kind: 'missing_in_mizan',
          event_id: invoice.id,
          hub: { amount: { currency: 'USD', amount: 40_000 }, delivery: 'delivered' },
          mizan: null,
        },
      ],
    });
    expect((await hub.send(invoice)).status).toBe(201);
    const replay = await report(hub, missing);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true, status: 'matched', gaps: 0 });
    const conflict = await report(hub, { ...missing, generated_at: `${today()}T23:59:30+03:00` });
    expect([conflict.status, conflict.body.code]).toEqual([409, 'IDEMPOTENCY_CONFLICT']);
    // A lower amount in a later report: the amount differs, both shown.
    const lower = reportOf(today(), [invoice], `${today()}T23:59:45+03:00`);
    lower.events = lower.events.map((event) => ({
      ...event,
      amount: { currency: 'USD', amount: 30_000 },
    }));
    lower.totals = lower.totals.map((total) => ({ ...total, amount: 30_000 }));
    const changed = await report(hub, lower);
    expect(changed.status, JSON.stringify(changed.body)).toBe(201);
    expect(changed.body.differences).toMatchObject([
      {
        kind: 'amount_differs',
        hub: { amount: { amount: 30_000 } },
        mizan: { amount: { amount: 40_000 }, state: 'posted' },
      },
    ]);
    // The first report, older than the latest, answers superseded and changes nothing.
    const late = await report(hub, reportOf(today(), [invoice], `${today()}T20:00:00+03:00`));
    expect(late.body).toMatchObject({ superseded: true, status: 'differences' });
    const day = await book.owner.browser.get(`/api/reconciliation/days/${today()}`);
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    expect((day.body as ReconciliationDay).clients[0]?.reports).toHaveLength(3);
  });

  it('refuses what stores nothing: the key, the totals, a later month (rules 1, 4)', async () => {
    const { book, hub } = await reconcilingBooks();
    const body = reportOf(today(), []);
    const wrongKey = await report(hub, body, { 'idempotency-key': uuidv7() });
    expect([wrongKey.status, wrongKey.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    const invoice = invoiceIssued(hubDocuments(), today());
    const cut = { ...reportOf(today(), [invoice]), events: [] };
    const refused = await report(hub, cut);
    expect([refused.status, refused.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    const [year, month] = today().split('-').map(Number) as [number, number];
    const next =
      month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const later = await report(hub, reportOf(next, []));
    expect([later.status, later.body.code, later.body.issues?.[0]?.path]).toEqual([
      422,
      'VALIDATION_FAILED',
      ['date'],
    ]);
    const stored = await withCompany(db, book.companyId, (tx) =>
      tx.select().from(reconciliationReports),
    );
    expect(stored).toEqual([]);
  });

  it('needs reconciliation:write and a key, never a session, and keeps each company apart', async () => {
    const { book, hub } = await reconcilingBooks();
    const invoice = invoiceIssued(hubDocuments(), today());
    expect((await hub.send(invoice)).status).toBe(201);
    const poster = await hubClient(app, book.owner, {
      name: 'Hub poster',
      scopes: ['events:write'],
    });
    const body = reportOf(today(), []);
    expect((await report(poster, body)).status).toBe(403);
    expect((await poster.get('/v1/events', { date: today() })).status).toBe(403);
    expect((await v1(app, null, hub.address).get('/v1/events', { date: today() })).status).toBe(
      401,
    );
    const session = await book.owner.browser.post('/v1/reconciliation/daily', body, {
      'idempotency-key': body.id,
    });
    expect(session.status).toBe(401);
    const listed = await hub.get('/v1/events', { date: today() });
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body).toMatchObject({
      events: [
        {
          id: invoice.id,
          type: 'invoice.issued',
          state: 'posted',
          amount: { currency: 'USD', amount: 50_000 },
        },
      ],
      next_cursor: null,
    });
    expect((await hub.get('/v1/events', {})).body.code).toBe('VALIDATION_FAILED');
    // Another company's client sees none of this company's events or reports.
    const other = await reconcilingBooks();
    expect((await other.hub.get('/v1/events', { date: today() })).body).toEqual({
      events: [],
      next_cursor: null,
    });
    expect((await report(other.hub, body)).status).toBe(201);
    const mine = await withCompany(db, book.companyId, (tx) =>
      tx.select().from(reconciliationReports),
    );
    expect(mine).toEqual([]);
  });
});

describe('/api/reconciliation', () => {
  it('is read by the owner, accountants and auditors, never the approver or viewer', async () => {
    const { book } = await reconcilingBooks();
    const month = today().slice(0, 7);
    for (const role of ['accountant', 'auditor'] as const) {
      const member = await book.join(role);
      expect((await member.browser.get('/api/reconciliation/days', { month })).status, role).toBe(
        200,
      );
    }
    for (const role of ['approver', 'viewer'] as const) {
      const member = await book.join(role);
      const answer = await member.browser.get('/api/reconciliation/days', { month });
      expect([answer.status, answer.body.code], role).toEqual([403, 'FORBIDDEN']);
      const counts = await member.browser.get('/api/reconciliation/counts');
      expect([counts.status, counts.body.code], role).toEqual([403, 'FORBIDDEN']);
    }
    expect((await book.owner.browser.get('/api/reconciliation/counts')).status).toBe(200);
    const days = await book.owner.browser.get('/api/reconciliation/days', { month });
    const body = days.body as ReconciliationMonth;
    expect(body.clients).toHaveLength(1);
    expect(body.days).toHaveLength(daysOf(month).length);
    expect(body.days[0]?.state).toMatch(/^(missing|pending)$/);
    expect(
      (await book.owner.browser.get('/api/reconciliation/days', { month, client: uuidv7() })).body
        .code,
    ).toBe('NOT_FOUND');
    expect(
      (await book.owner.browser.get('/api/reconciliation/days', { month: '2026-13' })).body.code,
    ).toBe('VALIDATION_FAILED');
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/reconciliation/days', query: { month } },
      { method: 'get', path: `/api/reconciliation/days/${today()}` },
      { method: 'get', path: '/api/reconciliation/counts' },
    ]);
  });
});

describe('GET /api/reconciliation/counts (the sidebar)', () => {
  it('counts the company’s own ended days not clean, for every role that reads them', async () => {
    const unreported = monthsAgo(2);
    const { book, hub } = await reconcilingBooks(`${unreported}-01`);
    // Last month and this one are reported in full, so only the days of the month before,
    // all missing at any time of day, count.
    for (const date of [...daysOf(monthsAgo(1)), ...daysOf(today().slice(0, 7))]) {
      expect((await report(hub, reportOf(date, []))).status, date).toBe(201);
    }
    const expected = { uncleanDays: daysOf(unreported).length };
    expect((await book.owner.browser.get('/api/reconciliation/counts')).body).toEqual(expected);
    for (const role of ['accountant', 'auditor'] as const) {
      const member = await book.join(role);
      const counts = await member.browser.get('/api/reconciliation/counts');
      expect([counts.status, counts.body], role).toEqual([200, expected]);
    }
    // Another company's owner sees none of these days.
    const other = await books(app, db);
    expect((await other.owner.browser.get('/api/reconciliation/counts')).body).toEqual({
      uncleanDays: 0,
    });
  });
});

describe('the close and the start date (rules 12, 13; acceptance 5, 6)', () => {
  async function close(book: Books, period: string) {
    return book.owner.browser.post(`/api/periods/${period}/close`, { reason: `إقفال ${period}` });
  }

  it('refuses the close until every day is reported, then locks the start date', async () => {
    const last = monthsAgo(1);
    const { book, hub } = await reconcilingBooks(`${last}-01`);
    const refused = await close(book, last);
    expect([refused.status, refused.body.code, refused.body.details]).toEqual([
      409,
      'CHECKLIST_FAILED',
      { items: 'reconciliation_clean' },
    ]);
    const period = await book.owner.browser.get(`/api/periods/${last}`);
    expect(
      period.body.checklist.find((item: { item: string }) => item.item === 'reconciliation_clean'),
    ).toEqual({
      item: 'reconciliation_clean',
      result: 'failed',
      count: daysOf(last).length,
      ledgers: [],
    });
    for (const date of daysOf(last)) {
      expect((await report(hub, reportOf(date, []))).status).toBe(201);
    }
    const closed = await close(book, last);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const put = (reconcileFrom: string) =>
      book.owner.browser.put(`/api/api-clients/${hub.id}`, { reconcileFrom });
    await reauthenticate(book.owner.browser, book.owner.person);
    const later = await put(`${last}-10`);
    expect([later.status, later.body.code]).toEqual([409, 'RECONCILIATION_START_LOCKED']);
    const earlier = await put(`${monthsAgo(2)}-01`);
    expect(earlier.status, JSON.stringify(earlier.body)).toBe(200);
    expect((earlier.body as ApiClient).reconcileFrom).toBe(`${monthsAgo(2)}-01`);
    const audit = await book.owner.browser.get('/api/audit', { entityType: 'api_client' });
    expect(JSON.stringify(audit.body)).toContain(`${monthsAgo(2)}-01`);
  });

  it('requires a start date with the scopes that need one', async () => {
    const book = await books(app, db);
    const reader = await hubClient(app, book.owner, { scopes: ['periods:read'] });
    await reauthenticate(book.owner.browser, book.owner.person);
    const refused = await book.owner.browser.put(`/api/api-clients/${reader.id}`, {
      scopes: ['periods:read', 'reconciliation:write'],
    });
    expect([refused.status, refused.body.code, refused.body.issues?.[0]?.path]).toEqual([
      422,
      'VALIDATION_FAILED',
      ['reconcileFrom'],
    ]);
    const created = await book.owner.browser.post('/api/api-clients', {
      name: 'Hub without a start',
      system: 'hub',
      scopes: ['events:write'],
      ipAllowList: [],
    });
    expect([created.status, created.body.code]).toEqual([422, 'VALIDATION_FAILED']);
  });
});
