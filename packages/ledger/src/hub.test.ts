import {
  type CompanyLedgers,
  type EventEnvelope,
  type EventOf,
  type ExchangeRate,
  type HubCurrency,
  money,
  type PostingSlot,
  parseEventEnvelope,
} from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceEntry, ledgerTotal } from './balance.js';
import {
  blockingEvent,
  firstOpenDayAfter,
  type HubItem,
  type HubLine,
  type HubReferences,
  type HubRuleContext,
  hubDealtRates,
  hubReversalLines,
  invoiceIssuedPlan,
  type KeyedEvent,
  type MappedAccount,
  paymentDecision,
  paymentRecordedPlan,
  planEvent,
  type RulePlan,
  reclassifiedLines,
} from './hub.js';
import { emptyBalance, type ItemState } from './items.js';
import { carriedLine, type Line } from './lines.js';
import { manualEntry } from './manual.js';
import type { MeasureContext } from './measure.js';
import { calendar, rate, refusal, sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

/**
 * Worked examples of the Hub posting rules with the numbers of the approved scenarios
 * `revenue/revenue-at-issue`, `receivables/hub-payment` and `inbox/holds-and-actions` (owner,
 * 2026-11-06 and 2026-11-07), and their properties. Accounts are the service-agency codes, mapped
 * to themselves; `C1`, `S1` and `S2` stand for Hub's values by their external ids.
 */

const TEMPLATE: Record<string, string> = {
  receivable: '112001',
  revenue_at_issue: '411001',
  termination_fee_revenue: '411002',
  'payment_method.cash:SYP': '111001',
  'payment_method.cash:USD': '111002',
  'payment_method.bank_transfer:SYP': '111003',
  'payment_method.bank_transfer:USD': '111004',
  'payment_method.e_wallet:SYP': '111005',
  'payment_method.e_wallet:USD': '111006',
};

function contextOf(
  ledgers: CompanyLedgers,
  overrides: Record<string, Partial<MappedAccount> | null> = {},
): HubRuleContext {
  return {
    ledgers,
    mapping: (slot: PostingSlot, currency: HubCurrency | null) => {
      const key = currency === null ? slot : `${slot}:${currency}`;
      if (overrides[key] === null) return null;
      const code = TEMPLATE[key];
      if (code === undefined) return null;
      return { id: code, code, blocked: false, archived: false, ...overrides[key] };
    },
    tolerance: { SYP: 100n, USD: 100n },
  };
}

const C1 = { external_id: 'C1', name: 'عميل' };
const S1 = { external_id: 'S1', name: 'تصميم' };
const S2 = { external_id: 'S2', name: 'تصوير' };
const ids = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;
const INVOICE = { id: ids(101), number: 'INV-2026-1' };

let seq = 0;
function event(type: string, payload: unknown, on = '2026-11-03'): EventEnvelope {
  seq += 1;
  return parseEventEnvelope({
    id: ids(seq),
    type,
    version: 1,
    occurred_at: `${on}T10:00:00+03:00`,
    accounting_date: on,
    payload,
  });
}

type InvoiceLine = { amount: number; source?: string; service?: typeof S1; [key: string]: unknown };

function invoice(currency: HubCurrency, sypPerUsd: string, lines: InvoiceLine[], extra = {}) {
  return event('invoice.issued', {
    invoice: INVOICE,
    client: C1,
    currency,
    syp_per_usd: sypPerUsd,
    issued_on: '2026-11-03',
    due_on: '2026-12-03',
    lines: lines.map((line, index) => ({
      id: ids(200 + index),
      source: 'extra_work',
      service: S1,
      ...line,
    })),
    ...extra,
  }) as EventOf<'invoice.issued'>;
}

const NO_REFERENCES: HubReferences = { invoiceItem: null, standing: [], issueLine: null };

const bulletin = (value: string, on: string) => rate('USD', 'SYP', value, 'bulletin', on);

/** A dimension set as the books key it, by type: Hub's external ids stand for the value ids. */
function dims(line: HubLine): Record<string, string> {
  return Object.fromEntries(
    Object.entries(line.dimensions).map(([type, value]) => [type, value.external_id]),
  );
}

/**
 * The entry a planned `lines` entry posts, measured as `post()` measures a Hub event: the items
 * opened or moved, the dealt rate, `manualEntry()`, then `balanceEntry()` on the role accounts.
 */
function measure(
  plan: RulePlan,
  ledgers: CompanyLedgers,
  on: string,
  rates: readonly ExchangeRate[],
  items: ReadonlyMap<string, ItemState> = new Map(),
): Line[] {
  if (plan.kind !== 'post') throw new Error(`Expected a posting, got ${plan.kind}`);
  const [entry] = plan.entries;
  if (entry?.kind !== 'lines') throw new Error('Expected lines');
  const context: MeasureContext = { ledgers, on, rates, calendar };
  const built = manualEntry(
    {
      lines: entry.lines.map((line) => ({
        account: line.account,
        dimensions: dims(line),
        amount: line.amount,
        ...(line.item?.kind === 'open' && {
          item: {
            id: line.item.reference,
            kind: 'document' as const,
            direction: null,
            opensAs: 1 as const,
            balance: emptyBalance(line.amount.currency, ledgers.parallel !== null),
          },
        }),
        ...(line.item?.kind === 'existing' && { item: items.get(line.item.id) as ItemState }),
      })),
      dealtRates: entry.dealtRates.map((dealt) => ({
        effectiveOn: on,
        ...dealt,
        type: 'market' as const,
        source: 'hub' as const,
      })),
    },
    context,
    { gain: { account: '421001' }, loss: { account: '541001' } },
  );
  return balanceEntry({ on, ledgers, lines: built.lines, rounding: { account: '541003' } });
}

type Row = readonly [string, string, bigint, bigint, bigint | null];

const rows = (lines: readonly Line[]): Row[] =>
  lines.map((line) => [
    line.account,
    line.transaction.currency,
    line.transaction.amountMinor,
    line.bookMinor,
    line.parallelMinor,
  ]);

describe('invoice.issued at issue (revenue/revenue-at-issue)', () => {
  it('posts 74.75 and 25.25 USD at bulletin 121.5 with a book rounding debit of 0.01 SYP', () => {
    const issued = invoice('USD', '122.0000', [
      { amount: 7_475 },
      { amount: 2_525, source: 'manual', service: S2 },
    ]);
    const plan = invoiceIssuedPlan(issued, contextOf(sypUsd));
    expect(plan.kind === 'post' && plan.entries[0]?.kind === 'lines' && plan.entries[0].dealtRates)
      // The USD parallel ledger converts nothing: Hub's rate is not passed.
      .toEqual([]);
    expect(rows(measure(plan, sypUsd, '2026-11-03', [bulletin('121.5000', '2026-11-03')]))).toEqual(
      [
        ['112001', 'USD', 10_000n, 1_215_000n, 10_000n],
        ['411001', 'USD', -7_475n, -908_213n, -7_475n],
        ['411001', 'USD', -2_525n, -306_788n, -2_525n],
        ['541003', 'SYP', 1n, 1n, 0n],
      ],
    );
  });

  it('measures an SYP invoice in the USD parallel ledger at Hub’s 123, a rounding credit of 0.01 USD', () => {
    const issued = invoice('SYP', '123.0000', [
      { amount: 610_000 },
      { amount: 610_000, service: S2 },
    ]);
    expect(
      rows(measure(invoiceIssuedPlan(issued, contextOf(sypUsd)), sypUsd, '2026-11-03', [])),
    ).toEqual([
      ['112001', 'SYP', 1_220_000n, 1_220_000n, 9_919n],
      ['411001', 'SYP', -610_000n, -610_000n, -4_959n],
      ['411001', 'SYP', -610_000n, -610_000n, -4_959n],
      ['541003', 'USD', -1n, 0n, -1n],
    ]);
  });

  it('measures in USD books: the SYP parallel ledger at Hub’s 122.5, the SYP fee at the bulletin', () => {
    const issued = invoice('USD', '122.5000', [
      { amount: 7_475 },
      { amount: 2_525, source: 'manual', service: S2 },
    ]);
    expect(
      rows(measure(invoiceIssuedPlan(issued, contextOf(usdSyp)), usdSyp, '2026-11-03', [])),
    ).toEqual([
      ['112001', 'USD', 10_000n, 10_000n, 1_225_000n],
      ['411001', 'USD', -7_475n, -7_475n, -915_688n],
      ['411001', 'USD', -2_525n, -2_525n, -309_313n],
      ['541003', 'SYP', 1n, 0n, 1n],
    ]);
    const fee = invoice(
      'SYP',
      '122.5000',
      [{ amount: 6_100_000, source: 'retainer_charge', charge_kind: 'termination_fee' }],
      { contract: { external_id: 'R1', name: 'عقد', kind: 'retainer', client_external_id: 'C1' } },
    );
    const plan = invoiceIssuedPlan(fee, contextOf(usdSyp));
    const lines = measure(plan, usdSyp, '2026-11-03', [bulletin('120.0000', '2026-11-03')]);
    expect(rows(lines)).toEqual([
      ['112001', 'SYP', 6_100_000n, 50_833n, 6_100_000n],
      ['411002', 'SYP', -6_100_000n, -50_833n, -6_100_000n],
    ]);
    if (plan.kind !== 'post' || plan.entries[0]?.kind !== 'lines')
      throw new Error('Expected lines');
    expect(plan.entries[0].lines.map((line) => Object.keys(line.dimensions))).toEqual([
      ['client', 'contract'],
      ['client', 'contract', 'service'],
    ]);
  });

  it('takes the bulletin alone in SYP books: no ledger reads Hub’s rate', () => {
    expect(hubDealtRates(sypOnly, ['USD'], '122.0000')).toEqual([]);
    expect(hubDealtRates(sypUsd, ['SYP'], '123.0000')).toEqual([
      { base: 'USD', quote: 'SYP', rate: '123.0000' },
    ]);
  });

  it('holds an invoice with a deferred line or a non-zero tax whole; a zero tax posts', () => {
    const context = contextOf(sypUsd);
    const retainer = invoice('USD', '122.0000', [
      { amount: 10_000 },
      { amount: 100_000, source: 'retainer_charge', charge_kind: 'monthly', service: S2 },
    ]);
    expect(invoiceIssuedPlan(retainer, context)).toEqual({
      kind: 'hold',
      reason: 'NO_MAPPING',
      detail: 'deferred_revenue',
    });
    const deferred = invoice('USD', '122.0000', [
      { amount: 10_000, source: 'manual', deferred: true },
    ]);
    expect(invoiceIssuedPlan(deferred, context)).toMatchObject({ detail: 'deferred_revenue' });
    const taxed = (amount: number) =>
      invoice('USD', '122.0000', [
        { amount: 10_000, taxes: [{ code: 'SALES', base: 10_000, rate: '5.00', amount }] },
      ]);
    expect(invoiceIssuedPlan(taxed(500), context)).toMatchObject({ detail: 'tax_lines' });
    expect(invoiceIssuedPlan(taxed(0), context).kind).toBe('post');
  });

  it('holds NO_MAPPING on an unmapped slot or a blocked account, naming it', () => {
    const issued = invoice('USD', '122.0000', [{ amount: 10_000 }]);
    expect(invoiceIssuedPlan(issued, contextOf(sypUsd, { revenue_at_issue: null }))).toEqual({
      kind: 'hold',
      reason: 'NO_MAPPING',
      detail: 'slot_unmapped:revenue_at_issue',
    });
    expect(
      invoiceIssuedPlan(issued, contextOf(sypUsd, { receivable: { blocked: true } })),
    ).toMatchObject({ detail: 'account_blocked:112001' });
  });

  it('leaves a contract of another client to the accountant', () => {
    const issued = invoice('USD', '122.0000', [{ amount: 10_000 }], {
      contract: { external_id: 'R1', name: 'عقد', kind: 'retainer', client_external_id: 'C2' },
    });
    expect(invoiceIssuedPlan(issued, contextOf(sypUsd))).toMatchObject({
      kind: 'post',
      decision: 'contract_client_mismatch',
    });
  });
});

const PAYMENT = { id: ids(301), number: 'R-2026-1' };

function payment(fields: Record<string, unknown>, on = '2026-11-19') {
  return event(
    'payment.recorded',
    {
      payment: PAYMENT,
      invoice: INVOICE,
      paid_on: on,
      method: 'bank_transfer',
      ...fields,
    },
    on,
  ) as EventOf<'payment.recorded'>;
}

const usdItem = (openMinor: bigint): HubItem => ({
  id: 'INV-2026-1',
  accountId: '112001',
  currency: 'USD',
  openMinor,
});

describe('payment.recorded (receivables/hub-payment)', () => {
  it('clears the item by Hub’s applied amount at what it carries; each ledger’s residual realised', () => {
    // A 1,000.00 USD invoice at 120; 50,000.00 SYP by e-wallet applied as 404.86 USD.
    const item: ItemState = {
      id: 'INV-2026-1',
      kind: 'document',
      direction: 1,
      balance: {
        transaction: money(100_000n, 'USD'),
        bookMinor: 12_000_000n,
        parallelMinor: 100_000n,
      },
    };
    const paid = payment({
      method: 'e_wallet',
      currency: 'SYP',
      amount: 5_000_000,
      syp_per_usd: '123.5000',
      applied_amount: 40_486,
      invoice_currency: 'USD',
    });
    const references = { ...NO_REFERENCES, invoiceItem: usdItem(100_000n) };
    const plan = paymentRecordedPlan(paid, references, contextOf(sypUsd));
    expect(plan).toMatchObject({ kind: 'post', decision: null });
    const lines = measure(plan, sypUsd, '2026-11-19', [], new Map([['INV-2026-1', item]]));
    expect(rows(lines)).toEqual([
      ['111005', 'SYP', 5_000_000n, 5_000_000n, 40_486n],
      ['112001', 'USD', -40_486n, -4_858_320n, -40_486n],
      ['421001', 'SYP', -141_680n, -141_680n, 0n],
    ]);
  });

  it('measures USD cash at the bulletin in the SYP books, never at Hub’s rate', () => {
    const item: ItemState = {
      id: 'INV-2026-1',
      kind: 'document',
      direction: 1,
      balance: {
        transaction: money(12_200_000n, 'SYP'),
        bookMinor: 12_200_000n,
        parallelMinor: 100_000n,
      },
    };
    const paid = payment({
      method: 'cash',
      currency: 'USD',
      amount: 50_000,
      syp_per_usd: '124.0000',
      applied_amount: 6_200_000,
      invoice_currency: 'SYP',
    });
    const references = {
      ...NO_REFERENCES,
      invoiceItem: { ...usdItem(12_200_000n), currency: 'SYP' as const },
    };
    const lines = measure(
      paymentRecordedPlan(paid, references, contextOf(sypUsd)),
      sypUsd,
      '2026-11-19',
      [bulletin('123.0000', '2026-11-19')],
      new Map([['INV-2026-1', item]]),
    );
    expect(rows(lines)).toEqual([
      ['111002', 'USD', 50_000n, 6_150_000n, 50_000n],
      ['112001', 'SYP', -6_200_000n, -6_200_000n, -50_820n],
      ['541001', 'SYP', 50_000n, 50_000n, 0n],
      ['541001', 'USD', 820n, 0n, 820n],
    ]);
  });

  it('holds UNKNOWN_REFERENCE before its invoice', () => {
    const paid = payment({
      currency: 'USD',
      amount: 10_000,
      syp_per_usd: '125.0000',
      applied_amount: 10_000,
      invoice_currency: 'USD',
    });
    expect(paymentRecordedPlan(paid, NO_REFERENCES, contextOf(sypUsd))).toEqual({
      kind: 'hold',
      reason: 'UNKNOWN_REFERENCE',
      detail: null,
    });
  });

  it('compares the gap with the tolerance in the invoice currency: exactly 1.00 posts, 1.01 holds', () => {
    const tolerance = { SYP: 100n, USD: 100n };
    const syp = (applied: number) =>
      payment({
        currency: 'SYP',
        amount: 5_000_000,
        syp_per_usd: '124.0000',
        applied_amount: applied,
        invoice_currency: 'USD',
      }).payload;
    // 5,000,000 / 124 = 40,322.58… → 40,323.
    expect(paymentDecision(syp(40_223), usdItem(100_000n), tolerance)).toBeNull();
    expect(paymentDecision(syp(40_222), usdItem(100_000n), tolerance)).toBe(
      'payment_gap_beyond_tolerance',
    );
    // On an SYP invoice the tolerance is 1.00 SYP: 50,000 × 124 = 6,200,000 against 6,200,101.
    const sypItem = { ...usdItem(12_200_000n), currency: 'SYP' as const };
    const usd = payment({
      currency: 'USD',
      amount: 50_000,
      syp_per_usd: '124.0000',
      applied_amount: 6_200_101,
      invoice_currency: 'SYP',
    }).payload;
    expect(paymentDecision(usd, sypItem, tolerance)).toBe('payment_gap_beyond_tolerance');
    expect(paymentDecision({ ...usd, applied_amount: 6_200_100 }, sypItem, tolerance)).toBeNull();
  });

  it('holds an amount above the applied amount, more than is open, or another invoice currency', () => {
    const tolerance = { SYP: 100n, USD: 100n };
    const same = (amount: number, applied: number) =>
      payment({
        currency: 'USD',
        amount,
        syp_per_usd: '124.0000',
        applied_amount: applied,
        invoice_currency: 'USD',
      }).payload;
    expect(paymentDecision(same(40_001, 40_000), usdItem(100_000n), tolerance)).toBe(
      'amount_above_applied',
    );
    expect(paymentDecision(same(70_000, 70_000), usdItem(60_000n), tolerance)).toBe(
      'payment_exceeds_open',
    );
    expect(
      paymentDecision(same(40_000, 40_000), { ...usdItem(100_000n), currency: 'SYP' }, tolerance),
    ).toBe('invoice_currency_mismatch');
  });

  it('holds NO_MAPPING when the method’s account in that currency is unmapped', () => {
    const paid = payment({
      method: 'cash',
      currency: 'USD',
      amount: 10_000,
      syp_per_usd: '125.0000',
      applied_amount: 10_000,
      invoice_currency: 'USD',
    });
    expect(
      paymentRecordedPlan(
        paid,
        { ...NO_REFERENCES, invoiceItem: usdItem(10_000n) },
        contextOf(sypUsd, { 'payment_method.cash:USD': null }),
      ),
    ).toMatchObject({ reason: 'NO_MAPPING', detail: 'slot_unmapped:payment_method.cash' });
  });
});

describe('voids, service changes and due dates', () => {
  it('reverses what stands for the document, latest first; nothing standing holds', () => {
    const voided = event('invoice.voided', {
      invoice: INVOICE,
      voided_on: '2026-11-24',
      reason: 'أُلغيت',
    });
    expect(planEvent(voided, NO_REFERENCES, contextOf(sypUsd))).toMatchObject({
      reason: 'UNKNOWN_REFERENCE',
    });
    expect(
      planEvent(voided, { ...NO_REFERENCES, standing: ['E2', 'E1'] }, contextOf(sypUsd)),
    ).toEqual({
      kind: 'post',
      entries: [
        { kind: 'reversal', key: `${voided.id}:reversal:1`, entryId: 'E2' },
        { kind: 'reversal', key: `${voided.id}:reversal:2`, entryId: 'E1' },
      ],
      decision: null,
    });
  });

  it('moves a line between services at its issue amounts', () => {
    const issued = carriedLine({
      account: '411002',
      dimensions: { client: 'C1', service: 'S3' },
      amounts: {
        transaction: money(-50_000n, 'USD'),
        bookMinor: -6_000_000n,
        parallelMinor: -50_000n,
      },
    });
    expect(rows(reclassifiedLines(issued, { client: 'C1', service: 'S4' }))).toEqual([
      ['411002', 'USD', 50_000n, 6_000_000n, 50_000n],
      ['411002', 'USD', -50_000n, -6_000_000n, -50_000n],
    ]);
    const changed = event('invoice.line_service_changed', {
      invoice: INVOICE,
      line_id: ids(200),
      old_service: S1,
      new_service: S2,
      changed_on: '2026-11-10',
    });
    expect(planEvent(changed, NO_REFERENCES, contextOf(sypUsd))).toMatchObject({
      reason: 'UNKNOWN_REFERENCE',
    });
    expect(
      planEvent(
        changed,
        { ...NO_REFERENCES, issueLine: { entryId: 'E1', lineNo: 2 } },
        contextOf(sypUsd),
      ),
    ).toMatchObject({ entries: [{ kind: 'reclassification', lineNo: 2, to: S2 }] });
  });

  it('records a due date on the item; a rate change posts nothing', () => {
    const due = event('invoice.due_date_changed', { invoice: INVOICE, due_on: '2026-12-20' });
    expect(
      planEvent(due, { ...NO_REFERENCES, invoiceItem: usdItem(1n) }, contextOf(sypUsd)),
    ).toEqual({
      kind: 'record',
      record: { kind: 'due_date', itemId: 'INV-2026-1', dueOn: '2026-12-20' },
    });
    const changed = event('rate.changed', { effective_on: '2026-11-03', syp_per_usd: '124.0000' });
    expect(planEvent(changed, NO_REFERENCES, contextOf(sypUsd))).toMatchObject({ kind: 'record' });
  });

  it('reverses a Hub entry only once, on or after its date, and never a reversal', () => {
    const lines: Line[] = [
      carriedLine({
        account: '411001',
        amounts: { transaction: money(-100n, 'USD'), bookMinor: -12_000n, parallelMinor: -100n },
      }),
    ];
    const entry = {
      source: 'hub_event',
      date: '2026-11-03',
      isReversal: false,
      reversed: false,
      lines,
    };
    expect(rows(hubReversalLines(entry, '2026-11-24'))).toEqual([
      ['411001', 'USD', 100n, 12_000n, 100n],
    ]);
    expect(refusal(() => hubReversalLines({ ...entry, source: 'manual' }, '2026-11-24'))).toBe(
      'ENTRY_NOT_REVERSIBLE',
    );
    expect(refusal(() => hubReversalLines({ ...entry, isReversal: true }, '2026-11-24'))).toBe(
      'ENTRY_NOT_REVERSIBLE',
    );
    expect(refusal(() => hubReversalLines({ ...entry, reversed: true }, '2026-11-24'))).toBe(
      'ENTRY_ALREADY_REVERSED',
    );
    expect(refusal(() => hubReversalLines(entry, '2026-11-02'))).toBe('REVERSAL_BEFORE_ORIGINAL');
  });

  it('holds the later spec’s events NO_MAPPING until their rules deploy', () => {
    const done = event('milestone.done', {
      milestone: { id: ids(501), number: 'M-1' },
      client: C1,
      project: { external_id: 'P1', name: 'مشروع', kind: 'project', client_external_id: 'C1' },
      currency: 'USD',
      amount: 10_000,
      done_on: '2026-11-03',
    });
    expect(planEvent(done, NO_REFERENCES, contextOf(sypUsd))).toMatchObject({
      reason: 'NO_MAPPING',
      detail: 'deferred_revenue',
    });
  });
});

describe('the order per item (rule 11)', () => {
  const keyed = (
    source: EventEnvelope,
    state: KeyedEvent['state'],
    reason: KeyedEvent['reason'] = null,
    waitingFor: string | null = null,
  ): KeyedEvent => ({
    id: source.id,
    type: source.type,
    state,
    reason,
    waitingFor,
    references:
      source.type === 'payment.recorded'
        ? [{ type: 'invoice', id: INVOICE.id, number: INVOICE.number }]
        : [],
  });
  const paid = payment({
    currency: 'USD',
    amount: 10_000,
    syp_per_usd: '125.0000',
    applied_amount: 10_000,
    invoice_currency: 'USD',
  });
  const second = payment({
    payment: { id: ids(302), number: 'R-2026-2' },
    currency: 'USD',
    amount: 10_000,
    syp_per_usd: '125.0000',
    applied_amount: 10_000,
    invoice_currency: 'USD',
  });
  const issued = invoice('USD', '122.0000', [{ amount: 20_000 }]);

  it('lets the invoice pass two payments received before it, and keeps the second behind the first', () => {
    const first = keyed(paid, 'held', 'UNKNOWN_REFERENCE');
    const behind = keyed(second, 'held', 'WAITING_FOR_EARLIER_EVENT', paid.id);
    expect(blockingEvent(issued, [first, behind])).toBeNull();
    expect(blockingEvent(second, [first])).toBe(first);
  });

  it('keeps every later event behind any other hold, and passes posted ones', () => {
    const held = keyed(issued, 'held', 'RATE_MISSING');
    expect(blockingEvent(paid, [held])).toBe(held);
    expect(blockingEvent(paid, [keyed(issued, 'posted')])).toBeNull();
    expect(blockingEvent(paid, [keyed(issued, 'dismissed')])).toBeNull();
  });

  it('lets a payment’s void pass the invoice void held for its settlements', () => {
    const voided = event('invoice.voided', {
      invoice: INVOICE,
      voided_on: '2026-11-25',
      reason: 'أُلغيت',
    });
    const paymentVoid = event('payment.voided', {
      payment: PAYMENT,
      invoice: INVOICE,
      voided_on: '2026-11-24',
    });
    const held = keyed(voided, 'held', 'OPEN_ITEM_HAS_SETTLEMENTS');
    expect(blockingEvent(paymentVoid, [held])).toBeNull();
    expect(blockingEvent(paid, [held])).toBe(held);
  });

  it('never lets the creating event wait behind events that wait for it, through any chain', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (count) => {
        const payments = Array.from({ length: count }, (_, index) =>
          payment({
            payment: { id: ids(400 + index), number: `R-${index}` },
            currency: 'USD',
            amount: 100,
            syp_per_usd: '125.0000',
            applied_amount: 100,
            invoice_currency: 'USD',
          }),
        );
        const chain = payments.map((source, index) =>
          index === 0
            ? keyed(source, 'held', 'UNKNOWN_REFERENCE')
            : keyed(source, 'held', 'WAITING_FOR_EARLIER_EVENT', payments[index - 1]?.id ?? null),
        );
        expect(blockingEvent(issued, chain)).toBeNull();
        // Any other later event waits behind the first.
        expect(blockingEvent(paid, chain)).toBe(chain[0]);
      }),
    );
  });
});

describe('the next open period (rule 15)', () => {
  it('is the first day of the first open month after the date', () => {
    expect(firstOpenDayAfter('2026-10-28', ['2026-10'])).toBe('2026-11-01');
    expect(firstOpenDayAfter('2026-09-29', ['2026-09', '2026-10'])).toBe('2026-11-01');
    expect(firstOpenDayAfter('2026-12-31', ['2026-12', '2027-01'])).toBe('2027-02-01');
  });
});

describe('properties of the invoice rule', () => {
  const shapes = [sypOnly, sypUsd, usdSyp] as const;
  const arbitraryInvoice = fc.record({
    shape: fc.integer({ min: 0, max: 2 }),
    currency: fc.constantFrom<HubCurrency>('SYP', 'USD'),
    rate: fc.integer({ min: 1_000_000, max: 2_000_000 }).map((n) => (n / 10_000).toFixed(4)),
    bulletin: fc.integer({ min: 1_000_000, max: 2_000_000 }).map((n) => (n / 10_000).toFixed(4)),
    amounts: fc.array(fc.integer({ min: 1, max: 100_000_000 }), { minLength: 1, maxLength: 20 }),
  });

  it('posts an entry balanced in every ledger, the rounding at most half a minor unit a line', () => {
    fc.assert(
      fc.property(
        arbitraryInvoice,
        ({ shape, currency, rate: hubRate, bulletin: day, amounts }) => {
          const ledgers = shapes[shape] as CompanyLedgers;
          const issued = invoice(
            currency,
            hubRate,
            amounts.map((amount) => ({ amount })),
          );
          const lines = measure(
            invoiceIssuedPlan(issued, contextOf(ledgers)),
            ledgers,
            '2026-11-03',
            [bulletin(day, '2026-11-03')],
          );
          expect(ledgerTotal(lines, 'book')).toBe(0n);
          if (ledgers.parallel !== null) expect(ledgerTotal(lines, 'parallel')).toBe(0n);
          const rounding = lines.filter((line) => line.kind === 'rounding');
          for (const line of rounding) {
            const amount = line.bookMinor !== 0n ? line.bookMinor : (line.parallelMinor ?? 0n);
            expect(amount < 0n ? -amount : amount).toBeLessThanOrEqual(
              BigInt(Math.ceil((amounts.length + 1) / 2)),
            );
          }
          // The item opens at the invoice's total in its own currency.
          expect(lines[0]?.transaction.amountMinor).toBe(
            amounts.reduce((sum, amount) => sum + BigInt(amount), 0n),
          );
        },
      ),
    );
  });

  it('decides the tolerance symmetrically around its bound', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 100_000_000 }),
        fc.integer({ min: 1_000_000, max: 2_000_000 }),
        fc.integer({ min: -300, max: 300 }),
        (amount, rateTimes, offset) => {
          const sypPerUsd = (rateTimes / 10_000).toFixed(4);
          const atRate = Number(
            (BigInt(amount) * 10_000n * 2n + BigInt(rateTimes)) / (BigInt(rateTimes) * 2n),
          );
          const applied = atRate + offset;
          fc.pre(applied > 0);
          const paid = payment({
            currency: 'SYP',
            amount,
            syp_per_usd: sypPerUsd,
            applied_amount: applied,
            invoice_currency: 'USD',
          }).payload;
          const decision = paymentDecision(paid, usdItem(BigInt(applied) + 1n), {
            SYP: 100n,
            USD: 100n,
          });
          expect(decision === null).toBe(Math.abs(offset) <= 100);
        },
      ),
    );
  });
});
