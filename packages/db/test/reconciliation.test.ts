import {
  type CompanyLedgers,
  DomainError,
  type EventEnvelope,
  HUB_DELIVERY_STATES,
  parseEventEnvelope,
  type ReconciliationReport,
  reconciliationAmountOf,
  reconciliationReportSchema,
  totalsOf,
  wireAmountOf,
} from '@vertex-mizan/contracts';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AuditActor,
  apiClients,
  checkReconcileFromMove,
  createCompanyBooks,
  type PersonActor,
  periodChecklist,
  REPORT_DELIVERY_STATES,
  readReceivedEvents,
  readReconciliationDay,
  readReconciliationMonth,
  receiveEvent,
  receiveReconciliationReport,
  reconciliationReportEvents,
  reconciliationReports,
  type Transaction,
  uncleanReconciliationDays,
  users,
  withCompany,
} from '../src/index.js';
import { closeMonthByHand, connect, refusal } from './connections.js';

// S08's daily reconciliation in the database (rules 4–16): the reports kept append-only and whole,
// each company's apart; the comparison with the events the inbox received; the days, a day in full,
// the checklist item and the events of a date for Hub; the start date's lock.

const { app } = connect();

let personId = '';

const person = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-reconciliation-test',
  ipAddress: null,
  userAgent: null,
});

const hubActor = (clientId: string): AuditActor => ({
  kind: 'api_client',
  clientId,
  name: 'Vertex Hub',
  requestId: 'request-reconciliation-test',
  ipAddress: null,
  userAgent: null,
});

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const TODAY = '2026-11-30';
const NOW = '2026-11-30T12:00';

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

/** A company with the service-agency chart and a Hub client reconciled from `reconcileFrom`. */
async function newCompany(reconcileFrom: string | null = '2026-11-01') {
  const companyId = uuidv7();
  await withCompany(app, companyId, async (tx) => {
    await createCompanyBooks(
      tx,
      companyId,
      {
        name: 'شركة مطابقة تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: personId,
      },
      person(),
    );
  });
  const clientId = reconcileFrom === null ? null : await newClient(companyId, reconcileFrom);
  return { companyId, clientId: clientId as string };
}

async function newClient(companyId: string, reconcileFrom: string, name = 'Vertex Hub') {
  const [row] = await app
    .insert(apiClients)
    .values({
      scopeCompanyId: companyId,
      name,
      system: 'hub',
      scopes: ['events:write', 'reconciliation:write'],
      reconcileFrom,
      createdByUserId: personId,
    })
    .returning({ id: apiClients.id });
  return row?.id as string;
}

const ids = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C1 = { external_id: ids(9001), code: 'C1', name: 'عميل تجريبي' };
const S1 = { external_id: ids(9002), code: 'S1', name: 'خدمة تجريبية' };

const bodies = new Map<string, Record<string, unknown>>();
let invoiceNumber = 0;

/** An invoice issued in Hub, dated `on`. */
function issued(on: string, amount: number): EventEnvelope {
  invoiceNumber += 1;
  const id = uuidv7();
  const raw = {
    id,
    type: 'invoice.issued',
    version: 1,
    occurred_at: `${on}T12:00:00+03:00`,
    accounting_date: on,
    payload: {
      invoice: { id: uuidv7(), number: `INV-2026-${invoiceNumber}` },
      client: C1,
      currency: 'USD',
      syp_per_usd: '119.0000',
      issued_on: on,
      due_on: '2026-12-31',
      lines: [{ id: uuidv7(), amount, service: S1, source: 'extra_work' }],
    },
  };
  bodies.set(id, raw);
  return parseEventEnvelope(raw);
}

/** Receives an event as `POST /v1/events` does, from the client. */
async function receive(companyId: string, clientId: string, event: EventEnvelope) {
  return inCompany(companyId, (tx) =>
    receiveEvent(
      tx,
      companyId,
      {
        raw: bodies.get(event.id) as Record<string, unknown>,
        envelope: event,
        apiClientId: clientId,
        requestId: 'request-reconciliation-test',
      },
      { actor: hubActor(clientId), today: TODAY },
    ),
  );
}

/** A report as Hub builds it from its own events of a date: consistent with itself. */
function reportOf(
  date: string,
  events: readonly EventEnvelope[],
  generatedAt = `${date}T23:59:00+03:00`,
): ReconciliationReport {
  return reconciliationReportSchema.parse({
    id: uuidv7(),
    date,
    generated_at: generatedAt,
    events: events.map((event) => {
      const amount = wireAmountOf(reconciliationAmountOf(event));
      return {
        id: event.id,
        type: event.type,
        ...(amount ? { amount } : {}),
        delivery: 'delivered',
      };
    }),
    totals: totalsOf(
      events.map((event) => ({ type: event.type, amount: reconciliationAmountOf(event) })),
    ).map((total) => ({
      ...total,
      amount: total.amount === null ? null : Number(total.amount),
    })),
  });
}

async function send(companyId: string, clientId: string, report: ReconciliationReport) {
  return inCompany(companyId, (tx) =>
    receiveReconciliationReport(tx, companyId, {
      raw: report as unknown as Record<string, unknown>,
      report,
      apiClientId: clientId,
      requestId: 'request-reconciliation-test',
      today: TODAY,
    }),
  );
}

const codeOf = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
};

const dayOf = (companyId: string, date: string, now = NOW) =>
  inCompany(companyId, (tx) => readReconciliationDay(tx, { date, now }));

const reconciliationItem = async (companyId: string, period: string) => {
  const checklist = await inCompany(companyId, (tx) => periodChecklist(tx, period, TODAY));
  return checklist.find((item) => item.item === 'reconciliation_clean');
};

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: `reconciliation-${uuidv7()}@example.test`, name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  personId = row?.id as string;
});

describe('the reports’ tables (S08 "Data")', () => {
  it('keep the delivery states of contracts', () => {
    expect(REPORT_DELIVERY_STATES).toEqual(HUB_DELIVERY_STATES);
  });

  it('are append-only, whole at commit and each company’s own', async () => {
    const { companyId, clientId } = await newCompany();
    const event = issued('2026-11-02', 10_000);
    const report = reportOf('2026-11-02', [event]);
    await send(companyId, clientId, report);
    const [stored] = await inCompany(companyId, (tx) => tx.select().from(reconciliationReports));
    expect(stored).toMatchObject({ reportDate: '2026-11-02', eventCount: 1 });
    const reportRow = stored?.id as string;
    expect(
      await refusal(
        inCompany(companyId, (tx) =>
          tx
            .update(reconciliationReports)
            .set({ gapsAtReceipt: 0 })
            .where(eq(reconciliationReports.id, reportRow)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await refusal(
        inCompany(companyId, (tx) =>
          tx
            .delete(reconciliationReportEvents)
            .where(eq(reconciliationReportEvents.reportId, reportRow)),
        ),
      ),
    ).toMatch(/permission denied/);
    // An event slipped into a stored report, or a report stored without its events, fails.
    expect(
      await refusal(
        inCompany(companyId, (tx) =>
          tx.insert(reconciliationReportEvents).values({
            companyId,
            reportId: reportRow,
            eventId: uuidv7(),
            type: 'invoice.voided',
            delivery: 'pending',
          }),
        ),
      ),
    ).toMatch(/lists 2 events, not the 1/);
    expect(
      await refusal(
        inCompany(companyId, (tx) =>
          tx.insert(reconciliationReports).values({
            companyId,
            apiClientId: clientId,
            reportId: uuidv7(),
            reportDate: '2026-11-03',
            generatedAt: new Date(),
            payload: {},
            payloadHash: 'b'.repeat(64),
            eventCount: 2,
            requestId: 'request-forged',
            statusAtReceipt: 'matched',
            gapsAtReceipt: 0,
          }),
        ),
      ),
    ).toMatch(/lists 0 events, not the 2/);
    // Another company sees none of it, and cannot hang an event on this company's report.
    const other = await newCompany();
    expect(
      await inCompany(other.companyId, (tx) => tx.select().from(reconciliationReports)),
    ).toEqual([]);
    expect(
      await refusal(
        inCompany(other.companyId, (tx) =>
          tx.insert(reconciliationReportEvents).values({
            companyId: other.companyId,
            reportId: reportRow,
            eventId: uuidv7(),
            type: 'invoice.voided',
            delivery: 'pending',
          }),
        ),
      ),
    ).toMatch(/reconciliation_report_events_report_fk/);
  });
});

describe('receiving a report (S08 rules 4, 5)', () => {
  it('answers the comparison, a replay, a conflict, a superseded report and a late date', async () => {
    const { companyId, clientId } = await newCompany();
    const event = issued('2026-11-03', 25_000);
    await receive(companyId, clientId, event);
    const report = reportOf('2026-11-03', [event]);
    const first = await send(companyId, clientId, report);
    expect(first.replayed).toBe(false);
    expect(first.result).toMatchObject({
      report_id: report.id,
      date: '2026-11-03',
      status: 'matched',
      superseded: false,
      gaps: 0,
      differences: [],
      totals: [
        {
          type: 'invoice.issued',
          currency: 'USD',
          hub_count: 1,
          hub_amount: 25_000,
          mizan_count: 1,
          mizan_amount: 25_000,
        },
      ],
    });
    const again = await send(companyId, clientId, report);
    expect(again).toMatchObject({ replayed: true, result: { replayed: true, status: 'matched' } });
    expect(
      await codeOf(
        send(companyId, clientId, { ...report, generated_at: '2026-11-04T01:00:00+03:00' }),
      ),
    ).toBe('IDEMPOTENCY_CONFLICT');
    // An older report arriving late is kept and changes nothing.
    const older = await send(
      companyId,
      clientId,
      reportOf('2026-11-03', [], '2026-11-03T20:00:00+03:00'),
    );
    expect(older.result).toMatchObject({ superseded: true, status: 'matched', gaps: 0 });
    const stored = await inCompany(companyId, (tx) => tx.select().from(reconciliationReports));
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.statusAtReceipt)).toEqual(['matched', 'matched']);
    // A date after the last day of the current month in Damascus stores nothing.
    expect(await codeOf(send(companyId, clientId, reportOf('2026-12-01', [])))).toBe(
      'VALIDATION_FAILED',
    );
    // A date of the month not yet reached is accepted (edge case 12).
    expect((await send(companyId, clientId, reportOf('2026-11-30', []))).result.status).toBe(
      'matched',
    );
  });
});

describe('the comparison (S08 rules 7–11)', () => {
  it('names a missing event, then matches it once received (acceptance step 2)', async () => {
    const { companyId, clientId } = await newCompany();
    const event = issued('2026-11-04', 40_000);
    const sent = await send(companyId, clientId, reportOf('2026-11-04', [event]));
    expect(sent.result).toMatchObject({
      status: 'differences',
      gaps: 1,
      differences: [
        {
          kind: 'missing_in_mizan',
          event_id: event.id,
          hub: { type: 'invoice.issued', amount: { currency: 'USD', amount: 40_000 } },
          mizan: null,
        },
      ],
    });
    const [stored] = await inCompany(companyId, (tx) => tx.select().from(reconciliationReports));
    expect(stored).toMatchObject({ statusAtReceipt: 'differences', gapsAtReceipt: 1 });
    await receive(companyId, clientId, event);
    const day = await dayOf(companyId, '2026-11-04');
    expect(day.state).toBe('matched');
    expect(day.clients[0]?.differences).toEqual([]);
  });

  it('names an amount, a date and an unreported event, on both dates (acceptance step 4)', async () => {
    const { companyId, clientId } = await newCompany();
    const invoice = issued('2026-11-04', 40_000);
    const late = issued('2026-11-06', 5_000);
    const unreported = issued('2026-11-04', 7_000);
    for (const event of [invoice, late, unreported]) await receive(companyId, clientId, event);
    const lower = reportOf('2026-11-04', [invoice, late]);
    const changed = {
      ...lower,
      events: lower.events.map((event) =>
        event.id === invoice.id
          ? { ...event, amount: { currency: 'USD' as const, amount: 30_000 } }
          : event,
      ),
      totals: [
        { type: 'invoice.issued' as const, currency: 'USD' as const, count: 2, amount: 35_000 },
      ],
    };
    await send(companyId, clientId, reconciliationReportSchema.parse(changed));
    const day = await dayOf(companyId, '2026-11-04');
    expect(day.state).toBe('differences');
    expect(day.clients[0]?.differences.map((gap) => [gap.eventId, gap.kind])).toEqual([
      [invoice.id, 'amount_differs'],
      [late.id, 'date_differs'],
      [unreported.id, 'missing_in_hub'],
    ]);
    expect(day.clients[0]?.differences[0]).toMatchObject({
      hub: { amount: { currency: 'USD', amountMinor: '30000' } },
      mizan: { amount: { currency: 'USD', amountMinor: '40000' }, accountingDate: '2026-11-04' },
    });
    // The event Mizan holds on the 6th shows there too, against the 4th's report.
    const sixth = await dayOf(companyId, '2026-11-06');
    expect(sixth.clients[0]?.differences).toMatchObject([
      { kind: 'date_differs', eventId: late.id, hub: { accountingDate: '2026-11-04' } },
    ]);
    expect(day.clients[0]?.totals).toMatchObject([
      {
        type: 'invoice.issued',
        currency: 'USD',
        hubCount: 2,
        hubAmountMinor: '35000',
        receivedCount: 2,
        receivedAmountMinor: '47000',
      },
    ]);
  });

  it('annotates a held event without counting it as a gap (rule 9, edge case 3)', async () => {
    const { companyId, clientId } = await newCompany();
    // No bulletin is recorded, so the invoice is held RATE_MISSING.
    const event = issued('2026-11-05', 12_000);
    const received = await receive(companyId, clientId, event);
    expect(received.event.state).toBe('held');
    await send(companyId, clientId, reportOf('2026-11-05', [event]));
    const day = await dayOf(companyId, '2026-11-05');
    expect(day.state).toBe('matched');
    expect(day.clients[0]?.annotations).toMatchObject([
      { kind: 'held', eventId: event.id, holdReason: 'RATE_MISSING' },
    ]);
    expect(day.clients[0]?.totals[0]).toMatchObject({ held: 1, posted: 0 });
  });

  it('waits for a day’s report until 08:00 the next day, then misses it (acceptance step 3)', async () => {
    const { companyId, clientId } = await newCompany();
    await receive(companyId, clientId, issued('2026-11-05', 9_000));
    expect((await dayOf(companyId, '2026-11-05', '2026-11-06T07:59')).state).toBe('pending');
    expect((await dayOf(companyId, '2026-11-05', '2026-11-06T08:00')).state).toBe('missing');
    expect((await dayOf(companyId, '2026-10-31', '2026-11-06T08:00')).state).toBe('not_required');
    const month = await inCompany(companyId, (tx) =>
      readReconciliationMonth(tx, {
        month: '2026-11',
        today: '2026-11-06',
        now: '2026-11-06T08:00',
      }),
    );
    expect(month.days[4]).toMatchObject({
      date: '2026-11-05',
      state: 'missing',
      clients: [{ clientId, hubCount: null, receivedCount: 1 }],
    });
    expect(month.matchedStreak).toBe(0);
    const unclean = await inCompany(companyId, (tx) =>
      uncleanReconciliationDays(tx, {
        today: '2026-11-06',
        now: '2026-11-06T08:00',
        limit: 31,
      }),
    );
    expect(unclean.map((day) => day.date)).toEqual([
      '2026-11-05',
      '2026-11-04',
      '2026-11-03',
      '2026-11-02',
      '2026-11-01',
    ]);
  });

  it('keeps each client to its own events and start date (rule 14, edge case 9)', async () => {
    const { companyId, clientId } = await newCompany();
    const second = await newClient(companyId, '2026-11-10', 'Vertex Hub 2');
    const mine = issued('2026-11-03', 3_000);
    await receive(companyId, clientId, mine);
    const theirs = await inCompany(companyId, (tx) =>
      readReceivedEvents(tx, { apiClientId: second, date: '2026-11-03' }),
    );
    expect(theirs).toEqual({ events: [], next_cursor: null });
    const page = await inCompany(companyId, (tx) =>
      readReceivedEvents(tx, { apiClientId: clientId, date: '2026-11-03' }),
    );
    expect(page.events).toMatchObject([
      {
        id: mine.id,
        type: 'invoice.issued',
        version: 1,
        amount: { currency: 'USD', amount: 3_000 },
      },
    ]);
    expect(page.next_cursor).toBeNull();
    expect(
      await codeOf(
        inCompany(companyId, (tx) =>
          readReceivedEvents(tx, { apiClientId: clientId, date: '2026-11-03', cursor: uuidv7() }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    await send(companyId, clientId, reportOf('2026-11-03', [mine]));
    const day = await dayOf(companyId, '2026-11-03');
    expect(day.clients.map((client) => [client.client.id, client.state])).toEqual([
      [clientId, 'matched'],
      [second, 'not_required'],
    ]);
  });
});

describe('the checklist item reconciliation_clean (S08 rule 12)', () => {
  it('is not applicable without a client, and fails per day until every day is reported', async () => {
    const none = await newCompany(null);
    expect(await reconciliationItem(none.companyId, '2026-10')).toMatchObject({
      result: 'not_applicable',
    });
    const { companyId, clientId } = await newCompany('2026-10-20');
    expect(await reconciliationItem(companyId, '2026-09')).toMatchObject({
      result: 'not_applicable',
    });
    expect(await reconciliationItem(companyId, '2026-10')).toMatchObject({
      result: 'failed',
      count: 12,
    });
    const event = issued('2026-10-25', 11_000);
    await receive(companyId, clientId, event);
    for (let day = 20; day <= 31; day += 1) {
      const date = `2026-10-${day}`;
      await send(companyId, clientId, reportOf(date, []));
    }
    // The 25th's report lacks the event Mizan holds: one day fails.
    expect(await reconciliationItem(companyId, '2026-10')).toMatchObject({
      result: 'failed',
      count: 1,
    });
    await send(companyId, clientId, reportOf('2026-10-25', [event], '2026-10-26T09:00:00+03:00'));
    expect(await reconciliationItem(companyId, '2026-10')).toMatchObject({
      result: 'passed',
      count: 0,
    });
  });

  it('reads every day from the start date at the first close, which closes the months before (owner, 2026-11-12)', async () => {
    const { companyId, clientId } = await newCompany('2026-10-19');
    // Nothing arrives for October; November is reported in full and matched.
    for (const date of [...Array(30).keys()].map(
      (day) => `2026-11-${String(day + 1).padStart(2, '0')}`,
    )) {
      await send(companyId, clientId, reportOf(date, []));
    }
    expect(await reconciliationItem(companyId, '2026-11')).toMatchObject({
      result: 'failed',
      count: 13,
    });
    for (let day = 19; day <= 31; day += 1) {
      await send(companyId, clientId, reportOf(`2026-10-${day}`, []));
    }
    expect(await reconciliationItem(companyId, '2026-11')).toMatchObject({ result: 'passed' });
    // Once a month is closed, a later close reads its own month only.
    await closeMonthByHand(app, companyId, '2026-11');
    await send(
      companyId,
      clientId,
      reportOf('2026-10-20', [issued('2026-10-20', 1_000)], '2026-10-21T09:00:00+03:00'),
    );
    // December's 31 days, not October's difference on the 20th.
    expect(await reconciliationItem(companyId, '2026-12')).toMatchObject({
      result: 'failed',
      count: 31,
    });
  });

  it('lets a report commit while a close’s transaction runs, each reading consistent (rule 12)', async () => {
    const { companyId, clientId } = await newCompany('2026-10-31');
    let read: () => void = () => {};
    const checked = new Promise<void>((resolve) => {
      read = resolve;
    });
    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The close's order: the ledger head, then the checklist; the transaction stays open.
    const closing = inCompany(companyId, async (tx) => {
      await tx.execute(sql`select id from ledger_heads for update`);
      const before = await periodChecklist(tx, '2026-10', TODAY);
      read();
      await until;
      return before;
    });
    await checked;
    // The report waits for no ledger lock: it commits while the close's transaction is open.
    await send(companyId, clientId, reportOf('2026-10-31', []));
    release();
    const before = await closing;
    expect(before.find((item) => item.item === 'reconciliation_clean')).toMatchObject({
      result: 'failed',
      count: 1,
    });
    expect(await reconciliationItem(companyId, '2026-10')).toMatchObject({ result: 'passed' });
  });
});

describe('the start date (S08 rule 13)', () => {
  it('moves later only while no month it releases is closed, and earlier always', async () => {
    const { companyId } = await newCompany('2026-10-19');
    const move = (from: string | null, to: string) =>
      inCompany(companyId, (tx) => checkReconcileFromMove(tx, { from, to }));
    await move('2026-10-19', '2026-11-10');
    await closeMonthByHand(app, companyId, '2026-10');
    expect(await codeOf(move('2026-10-19', '2026-11-10'))).toBe('RECONCILIATION_START_LOCKED');
    // From the first day of the next month, no day of the closed month is released.
    expect(await codeOf(move('2026-10-19', '2026-11-01'))).toBe('RECONCILIATION_START_LOCKED');
    await move('2026-11-01', '2026-11-10');
    await move('2026-11-10', '2026-10-01');
    await move(null, '2026-11-10');
    // A move later waits for a close holding the ledger head, then sees the month closed.
    const { companyId: racing } = await newCompany('2026-11-01');
    let written: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      written = resolve;
    });
    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    const close = closeMonthByHand(app, racing, '2026-11', { written, until });
    await ready;
    let settled = false;
    const moving = codeOf(
      inCompany(racing, (tx) =>
        checkReconcileFromMove(tx, { from: '2026-11-01', to: '2026-12-01' }),
      ),
    ).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(settled).toBe(false);
    release();
    await close;
    expect(await moving).toBe('RECONCILIATION_START_LOCKED');
    // A report for a closed month is kept and compared like any other (rule 15).
    const day = await dayOf(companyId, '2026-10-25');
    expect(day).toMatchObject({ closed: true, state: 'missing' });
  });
});
