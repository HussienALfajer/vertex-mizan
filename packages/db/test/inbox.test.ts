import {
  ACTOR_KINDS,
  type CompanyLedgers,
  EVENT_ACTIONS,
  EVENT_STATES,
  type EventEnvelope,
  HOLD_REASONS,
  POSTING_SLOTS,
  parseEventEnvelope,
} from '@vertex-mizan/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AuditActor,
  chartAccounts,
  createCompanyBooks,
  dismissEvent,
  exchangeRates,
  INBOUND_ACTOR_KINDS,
  INBOUND_EVENT_ACTIONS,
  INBOUND_EVENT_STATES,
  INBOUND_HOLD_REASONS,
  inboundEventActions,
  inboundEventStates,
  inboundEvents,
  journalEntries,
  journalLines,
  moveEvent,
  openItemDueDates,
  openItems,
  type PersonActor,
  post,
  postingRuleAccounts,
  postingSlot,
  type RetryTrigger,
  receiveEvent,
  recordRate,
  resolveEvent,
  retryEvent,
  retryFreed,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S05's event inbox on the migrated database (0024, 0025): an event kept as received and posted
// through `post()` by its rule, replays and conflicts, two receipts at once, the order per item
// and the automatic retries, a move out of a closed month (the first case of
// `inbox/post-in-next-open-period`, whose setup the book cannot make before S07), the mapping, a
// rate from Hub, and the writes the service never makes, forged to prove the guards refuse them.
// Every value is synthetic.

const { app, jobs, superuser } = connect();

let personId = '';

const person = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-inbox-test',
  ipAddress: null,
  userAgent: null,
});

const CLIENT_ID = uuidv7();

const hub: AuditActor = {
  kind: 'api_client',
  clientId: CLIENT_ID,
  name: 'Vertex Hub',
  requestId: 'request-inbox-test',
  ipAddress: null,
  userAgent: null,
};

const system: AuditActor = {
  kind: 'system',
  name: 'Vertex',
  requestId: 'request-inbox-test',
  ipAddress: null,
  userAgent: null,
};

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

async function newCompany(
  template: 'service-agency' | 'general' = 'service-agency',
  bulletins: readonly [string, string][] = [],
): Promise<string> {
  const id = uuidv7();
  await withCompany(app, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة صندوق تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template,
        createdByUserId: personId,
      },
      person(),
    );
    for (const [on, rate] of bulletins) {
      await recordRate(tx, id, person(), {
        effectiveOn: on,
        base: 'USD',
        quote: 'SYP',
        rate,
        type: 'bulletin',
        source: 'manual',
      });
    }
  });
  return id;
}

const ids = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C1 = { external_id: ids(9001), code: 'C1', name: 'عميل تجريبي' };
const S1 = { external_id: ids(9002), code: 'S1', name: 'خدمة تجريبية' };

/** The bodies Hub sent, by event id: what the inbox keeps and hashes as received. */
const bodies = new Map<string, Record<string, unknown>>();

function envelope(type: string, on: string, payload: unknown, id = uuidv7()): EventEnvelope {
  const raw = {
    id,
    type,
    version: 1,
    occurred_at: `${on}T12:00:00+03:00`,
    accounting_date: on,
    payload,
  };
  const parsed = parseEventEnvelope(raw);
  bodies.set(id, raw);
  return parsed;
}

const invoiceRef = (n: number) => ({ id: ids(100 + n), number: `INV-2026-${n}` });

const issued = (n: number, on: string, amount: number, currency = 'USD', sypPerUsd = '119.0000') =>
  envelope('invoice.issued', on, {
    invoice: invoiceRef(n),
    client: C1,
    currency,
    syp_per_usd: sypPerUsd,
    issued_on: on,
    due_on: '2026-12-31',
    lines: [{ id: ids(200 + n), amount, service: S1, source: 'extra_work' }],
  });

const paid = (n: number, invoice: number, on: string, amount: number) =>
  envelope('payment.recorded', on, {
    payment: { id: ids(300 + n), number: `R-2026-${n}` },
    invoice: invoiceRef(invoice),
    paid_on: on,
    method: 'bank_transfer',
    currency: 'USD',
    amount,
    syp_per_usd: '122.0000',
    applied_amount: amount,
    invoice_currency: 'USD',
  });

/** Receives an event as `POST /v1/events` does, then runs the retries it frees. */
async function receive(
  companyId: string,
  event: EventEnvelope,
  today = '2026-11-30',
  raw: Record<string, unknown> = bodies.get(event.id) ?? (event as Record<string, unknown>),
) {
  const result = await inCompany(companyId, (tx) =>
    receiveEvent(
      tx,
      companyId,
      { raw, envelope: event, apiClientId: CLIENT_ID, requestId: 'request-inbox-test' },
      { actor: hub, today },
    ),
  );
  await retries(companyId, result.triggers);
  return result;
}

async function retries(companyId: string, triggers: readonly RetryTrigger[]) {
  await inCompany(companyId, (tx) =>
    retryFreed(tx, triggers, { actor: system, today: '2026-11-30' }),
  );
}

/** The company's entries in posting order, each line as account code, currency and amounts. */
async function ledger(companyId: string) {
  return inCompany(companyId, async (tx) => {
    const entries = await tx.select().from(journalEntries).orderBy(asc(journalEntries.sequence));
    const lines = await tx
      .select({ line: journalLines, code: chartAccounts.code })
      .from(journalLines)
      .innerJoin(
        chartAccounts,
        and(
          eq(chartAccounts.companyId, journalLines.companyId),
          eq(chartAccounts.id, journalLines.accountId),
        ),
      )
      .orderBy(asc(journalLines.lineNo));
    return entries.map((entry) => ({
      date: entry.entryDate,
      lines: lines
        .filter(({ line }) => line.entryId === entry.id)
        .map(({ line, code }) => [
          code,
          line.currency,
          line.amountMinor,
          line.bookMinor,
          line.parallelMinor,
        ]),
    }));
  });
}

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: `inbox-${uuidv7()}@example.test`, name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  personId = row?.id as string;
});

describe('the inbox tables', () => {
  it('keep the lists of the contracts', () => {
    expect(postingSlot.enumValues).toEqual([...POSTING_SLOTS]);
    expect(INBOUND_EVENT_STATES).toEqual(EVENT_STATES);
    expect(INBOUND_HOLD_REASONS).toEqual(HOLD_REASONS);
    expect(INBOUND_EVENT_ACTIONS).toEqual(EVENT_ACTIONS);
    expect(INBOUND_ACTOR_KINDS).toEqual(ACTOR_KINDS);
  });

  it('map the service-agency slots at company creation, and none of the general template', async () => {
    const agency = await newCompany();
    const general = await newCompany('general');
    const mapped = (companyId: string) =>
      inCompany(companyId, (tx) =>
        tx
          .select({
            slot: postingRuleAccounts.slot,
            currency: postingRuleAccounts.currency,
            code: chartAccounts.code,
          })
          .from(postingRuleAccounts)
          .innerJoin(chartAccounts, eq(chartAccounts.id, postingRuleAccounts.accountId)),
      );
    const rows = await mapped(agency);
    expect(rows).toHaveLength(13);
    expect(rows).toContainEqual({ slot: 'payment_method.cash', currency: 'USD', code: '111002' });
    expect(await mapped(general)).toEqual([]);
  });
});

describe('an event received (S05 rules 1–7)', () => {
  it('posts once through post(), from Hub, and answers a replay with the same state', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    const event = issued(1, '2026-11-03', 10_000);
    const first = await receive(company, event);
    expect(first.event).toMatchObject({ state: 'posted', reason: null });
    expect(first.event.entries).toHaveLength(1);
    const [entry] = await inCompany(company, (tx) => tx.select().from(journalEntries));
    expect(entry).toMatchObject({
      source: 'hub_event',
      sourceRef: first.event.inboxId,
      hubDocument: { type: 'invoice', id: ids(101), number: 'INV-2026-1' },
      postedByClientId: CLIENT_ID,
      postedByUserId: null,
      reference: 'INV-2026-1',
      description: 'فاتورة INV-2026-1 — عميل تجريبي',
    });
    const [item] = await inCompany(company, (tx) => tx.select().from(openItems));
    expect(item).toMatchObject({
      source: 'hub_event',
      reference: 'INV-2026-1',
      documentDate: '2026-11-03',
    });
    const again = await receive(company, event);
    expect(again).toMatchObject({
      replayed: true,
      event: { state: 'posted', entries: first.event.entries },
    });
    expect(await ledger(company)).toHaveLength(1);
    const actions = await inCompany(company, (tx) =>
      tx
        .select({ action: inboundEventActions.action })
        .from(inboundEventActions)
        .orderBy(asc(inboundEventActions.createdAt)),
    );
    expect(actions.map((row) => row.action)).toEqual(['received', 'posted', 'replayed']);
  });

  it('refuses the same event ID with another payload, storing nothing', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    const event = issued(1, '2026-11-03', 10_000);
    await receive(company, event);
    const changed = {
      ...event,
      payload: { ...event.payload, syp_per_usd: '119.5000' },
    } as EventEnvelope;
    await expect(receive(company, changed, '2026-11-30', changed)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    // A body that parses to the same envelope is still another payload: a field's whitespace, a
    // field the contract does not know. The hash is of what Hub sent (rule 4).
    const sent = bodies.get(event.id) as { payload: Record<string, unknown> };
    for (const payload of [
      { ...sent.payload, invoice: { id: ids(101), number: ' INV-2026-1' } },
      { ...sent.payload, note: 'حقل إضافي' },
    ]) {
      await expect(
        receive(company, event, '2026-11-30', { ...sent, payload }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    }
    const stored = await inCompany(company, (tx) => tx.select().from(inboundEvents));
    expect(stored).toHaveLength(1);
  });

  it('stores one of two receipts of one event at once; the other answers as a replay', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    const event = issued(1, '2026-11-03', 10_000);
    const both = await Promise.all([receive(company, event), receive(company, event)]);
    expect(both.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(await ledger(company)).toHaveLength(1);
  });

  it('never lets the accountant reverse a Hub entry by hand (rule 14)', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    const { event } = await receive(company, issued(1, '2026-11-03', 10_000));
    const entryId = event.entries[0]?.id as string;
    await expect(
      inCompany(company, (tx) =>
        post(tx, {
          client: 'manual',
          idempotencyKey: `reversal:${entryId}`,
          entryDate: '2026-11-10',
          description: 'عكس',
          reference: null,
          draftId: null,
          preparedByUserId: personId,
          approvedByUserId: null,
          actor: person(),
          content: { kind: 'reversal', entryId, today: '2026-11-10' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_REVERSIBLE' });
  });
});

describe('the order per item and the retries (rules 10–11)', () => {
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ] as const;

  it('posts an invoice and its two payments as in Hub’s order, whatever the order of arrival', async () => {
    const bulletins: [string, string][] = [
      ['2026-11-03', '120.0000'],
      ['2026-11-19', '123.0000'],
      ['2026-11-25', '123.5000'],
    ];
    const events = [
      issued(1, '2026-11-03', 100_000),
      paid(1, 1, '2026-11-19', 40_000),
      paid(2, 1, '2026-11-25', 60_000),
    ];
    const hubOrder = await newCompany('service-agency', bulletins);
    for (const event of events) await receive(hubOrder, event);
    const expected = await ledger(hubOrder);
    expect(expected).toHaveLength(3);
    for (const order of orders) {
      const company = await newCompany('service-agency', bulletins);
      // The payments' order among themselves is Hub's: a later payment waits behind the earlier.
      const arrival = order.map((index) => events[index] as EventEnvelope);
      for (const event of arrival) await receive(company, event);
      const posted = await ledger(company);
      expect(posted.map((entry) => entry.date).sort()).toEqual(
        expected.map((entry) => entry.date).sort(),
      );
      for (const entry of expected) expect(posted).toContainEqual(entry);
      // A replay of every event, in any order, posts nothing new.
      for (const event of [...arrival].reverse()) await receive(company, event);
      expect(await ledger(company)).toHaveLength(3);
    }
  });

  it('retries a RATE_MISSING event once the bulletin is recorded, and posts it once', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    await receive(company, issued(1, '2026-11-03', 10_000));
    const held = await receive(company, paid(1, 1, '2026-11-19', 10_000));
    expect(held.event).toMatchObject({ state: 'held', reason: 'RATE_MISSING' });
    // Retries before the rate exists keep it held with no new action.
    for (let n = 0; n < 3; n += 1) {
      await inCompany(company, (tx) =>
        retryEvent(tx, held.event.inboxId, { actor: person(), today: '2026-11-30' }),
      );
    }
    await inCompany(company, (tx) =>
      recordRate(tx, company, person(), {
        effectiveOn: '2026-11-19',
        base: 'USD',
        quote: 'SYP',
        rate: '123.0000',
        type: 'bulletin',
        source: 'manual',
      }),
    );
    await retries(company, [{ kind: 'rate', on: '2026-11-19' }]);
    await retries(company, [{ kind: 'rate', on: '2026-11-19' }, { kind: 'sweep' }]);
    const posted = await ledger(company);
    expect(posted).toHaveLength(2);
    expect(posted[1]?.lines).toContainEqual(['421001', 'SYP', -30_000n, -30_000n, 0n]);
    const actions = await inCompany(company, (tx) =>
      tx
        .select({ action: inboundEventActions.action, actorKind: inboundEventActions.actorKind })
        .from(inboundEventActions)
        .where(eq(inboundEventActions.eventId, held.event.inboxId))
        .orderBy(asc(inboundEventActions.createdAt)),
    );
    expect(actions.map((row) => row.action)).toEqual([
      'received',
      'held',
      'retried',
      'retried',
      'retried',
      'posted',
    ]);
  });

  it('holds NO_MAPPING naming the slot, and posts once the slot is mapped again', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    await inCompany(company, (tx) =>
      tx
        .update(postingRuleAccounts)
        .set({ archivedAt: sql`now()` })
        .where(eq(postingRuleAccounts.slot, 'revenue_at_issue')),
    );
    const held = await receive(company, issued(1, '2026-11-03', 10_000));
    expect(held.event).toMatchObject({
      reason: 'NO_MAPPING',
      detail: 'slot_unmapped:revenue_at_issue',
    });
    await inCompany(company, (tx) =>
      tx
        .update(postingRuleAccounts)
        .set({ archivedAt: null })
        .where(eq(postingRuleAccounts.slot, 'revenue_at_issue')),
    );
    await retries(company, [{ kind: 'mapping' }]);
    expect(await ledger(company)).toHaveLength(1);
  });
});

describe('a move out of a closed month (rule 15; inbox/post-in-next-open-period)', () => {
  it('posts on the first open day at the bulletin of its own date; the payment behind it then posts', async () => {
    const company = await newCompany('service-agency', [
      ['2026-10-28', '118.0000'],
      ['2026-11-01', '120.0000'],
      ['2026-11-05', '121.0000'],
    ]);
    // S07 brings the close; here the superuser closes October, as the ledger tests do.
    const closer = await superuser.connect();
    try {
      await closer.query('begin');
      await closer.query('alter table periods disable trigger period_rules');
      await closer.query(
        `insert into periods (id, company_id, period, fiscal_year, state) values ($1, $2, '2026-10', 2026, 'closed')`,
        [uuidv7(), company],
      );
      await closer.query('alter table periods enable always trigger period_rules');
      await closer.query('commit');
    } finally {
      closer.release();
    }
    const invoice = await receive(company, issued(1, '2026-10-28', 100_000));
    expect(invoice.event).toMatchObject({ state: 'held', reason: 'PERIOD_CLOSED' });
    const payment = await receive(company, paid(1, 1, '2026-11-05', 40_000));
    expect(payment.event).toMatchObject({ state: 'held', reason: 'WAITING_FOR_EARLIER_EVENT' });
    const retried = await inCompany(company, (tx) =>
      retryEvent(tx, invoice.event.inboxId, { actor: person(), today: '2026-11-05' }),
    );
    expect(retried.event).toMatchObject({ state: 'held', reason: 'PERIOD_CLOSED' });
    const moved = await inCompany(company, (tx) =>
      moveEvent(tx, invoice.event.inboxId, 'وصلت الفاتورة بعد إقفال تشرين الأول', {
        actor: person(),
        today: '2026-11-05',
      }),
    );
    expect(moved.event).toMatchObject({ state: 'posted', postedOn: '2026-11-01' });
    await retries(company, moved.triggers);
    expect(await ledger(company)).toEqual([
      {
        date: '2026-11-01',
        lines: [
          ['112001', 'USD', 100_000n, 11_800_000n, 100_000n],
          ['411001', 'USD', -100_000n, -11_800_000n, -100_000n],
        ],
      },
      {
        date: '2026-11-05',
        lines: [
          ['111004', 'USD', 40_000n, 4_840_000n, 40_000n],
          ['112001', 'USD', -40_000n, -4_720_000n, -40_000n],
          ['421001', 'SYP', -120_000n, -120_000n, 0n],
        ],
      },
    ]);
    // The item keeps the invoice's own date for its ageing; its due date runs from it.
    const [item] = await inCompany(company, (tx) => tx.select().from(openItems));
    expect(item?.documentDate).toBe('2026-10-28');
    const dueDates = await inCompany(company, (tx) => tx.select().from(openItemDueDates));
    expect(dueDates).toMatchObject([
      { effectiveOn: '2026-10-28', dueOn: '2026-12-31', setBy: 'opening' },
    ]);
  });
});

describe('records (ADR 0014 `recorded`)', () => {
  it('records a due date and Hub’s rate; the same rate is a no-op, another one a correction', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    await receive(company, issued(1, '2026-11-03', 10_000));
    const due = await receive(
      company,
      envelope('invoice.due_date_changed', '2026-11-24', {
        invoice: invoiceRef(1),
        due_on: '2027-01-15',
      }),
    );
    expect(due.event.state).toBe('recorded');
    const rate = (value: string) =>
      envelope('rate.changed', '2026-11-24', { effective_on: '2026-11-24', syp_per_usd: value });
    expect((await receive(company, rate('124.0000'))).event.state).toBe('recorded');
    expect((await receive(company, rate('124.0000'))).event.state).toBe('recorded');
    expect((await receive(company, rate('124.5000'))).event.state).toBe('recorded');
    const rows = await inCompany(company, (tx) =>
      tx
        .select({
          rate: exchangeRates.rate,
          source: exchangeRates.source,
          reason: exchangeRates.reason,
        })
        .from(exchangeRates)
        .where(eq(exchangeRates.type, 'market'))
        .orderBy(asc(exchangeRates.createdAt)),
    );
    expect(rows).toEqual([
      { rate: '124.0000000000', source: 'hub', reason: null },
      { rate: '124.5000000000', source: 'hub', reason: 'تصحيح من Hub' },
    ]);
  });
});

describe('the guards as the app role (0025)', () => {
  it('keep the events and their actions append-only, and only a held state changes', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    const { event } = await receive(company, issued(1, '2026-11-03', 10_000));
    expect(
      await refusal(
        inCompany(company, (tx) => tx.update(inboundEvents).set({ type: 'invoice.voided' })),
      ),
    ).toMatch(/permission denied|append-only/);
    expect(await refusal(inCompany(company, (tx) => tx.delete(inboundEventActions)))).toMatch(
      /append-only|permission/,
    );
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx.update(inboundEventStates).set({ state: 'held', holdReason: 'NO_MAPPING' }),
        ),
      ),
    ).toMatch(/no longer changes/);
    expect(await refusal(inCompany(company, (tx) => tx.delete(inboundEventStates)))).toMatch(
      /permission|never deleted/,
    );
    // A state stored resolved, or resolved by an entry that is not manual, is refused.
    expect(
      await refusal(
        inCompany(company, async (tx) => {
          const [other] = await tx
            .insert(inboundEvents)
            .values({
              companyId: company,
              apiClientId: CLIENT_ID,
              eventId: uuidv7(),
              type: 'invoice.voided',
              version: 1,
              occurredAt: new Date(),
              accountingDate: '2026-11-04',
              payload: {},
              payloadHash: 'c'.repeat(64),
              documentType: 'invoice',
              documentId: ids(101),
              requestId: 'forged',
            })
            .returning({ id: inboundEvents.id });
          await tx.insert(inboundEventStates).values({
            companyId: company,
            eventId: other?.id as string,
            state: 'resolved',
            resolvedByEntryId: event.entries[0]?.id as string,
          });
        }),
      ),
    ).toMatch(/stored held, posted or recorded/);
  });

  it('let the jobs role see that a company has held events, and nothing else', async () => {
    const company = await newCompany('service-agency');
    await receive(company, issued(1, '2026-11-03', 10_000));
    const rows = await jobs
      .select({ companyId: inboundEventStates.companyId, state: inboundEventStates.state })
      .from(inboundEventStates)
      .where(eq(inboundEventStates.companyId, company));
    expect(rows).toEqual([{ companyId: company, state: 'held' }]);
    expect(
      await refusal(
        jobs.select({ reason: inboundEventStates.holdReason }).from(inboundEventStates),
      ),
    ).toMatch(/permission denied/);
    expect(await refusal(jobs.select({ id: inboundEvents.id }).from(inboundEvents))).toMatch(
      /permission denied/,
    );
  });
});

const recordBulletin = (companyId: string, on: string, rate: string) =>
  inCompany(companyId, (tx) =>
    recordRate(tx, companyId, person(), {
      effectiveOn: on,
      base: 'USD',
      quote: 'SYP',
      rate,
      type: 'bulletin',
      source: 'manual',
    }),
  );

describe('exactly once through any sequence (S05 "Acceptance", tests)', () => {
  const events = [
    issued(1, '2026-11-03', 100_000),
    paid(1, 1, '2026-11-19', 40_000),
    paid(2, 1, '2026-11-25', 60_000),
  ];
  type Op =
    | { kind: 'receive'; event: number }
    | { kind: 'retry'; event: number }
    | { kind: 'freed'; trigger: 'sweep' | 'item' | 'rate' }
    | { kind: 'bulletin' };
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('receive' as const), event: fc.integer({ min: 0, max: 2 }) }),
    fc.record({ kind: fc.constant('retry' as const), event: fc.integer({ min: 0, max: 2 }) }),
    fc.record({
      kind: fc.constant('freed' as const),
      trigger: fc.constantFrom('sweep' as const, 'item' as const, 'rate' as const),
    }),
    fc.record({ kind: fc.constant('bulletin' as const) }),
  );

  it('posts each event once, Hub’s entries, whatever arrives, replays and retries in between', async () => {
    const expected = await (async () => {
      const company = await newCompany('service-agency', [
        ['2026-11-03', '120.0000'],
        ['2026-11-19', '123.0000'],
        ['2026-11-25', '123.5000'],
      ]);
      for (const event of events) await receive(company, event);
      return ledger(company);
    })();
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 10 }), async (ops) => {
        // The bulletin of 19 November is missing until a `bulletin` step records it.
        const company = await newCompany('service-agency', [
          ['2026-11-03', '120.0000'],
          ['2026-11-25', '123.5000'],
        ]);
        let recorded = false;
        const inboxIds = new Map<number, string>();
        const run = async (step: Op) => {
          switch (step.kind) {
            case 'receive': {
              const result = await receive(company, events[step.event] as EventEnvelope);
              inboxIds.set(step.event, result.event.inboxId);
              return;
            }
            case 'retry': {
              const id = inboxIds.get(step.event);
              if (id === undefined) return;
              await inCompany(company, (tx) =>
                retryEvent(tx, id, { actor: person(), today: '2026-11-30' }),
              ).catch((error: { code?: string }) => {
                if (error.code !== 'EVENT_NOT_HELD') throw error;
              });
              return;
            }
            case 'freed':
              await retries(company, [
                step.trigger === 'item'
                  ? { kind: 'item', itemKey: `invoice:${ids(101)}` }
                  : step.trigger === 'rate'
                    ? { kind: 'rate', on: '2026-11-19' }
                    : { kind: 'sweep' },
              ]);
              return;
            case 'bulletin':
              if (!recorded) await recordBulletin(company, '2026-11-19', '123.0000');
              recorded = true;
              return;
          }
        };
        for (const step of ops) await run(step);
        // Then every event arrives (again, for some), the bulletin is recorded and the sweep runs.
        for (const index of [0, 1, 2]) await run({ kind: 'receive', event: index });
        if (!recorded) await recordBulletin(company, '2026-11-19', '123.0000');
        await retries(company, [{ kind: 'rate', on: '2026-11-19' }, { kind: 'sweep' }]);
        const posted = await ledger(company);
        expect(posted).toHaveLength(3);
        for (const entry of expected) expect(posted).toContainEqual(entry);
        const keys = await inCompany(company, (tx) =>
          tx.execute<{ n: number }>(
            sql`select count(*)::int as n from posting_requests group by client, idempotency_key having count(*) > 1`,
          ),
        );
        expect(keys.rows).toEqual([]);
      }),
      { numRuns: 12 },
    );
  }, 120_000);
});

describe('two writers at once', () => {
  it('serialise an invoice and its payment received at once on the ledger head', async () => {
    const company = await newCompany('service-agency', [
      ['2026-11-03', '120.0000'],
      ['2026-11-19', '123.0000'],
    ]);
    const [invoice, payment] = await Promise.all([
      receive(company, issued(1, '2026-11-03', 100_000)),
      receive(company, paid(1, 1, '2026-11-19', 40_000)),
    ]);
    // Whichever committed first, the payment ends posted against the invoice's item, once.
    if (payment.event.state === 'held') {
      expect(payment.event.reason).toBe('UNKNOWN_REFERENCE');
      await retries(company, invoice.triggers);
    }
    expect(await ledger(company)).toHaveLength(2);
  });

  it('post a held event once when the worker’s retry and the accountant’s retry race', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    await receive(company, issued(1, '2026-11-03', 10_000));
    const held = await receive(company, paid(1, 1, '2026-11-19', 10_000));
    await recordBulletin(company, '2026-11-19', '123.0000');
    const outcomes = await Promise.allSettled([
      retries(company, [{ kind: 'rate', on: '2026-11-19' }]),
      inCompany(company, (tx) =>
        retryEvent(tx, held.event.inboxId, { actor: person(), today: '2026-11-30' }),
      ),
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toMatchObject({ code: 'EVENT_NOT_HELD' });
      }
    }
    expect(await ledger(company)).toHaveLength(2);
  });
});

describe('the accountant’s actions refused (rules 15–17)', () => {
  it('resolve and dismiss only a held event, by a free manual entry, for its own hold', async () => {
    const company = await newCompany('service-agency', [
      ['2026-11-03', '120.0000'],
      ['2026-11-19', '123.0000'],
    ]);
    const invoice = await receive(company, issued(1, '2026-11-03', 100_000));
    const options = { actor: person(), today: '2026-11-30' };
    const code = (work: Promise<unknown>) =>
      work.then(
        () => 'none',
        (error: { code?: string }) => error.code ?? String(error),
      );
    const inboxId = invoice.event.inboxId;
    const entryId = invoice.event.entries[0]?.id as string;
    expect(await code(inCompany(company, (tx) => dismissEvent(tx, inboxId, 'سبب', options)))).toBe(
      'EVENT_NOT_HELD',
    );
    // A payment beyond the open amount needs the accountant.
    const over = await receive(company, paid(1, 1, '2026-11-19', 200_000));
    expect(over.event).toMatchObject({ reason: 'NEEDS_DECISION', detail: 'payment_exceeds_open' });
    const id = over.event.inboxId;
    expect(
      await code(inCompany(company, (tx) => resolveEvent(tx, id, uuidv7(), 'سبب', options))),
    ).toBe('NOT_FOUND');
    // A Hub entry never resolves an event: only a manual entry the accountant posted.
    expect(
      await code(inCompany(company, (tx) => resolveEvent(tx, id, entryId, 'سبب', options))),
    ).toBe('ENTRY_ALREADY_LINKED');
    expect(await code(inCompany(company, (tx) => moveEvent(tx, id, 'سبب', options)))).toBe(
      'EVENT_ACTION_NOT_ALLOWED',
    );
    expect(
      (await inCompany(company, (tx) => dismissEvent(tx, id, 'سبب', options))).event.state,
    ).toBe('dismissed');
    expect(await code(inCompany(company, (tx) => dismissEvent(tx, id, 'سبب', options)))).toBe(
      'EVENT_NOT_HELD',
    );
    // And the guard refuses a dismissed event's return to held, whoever writes it.
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx
            .update(inboundEventStates)
            .set({ state: 'held', holdReason: 'NEEDS_DECISION' })
            .where(eq(inboundEventStates.eventId, id)),
        ),
      ),
    ).toMatch(/no longer changes/);
  });
});

describe('a line’s service change (revenue/revenue-at-issue; accounting review)', () => {
  const S3 = { external_id: ids(9003), code: 'S3', name: 'خدمة ثالثة' };
  const S4 = { external_id: ids(9004), code: 'S4', name: 'خدمة رابعة' };
  const change = (on: string, from: typeof S1, to: typeof S1) =>
    envelope('invoice.line_service_changed', on, {
      invoice: invoiceRef(1),
      line_id: ids(201),
      old_service: from,
      new_service: to,
      changed_on: on,
    });

  it('moves the service the line has in the books, whatever old service Hub names', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    await receive(company, issued(1, '2026-11-03', 30_000));
    await receive(company, change('2026-11-10', S1, S3));
    // Hub names S1 again: the line is on S3 in the books, so S3 moves to S4.
    await receive(company, change('2026-11-12', S1, S4));
    const byService = await inCompany(company, (tx) =>
      tx.execute<{ code: string; book: string }>(sql`
        select v.code, sum(l.book_minor)::text as book
        from journal_lines l
        join dimension_set_values sv on sv.set_id = l.dimension_set_id
        join dimension_types t on t.id = sv.type_id and t.code = 'service'
        join dimension_values v on v.id = sv.value_id
        group by v.code order by v.code`),
    );
    expect(byService.rows).toEqual([
      { code: 'S1', book: '0' },
      { code: 'S3', book: '0' },
      { code: 'S4', book: '-3600000' },
    ]);
  });

  it('holds a change received after its invoice’s void: no revenue is left to move', async () => {
    const company = await newCompany('service-agency', [['2026-11-03', '120.0000']]);
    await receive(company, issued(1, '2026-11-03', 30_000));
    await receive(
      company,
      envelope('invoice.voided', '2026-11-24', {
        invoice: invoiceRef(1),
        voided_on: '2026-11-24',
        reason: 'أُلغيت',
      }),
    );
    const late = await receive(company, change('2026-11-25', S1, S3));
    expect(late.event).toMatchObject({ state: 'held', reason: 'UNKNOWN_REFERENCE' });
    expect(await ledger(company)).toHaveLength(2);
  });
});
