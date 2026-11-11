import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  canonicalPayload,
  documentOf,
  EVENT_TYPES,
  type EventEnvelope,
  eventEnvelopeSchema,
  eventOutcomeSchema,
  HOLD_CHECK_ORDER,
  HOLD_REASONS,
  hubMinor,
  itemKeyOf,
  monthsOf,
  POSTING_SLOTS,
  parseEventEnvelope,
  paymentMethodSlot,
  periodStatusQuerySchema,
  slotIsPerCurrency,
} from './events.js';

// Synthetic ids only (AGENTS.md: public repository).
const ID = {
  event: '01934b6e-0000-7000-8000-000000000001',
  invoice: '01934b6e-0000-7000-8000-000000000101',
  line: '01934b6e-0000-7000-8000-000000000201',
  payment: '01934b6e-0000-7000-8000-000000000301',
  entry: '01934b6e-0000-7000-8000-000000000401',
};

const client = { external_id: '01934b6e-0000-7000-8000-00000000c001', name: 'عميل تجريبي' };
const service = { external_id: '01934b6e-0000-7000-8000-00000000s001', name: 'تصميم' };

function envelope(type: string, payload: unknown, version = 1) {
  return {
    id: ID.event,
    type,
    version,
    occurred_at: '2026-11-03T10:00:00+03:00',
    accounting_date: '2026-11-03',
    payload,
  };
}

const invoice = {
  invoice: { id: ID.invoice, number: 'INV-2026-0012' },
  client,
  currency: 'USD',
  syp_per_usd: '122.0000',
  issued_on: '2026-11-03',
  due_on: '2026-12-03',
  lines: [{ id: ID.line, amount: 10_000, service, source: 'extra_work' }],
};

const payment = {
  payment: { id: ID.payment, number: 'RC-2026-0007' },
  invoice: { id: ID.invoice, number: 'INV-2026-0012' },
  paid_on: '2026-11-19',
  method: 'bank_transfer',
  currency: 'SYP',
  amount: 5_000_000,
  syp_per_usd: '124.0000',
  applied_amount: 40_223,
  invoice_currency: 'USD',
};

const issues = (input: unknown) => {
  const parsed = eventEnvelopeSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
};

describe('the event envelope (S05 rules 1–3)', () => {
  it('chooses the payload by type and version, for every type of the catalogue', () => {
    expect(EVENT_TYPES).toHaveLength(20);
    expect(EVENT_TYPES.at(-1)).toBe('milestone.reopened');
    const parsed = parseEventEnvelope(envelope('invoice.issued', invoice));
    expect(parsed.type).toBe('invoice.issued');
    expect(issues(envelope('invoice.issued', invoice, 2))).toEqual(['version']);
    expect(issues(envelope('invoice.archived', invoice))).toEqual(['type']);
    // A payment's payload under an invoice's type fails on its fields.
    expect(issues(envelope('invoice.issued', payment)).length).toBeGreaterThan(0);
  });

  it('takes only SYP and USD, positive integer amounts and Hub’s rate as quoted', () => {
    const line = (amount: unknown) => ({ ...invoice, lines: [{ ...invoice.lines[0], amount }] });
    expect(issues(envelope('invoice.issued', { ...invoice, currency: 'TRY' }))).toEqual([
      'payload.currency',
    ]);
    expect(issues(envelope('invoice.issued', line(0)))).toEqual(['payload.lines.0.amount']);
    expect(issues(envelope('invoice.issued', line(-100)))).toEqual(['payload.lines.0.amount']);
    expect(issues(envelope('invoice.issued', line(10.5)))).toEqual(['payload.lines.0.amount']);
    for (const rate of ['0', '0.0000', '122.12345', '123456789', '-1', '1e3']) {
      expect(issues(envelope('invoice.issued', { ...invoice, syp_per_usd: rate }))).toEqual([
        'payload.syp_per_usd',
      ]);
    }
    expect(
      issues(envelope('invoice.issued', { ...invoice, syp_per_usd: '12345678.1234' })),
    ).toEqual([]);
  });

  it('requires a service on every revenue line and a department on every expense', () => {
    const { service: _service, ...noService } = invoice.lines[0] as Record<string, unknown>;
    expect(issues(envelope('invoice.issued', { ...invoice, lines: [noService] }))).toEqual([
      'payload.lines.0.service',
    ]);
    const expense = {
      expense: { id: ID.entry, number: 'EXP-1' },
      client,
      spent_on: '2026-11-10',
      currency: 'SYP',
      amount: 5_000_000,
      syp_per_usd: '124.0000',
      description: 'تصوير',
    };
    expect(issues(envelope('project_expense.recorded', expense))).toEqual(['payload.department']);
    expect(
      issues(
        envelope('project_expense.recorded', {
          ...expense,
          department: { external_id: 'photography', name: 'التصوير' },
        }),
      ),
    ).toEqual([]);
  });

  it('takes a negative amount on a retainer credit only, and a kind on a retainer charge only', () => {
    const charge = (fields: Record<string, unknown>) =>
      envelope('invoice.issued', {
        ...invoice,
        lines: [{ ...invoice.lines[0], source: 'retainer_charge', ...fields }],
      });
    expect(issues(charge({ charge_kind: 'credit', amount: -500 }))).toEqual([]);
    expect(issues(charge({ charge_kind: 'credit', amount: 500 }))).toEqual([
      'payload.lines.0.amount',
    ]);
    expect(issues(charge({}))).toEqual(['payload.lines.0.charge_kind']);
    expect(
      issues(
        envelope('invoice.issued', {
          ...invoice,
          lines: [{ ...invoice.lines[0], charge_kind: 'monthly' }],
        }),
      ),
    ).toEqual(['payload.lines.0.charge_kind']);
    expect(
      issues(
        envelope('invoice.issued', {
          ...invoice,
          lines: [{ ...invoice.lines[0], deferred: true }],
        }),
      ),
    ).toEqual(['payload.lines.0.deferred']);
  });

  it('refuses at receipt what is never an exchange difference (rule 3)', () => {
    // In the invoice's currency, more applied than received.
    expect(
      issues(
        envelope('payment.recorded', {
          ...payment,
          currency: 'USD',
          amount: 40_000,
          applied_amount: 40_001,
        }),
      ),
    ).toEqual(['payload.applied_amount']);
    // In the other currency, the applied amount is compared with the tolerance later (rule 9).
    expect(issues(envelope('payment.recorded', payment))).toEqual([]);
    const wallet = {
      entry: { id: ID.entry, number: 'W-1' },
      client,
      entered_on: '2026-11-03',
      method: 'cash',
      currency: 'USD',
      amount: 10_000,
      syp_per_usd: '122.0000',
      usd_amount: 9_999,
    };
    expect(issues(envelope('ad_wallet.deposited', wallet))).toEqual(['payload.usd_amount']);
    expect(issues(envelope('ad_wallet.deposited', { ...wallet, usd_amount: 10_000 }))).toEqual([]);
  });

  it('caps an invoice at 200 lines (rule 22)', () => {
    const lines = Array.from({ length: 201 }, (_, index) => ({
      ...invoice.lines[0],
      id: `01934b6e-0000-7000-8000-${String(index).padStart(12, '0')}`,
    }));
    expect(issues(envelope('invoice.issued', { ...invoice, lines }))).toEqual(['payload.lines']);
  });
});

describe('an event’s document and item key (rules 11 and 16)', () => {
  const parsed = (type: string, payload: unknown) => parseEventEnvelope(envelope(type, payload));

  it('orders invoice and payment events on the invoice, wallet and spend events on the client', () => {
    const issued = parsed('invoice.issued', invoice);
    const paid = parsed('payment.recorded', payment);
    expect(itemKeyOf(issued)).toBe(`invoice:${ID.invoice}`);
    expect(itemKeyOf(paid)).toBe(`invoice:${ID.invoice}`);
    expect(documentOf(issued)).toEqual({
      type: 'invoice',
      id: ID.invoice,
      number: 'INV-2026-0012',
    });
    // A payment's own document is the payment, so a dismissed payment marks it alone.
    expect(documentOf(paid)).toEqual({ type: 'payment', id: ID.payment, number: 'RC-2026-0007' });
    const rate = parsed('rate.changed', { effective_on: '2026-11-03', syp_per_usd: '124.0000' });
    expect(itemKeyOf(rate)).toBeNull();
    const spend = parsed('ad_spend.recorded', {
      update: { id: ID.entry, number: 'CU-1' },
      campaign: { id: ID.payment, number: 'CMP-1' },
      client,
      period_from: '2026-11-01',
      period_to: '2026-11-19',
      usd_spend: 70_000,
    });
    expect(itemKeyOf(spend)).toBe(`ad_funds:${client.external_id}`);
  });
});

describe('the payload hash’s canonical form (RFC 8785)', () => {
  it('sorts keys, drops whitespace and keeps integers and strings as JSON writes them', () => {
    expect(canonicalPayload({ b: 1, a: [true, null, 'x'], c: { z: 'ي', y: -2 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":-2,"z":"ي"}}',
    );
    const a = canonicalPayload(parseEventEnvelope(envelope('invoice.issued', invoice)).payload);
    const reordered = { ...invoice, lines: invoice.lines, client, invoice: invoice.invoice };
    expect(canonicalPayload(reordered)).toBe(a);
    expect(canonicalPayload({ ...invoice, syp_per_usd: '122.0001' })).not.toBe(a);
  });

  it('refuses what is not JSON', () => {
    expect(() => canonicalPayload(Number.NaN)).toThrow(RangeError);
    expect(() => canonicalPayload(1n)).toThrow(TypeError);
  });
});

describe('the amounts', () => {
  it('reach the ledger as bigint', () => {
    expect(hubMinor(12_345)).toBe(12_345n);
    expect(() => hubMinor(1.5)).toThrow(RangeError);
  });
});

describe('the holds and the slots', () => {
  it('check every reason in the order of rule 8, an elapsed month after the date (S06 rule 18)', () => {
    expect(HOLD_REASONS.slice(-2)).toEqual([
      'OPEN_ITEM_HAS_SETTLEMENTS',
      'WAITING_FOR_EARLIER_EVENT',
    ]);
    expect(HOLD_CHECK_ORDER[0]).toBe('WAITING_FOR_EARLIER_EVENT');
    expect([...HOLD_CHECK_ORDER].sort()).toEqual([...HOLD_REASONS].sort());
    expect(HOLD_CHECK_ORDER.indexOf('SERVICE_PERIOD_CLOSED')).toBe(
      HOLD_CHECK_ORDER.indexOf('PERIOD_CLOSED') + 1,
    );
  });

  it('have a slot per payment method, with an account per currency', () => {
    expect(POSTING_SLOTS).toHaveLength(14);
    expect(paymentMethodSlot('e_wallet')).toBe('payment_method.e_wallet');
    expect(POSTING_SLOTS.filter(slotIsPerCurrency)).toEqual([
      'payment_method.cash',
      'payment_method.bank_transfer',
      'payment_method.e_wallet',
    ]);
  });

  it('answer posted with entries and held with a reason and detail', () => {
    expect(
      eventOutcomeSchema.safeParse({
        status: 'held',
        inbox_id: ID.event,
        reason: 'NO_MAPPING',
        detail: 'slot_unmapped:project_cost',
      }).success,
    ).toBe(true);
    expect(
      eventOutcomeSchema.safeParse({
        status: 'held',
        inbox_id: ID.event,
        reason: 'X',
        detail: null,
      }).success,
    ).toBe(false);
  });
});

describe('JSON Schema', () => {
  it('holds the envelope and every payload with an id, for the OpenAPI document and Hub', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'EventEnvelope',
        'EventOutcome',
        'HoldReason',
        'InvoiceIssuedV1',
        'PaymentRecordedV1',
        'RateChangedV1',
        'PostingSlot',
      ]),
    );
  });

  it('types an envelope by its type', () => {
    const event: EventEnvelope = parseEventEnvelope(envelope('payment.recorded', payment));
    if (event.type !== 'payment.recorded') throw new Error('Expected a payment');
    expect(event.payload.applied_amount).toBe(40_223);
  });
});

describe('periodStatusQuerySchema', () => {
  it('takes a range of at most 24 months and lists its months in order', () => {
    const range = periodStatusQuerySchema.parse({ from: '2026-11', to: '2027-02' });
    expect(monthsOf(range)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(
      monthsOf(periodStatusQuerySchema.parse({ from: '2025-02', to: '2027-01' })),
    ).toHaveLength(24);
    for (const query of [
      { from: '2025-01', to: '2027-01' },
      { from: '2026-05', to: '2026-04' },
      { from: '2026-00', to: '2026-04' },
      { from: '2026-4', to: '2026-04' },
    ]) {
      expect(periodStatusQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });
});
