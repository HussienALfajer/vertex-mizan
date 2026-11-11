import type { INestApplication } from '@nestjs/common';
import type {
  RevenueMonth,
  RevenuePreview,
  RevenueScheduleDetail,
  RevenueSchedulePage,
} from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { books, today } from './books.js';
import { expectGuarded } from './guards.js';
import { hubClient, hubDocuments } from './hub.js';
import { testDatabase } from './people.js';

// S06's `/api/revenue` over HTTP ("API"): the schedules with their filters and pages, a schedule
// with its movements and months, the months' summary and the current month's preview, each with
// `recognition.read` (owner, accountant, auditor), another company's ids not found, and the
// refusals of a bad query. Every value is synthetic.

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

const month = () => today().slice(0, 7);

/** The month after `YYYY-MM`. */
function nextMonth(value: string): string {
  const [year, number] = value.split('-').map(Number) as [number, number];
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

/** A retainer cycle's 900.00 USD monthly charge for today alone, issued today. */
function retainerInvoice(documents: ReturnType<typeof hubDocuments>) {
  const on = today();
  return {
    id: uuidv7(),
    type: 'invoice.issued',
    version: 1,
    occurred_at: `${on}T09:00:00+03:00`,
    accounting_date: on,
    payload: {
      invoice: documents.invoice,
      client: documents.client,
      contract: {
        external_id: uuidv7(),
        code: `R${uuidv7().slice(-4)}`,
        name: 'اشتراك تجريبي',
        kind: 'retainer',
        client_external_id: documents.client.external_id,
      },
      currency: 'USD',
      syp_per_usd: '122.0000',
      issued_on: on,
      due_on: on,
      lines: [
        {
          id: uuidv7(),
          amount: 90_000,
          service: documents.service,
          source: 'retainer_charge',
          charge_kind: 'monthly',
          cycle_start: on,
          cycle_end: on,
        },
      ],
    },
  };
}

describe('/api/revenue', () => {
  it('lists, reads and previews a deferred retainer charge; another company sees none of it', async () => {
    const book = await books(app, db);
    const hub = await hubClient(app, book.owner);
    const documents = hubDocuments();
    const issued = await hub.send(retainerInvoice(documents));
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);

    const page = await book.owner.browser.get('/api/revenue/schedules');
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    const { schedules, nextCursor } = page.body as RevenueSchedulePage;
    expect(nextCursor).toBeNull();
    expect(schedules).toHaveLength(1);
    const [schedule] = schedules;
    expect(schedule).toMatchObject({
      inboxId: issued.body.inbox_id,
      invoiceNumber: documents.invoice.number,
      pattern: 'over_time',
      lineSource: 'retainer_charge',
      chargeKind: 'monthly',
      currency: 'USD',
      client: { code: documents.client.code, name: documents.client.name },
      service: { code: documents.service.code },
      serviceFrom: today(),
      serviceTo: today(),
      amountMinor: '90000',
      released: { transactionMinor: '0', bookMinor: '0', parallelMinor: '0' },
      remaining: { transactionMinor: '90000', parallelMinor: '90000' },
      state: 'active',
      reissueOfId: null,
    });
    const id = schedule?.id as string;
    // The filters: its client and month find it; another state does not.
    const filtered = async (query: Record<string, string>) =>
      ((await book.owner.browser.get('/api/revenue/schedules', query)).body as RevenueSchedulePage)
        .schedules.length;
    expect(await filtered({ state: 'active', month: month() })).toBe(1);
    expect(await filtered({ client: schedule?.client.id as string })).toBe(1);
    expect(await filtered({ state: 'voided' })).toBe(0);
    expect(await filtered({ month: nextMonth(month()) })).toBe(0);
    expect(
      (await book.owner.browser.get('/api/revenue/schedules', { month: '2026-13' })).status,
    ).toBe(422);
    expect(
      (await book.owner.browser.get('/api/revenue/schedules', { cursor: 'not-a-cursor' })).body
        .code,
    ).toBe('VALIDATION_FAILED');

    const detail = await book.owner.browser.get(`/api/revenue/schedules/${id}`);
    expect(detail.status).toBe(200);
    const read = detail.body as RevenueScheduleDetail;
    expect(read.movements.map((movement) => movement.kind)).toEqual(['deferred']);
    expect(read.movements[0]?.entry?.id).toBe(issued.body.entries[0].id);
    expect(read.months).toEqual([
      {
        month: month(),
        days: 1,
        elapsed: false,
        part: {
          transactionMinor: '90000',
          bookMinor: read.remaining.bookMinor,
          parallelMinor: '90000',
        },
        released: false,
      },
    ]);

    // The current month is not ended: nothing missing, and its preview is the schedule's part.
    const months = await book.owner.browser.get('/api/revenue/months', {
      from: month(),
      to: month(),
    });
    expect(months.status).toBe(200);
    expect(months.body as RevenueMonth[]).toEqual([
      {
        month: month(),
        releasedBookMinor: '0',
        releasedParallelMinor: '0',
        entryCount: 0,
        missing: [],
        decisionCount: 0,
      },
    ]);
    const preview = await book.owner.browser.get('/api/revenue/preview', { month: month() });
    expect(preview.status).toBe(200);
    expect((preview.body as RevenuePreview).entries).toEqual([
      expect.objectContaining({
        inboxId: issued.body.inbox_id,
        invoiceNumber: documents.invoice.number,
        lines: [expect.objectContaining({ scheduleId: id, amounts: read.remaining })],
      }),
    ]);

    // The refusals of the queries: a month to come, a range over 24 months or ending before it starts.
    const refused = async (path: string, query: Record<string, string>) =>
      (await book.owner.browser.get(path, query)).body.code;
    expect(await refused('/api/revenue/preview', { month: nextMonth(month()) })).toBe(
      'VALIDATION_FAILED',
    );
    expect(await refused('/api/revenue/months', { from: '2026-01', to: '2028-01' })).toBe(
      'VALIDATION_FAILED',
    );
    expect(await refused('/api/revenue/months', { from: '2026-05', to: '2026-04' })).toBe(
      'VALIDATION_FAILED',
    );
    expect((await book.owner.browser.get(`/api/revenue/schedules/${uuidv7()}`)).status).toBe(404);

    // The auditor and the accountant read; the approver and the viewer hold no recognition.read.
    for (const role of ['auditor', 'accountant'] as const) {
      const member = await book.join(role);
      expect((await member.browser.get(`/api/revenue/schedules/${id}`)).status, role).toBe(200);
    }
    for (const role of ['approver', 'viewer'] as const) {
      const member = await book.join(role);
      const answer = await member.browser.get('/api/revenue/schedules');
      expect([answer.status, answer.body.code], role).toEqual([403, 'FORBIDDEN']);
    }

    // Another company finds neither the schedule nor anything in its lists.
    const other = await books(app, db);
    expect((await other.owner.browser.get(`/api/revenue/schedules/${id}`)).status).toBe(404);
    expect(
      ((await other.owner.browser.get('/api/revenue/schedules')).body as RevenueSchedulePage)
        .schedules,
    ).toEqual([]);
    expect(
      (
        (await other.owner.browser.get('/api/revenue/preview', { month: month() }))
          .body as RevenuePreview
      ).entries,
    ).toEqual([]);
  });

  it('guards every route', async () => {
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/revenue/schedules' },
      { method: 'get', path: `/api/revenue/schedules/${uuidv7()}` },
      { method: 'get', path: `/api/revenue/months?from=${month()}&to=${month()}` },
      { method: 'get', path: `/api/revenue/preview?month=${month()}` },
    ]);
  });
});
