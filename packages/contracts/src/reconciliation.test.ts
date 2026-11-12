import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApiClientSchema, needsReconcileFrom } from './api-clients.js';
import { emailDataSchemas } from './email.js';
import { EVENT_TYPES, type EventEnvelope, parseEventEnvelope } from './events.js';
import { eventExamplesV1 } from './hub-examples.js';
import {
  dayStateIsClean,
  eventTypeHasAmount,
  HUB_DELIVERY_STATES,
  RECONCILIATION_DAY_STATES,
  RECONCILIATION_KINDS,
  RECONCILIATION_REPORT_EVENT_LIMIT,
  type ReconciliationReport,
  receivedEventsQuerySchema,
  reconciliationAmountOf,
  reconciliationReportSchema,
  totalsOf,
  wireAmountOf,
  worstDayState,
} from './reconciliation.js';

// Synthetic ids only (AGENTS.md: public repository).
const id = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;

const examples = eventExamplesV1('2026-11-03').map((example) => parseEventEnvelope(example));

const exampleOf = <T extends EventEnvelope['type']>(type: T) =>
  examples.find((event) => event.type === type) as Extract<EventEnvelope, { type: T }>;

describe('reconciliationAmountOf (S08 rule 2)', () => {
  it('gives each type with an amount its currency and minor units, and the others none', () => {
    const amounts = Object.fromEntries(
      examples.map((event) => [event.type, reconciliationAmountOf(event)]),
    );
    expect(amounts).toEqual({
      'invoice.issued': { currency: 'USD', amount: 50_000n },
      'invoice.voided': null,
      'invoice.line_service_changed': null,
      'invoice.due_date_changed': null,
      'payment.recorded': expect.objectContaining({ amount: expect.any(BigInt) }),
      'payment.voided': null,
      'milestone.done': expect.objectContaining({ amount: expect.any(BigInt) }),
      'project.completed': null,
      'project.cancelled': null,
      'project_expense.recorded': expect.objectContaining({ amount: expect.any(BigInt) }),
      'project_expense.changed': expect.objectContaining({ amount: expect.any(BigInt) }),
      'project_expense.archived': null,
      'ad_wallet.deposited': expect.objectContaining({ amount: expect.any(BigInt) }),
      'ad_wallet.refunded': expect.objectContaining({ amount: expect.any(BigInt) }),
      'ad_wallet.entry_voided': null,
      'ad_spend.recorded': expect.objectContaining({ currency: 'USD' }),
      'ad_spend.changed': expect.objectContaining({ currency: 'USD' }),
      'ad_spend.archived': null,
      'rate.changed': null,
      'milestone.reopened': null,
    });
    for (const type of EVENT_TYPES) {
      expect(eventTypeHasAmount(type)).toBe(amounts[type] !== null);
    }
  });

  it('reads a payment, an expense and a wallet entry in their own currency and amount', () => {
    const payment = exampleOf('payment.recorded');
    expect(reconciliationAmountOf(payment)).toEqual({
      currency: payment.payload.currency,
      amount: BigInt(payment.payload.amount),
    });
    const spend = exampleOf('ad_spend.recorded');
    expect(reconciliationAmountOf(spend)).toEqual({
      currency: 'USD',
      amount: BigInt(spend.payload.usd_spend),
    });
  });

  it('sums an invoice with a retainer credit negative and its lines’ taxes (edge cases 7, 8)', () => {
    const invoice = exampleOf('invoice.issued');
    const base = invoice.payload.lines[0];
    if (!base) throw new Error('the example has a line');
    const lines = [
      {
        ...base,
        id: id(1),
        amount: 30_000,
        source: 'retainer_charge' as const,
        charge_kind: 'monthly' as const,
        taxes: [{ code: 'VAT', base: 30_000, rate: '5', amount: 1_500 }],
      },
      {
        ...base,
        id: id(2),
        amount: -45_000,
        source: 'retainer_charge' as const,
        charge_kind: 'credit' as const,
      },
    ];
    const credit = parseEventEnvelope({ ...invoice, payload: { ...invoice.payload, lines } });
    expect(reconciliationAmountOf(credit)).toEqual({ currency: 'USD', amount: -13_500n });
    expect(wireAmountOf(reconciliationAmountOf(credit))).toEqual({
      currency: 'USD',
      amount: -13_500,
    });
    expect(wireAmountOf(null)).toBeNull();
  });
});

/** A report of some example events as Hub would build it: consistent with itself. */
function reportOf(events: EventEnvelope[]): ReconciliationReport {
  const listed = events.map((event) => {
    const amount = wireAmountOf(reconciliationAmountOf(event));
    return {
      id: event.id,
      type: event.type,
      ...(amount ? { amount } : {}),
      delivery: 'delivered' as const,
    };
  });
  return {
    id: id(900),
    date: '2026-11-03',
    generated_at: '2026-11-04T00:05:00+03:00',
    events: listed,
    totals: totalsOf(
      events.map((event) => ({ type: event.type, amount: reconciliationAmountOf(event) })),
    ).map((total) => ({
      type: total.type,
      currency: total.currency,
      count: total.count,
      amount: total.amount === null ? null : Number(total.amount),
    })),
  };
}

const issuesOf = (input: unknown) => {
  const result = reconciliationReportSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('the report (S08 rules 1, 4)', () => {
  it('accepts a report consistent with itself, and a day with no events (edge case 1)', () => {
    expect(issuesOf(reportOf(examples))).toEqual([]);
    expect(issuesOf({ ...reportOf([]), events: [], totals: [] })).toEqual([]);
  });

  it('refuses an event twice', () => {
    const invoice = exampleOf('invoice.issued');
    expect(issuesOf(reportOf([invoice, invoice]))).toEqual(['events.1.id']);
  });

  it('refuses an amount present for a type without one, or missing for a type with one', () => {
    const report = reportOf([exampleOf('invoice.issued'), exampleOf('invoice.voided')]);
    const [issued, voided] = report.events;
    if (!issued || !voided) throw new Error('two events');
    const { amount: _amount, ...withoutAmount } = issued;
    expect(issuesOf({ ...report, events: [withoutAmount, voided] })).toContain('events.0.amount');
    expect(
      issuesOf({
        ...report,
        events: [issued, { ...voided, amount: { currency: 'USD', amount: 1 } }],
      }),
    ).toContain('events.1.amount');
  });

  it('names a refusal code on a refused event only (rule 3)', () => {
    const report = reportOf([exampleOf('invoice.voided')]);
    const [voided] = report.events;
    if (!voided) throw new Error('one event');
    expect(issuesOf({ ...report, events: [{ ...voided, delivery: 'refused' }] })).toContain(
      'events.0.refusal_code',
    );
    expect(
      issuesOf({ ...report, events: [{ ...voided, refusal_code: 'VALIDATION_FAILED' }] }),
    ).toContain('events.0.refusal_code');
    expect(
      issuesOf({
        ...report,
        events: [{ ...voided, delivery: 'refused', refusal_code: 'VALIDATION_FAILED' }],
      }),
    ).toEqual([]);
  });

  it('refuses totals that are not the sums of its events (a report cut short)', () => {
    const report = reportOf(examples);
    const cut = { ...report, events: report.events.slice(1) };
    expect(issuesOf(cut)).toContain('totals.0');
    const missing = { ...report, totals: report.totals.slice(1) };
    expect(issuesOf(missing)).toContain('totals');
    const [first, ...rest] = report.totals;
    if (!first) throw new Error('totals');
    expect(issuesOf({ ...report, totals: [first, first, ...rest] })).toContain('totals.1');
    expect(
      issuesOf({ ...report, totals: [{ ...first, count: first.count + 1 }, ...rest] }),
    ).toContain('totals.0');
  });

  it('keeps at most 5 000 events', () => {
    expect(RECONCILIATION_REPORT_EVENT_LIMIT).toBe(5000);
  });
});

describe('the comparison’s lists (S08 rules 3, 8, 10)', () => {
  it('keep their published order', () => {
    expect(HUB_DELIVERY_STATES).toEqual(['pending', 'delivered', 'refused']);
    expect(RECONCILIATION_KINDS).toEqual([
      'matched',
      'missing_in_mizan',
      'missing_in_hub',
      'date_differs',
      'type_differs',
      'amount_differs',
    ]);
    expect(RECONCILIATION_DAY_STATES).toEqual([
      'not_required',
      'pending',
      'missing',
      'differences',
      'matched',
    ]);
  });

  it('make a company’s day the worst of its clients’ (rule 10)', () => {
    expect(worstDayState([])).toBe('not_required');
    expect(worstDayState(['matched', 'not_required'])).toBe('matched');
    expect(worstDayState(['matched', 'pending'])).toBe('pending');
    expect(worstDayState(['pending', 'differences'])).toBe('differences');
    expect(worstDayState(['differences', 'missing', 'matched'])).toBe('missing');
    expect(RECONCILIATION_DAY_STATES.filter(dayStateIsClean)).toEqual(['not_required', 'matched']);
  });
});

describe('the start date (S08 rule 13, "Data")', () => {
  it('is required with events:write or reconciliation:write', () => {
    expect(needsReconcileFrom(['periods:read'])).toBe(false);
    expect(needsReconcileFrom(['events:write'])).toBe(true);
    expect(needsReconcileFrom(['reconciliation:write'])).toBe(true);
    const client = { name: 'Hub', system: 'hub', ipAllowList: [] };
    expect(createApiClientSchema.safeParse({ ...client, scopes: ['events:write'] }).success).toBe(
      false,
    );
    expect(
      createApiClientSchema.safeParse({
        ...client,
        scopes: ['events:write'],
        reconcileFrom: '2026-10-19',
      }).success,
    ).toBe(true);
    expect(createApiClientSchema.safeParse({ ...client, scopes: ['periods:read'] }).success).toBe(
      true,
    );
  });
});

describe('the digest (S08 rule 16)', () => {
  it('takes the reconciliation days and needs no held event', () => {
    const digest = emailDataSchemas.held_digest.parse({
      companyName: 'شركة تجريبية',
      day: '2026-11-06',
      newlyHeld: 0,
      held: [],
      link: 'https://mizan.example/inbox',
      reconciliation: [{ date: '2026-11-05', state: 'missing', gaps: 0, afterClose: false }],
    });
    expect(digest.unclosedMonths).toEqual([]);
    expect(digest.reconciliation).toHaveLength(1);
  });
});

describe('GET /v1/events?date= (S08 rule 14)', () => {
  it('needs a date', () => {
    expect(receivedEventsQuerySchema.safeParse({}).success).toBe(false);
    expect(receivedEventsQuerySchema.parse({ date: '2026-11-03' })).toEqual({ date: '2026-11-03' });
  });
});

describe('JSON Schema', () => {
  it('holds the report and the answers with their ids, for the OpenAPI document and Hub', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'ReconciliationReport',
        'ReconciliationResult',
        'ReceivedEventsPage',
        'ReconciliationMonth',
        'ReconciliationDay',
      ]),
    );
  });
});
