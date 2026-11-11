import type { INestApplication } from '@nestjs/common';
import { type ApiClient, eventExamplesV1 } from '@vertex-mizan/contracts';
import {
  companies,
  type Database,
  inboundEventActions,
  inboundEvents,
  journalEntries,
  periods,
  withCompany,
} from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { books, today } from './books.js';
import { Browser } from './browser.js';
import { clientOf, hubClient, hubDocuments, invoiceIssued, paymentRecorded, v1 } from './hub.js';
import { testDatabase } from './people.js';

// S05's Hub API under `/v1` (rules 1–7, 19–22, "Periods"): an event posted, held and replayed in
// one request, the refusals that store nothing, the key's guard (sessions and keys never cross
// between `/v1` and `/api`, the allow-list, the scopes, the archive, another company), and the
// periods' states. Every value is synthetic.

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

const storedEvents = (companyId: string) =>
  withCompany(db, companyId, (tx) => tx.select({ id: inboundEvents.id }).from(inboundEvents));

const hubEntries = (companyId: string) =>
  withCompany(db, companyId, (tx) =>
    tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.source, 'hub_event')),
  );

describe('POST /v1/events', () => {
  it('posts an event in its request, answers a replay with the same entries, and holds a payment before its invoice', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const documents = hubDocuments();
    const payment = paymentRecorded(documents, today());
    const held = await hub.send(payment);
    expect(held.status, JSON.stringify(held.body)).toBe(202);
    expect(held.body).toMatchObject({ status: 'held', reason: 'UNKNOWN_REFERENCE' });
    expect(held.headers['x-request-id']).toBeTruthy();

    const invoice = invoiceIssued(documents, today());
    const posted = await hub.send(invoice);
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    expect(posted.body).toMatchObject({ status: 'posted', inbox_id: expect.any(String) });
    expect(posted.body.entries).toHaveLength(1);
    expect(posted.body.entries[0]).toMatchObject({ fiscal_year: Number(today().slice(0, 4)) });

    const replay = await hub.send(invoice);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(posted.body);
    const actions = await withCompany(db, book.companyId, (tx) =>
      tx
        .select({ action: inboundEventActions.action })
        .from(inboundEventActions)
        .where(eq(inboundEventActions.eventId, posted.body.inbox_id)),
    );
    expect(actions.map((row) => row.action)).toContain('replayed');
    // The payment waits for the worker's retry (rule 10); the invoice posted once.
    expect(await hubEntries(book.companyId)).toHaveLength(1);
  });

  it('serialises two requests with one key: one stores, the other answers as a replay', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const invoice = invoiceIssued(hubDocuments(), today());
    const [a, b] = await Promise.all([hub.send(invoice), hub.send(invoice)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body).toEqual(b.body);
    expect(await storedEvents(book.companyId)).toHaveLength(1);
    expect(await hubEntries(book.companyId)).toHaveLength(1);
  });

  it('refuses without storing: a conflicting replay, the key header, a bad payload, a later month, SYP before 2026', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const documents = hubDocuments();
    const invoice = invoiceIssued(documents, today());
    expect((await hub.send(invoice)).status).toBe(201);
    const conflict = await hub.send({
      ...invoice,
      payload: { ...invoice.payload, due_on: '2099-12-31' },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const other = invoiceIssued(hubDocuments(), today());
    const wrongKey = await hub.send(other, { 'idempotency-key': uuidv7() });
    expect(wrongKey.body.code).toBe('VALIDATION_FAILED');
    const noKey = await v1(app, hub.key, hub.address).post('/v1/events', other);
    expect(noKey.body.code).toBe('VALIDATION_FAILED');
    const zero = invoiceIssued(hubDocuments(), today(), 0);
    expect((await hub.send(zero)).body.code).toBe('VALIDATION_FAILED');
    const unknown = { ...other, id: uuidv7(), type: 'invoice.reissued' };
    expect((await hub.send(unknown)).status).toBe(422);
    const later = invoiceIssued(hubDocuments(), '2099-01-15');
    expect((await hub.send(later)).body.code).toBe('ENTRY_DATE_OUT_OF_RANGE');
    const old = invoiceIssued(hubDocuments(), '2025-12-31');
    const oldAnswer = await hub.send(old);
    expect(oldAnswer.status).toBe(422);
    expect(oldAnswer.body.code).toBe('SYP_BEFORE_REDENOMINATION');
    expect(await storedEvents(book.companyId)).toHaveLength(1);
  });

  it('refuses a document type from another source or none, and a replay under the type’s new client posts nothing twice', async () => {
    const book = await books(app, db);
    const first = await hubClient(app, book.owner, { name: 'Vertex Hub' });
    const second = await hubClient(app, book.owner, { name: 'Vertex Hub 2' });
    const invoice = invoiceIssued(hubDocuments(), today());
    const refused = await second.send(invoice);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('SOURCE_NOT_ALLOWED');
    const posted = await first.send(invoice);
    expect(posted.status).toBe(201);
    // The owner moves invoices to the second client; Hub replays the event with its new key.
    const moved = await book.owner.browser.put(`/api/api-clients/${second.id}`, {
      documentTypes: ['invoice'],
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await first.send(invoiceIssued(hubDocuments(), today()))).body.code).toBe(
      'SOURCE_NOT_ALLOWED',
    );
    const replay = await second.send(invoice);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body).toEqual(posted.body);
    expect(await hubEntries(book.companyId)).toHaveLength(1);
    // A type moved to none is refused to everyone.
    await book.owner.browser.put(`/api/api-clients/${second.id}`, { documentTypes: [] });
    expect((await second.send(invoiceIssued(hubDocuments(), today()))).body.code).toBe(
      'SOURCE_NOT_ALLOWED',
    );
  });

  it('refuses a body over 256 KB with 413, and an invoice over 200 lines', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const big = invoiceIssued(hubDocuments(), today());
    const padded = { ...big, payload: { ...big.payload, note: 'x'.repeat(300 * 1024) } };
    const tooLarge = await hub.send(padded);
    expect(tooLarge.status).toBe(413);
    // Over the framework's default of 100 KB, under 256 KB: read and posted (an unknown field is
    // kept in the stored payload, never read by the rule).
    const large = { ...big, payload: { ...big.payload, note: 'x'.repeat(200 * 1024) } };
    const read = await hub.send(large);
    expect(read.status).not.toBe(413);
    expect(read.status).toBe(201);
    const documents = hubDocuments();
    const many = invoiceIssued(documents, today());
    const [line] = many.payload.lines;
    many.payload.lines = Array.from({ length: 201 }, () => ({ ...line, id: uuidv7() }) as never);
    expect((await hub.send(many)).body.code).toBe('VALIDATION_FAILED');
    expect(await storedEvents(book.companyId)).toHaveLength(1);
  });
});

describe('the key’s guard', () => {
  it('refuses no key, a malformed or unknown key, a session on /v1 and a key on /api', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const event = invoiceIssued(hubDocuments(), today());
    const headers = { 'idempotency-key': event.id };
    for (const key of [null, 'not-a-key', `mzn_${'A'.repeat(40)}`]) {
      const answer = await v1(app, key, hub.address).post('/v1/events', event, headers);
      expect(answer.status, String(key)).toBe(401);
      expect(answer.body.code).toBe('UNAUTHENTICATED');
    }
    // The owner's signed-in browser has a session cookie, never accepted on /v1.
    const session = await book.owner.browser.post('/v1/events', event, headers);
    expect(session.status).toBe(401);
    // A key on the internal API.
    const onApi = await new Browser(app).get('/api/api-clients', undefined, {
      authorization: `Bearer ${hub.key}`,
    });
    expect(onApi.status).toBe(401);
    const both = await book.owner.browser.get('/api/api-clients', undefined, {
      authorization: `Bearer ${hub.key}`,
    });
    expect(both.status).toBe(401);
  });

  it('admits only the allow-list’s addresses and the client’s scopes', async () => {
    const book = await books(app, db);
    const listed = await hubClient(app, book.owner, {
      name: 'Hub listed',
      ipAllowList: ['198.51.100.0/24'],
      scopes: ['events:write'],
    });
    const outside = await listed.get('/v1/periods/status', { from: '2026-01', to: '2026-01' });
    expect(outside.status).toBe(403);
    const inside = clientOf(app, listed.id, listed.key, '198.51.100.7');
    // In the list, but without `periods:read`.
    const scope = await inside.get('/v1/periods/status', { from: '2026-01', to: '2026-01' });
    expect(scope.status).toBe(403);
    expect(scope.body.code).toBe('FORBIDDEN');
    expect((await inside.send(invoiceIssued(hubDocuments(), today()))).status).toBe(201);
  });

  it('refuses every call of an archived company, and reaches only the key’s company', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const other = await books(app, db);
    const otherHub = await hubClient(app, other.owner);
    // The other company's invoice is unknown to this company's key: its payment is held here, and
    // nothing reaches the other company's books or its item (S05 "Abuse").
    const documents = hubDocuments();
    const invoice = invoiceIssued(documents, today());
    expect((await otherHub.send(invoice)).status).toBe(201);
    expect(await storedEvents(book.companyId)).toHaveLength(0);
    const payment = await hub.send(paymentRecorded(documents, today()));
    expect(payment.status, JSON.stringify(payment.body)).toBe(202);
    expect(payment.body).toMatchObject({ status: 'held', reason: 'UNKNOWN_REFERENCE' });
    expect(await storedEvents(other.companyId)).toHaveLength(1);
    expect(await hubEntries(other.companyId)).toHaveLength(1);
    expect(await hubEntries(book.companyId)).toHaveLength(0);
    // A payment of that invoice sent with the other company's key posts there, against its item.
    const crossed = await otherHub.send(paymentRecorded(documents, today()));
    expect(crossed.status).toBe(201);
    const clients = (await book.owner.browser.get('/api/api-clients')).body as ApiClient[];
    expect(clients.map((client) => client.id)).toEqual([hub.id]);
    // Archived by hand, so the key stays active and the company's archive is what refuses it.
    await db
      .update(companies)
      .set({ archivedAt: new Date(), archivedReason: 'أرشفة تجريبية' })
      .where(eq(companies.id, book.companyId));
    const archived = await hub.get('/v1/periods/status', { from: '2026-01', to: '2026-01' });
    expect(archived.body.code).toBe('COMPANY_ARCHIVED');
  });

  it('keeps Hub’s client to 600 requests a minute', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const answers = [];
    // The limit counts per calendar minute, so a run may straddle one boundary: 1,250 requests are
    // more than two minutes' 600, so some are refused wherever the boundary falls.
    for (let batch = 0; batch < 25; batch += 1) {
      answers.push(
        ...(await Promise.all(
          Array.from({ length: 50 }, () =>
            hub.get('/v1/periods/status', { from: '2026-01', to: '2026-01' }),
          ),
        )),
      );
    }
    const limited = answers.filter((answer) => answer.status === 429);
    expect(limited.length).toBeGreaterThanOrEqual(1_250 - 2 * 600);
    expect(limited[0]?.body.code).toBe('RATE_LIMITED');
  });
});

describe('GET /v1/periods/status', () => {
  it('answers each month of the range, open without a period row, at most 24 months', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    await withCompany(db, book.companyId, (tx) =>
      tx
        .insert(periods)
        .values({ companyId: book.companyId, period: '2026-03', fiscalYear: 2026, state: 'open' }),
    );
    const answer = await hub.get('/v1/periods/status', { from: '2026-02', to: '2026-04' });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body).toEqual([
      { period: '2026-02', state: 'open' },
      { period: '2026-03', state: 'open' },
      { period: '2026-04', state: 'open' },
    ]);
    for (const query of [
      { from: '2026-05', to: '2026-04' },
      { from: '2024-01', to: '2026-01' },
      { from: '2026-13', to: '2026-12' },
    ]) {
      expect((await hub.get('/v1/periods/status', query)).body.code).toBe('VALIDATION_FAILED');
    }
    expect((await hub.get('/v1/periods/status', { from: '2025-02', to: '2027-01' })).status).toBe(
      200,
    );
  });
});

describe('the examples Hub receives', () => {
  it('post every event type of the catalogue in order, each answered as its rule says', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const answers: [string, number, string, string | null][] = [];
    for (const example of eventExamplesV1(today())) {
      const answer = await hub.send(example);
      answers.push([example.type, answer.status, answer.body.status, answer.body.reason ?? null]);
    }
    // S06's milestones and project ends wait for their rules (rule 8, `deferred_revenue`); the
    // project's second event waits behind its first (rule 11).
    expect(answers).toEqual([
      ['invoice.issued', 201, 'posted', null],
      ['invoice.due_date_changed', 201, 'recorded', null],
      ['invoice.line_service_changed', 201, 'posted', null],
      ['payment.recorded', 201, 'posted', null],
      ['payment.voided', 201, 'posted', null],
      ['invoice.voided', 201, 'posted', null],
      ['milestone.done', 202, 'held', 'NO_MAPPING'],
      ['project.completed', 202, 'held', 'NO_MAPPING'],
      ['project.cancelled', 202, 'held', 'WAITING_FOR_EARLIER_EVENT'],
      ['project_expense.recorded', 201, 'posted', null],
      ['project_expense.changed', 201, 'posted', null],
      ['project_expense.archived', 201, 'posted', null],
      ['ad_wallet.deposited', 201, 'posted', null],
      ['ad_spend.recorded', 201, 'posted', null],
      ['ad_spend.changed', 201, 'posted', null],
      ['ad_spend.archived', 201, 'posted', null],
      ['ad_wallet.refunded', 201, 'posted', null],
      ['ad_wallet.entry_voided', 201, 'posted', null],
      ['rate.changed', 201, 'recorded', null],
    ]);
  });
});
