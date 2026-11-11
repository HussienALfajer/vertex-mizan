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
  type CreditableSchedule,
  firstOpenDayAfter,
  type HubItem,
  type HubLine,
  type HubReferences,
  type HubRuleContext,
  hold,
  hubDealtRates,
  hubReversalLines,
  invoiceIssuedPlan,
  type KeyedEvent,
  type MappedAccount,
  type MilestoneReferences,
  type PlannedEntry,
  type PointInTimeSchedule,
  paymentDecision,
  paymentRecordedPlan,
  planEvent,
  type RulePlan,
  reclassifiedLines,
  recognitionPatternOf,
  reissueKey,
  spendChangedPlan,
  walletDecision,
  walletEntryPlan,
} from './hub.js';
import { emptyBalance, type ItemState } from './items.js';
import { type CarriedAmounts, carriedLine, type Line, negate } from './lines.js';
import { manualEntry } from './manual.js';
import type { MeasureContext } from './measure.js';
import { calendar, rate, refusal, sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

/**
 * Worked examples of the Hub posting rules with the numbers of the approved scenarios
 * `revenue/revenue-at-issue`, `receivables/hub-payment`, `inbox/holds-and-actions`,
 * `ad-funds/running-balance` and `expenses/project-expense` (owner, 2026-11-06 and 2026-11-07),
 * and their properties. Accounts are the service-agency codes, mapped
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
  ad_funds: '213001',
  ad_platforms_payable: '211001',
  project_cost: '511001',
  project_expense_awaiting_payment: '211002',
  contract_liability: '212001',
  contract_asset: '113001',
  released_revenue: '411001',
  cancelled_project_refund: '211003',
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
const R1 = {
  external_id: 'R1',
  name: 'اشتراك',
  kind: 'retainer' as const,
  client_external_id: 'C1',
};
const P1 = { external_id: 'P1', name: 'مشروع', kind: 'project' as const, client_external_id: 'C1' };

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
  index = 0,
): Line[] {
  if (plan.kind !== 'post') throw new Error(`Expected a posting, got ${plan.kind}`);
  const entry = plan.entries[index];
  if (entry?.kind !== 'lines') throw new Error('Expected lines');
  const context: MeasureContext = { ledgers, on, rates, calendar };
  const built = manualEntry(
    {
      lines: entry.lines.map((line) => ({
        account: line.account,
        // A schedule's values stand for themselves, by their place.
        dimensions:
          line.valueIds === undefined
            ? dims(line)
            : Object.fromEntries(line.valueIds.map((value, k) => [`value${k}`, value])),
        amount: line.amount,
        ...(line.carried !== undefined && { carried: line.carried }),
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
        // An item an earlier entry of the plan opened, by its reference.
        ...(line.item?.kind === 'planned' && {
          item: items.get(line.item.reference) as ItemState,
        }),
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

  it('holds a credit to a cycle the books do not hold, and a non-zero tax', () => {
    const context = contextOf(sypUsd);
    const credit = invoice(
      'USD',
      '122.0000',
      [
        {
          amount: -10_000,
          source: 'retainer_charge',
          charge_kind: 'credit',
          cycle_start: '2026-10-01',
        },
        { amount: 20_000 },
      ],
      { contract: R1 },
    );
    // No schedule for the cycle: the credit waits for its cycle's invoice (S06 rule 6).
    expect(invoiceIssuedPlan(credit, context)).toEqual({
      kind: 'hold',
      reason: 'UNKNOWN_REFERENCE',
      detail: 'credit_cycle',
    });
    const deposit = invoice(
      'USD',
      '122.0000',
      [{ amount: 10_000, source: 'deposit', milestone_id: ids(501) }],
      {
        contract: P1,
      },
    );
    // A deposit is deferred to its milestone's done (S06 rule 1).
    expect(invoiceIssuedPlan(deposit, context)).toMatchObject({ kind: 'post', decision: null });
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

describe('invoice.issued over time (revenue/over-time-release; S06 rules 1–3, 7)', () => {
  const monthly = (amount: number, cycleStart: string, cycleEnd: string, service = S1) => ({
    amount,
    source: 'retainer_charge',
    charge_kind: 'monthly',
    cycle_start: cycleStart,
    cycle_end: cycleEnd,
    service,
  });

  it('reads each line’s pattern, unclear without the facts it needs (S06 rule 1)', () => {
    const issued = invoice(
      'USD',
      '122.0000',
      [
        { amount: 1 },
        { amount: 1, source: 'manual' },
        {
          amount: 1,
          source: 'manual',
          deferred: true,
          cycle_start: '2026-11-01',
          cycle_end: '2026-11-30',
        },
        { amount: 1, source: 'manual', deferred: true, cycle_start: '2026-11-01' },
        monthly(1, '2026-11-01', '2026-11-30'),
        monthly(1, '2026-11-30', '2026-11-01'),
        { amount: 1, source: 'retainer_charge', charge_kind: 'termination_fee' },
        { amount: -1, source: 'retainer_charge', charge_kind: 'credit', cycle_start: '2026-10-01' },
        { amount: -1, source: 'retainer_charge', charge_kind: 'credit' },
        { amount: 1, source: 'deposit', milestone_id: ids(501) },
        { amount: 1, source: 'milestone' },
      ],
      { contract: R1 },
    );
    expect(issued.payload.lines.map((line) => recognitionPatternOf(line, R1).kind)).toEqual([
      'at_issue',
      'at_issue',
      'over_time',
      'unclear',
      'over_time',
      'unclear',
      'at_issue',
      'credit',
      'unclear',
      // A deposit or milestone is a project's: a retainer's is unclear.
      'unclear',
      'unclear',
    ]);
    // A retainer charge needs its invoice's retainer; a deposit its project.
    const [, , , , charge, , , , , deposit] = issued.payload.lines;
    expect(charge && recognitionPatternOf(charge, undefined).kind).toBe('unclear');
    expect(charge && recognitionPatternOf(charge, P1).kind).toBe('unclear');
    expect(deposit && recognitionPatternOf(deposit, P1)).toEqual({
      kind: 'point_in_time',
      milestoneId: ids(501),
    });
  });

  it('defers a 900.00 USD cycle of 15 Nov to 14 Dec at bulletin 121 (S06’s example)', () => {
    const issued = invoice('USD', '122.0000', [monthly(90_000, '2026-11-15', '2026-12-14')], {
      contract: R1,
      issued_on: '2026-11-15',
    });
    const plan = invoiceIssuedPlan(issued, contextOf(sypUsd));
    expect(plan.kind === 'post' && plan.entries.map((entry) => entry.key)).toEqual([issued.id]);
    expect(rows(measure(plan, sypUsd, '2026-11-15', [bulletin('121.0000', '2026-11-15')]))).toEqual(
      [
        ['112001', 'USD', 90_000n, 10_890_000n, 90_000n],
        ['212001', 'USD', -90_000n, -10_890_000n, -90_000n],
      ],
    );
    expect(plan.kind === 'post' && plan.schedules).toEqual([
      expect.objectContaining({
        position: 1,
        lineSource: 'retainer_charge',
        chargeKind: 'monthly',
        serviceFrom: '2026-11-15',
        serviceTo: '2026-12-14',
        cycleKey: 'R1:2026-11-15',
        deferral: { key: issued.id, lineNo: 2 },
        elapsed: [],
      }),
    ]);
  });

  it('recognises a late issue’s elapsed October at 119 and clears it at 120.5 with a 360.00 SYP gain', () => {
    // 620.00 USD for 20 Oct to 19 Nov (31 days), issued on 5 Nov: October's 12 days elapsed.
    const issued = invoice('USD', '121.0000', [monthly(62_000, '2026-10-20', '2026-11-19')], {
      contract: R1,
      issued_on: '2026-11-05',
    });
    const plan = invoiceIssuedPlan(issued, contextOf(sypUsd));
    if (plan.kind !== 'post') throw new Error('Expected a posting');
    expect(plan.entries.map((entry) => entry.kind === 'lines' && [entry.key, entry.on])).toEqual([
      [`${issued.id}:elapsed:2026-10`, '2026-10-31'],
      [issued.id, undefined],
    ]);
    const rates = [bulletin('119.0000', '2026-10-29'), bulletin('120.5000', '2026-11-05')];
    // The bulletin in force on Saturday 31 October is Thursday's.
    const elapsed = measure(plan, sypUsd, '2026-10-31', rates);
    expect(rows(elapsed)).toEqual([
      ['113001', 'USD', 24_000n, 2_856_000n, 24_000n],
      ['411001', 'USD', -24_000n, -2_856_000n, -24_000n],
    ]);
    const opened: ItemState = {
      id: 'INV-2026-1/1',
      kind: 'document',
      direction: 1,
      balance: {
        transaction: money(24_000n, 'USD'),
        bookMinor: 2_856_000n,
        parallelMinor: 24_000n,
      },
    };
    const issue = measure(
      plan,
      sypUsd,
      '2026-11-05',
      rates,
      new Map([['INV-2026-1/1', opened]]),
      1,
    );
    expect(rows(issue)).toEqual([
      ['112001', 'USD', 62_000n, 7_471_000n, 62_000n],
      ['212001', 'USD', -38_000n, -4_579_000n, -38_000n],
      ['113001', 'USD', -24_000n, -2_856_000n, -24_000n],
      // A realised difference carries its amount in its ledger's currency (ADR 0007).
      ['421001', 'SYP', -36_000n, -36_000n, 0n],
    ]);
    expect(plan.schedules?.[0]).toMatchObject({
      deferral: { key: issued.id, lineNo: 2 },
      elapsed: [{ month: '2026-10', key: `${issued.id}:elapsed:2026-10`, lineNo: 2 }],
    });
  });

  it('opens one item per elapsed month of a line, and none for a period wholly elapsed', () => {
    const issued = invoice(
      'USD',
      '121.0000',
      [
        {
          amount: 30_000,
          source: 'manual',
          deferred: true,
          cycle_start: '2026-09-01',
          cycle_end: '2026-10-31',
        },
      ],
      { issued_on: '2026-11-10' },
    );
    const plan = invoiceIssuedPlan(issued, contextOf(sypUsd));
    if (plan.kind !== 'post') throw new Error('Expected a posting');
    const references = plan.entries.flatMap((entry) =>
      entry.kind === 'lines' ? entry.lines.flatMap((line) => (line.item ? [line.item] : [])) : [],
    );
    expect(references).toEqual([
      { kind: 'open', reference: 'INV-2026-1/1', dueOn: '2026-09-30' },
      { kind: 'open', reference: 'INV-2026-1/1/2026-10', dueOn: '2026-10-31' },
      { kind: 'open', reference: 'INV-2026-1', dueOn: '2026-12-03' },
      { kind: 'planned', reference: 'INV-2026-1/1' },
      { kind: 'planned', reference: 'INV-2026-1/1/2026-10' },
    ]);
    // Nothing is deferred: no contract liability line, but the schedule names its liability.
    expect(plan.schedules?.[0]).toMatchObject({ deferral: null, liabilityAccountId: '212001' });
  });

  it('lists the lines at issue before the deferrals, so a service change finds its line', () => {
    const issued = invoice(
      'USD',
      '122.0000',
      [monthly(100_000, '2026-11-01', '2026-11-30', S2), { amount: 10_000 }],
      { contract: R1 },
    );
    const plan = invoiceIssuedPlan(issued, contextOf(sypUsd));
    const [entry] = plan.kind === 'post' ? plan.entries : [];
    expect(entry?.kind === 'lines' && entry.lines.map((line) => line.account)).toEqual([
      '112001',
      '411001',
      '212001',
    ]);
  });

  it('holds NO_MAPPING on an unmapped recognition slot, naming it', () => {
    const late = invoice('USD', '121.0000', [monthly(62_000, '2026-10-20', '2026-11-19')], {
      contract: R1,
      issued_on: '2026-11-05',
    });
    for (const slot of ['contract_liability', 'contract_asset', 'released_revenue']) {
      expect(invoiceIssuedPlan(late, contextOf(sypUsd, { [slot]: null }))).toEqual({
        kind: 'hold',
        reason: 'NO_MAPPING',
        detail: `slot_unmapped:${slot}`,
      });
    }
  });

  it('leaves a line whose pattern is unclear to the accountant, after the period and rates', () => {
    const issued = invoice(
      'USD',
      '122.0000',
      [{ amount: 10_000 }, { amount: 20_000, source: 'manual', deferred: true }],
      { contract: R1 },
    );
    expect(invoiceIssuedPlan(issued, contextOf(sypUsd))).toMatchObject({
      kind: 'post',
      decision: 'recognition_pattern_unclear:2',
    });
  });

  it('moves a deferred line’s recognised revenue at its carried amounts, and reverses its void', () => {
    const line = ids(200);
    const changed = event(
      'invoice.line_service_changed',
      {
        invoice: INVOICE,
        line_id: line,
        old_service: S1,
        new_service: S2,
        changed_on: '2026-12-07',
      },
      '2026-12-07',
    ) as EventOf<'invoice.line_service_changed'>;
    const scheduled = { ...NO_REFERENCES, scheduledLineIds: [line] };
    expect(planEvent(changed, scheduled, contextOf(sypUsd))).toEqual({
      kind: 'post',
      entries: [{ kind: 'recognised_reclassification', key: changed.id, lineId: line, to: S2 }],
      decision: null,
    });
    // A line at issue keeps S05's rule: its issue line moves.
    expect(planEvent(changed, NO_REFERENCES, contextOf(sypUsd))).toMatchObject({
      reason: 'UNKNOWN_REFERENCE',
    });
    const voided = event('invoice.voided', {
      invoice: INVOICE,
      voided_on: '2026-12-10',
      reason: 'خطأ',
    });
    // Its releases, issue and elapsed parts are reversed, latest first (S06 rule 8).
    expect(
      planEvent(voided, { ...scheduled, standing: [ids(901), ids(900)] }, contextOf(sypUsd)),
    ).toEqual({
      kind: 'post',
      entries: [
        { kind: 'reversal', key: `${voided.id}:reversal:1`, entryId: ids(901) },
        { kind: 'reversal', key: `${voided.id}:reversal:2`, entryId: ids(900) },
      ],
      decision: null,
    });
  });

  it('balances every entry of an over-time invoice in every shape (a property)', () => {
    // A bulletin on every day from September to the issue, as a working day needs its own.
    const bulletins = Array.from({ length: 71 }, (_, n) =>
      bulletin(
        `${119 + (n % 3)}.0000`,
        new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10),
      ),
    );
    const day = fc.integer({ min: 0, max: 100 }).map((n) => {
      const date = new Date(Date.UTC(2026, 8, 1 + n));
      return date.toISOString().slice(0, 10);
    });
    fc.assert(
      fc.property(
        fc.constantFrom(sypOnly, sypUsd, usdSyp),
        fc.constantFrom<HubCurrency>('USD', 'SYP'),
        fc.integer({ min: 1, max: 50_000_000 }),
        day,
        fc.integer({ min: 0, max: 90 }),
        (ledgers, currency, amount, from, length) => {
          const start = new Date(`${from}T00:00:00Z`);
          const to = new Date(start.getTime() + length * 86_400_000).toISOString().slice(0, 10);
          const issued = invoice(currency, '122.0000', [monthly(amount, from, to)], {
            contract: R1,
            issued_on: '2026-11-10',
          });
          const plan = invoiceIssuedPlan(issued, contextOf(ledgers));
          if (plan.kind !== 'post') throw new Error('Expected a posting');
          const rates = [rate('USD', 'SYP', '120.0000', 'market', '2026-09-01'), ...bulletins];
          const opened = new Map<string, ItemState>();
          for (const [index, entry] of plan.entries.entries()) {
            if (entry.kind !== 'lines') throw new Error('Expected lines');
            const lines = measure(plan, ledgers, entry.on ?? '2026-11-10', rates, opened, index);
            expect(ledgerTotal(lines, 'book')).toBe(0n);
            if (ledgers.parallel !== null) expect(ledgerTotal(lines, 'parallel')).toBe(0n);
            // A planned line's place is its built line's: an elapsed month's item opens there.
            for (const [k, spec] of entry.lines.entries()) {
              const line = lines[k];
              if (spec.item?.kind !== 'open' || line === undefined) continue;
              opened.set(spec.item.reference, {
                id: spec.item.reference,
                kind: 'document',
                direction: 1,
                balance: {
                  transaction: line.transaction,
                  bookMinor: line.bookMinor,
                  parallelMinor: line.parallelMinor,
                },
              });
            }
          }
        },
      ),
      { numRuns: 200 },
    );
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
    expect(
      rows(
        reclassifiedLines(issued, { client: 'C1', service: 'S3' }, { client: 'C1', service: 'S4' }),
      ),
    ).toEqual([
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
        { ...NO_REFERENCES, standing: ['E1'], issueLine: { entryId: 'E1', lineNo: 2 } },
        contextOf(sypUsd),
      ),
    ).toMatchObject({
      entries: [{ kind: 'reclassification', lineNo: 2, lineId: ids(200), to: S2 }],
    });
    // After the invoice's void reversed its issue entry, nothing is left to move: held.
    expect(
      planEvent(
        changed,
        { ...NO_REFERENCES, standing: [], issueLine: { entryId: 'E1', lineNo: 2 } },
        contextOf(sypUsd),
      ),
    ).toMatchObject({ kind: 'hold', reason: 'UNKNOWN_REFERENCE' });
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
});

describe('milestones and projects (revenue/milestones, revenue/cancelled-project)', () => {
  const MS = (n: number) => ({ id: ids(500 + n), number: `MS-${n}` });
  const done = (n: number, amount: number, on: string, service: typeof S1 | null = S1) =>
    event(
      'milestone.done',
      {
        milestone: MS(n),
        client: C1,
        project: P1,
        currency: 'USD',
        amount,
        done_on: on,
        ...(service !== null && { service }),
      },
      on,
    ) as EventOf<'milestone.done'>;
  const usd = (transaction: bigint, book: bigint, parallel: bigint): CarriedAmounts => ({
    transaction: money(transaction, 'USD'),
    bookMinor: book,
    parallelMinor: parallel,
  });
  const schedule = (id: string, remaining: CarriedAmounts): PointInTimeSchedule => ({
    id,
    liabilityAccountId: '212001',
    parties: ['client-C1', 'contract-P1'],
    serviceValueId: 'service-S1',
    remaining,
  });
  const facts = (overrides: Partial<MilestoneReferences>): MilestoneReferences => ({
    doneStanding: false,
    item: null,
    doneRelease: null,
    schedule: null,
    items: 0,
    projectCancelled: false,
    ...overrides,
  });
  const withMilestone = (n: number, milestone: MilestoneReferences): HubReferences => ({
    ...NO_REFERENCES,
    milestones: new Map([[MS(n).id, milestone]]),
  });
  const deposit = (amount: number, n = 1, extra = {}) =>
    invoice('USD', '122.0000', [{ amount, source: 'deposit', milestone_id: MS(n).id }], {
      contract: P1,
      ...extra,
    });

  it('defers a 300.00 USD deposit at 120 with its point-in-time schedule (S06 rules 1, 2)', () => {
    const issued = deposit(30_000);
    const plan = invoiceIssuedPlan(issued, contextOf(sypUsd));
    expect(rows(measure(plan, sypUsd, '2026-11-03', [bulletin('120.0000', '2026-11-03')]))).toEqual(
      [
        ['112001', 'USD', 30_000n, 3_600_000n, 30_000n],
        ['212001', 'USD', -30_000n, -3_600_000n, -30_000n],
      ],
    );
    expect(plan.kind === 'post' && plan.schedules).toEqual([
      expect.objectContaining({
        pattern: 'point_in_time',
        lineSource: 'deposit',
        milestoneId: MS(1).id,
        serviceFrom: null,
        serviceTo: null,
        cycleKey: null,
        deferral: { key: issued.id, lineNo: 2 },
        months: [],
      }),
    ]);
  });

  it('releases the deposit at its done at the 36,000.00 SYP it carries, reading no rate (rule 11)', () => {
    const carried = usd(30_000n, 3_600_000n, 30_000n);
    const event = done(1, 30_000, '2026-11-20');
    const plan = planEvent(
      event,
      withMilestone(1, facts({ schedule: schedule('sch-1', carried) })),
      contextOf(sypUsd),
    );
    // No rate is given: a release reads none.
    expect(rows(measure(plan, sypUsd, '2026-11-20', []))).toEqual([
      ['212001', 'USD', 30_000n, 3_600_000n, 30_000n],
      ['411001', 'USD', -30_000n, -3_600_000n, -30_000n],
    ]);
    expect(plan).toMatchObject({
      decision: null,
      movements: [
        { scheduleId: 'sch-1', kind: 'released', key: event.id, amounts: negate(carried) },
      ],
    });
  });

  it('opens a contract asset at 122 for a milestone done before its invoice, MS-8/2 after a reopen', () => {
    const plan = planEvent(done(2, 40_000, '2026-12-01'), NO_REFERENCES, contextOf(sypUsd));
    expect(rows(measure(plan, sypUsd, '2026-12-01', [bulletin('122.0000', '2026-12-01')]))).toEqual(
      [
        ['113001', 'USD', 40_000n, 4_880_000n, 40_000n],
        ['411001', 'USD', -40_000n, -4_880_000n, -40_000n],
      ],
    );
    const lines =
      plan.kind === 'post' && plan.entries[0]?.kind === 'lines' && plan.entries[0].lines;
    expect(lines ? lines[0]?.item : null).toEqual({
      kind: 'open',
      reference: 'MS-2',
      dueOn: '2026-12-01',
    });
    const again = planEvent(
      done(8, 40_000, '2026-12-10'),
      withMilestone(8, facts({ items: 1 })),
      contextOf(sypUsd),
    );
    expect(
      again.kind === 'post' &&
        again.entries[0]?.kind === 'lines' &&
        again.entries[0].lines[0]?.item,
    ).toMatchObject({ reference: 'MS-8/2' });
  });

  it('clears the done milestone’s item at what it carries, with a 400.00 SYP realised gain (rule 12)', () => {
    const issued = invoice(
      'USD',
      '124.0000',
      [{ amount: 40_000, source: 'milestone', milestone_id: MS(2).id }],
      { contract: P1, issued_on: '2026-12-03' },
    );
    const carried = usd(40_000n, 4_880_000n, 40_000n);
    const item = {
      id: 'item-MS-2',
      accountId: '113001',
      currency: 'USD' as const,
      openMinor: 40_000n,
    };
    const references = withMilestone(2, facts({ doneStanding: true, item: { ...item, carried } }));
    const plan = planEvent(issued, references, contextOf(sypUsd));
    const state: ItemState = { id: 'item-MS-2', kind: 'document', direction: 1, balance: carried };
    expect(
      rows(
        measure(
          plan,
          sypUsd,
          '2026-12-03',
          [bulletin('123.0000', '2026-12-03')],
          new Map([['item-MS-2', state]]),
        ),
      ),
    ).toEqual([
      ['112001', 'USD', 40_000n, 4_920_000n, 40_000n],
      ['113001', 'USD', -40_000n, -4_880_000n, -40_000n],
      ['421001', 'SYP', -40_000n, -40_000n, 0n],
    ]);
    expect(plan.kind === 'post' && plan.schedules).toBeUndefined();
    // Another amount than the item has open is the accountant's.
    const differs = invoice(
      'USD',
      '124.0000',
      [{ amount: 45_000, source: 'milestone', milestone_id: MS(2).id }],
      { contract: P1, issued_on: '2026-12-03' },
    );
    expect(planEvent(differs, references, contextOf(sypUsd))).toMatchObject({
      kind: 'post',
      decision: 'milestone_amount_differs',
    });
  });

  it('holds a done’s decisions for the accountant (rule 11)', () => {
    const deferred = schedule('sch-4', usd(30_000n, 3_600_000n, 30_000n));
    const context = contextOf(sypUsd);
    expect(
      planEvent(
        done(4, 35_000, '2026-12-01'),
        withMilestone(4, facts({ schedule: deferred })),
        context,
      ),
    ).toMatchObject({ decision: 'milestone_amount_differs' });
    expect(planEvent(done(6, 40_000, '2026-12-01', null), NO_REFERENCES, context)).toMatchObject({
      decision: 'milestone_service_missing',
    });
    expect(
      planEvent(
        done(7, 40_000, '2026-12-03'),
        withMilestone(7, facts({ doneStanding: true })),
        context,
      ),
    ).toEqual({ kind: 'post', entries: [], decision: 'milestone_already_done' });
    const released = schedule('sch-14', usd(0n, 0n, 0n));
    expect(
      planEvent(
        done(14, 30_000, '2026-11-30'),
        withMilestone(14, facts({ schedule: released })),
        context,
      ),
    ).toEqual({ kind: 'post', entries: [], decision: 'milestone_released_at_completion' });
  });

  it('reverses a standing done on its reopen, and holds a reopen with no done (rule 13)', () => {
    const reopened = event(
      'milestone.reopened',
      { milestone: MS(8), client: C1, project: P1, reopened_on: '2026-12-03' },
      '2026-12-03',
    );
    expect(planEvent(reopened, NO_REFERENCES, contextOf(sypUsd))).toEqual(
      hold('UNKNOWN_REFERENCE'),
    );
    expect(
      planEvent(reopened, { ...NO_REFERENCES, standing: ['done-entry'] }, contextOf(sypUsd)),
    ).toEqual({
      kind: 'post',
      entries: [{ kind: 'reversal', key: `${reopened.id}:reversal:1`, entryId: 'done-entry' }],
      decision: null,
    });
    // A done that released its schedule gives the schedule its remaining back.
    const amounts = usd(30_000n, 3_600_000n, 30_000n);
    const references: HubReferences = {
      ...withMilestone(
        8,
        facts({
          doneStanding: true,
          doneRelease: { entryId: 'done-entry', scheduleId: 'sch-8', amounts },
        }),
      ),
      standing: ['done-entry'],
    };
    expect(planEvent(reopened, references, contextOf(sypUsd))).toMatchObject({
      movements: [
        { scheduleId: 'sch-8', kind: 'released', key: `${reopened.id}:reversal:1`, amounts },
      ],
    });
  });

  it('releases what a completed project’s schedules hold, one entry each, or records it (rule 14)', () => {
    const completed = event('project.completed', { project: P1, client: C1, on: '2026-12-10' });
    const context = contextOf(sypUsd);
    expect(planEvent(completed, NO_REFERENCES, context)).toEqual({
      kind: 'post',
      entries: [],
      decision: null,
    });
    const plan = planEvent(
      completed,
      {
        ...NO_REFERENCES,
        projectSchedules: [
          schedule('sch-11', usd(0n, 0n, 0n)),
          schedule('sch-13', usd(20_000n, 2_460_000n, 20_000n)),
        ],
      },
      context,
    );
    expect(plan.kind === 'post' && plan.entries.map((entry) => entry.key)).toEqual([
      `${completed.id}:schedule:sch-13`,
    ]);
    expect(rows(measure(plan, sypUsd, '2026-12-10', []))).toEqual([
      ['212001', 'USD', 20_000n, 2_460_000n, 20_000n],
      ['411001', 'USD', -20_000n, -2_460_000n, -20_000n],
    ]);
    // A milestone the accountant resolved by hand: its schedule is the accountant's (S05 rule 16).
    const byHand: HubReferences = {
      ...NO_REFERENCES,
      projectSchedules: [
        { ...schedule('sch-13', usd(20_000n, 2_460_000n, 20_000n)), resolvedByHand: true },
      ],
    };
    expect(planEvent(completed, byHand, context)).toEqual({
      kind: 'post',
      entries: [],
      decision: 'document_resolved_manually',
    });
    const cancelled = event('project.cancelled', { project: P1, client: C1, on: '2026-12-10' });
    expect(planEvent(cancelled, byHand, context)).toMatchObject({
      decision: 'document_resolved_manually',
    });
    expect(refusal(() => planEvent(cancelled, byHand, context, 0n))).toBe(
      'EVENT_ACTION_NOT_ALLOWED',
    );
  });

  it('holds a cancelled project’s remainder for the split, then posts it with an 800.00 SYP loss (rule 15)', () => {
    const cancelled = event('project.cancelled', { project: P1, client: C1, on: '2026-12-10' });
    const context = contextOf(sypUsd);
    const references: HubReferences = {
      ...NO_REFERENCES,
      projectSchedules: [schedule('sch-1', usd(30_000n, 3_600_000n, 30_000n))],
    };
    expect(planEvent(cancelled, NO_REFERENCES, context)).toEqual({
      kind: 'post',
      entries: [],
      decision: null,
    });
    const held = planEvent(cancelled, references, context);
    expect(held).toMatchObject({ decision: 'cancelled_project_remainder' });
    // Planned with the whole remainder refunded, so the refund's rate is checked first.
    expect(rows(measure(held, sypUsd, '2026-12-10', [bulletin('124.0000', '2026-12-10')]))).toEqual(
      [
        ['212001', 'USD', 30_000n, 3_600_000n, 30_000n],
        ['211003', 'USD', -30_000n, -3_720_000n, -30_000n],
        ['541001', 'SYP', 120_000n, 120_000n, 0n],
      ],
    );
    const split = planEvent(cancelled, references, context, 10_000n);
    expect(
      rows(measure(split, sypUsd, '2026-12-10', [bulletin('124.0000', '2026-12-10')])),
    ).toEqual([
      ['212001', 'USD', 30_000n, 3_600_000n, 30_000n],
      ['411001', 'USD', -10_000n, -1_200_000n, -10_000n],
      ['211003', 'USD', -20_000n, -2_480_000n, -20_000n],
      ['541001', 'SYP', 80_000n, 80_000n, 0n],
    ]);
    expect(split).toMatchObject({
      decision: null,
      movements: [
        {
          scheduleId: 'sch-1',
          kind: 'remainder_released',
          amounts: usd(-10_000n, -1_200_000n, -10_000n),
        },
        {
          scheduleId: 'sch-1',
          kind: 'remainder_refunded',
          amounts: usd(-20_000n, -2_400_000n, -20_000n),
        },
      ],
    });
    expect(refusal(() => planEvent(cancelled, references, context, 30_001n))).toBe(
      'VALIDATION_FAILED',
    );
    expect(refusal(() => planEvent(cancelled, NO_REFERENCES, context, 0n))).toBe(
      'EVENT_ACTION_NOT_ALLOWED',
    );
  });

  it('holds a deposit invoiced after its project’s cancellation, then splits it at 125 (rule 15)', () => {
    const issued = deposit(30_000, 1, { issued_on: '2026-12-15', due_on: '2026-12-30' });
    const references = withMilestone(1, facts({ projectCancelled: true }));
    const context = contextOf(sypUsd);
    expect(planEvent(issued, references, context)).toMatchObject({
      decision: 'invoiced_after_cancellation',
    });
    const split = planEvent(issued, references, context, 10_000n);
    expect(split.kind === 'post' && split.schedules).toBeUndefined();
    expect(
      rows(measure(split, sypUsd, '2026-12-15', [bulletin('125.0000', '2026-12-15')])),
    ).toEqual([
      ['112001', 'USD', 30_000n, 3_750_000n, 30_000n],
      ['411001', 'USD', -10_000n, -1_250_000n, -10_000n],
      ['211003', 'USD', -20_000n, -2_500_000n, -20_000n],
    ]);
    expect(refusal(() => planEvent(deposit(30_000), NO_REFERENCES, context, 0n))).toBe(
      'EVENT_ACTION_NOT_ALLOWED',
    );
  });

  it('holds the void of an invoice its project’s split cleared for the accountant (rule 8)', () => {
    const voided = event('invoice.voided', {
      invoice: INVOICE,
      voided_on: '2026-12-15',
      reason: 'ملغاة',
    });
    const references: HubReferences = {
      ...NO_REFERENCES,
      standing: ['issue-entry'],
      scheduledLineIds: [ids(200)],
      splitAtCancellation: true,
    };
    expect(planEvent(voided, references, contextOf(sypUsd))).toEqual({
      kind: 'post',
      entries: [{ kind: 'reversal', key: `${voided.id}:reversal:1`, entryId: 'issue-entry' }],
      decision: 'schedule_split_at_cancellation',
    });
  });
});

describe('credits, voids and re-issues (revenue/retainer-credit, revenue/void-and-reissue)', () => {
  const usd = (transaction: bigint, book: bigint, parallel: bigint | null): CarriedAmounts => ({
    transaction: money(transaction, 'USD'),
    bookMinor: book,
    parallelMinor: parallel,
  });
  const cycleOf = (
    id: string,
    netMinor: bigint,
    remaining: CarriedAmounts,
    service = 'service-S1',
  ): CreditableSchedule => ({
    id,
    liabilityAccountId: '212001',
    parties: ['client-C1', 'contract-R1'],
    serviceValueId: service,
    netMinor,
    remaining,
  });
  const charge = (
    amount: number,
    kind: 'monthly' | 'addition',
    cycleStart: string,
    cycleEnd: string,
    service = S1,
  ) => ({
    amount,
    source: 'retainer_charge',
    charge_kind: kind,
    cycle_start: cycleStart,
    cycle_end: cycleEnd,
    service,
  });
  const credit = (amount: number, cycleStart: string) => ({
    amount,
    source: 'retainer_charge',
    charge_kind: 'credit',
    cycle_start: cycleStart,
  });
  const issuedOn = (on: string, lines: InvoiceLine[], currency: HubCurrency = 'USD') =>
    invoice(currency, '124.0000', lines, { contract: R1, issued_on: on, due_on: on });
  const withCycle = (cycleKey: string, standing: CreditableSchedule[], voided = false) => ({
    ...NO_REFERENCES,
    cycles: new Map([[cycleKey, { standing, voided }]]),
  });
  const R1_NOV = 'R1:2026-11-15';

  it('splits a 90.00 USD credit at 123 between released revenue and the liability at 121', () => {
    // INV-2026-41: the next cycle's 900.00 USD and a credit of 90.00 to the cycle with 16/30 released.
    const issued = issuedOn('2026-12-15', [
      charge(90_000, 'monthly', '2026-12-15', '2027-01-14'),
      credit(-9_000, '2026-11-15'),
    ]);
    const first = cycleOf('schedule-40', 90_000n, usd(42_000n, 5_082_000n, 42_000n));
    const plan = planEvent(issued, withCycle(R1_NOV, [first]), contextOf(sypUsd));
    expect(rows(measure(plan, sypUsd, '2026-12-15', [bulletin('123.0000', '2026-12-15')]))).toEqual(
      [
        ['112001', 'USD', 81_000n, 9_963_000n, 81_000n],
        ['212001', 'USD', -90_000n, -11_070_000n, -90_000n],
        // N = 90,000, R = 42,000: 4,800 of revenue, a new measurement at 123
        ['411001', 'USD', 4_800n, 590_400n, 4_800n],
        // 4,200 of the liability, carried at the 121 it holds
        ['212001', 'USD', 4_200n, 508_200n, 4_200n],
        ['541001', 'SYP', 8_400n, 8_400n, 0n],
      ],
    );
    expect(plan.kind === 'post' && plan.movements).toEqual([
      {
        scheduleId: 'schedule-40',
        kind: 'credited',
        key: issued.id,
        amounts: usd(-4_200n, -508_200n, -4_200n),
        creditMinor: 9_000n,
      },
    ]);
    // The new cycle's deferral is its schedule's, after the receivable's line.
    expect(plan.kind === 'post' && plan.schedules?.[0]?.deferral).toEqual({
      key: issued.id,
      lineNo: 2,
    });
  });

  it('shares a 100.01 USD credit 75.01 / 25.00 over a cycle not released yet, each liability carried', () => {
    const issued = issuedOn('2026-11-26', [
      { amount: 20_000, service: S2 },
      credit(-10_001, '2026-11-15'),
    ]);
    const plan = planEvent(
      issued,
      withCycle(R1_NOV, [
        cycleOf('monthly', 90_000n, usd(90_000n, 10_890_000n, 90_000n)),
        cycleOf('addition', 30_000n, usd(30_000n, 3_645_000n, 30_000n), 'service-S2'),
      ]),
      contextOf(sypUsd),
    );
    expect(rows(measure(plan, sypUsd, '2026-11-26', [bulletin('122.0000', '2026-11-26')]))).toEqual(
      [
        ['112001', 'USD', 9_999n, 1_219_878n, 9_999n],
        ['411001', 'USD', -20_000n, -2_440_000n, -20_000n],
        ['212001', 'USD', 7_501n, 907_621n, 7_501n],
        ['212001', 'USD', 2_500n, 303_750n, 2_500n],
        ['541001', 'SYP', 8_751n, 8_751n, 0n],
      ],
    );
  });

  it('reduces revenue only on a cycle fully released, and drops the receivable of a zero total', () => {
    const released = cycleOf('schedule-42', 60_000n, usd(0n, 0n, 0n));
    const zero = issuedOn('2026-12-03', [
      charge(60_000, 'monthly', '2026-12-01', '2026-12-31'),
      credit(-60_000, '2026-11-01'),
    ]);
    const plan = planEvent(zero, withCycle('R1:2026-11-01', [released]), contextOf(sypUsd));
    expect(rows(measure(plan, sypUsd, '2026-12-03', [bulletin('123.0000', '2026-12-03')]))).toEqual(
      [
        ['212001', 'USD', -60_000n, -7_380_000n, -60_000n],
        ['411001', 'USD', 60_000n, 7_380_000n, 60_000n],
      ],
    );
    // Its movement records the credit's part with no liability amount.
    expect(plan.kind === 'post' && plan.movements?.[0]).toMatchObject({
      kind: 'credited',
      amounts: usd(0n, 0n, 0n),
      creditMinor: 60_000n,
    });
  });

  it('measures an SYP credit at Hub’s 120 in the USD parallel ledger, a 0.23 USD realised loss', () => {
    const issued = invoice(
      'SYP',
      '120.0000',
      [charge(7_260_000, 'monthly', '2026-12-15', '2027-01-14'), credit(-726_000, '2026-11-15')],
      { contract: R1, issued_on: '2026-12-15', due_on: '2026-12-30' },
    );
    const syp = (transaction: bigint, parallel: bigint): CarriedAmounts => ({
      transaction: money(transaction, 'SYP'),
      bookMinor: transaction,
      parallelMinor: parallel,
    });
    const first: CreditableSchedule = {
      ...cycleOf('schedule-51', 7_260_000n, usd(0n, 0n, 0n)),
      remaining: syp(3_388_000n, 28_000n),
    };
    const plan = planEvent(issued, withCycle(R1_NOV, [first]), contextOf(sypUsd));
    expect(rows(measure(plan, sypUsd, '2026-12-15', []))).toEqual([
      ['112001', 'SYP', 6_534_000n, 6_534_000n, 54_450n],
      ['212001', 'SYP', -7_260_000n, -7_260_000n, -60_500n],
      ['411001', 'SYP', 387_200n, 387_200n, 3_227n],
      ['212001', 'SYP', 338_800n, 338_800n, 2_800n],
      ['541001', 'USD', 23n, 0n, 23n],
    ]);
  });

  it('holds credits the accountant decides, whole, with nothing planned', () => {
    const issued = issuedOn('2026-11-24', [{ amount: 50_000 }, credit(-40_000, '2026-11-15')]);
    // Already credited 600.00 USD: 300.00 USD left net of credits.
    const credited = cycleOf('schedule-40', 30_000n, usd(30_000n, 3_630_000n, 30_000n));
    expect(planEvent(issued, withCycle(R1_NOV, [credited]), contextOf(sypUsd))).toEqual({
      kind: 'post',
      entries: [],
      decision: 'credit_exceeds_cycle',
    });
    expect(planEvent(issued, withCycle(R1_NOV, [], true), contextOf(sypUsd))).toEqual({
      kind: 'post',
      entries: [],
      decision: 'credit_cycle_voided',
    });
  });

  it('re-issues a voided cycle: November taken back is revenue at issue at 122, December deferred', () => {
    const issued = issuedOn('2026-12-07', [charge(90_000, 'monthly', '2026-11-15', '2026-12-14')]);
    const references = {
      ...NO_REFERENCES,
      reissues: new Map([
        [reissueKey(R1_NOV, 'monthly'), [{ scheduleId: 'voided-80', takenBack: ['2026-11'] }]],
      ]),
    };
    const plan = planEvent(issued, references, contextOf(sypUsd));
    expect(rows(measure(plan, sypUsd, '2026-12-07', [bulletin('122.0000', '2026-12-07')]))).toEqual(
      [
        ['112001', 'USD', 90_000n, 10_980_000n, 90_000n],
        ['411001', 'USD', -48_000n, -5_856_000n, -48_000n],
        ['212001', 'USD', -42_000n, -5_124_000n, -42_000n],
      ],
    );
    expect(plan.kind === 'post' && plan.schedules?.[0]).toMatchObject({
      reissueOfScheduleId: 'voided-80',
      deferral: { key: issued.id, lineNo: 3 },
      months: [expect.objectContaining({ month: '2026-12', transactionMinor: 42_000n })],
    });
    // A re-issue for 15 to 30 November does not cover December, which the void took back.
    const shorter = issuedOn('2027-01-07', [charge(48_000, 'monthly', '2026-11-15', '2026-11-30')]);
    const both = {
      ...NO_REFERENCES,
      reissues: new Map([
        [
          reissueKey(R1_NOV, 'monthly'),
          [{ scheduleId: 'voided-80', takenBack: ['2026-11', '2026-12'] }],
        ],
      ]),
    };
    expect(planEvent(shorter, both, contextOf(sypUsd))).toEqual({
      kind: 'post',
      entries: [],
      decision: 'reissue_period_differs',
    });
  });

  it('re-issues a voided cycle the next month: November at issue, December elapsed and cleared', () => {
    const issued = issuedOn('2027-01-05', [charge(90_000, 'monthly', '2026-11-15', '2026-12-14')]);
    const references = {
      ...NO_REFERENCES,
      reissues: new Map([
        [reissueKey(R1_NOV, 'monthly'), [{ scheduleId: 'voided-80', takenBack: ['2026-11'] }]],
      ]),
    };
    const plan = planEvent(issued, references, contextOf(sypUsd));
    const rates = [bulletin('124.0000', '2026-12-31'), bulletin('125.0000', '2027-01-05')];
    const december = measure(plan, sypUsd, '2026-12-31', rates);
    expect(rows(december)).toEqual([
      ['113001', 'USD', 42_000n, 5_208_000n, 42_000n],
      ['411001', 'USD', -42_000n, -5_208_000n, -42_000n],
    ]);
    const item: ItemState = {
      id: 'INV-2026-1/1',
      kind: 'document',
      direction: 1,
      balance: usd(42_000n, 5_208_000n, 42_000n),
    };
    const lines = measure(plan, sypUsd, '2027-01-05', rates, new Map([['INV-2026-1/1', item]]), 1);
    expect(rows(lines)).toEqual([
      ['112001', 'USD', 90_000n, 11_250_000n, 90_000n],
      ['411001', 'USD', -48_000n, -6_000_000n, -48_000n],
      ['113001', 'USD', -42_000n, -5_208_000n, -42_000n],
      ['421001', 'SYP', -42_000n, -42_000n, 0n],
    ]);
  });

  describe('milestones re-issued', () => {
    const MS5 = { id: ids(505), number: 'MS-5' };
    const reissue = invoice(
      'USD',
      '124.0000',
      [{ amount: 30_000, source: 'deposit', milestone_id: MS5.id }],
      { contract: P1, issued_on: '2026-12-03', due_on: '2026-12-18' },
    );
    const facts = (overrides: Partial<MilestoneReferences>): HubReferences => ({
      ...NO_REFERENCES,
      milestones: new Map([
        [
          MS5.id,
          {
            doneStanding: false,
            item: null,
            doneRelease: null,
            schedule: null,
            items: 0,
            projectCancelled: false,
            voidedScheduleId: 'voided-98',
            ...overrides,
          },
        ],
      ]),
    });

    it('is revenue at issue when the void took back its completion’s or its done’s release', () => {
      for (const taken of [
        { completionTakenBackByVoid: true },
        { doneTakenBackByVoid: true },
      ] as const) {
        const plan = planEvent(reissue, facts(taken), contextOf(sypUsd));
        expect(
          rows(measure(plan, sypUsd, '2026-12-03', [bulletin('123.0000', '2026-12-03')])),
        ).toEqual([
          ['112001', 'USD', 30_000n, 3_690_000n, 30_000n],
          ['411001', 'USD', -30_000n, -3_690_000n, -30_000n],
        ]);
        // Its schedule defers nothing, so a later done is a second one.
        expect(plan.kind === 'post' && plan.schedules?.[0]).toMatchObject({
          pattern: 'point_in_time',
          deferral: null,
          reissueOfScheduleId: 'voided-98',
        });
      }
    });

    it('is deferred when the milestone was never done, and clears the item when a done stands', () => {
      const deferred = planEvent(reissue, facts({}), contextOf(sypUsd));
      expect(
        rows(measure(deferred, sypUsd, '2026-12-03', [bulletin('121.0000', '2026-12-03')])),
      ).toEqual([
        ['112001', 'USD', 30_000n, 3_630_000n, 30_000n],
        ['212001', 'USD', -30_000n, -3_630_000n, -30_000n],
      ]);
      const item = {
        id: 'item-MS-5',
        accountId: '113001',
        currency: 'USD' as const,
        openMinor: 30_000n,
        carried: usd(30_000n, 3_630_000n, 30_000n),
      };
      const cleared = planEvent(reissue, facts({ doneStanding: true, item }), contextOf(sypUsd));
      expect(cleared).toMatchObject({ kind: 'post', decision: null });
      expect(cleared.kind === 'post' && cleared.schedules).toBeUndefined();
    });

    it('holds a done after a re-issue recognised at issue, and records a reopen after the void', () => {
      const done = event(
        'milestone.done',
        {
          milestone: MS5,
          client: C1,
          project: P1,
          currency: 'USD',
          amount: 30_000,
          done_on: '2026-12-15',
          service: S1,
        },
        '2026-12-15',
      );
      expect(planEvent(done, facts({ recognisedAtIssue: true }), contextOf(sypUsd))).toEqual({
        kind: 'post',
        entries: [],
        decision: 'milestone_already_done',
      });
      const reopened = event(
        'milestone.reopened',
        { milestone: MS5, client: C1, project: P1, reopened_on: '2026-12-02' },
        '2026-12-02',
      );
      expect(planEvent(reopened, facts({ doneTakenBackByVoid: true }), contextOf(sypUsd))).toEqual({
        kind: 'post',
        entries: [],
        decision: null,
      });
      expect(planEvent(reopened, facts({}), contextOf(sypUsd))).toMatchObject({
        reason: 'UNKNOWN_REFERENCE',
      });
    });
  });

  it('holds a credit, or a credit’s void, after a later change of its cycle (owner, 2026-11-11)', () => {
    const issued = issuedOn('2026-11-19', [{ amount: 10_000 }, credit(-5_000, '2026-11-15')]);
    const cycle = cycleOf('schedule-40', 87_000n, usd(40_600n, 4_912_600n, 40_600n));
    expect(
      planEvent(
        issued,
        {
          ...NO_REFERENCES,
          cycles: new Map([[R1_NOV, { standing: [cycle], voided: false, changedLater: true }]]),
        },
        contextOf(sypUsd),
      ),
    ).toEqual({ kind: 'post', entries: [], decision: 'credit_after_later_change' });
    const voided = event('invoice.voided', {
      invoice: INVOICE,
      voided_on: '2026-12-03',
      reason: 'x',
    });
    expect(
      planEvent(
        voided,
        { ...NO_REFERENCES, standing: [ids(900)], creditChangedLater: true },
        contextOf(sypUsd),
      ),
    ).toEqual({
      kind: 'post',
      entries: [{ kind: 'reversal', key: `${voided.id}:reversal:1`, entryId: ids(900) }],
      decision: 'credit_after_later_change',
    });
  });

  it('holds the void of a cycle another invoice’s credit reduces, with its reversals planned', () => {
    const voided = event('invoice.voided', {
      invoice: INVOICE,
      voided_on: '2026-11-25',
      reason: 'x',
    });
    expect(
      planEvent(
        voided,
        { ...NO_REFERENCES, standing: [ids(900)], scheduleCredited: true },
        contextOf(sypUsd),
      ),
    ).toEqual({
      kind: 'post',
      entries: [{ kind: 'reversal', key: `${voided.id}:reversal:1`, entryId: ids(900) }],
      decision: 'schedule_credited',
    });
  });

  it('reverses a release by its invoice’s void', () => {
    const release = carriedLine({
      account: '212001',
      dimensions: {},
      amounts: usd(48_000n, 5_808_000n, 48_000n),
    });
    const revenue = carriedLine({
      account: '411001',
      dimensions: {},
      amounts: usd(-48_000n, -5_808_000n, -48_000n),
    });
    const entry = {
      source: 'revenue_release',
      date: '2026-11-30',
      isReversal: false,
      reversed: false,
      lines: [release, revenue],
    };
    expect(rows(hubReversalLines(entry, '2026-12-03'))).toEqual([
      ['212001', 'USD', -48_000n, -5_808_000n, -48_000n],
      ['411001', 'USD', 48_000n, 5_808_000n, 48_000n],
    ]);
  });

  it('balances a credit’s entry in every shape, its residual realised (a property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(sypOnly, sypUsd, usdSyp),
        fc.constantFrom<HubCurrency>('USD', 'SYP'),
        fc.array(
          fc.record({
            net: fc.integer({ min: 1, max: 10_000_000 }),
            share: fc.integer({ min: 0, max: 1_000 }),
            rate: fc.integer({ min: 100, max: 150 }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        fc.integer({ min: 1, max: 1_000 }),
        fc.integer({ min: 1, max: 5_000_000 }),
        (ledgers, currency, cycle, creditShare, extra) => {
          // Each schedule holds R of its N, carried at its own rate in every ledger.
          const carriedAt = (minor: bigint, at: number): CarriedAmounts => {
            const other = (ledger: 'book' | 'parallel') => {
              const settings = ledgers[ledger];
              if (settings === null) return null;
              if (settings.currency === currency) return minor;
              return currency === 'USD' ? minor * BigInt(at) : minor / BigInt(at);
            };
            return {
              transaction: money(minor, currency),
              bookMinor: other('book') as bigint,
              parallelMinor: other('parallel'),
            };
          };
          const schedules = cycle.map((part, k) => {
            const net = BigInt(part.net);
            const remaining = (net * BigInt(part.share)) / 1_000n;
            return cycleOf(`schedule-${k}`, net, carriedAt(remaining, part.rate));
          });
          const net = schedules.reduce((total, schedule) => total + schedule.netMinor, 0n);
          const creditMinor = (net * BigInt(creditShare)) / 1_000n;
          if (creditMinor === 0n) return;
          const issued = invoice(
            currency,
            '122.0000',
            // Hub keeps an invoice's total at zero or more (Hub F05B rule C5).
            [{ amount: extra + Number(creditMinor) }, credit(-Number(creditMinor), '2026-11-15')],
            { contract: R1, issued_on: '2026-12-15', due_on: '2026-12-30' },
          );
          const plan = planEvent(issued, withCycle(R1_NOV, schedules), contextOf(ledgers));
          const rates = [
            bulletin('123.0000', '2026-12-15'),
            rate('USD', 'SYP', '123.5000', 'market', '2026-12-15'),
          ];
          const lines = measure(plan, ledgers, '2026-12-15', rates);
          expect(ledgerTotal(lines, 'book')).toBe(0n);
          if (ledgers.parallel !== null) expect(ledgerTotal(lines, 'parallel')).toBe(0n);
          // Each schedule's movement is what its liability line carries, and its part sums to the credit.
          if (plan.kind !== 'post') throw new Error('Expected a posting');
          const parts = (plan.movements ?? []).reduce(
            (total, movement) => total + (movement.creditMinor ?? 0n),
            0n,
          );
          expect(parts).toBe(creditMinor);
        },
      ),
      { numRuns: 300 },
    );
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

  it('lets a done pass its reopen held before it, and keeps it behind its held invoice (S06 rule 17)', () => {
    const milestone = { id: ids(510), number: 'MS-10' };
    const reopened = event('milestone.reopened', {
      milestone,
      client: C1,
      project: P1,
      reopened_on: '2026-12-03',
    });
    const done = event('milestone.done', {
      milestone,
      client: C1,
      project: P1,
      currency: 'USD',
      amount: 40_000,
      done_on: '2026-12-01',
      service: S1,
    });
    expect(blockingEvent(done, [keyed(reopened, 'held', 'UNKNOWN_REFERENCE')])).toBeNull();
    const held = keyed(issued, 'held', 'RATE_MISSING');
    expect(blockingEvent(done, [held])).toBe(held);
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

// ---- The ad funds (`ad-funds/running-balance`) and project expenses (`expenses/project-expense`)

const WALLET = (n: number) => ({ id: ids(600 + n), number: `W-${n}` });
const UPDATE = { id: ids(701), number: 'CU-1' };
const CAMPAIGN = { id: ids(702), number: 'CMP-1' };
const EXPENSE = { id: ids(801), number: 'E-1' };
const PHOTO = { external_id: 'photography', code: 'photography', name: 'تصوير' };

function wallet(
  type: 'ad_wallet.deposited' | 'ad_wallet.refunded',
  n: number,
  on: string,
  fields: { method?: string; currency: HubCurrency; amount: number; syp: string; usd: number },
) {
  return event(
    type,
    {
      entry: WALLET(n),
      client: C1,
      entered_on: on,
      method: fields.method ?? 'bank_transfer',
      currency: fields.currency,
      amount: fields.amount,
      syp_per_usd: fields.syp,
      usd_amount: fields.usd,
    },
    on,
  ) as EventOf<'ad_wallet.deposited' | 'ad_wallet.refunded'>;
}

function spend(type: 'ad_spend.recorded' | 'ad_spend.changed', usd: number, on: string) {
  return event(
    type,
    {
      update: UPDATE,
      campaign: CAMPAIGN,
      client: C1,
      period_from: '2026-11-01',
      period_to: on,
      usd_spend: usd,
    },
    on,
  );
}

function expense(
  type: 'project_expense.recorded' | 'project_expense.changed',
  fields: { currency: HubCurrency; amount: number; spentOn: string; contract?: unknown },
  on = fields.spentOn,
) {
  return event(
    type,
    {
      expense: EXPENSE,
      client: C1,
      contract: fields.contract ?? P1,
      department: PHOTO,
      spent_on: fields.spentOn,
      currency: fields.currency,
      amount: fields.amount,
      syp_per_usd: '124.0000',
      description: 'تصوير',
      ...(type === 'project_expense.changed' && { changed_on: on }),
    },
    on,
  );
}

const usdOf = (amount: bigint, book: bigint, parallel: bigint | null): CarriedAmounts => ({
  transaction: money(amount, 'USD'),
  bookMinor: book,
  parallelMinor: parallel,
});

/** The client's funds as the posting function reads their running item. */
const fundsAt = (balance: CarriedAmounts): ItemState => ({
  id: 'C1',
  kind: 'running',
  direction: null,
  balance,
});

/**
 * The lines a planned `lines` entry posts as `post()` posts a Hub event's: a line on the funds'
 * account moves the client's running item, a carrying line takes what the items gave up, then
 * `manualEntry()` and `balanceEntry()`. Returns the lines and the funds after them.
 */
function postLines(
  entry: PlannedEntry | undefined,
  ledgers: CompanyLedgers,
  on: string,
  rates: readonly ExchangeRate[],
  funds: CarriedAmounts = emptyBalance('USD', ledgers.parallel !== null),
): { lines: Line[]; funds: CarriedAmounts } {
  if (entry?.kind !== 'lines') throw new Error('Expected lines');
  const measuredOn = entry.measuredOn ?? on;
  const built = manualEntry(
    {
      lines: entry.lines.map((line) => ({
        account: line.account,
        dimensions: dims(line),
        amount: line.amount,
        ...(line.account === '213001' && { item: fundsAt(funds) }),
        ...(line.carriesItems === true && { carriesItems: true as const }),
      })),
      dealtRates: entry.dealtRates.map((dealt) => ({
        effectiveOn: measuredOn,
        ...dealt,
        type: 'market' as const,
        source: 'hub' as const,
      })),
    },
    { ledgers, on: measuredOn, rates, calendar },
    { gain: { account: '421001' }, loss: { account: '541001' } },
  );
  const lines = balanceEntry({ on, ledgers, lines: built.lines, rounding: { account: '541003' } });
  let after = funds;
  for (const line of lines) {
    if (line.item?.id !== 'C1') continue;
    after = {
      transaction: money(after.transaction.amountMinor + line.transaction.amountMinor, 'USD'),
      bookMinor: after.bookMinor + line.bookMinor,
      parallelMinor:
        after.parallelMinor === null || line.parallelMinor === null
          ? null
          : after.parallelMinor + line.parallelMinor,
    };
  }
  return { lines, funds: after };
}

function only(plan: RulePlan): PlannedEntry | undefined {
  if (plan.kind !== 'post') throw new Error(`Expected a posting, got ${plan.kind}`);
  return plan.entries[0];
}

const DAYS = {
  '2026-11-03': '120.0000',
  '2026-11-10': '122.0000',
  '2026-11-19': '123.0000',
  '2026-11-25': '123.5000',
} as const;
const BULLETINS = Object.entries(DAYS).map(([on, value]) => bulletin(value, on));

describe('the ad funds (ad-funds/running-balance)', () => {
  it('deposits in USD and SYP, spends at the average, refunds with a loss', () => {
    const context = contextOf(sypUsd);
    const first = postLines(
      only(
        walletEntryPlan(
          wallet('ad_wallet.deposited', 1, '2026-11-03', {
            currency: 'USD',
            amount: 100_000,
            syp: '122.0000',
            usd: 100_000,
          }),
          context,
        ),
      ),
      sypUsd,
      '2026-11-03',
      BULLETINS,
    );
    expect(rows(first.lines)).toEqual([
      ['111004', 'USD', 100_000n, 12_000_000n, 100_000n],
      ['213001', 'USD', -100_000n, -12_000_000n, -100_000n],
    ]);
    const deposit = walletEntryPlan(
      wallet('ad_wallet.deposited', 2, '2026-11-10', {
        method: 'cash',
        currency: 'SYP',
        amount: 6_200_000,
        syp: '124.0000',
        usd: 50_000,
      }),
      context,
    );
    expect(deposit).toMatchObject({ decision: null });
    const second = postLines(only(deposit), sypUsd, '2026-11-10', BULLETINS, first.funds);
    expect(rows(second.lines)).toEqual([
      ['111001', 'SYP', 6_200_000n, 6_200_000n, 50_000n],
      ['213001', 'USD', -50_000n, -6_100_000n, -50_000n],
      ['421001', 'SYP', -100_000n, -100_000n, 0n],
    ]);
    const spent = postLines(
      only(planEvent(spend('ad_spend.recorded', 70_000, '2026-11-19'), NO_REFERENCES, context)),
      sypUsd,
      '2026-11-19',
      BULLETINS,
      second.funds,
    );
    // 18,100,000 × 700 / 1,500 = 8,446,666.67 → 8,446,667; the payable carries it, 123 not read.
    expect(rows(spent.lines)).toEqual([
      ['213001', 'USD', 70_000n, 8_446_667n, 70_000n],
      ['211001', 'USD', -70_000n, -8_446_667n, -70_000n],
    ]);
    const refund = postLines(
      only(
        walletEntryPlan(
          wallet('ad_wallet.refunded', 3, '2026-11-25', {
            currency: 'USD',
            amount: 30_000,
            syp: '124.5000',
            usd: 30_000,
          }),
          context,
        ),
      ),
      sypUsd,
      '2026-11-25',
      BULLETINS,
      spent.funds,
    );
    expect(rows(refund.lines)).toEqual([
      ['111004', 'USD', -30_000n, -3_705_000n, -30_000n],
      ['213001', 'USD', 30_000n, 3_620_000n, 30_000n],
      ['541001', 'SYP', 85_000n, 85_000n, 0n],
    ]);
    expect(refund.funds).toEqual(usdOf(-50_000n, -6_033_333n, -50_000n));
  });

  it('splits a spend at zero; the payable carries both parts, so no residual', () => {
    const lines = postLines(
      only(
        planEvent(
          spend('ad_spend.recorded', 45_000, '2026-11-19'),
          NO_REFERENCES,
          contextOf(sypUsd),
        ),
      ),
      sypUsd,
      '2026-11-19',
      BULLETINS,
      usdOf(-30_000n, -3_600_000n, -30_000n),
    );
    expect(rows(lines.lines)).toEqual([
      ['213001', 'USD', 30_000n, 3_600_000n, 30_000n],
      ['213001', 'USD', 15_000n, 1_845_000n, 15_000n],
      ['211001', 'USD', -45_000n, -5_445_000n, -45_000n],
    ]);
  });

  it('decides the SYP gap in USD: exactly 1.00 posts as a parallel difference, 1.01 holds', () => {
    const entry = (usd: number) =>
      wallet('ad_wallet.deposited', 1, '2026-11-03', {
        method: 'cash',
        currency: 'SYP',
        amount: 5_000_000,
        syp: '124.0000',
        usd,
      });
    const within = walletEntryPlan(entry(40_223), contextOf(sypUsd));
    expect(within).toMatchObject({ decision: null });
    expect(rows(postLines(only(within), sypUsd, '2026-11-03', BULLETINS).lines)).toEqual([
      ['111001', 'SYP', 5_000_000n, 5_000_000n, 40_323n],
      ['213001', 'USD', -40_223n, -4_826_760n, -40_223n],
      ['421001', 'SYP', -173_240n, -173_240n, 0n],
      ['421001', 'USD', -100n, 0n, -100n],
    ]);
    expect(walletEntryPlan(entry(40_222), contextOf(sypUsd))).toMatchObject({
      decision: 'wallet_gap_beyond_tolerance',
    });
    // Without a parallel ledger the gap would vanish into the book residual: it still holds.
    const books = wallet('ad_wallet.deposited', 1, '2026-11-03', {
      method: 'cash',
      currency: 'SYP',
      amount: 12_200_000,
      syp: '122.0000',
      usd: 99_899,
    });
    expect(walletEntryPlan(books, contextOf(sypOnly))).toMatchObject({
      decision: 'wallet_gap_beyond_tolerance',
    });
  });

  it('measures an SYP deposit in USD books at the bulletin and the SYP parallel ledger at Hub’s rate', () => {
    const plan = walletEntryPlan(
      wallet('ad_wallet.deposited', 1, '2026-11-03', {
        method: 'cash',
        currency: 'SYP',
        amount: 12_200_000,
        syp: '122.0000',
        usd: 100_000,
      }),
      contextOf(usdSyp),
    );
    expect(rows(postLines(only(plan), usdSyp, '2026-11-03', BULLETINS).lines)).toEqual([
      ['111001', 'SYP', 12_200_000n, 101_667n, 12_200_000n],
      ['213001', 'USD', -100_000n, -100_000n, -12_200_000n],
      ['421001', 'USD', -1_667n, -1_667n, 0n],
    ]);
  });

  it('reverses a change’s spend, then posts the new state measured at its period’s end', () => {
    const changed = spend('ad_spend.changed', 45_000, '2026-11-19') as EventOf<'ad_spend.changed'>;
    const references = { ...NO_REFERENCES, standing: ['spend-entry'] };
    const plan = spendChangedPlan(changed, references, contextOf(sypUsd));
    expect(plan).toMatchObject({
      kind: 'post',
      entries: [
        // One change with its new state: no difference entry follows the reversal (Q13).
        {
          kind: 'reversal',
          key: `${changed.id}:reversal:1`,
          entryId: 'spend-entry',
          withinChange: true,
        },
        { kind: 'lines', key: changed.id, measuredOn: '2026-11-19' },
      ],
    });
    expect(spendChangedPlan(changed, NO_REFERENCES, contextOf(sypUsd))).toMatchObject({
      reason: 'UNKNOWN_REFERENCE',
    });
    expect(
      spendChangedPlan(changed, references, contextOf(sypUsd, { ad_platforms_payable: null })),
    ).toMatchObject({ reason: 'NO_MAPPING', detail: 'slot_unmapped:ad_platforms_payable' });
  });

  it('reverses what stands for a wallet entry or a spend on its void or archive', () => {
    const voided = event(
      'ad_wallet.entry_voided',
      { entry: WALLET(1), client: C1, voided_on: '2026-11-19' },
      '2026-11-19',
    );
    const archived = event(
      'ad_spend.archived',
      { update: UPDATE, campaign: CAMPAIGN, client: C1, archived_on: '2026-11-26' },
      '2026-11-26',
    );
    for (const done of [voided, archived]) {
      expect(
        planEvent(done, { ...NO_REFERENCES, standing: ['e2', 'e1'] }, contextOf(sypUsd)),
      ).toEqual({
        kind: 'post',
        entries: [
          { kind: 'reversal', key: `${done.id}:reversal:1`, entryId: 'e2' },
          { kind: 'reversal', key: `${done.id}:reversal:2`, entryId: 'e1' },
        ],
        decision: null,
      });
      expect(planEvent(done, NO_REFERENCES, contextOf(sypUsd))).toMatchObject({
        reason: 'UNKNOWN_REFERENCE',
      });
    }
  });

  it('holds a wallet entry NO_MAPPING without the method’s account or the funds', () => {
    const entry = wallet('ad_wallet.deposited', 1, '2026-11-03', {
      currency: 'USD',
      amount: 100,
      syp: '122.0000',
      usd: 100,
    });
    expect(
      walletEntryPlan(entry, contextOf(sypUsd, { 'payment_method.bank_transfer:USD': null })),
    ).toMatchObject({ reason: 'NO_MAPPING', detail: 'slot_unmapped:payment_method.bank_transfer' });
    expect(
      walletEntryPlan(entry, contextOf(sypUsd, { ad_funds: { blocked: true } })),
    ).toMatchObject({ reason: 'NO_MAPPING', detail: 'account_blocked:213001' });
  });
});

describe('project expenses (expenses/project-expense)', () => {
  it('measures an SYP expense in the USD parallel ledger at Hub’s 124 on each line', () => {
    const plan = planEvent(
      expense('project_expense.recorded', {
        currency: 'SYP',
        amount: 5_000_000,
        spentOn: '2026-11-10',
      }),
      NO_REFERENCES,
      contextOf(sypUsd),
    );
    const { lines } = postLines(only(plan), sypUsd, '2026-11-10', BULLETINS);
    expect(rows(lines)).toEqual([
      ['511001', 'SYP', 5_000_000n, 5_000_000n, 40_323n],
      ['211002', 'SYP', -5_000_000n, -5_000_000n, -40_323n],
    ]);
    const entry = only(plan);
    expect(entry?.kind === 'lines' && dims(entry.lines[0] as HubLine)).toEqual({
      client: 'C1',
      contract: 'P1',
      department: 'photography',
    });
  });

  it('measures a USD expense at the bulletin in the SYP books, never at Hub’s rate', () => {
    const plan = planEvent(
      expense('project_expense.recorded', {
        currency: 'USD',
        amount: 18_735,
        spentOn: '2026-11-10',
      }),
      NO_REFERENCES,
      contextOf(sypUsd),
    );
    expect(only(plan)).toMatchObject({ dealtRates: [] });
    expect(rows(postLines(only(plan), sypUsd, '2026-11-10', BULLETINS).lines)).toEqual([
      ['511001', 'USD', 18_735n, 2_285_670n, 18_735n],
      ['211002', 'USD', -18_735n, -2_285_670n, -18_735n],
    ]);
  });

  it('measures a change’s new state at its own spent_on, not the change date', () => {
    const changed = expense(
      'project_expense.changed',
      { currency: 'USD', amount: 25_000, spentOn: '2026-11-10' },
      '2026-12-03',
    );
    const plan = planEvent(changed, { ...NO_REFERENCES, standing: ['e1'] }, contextOf(sypUsd));
    expect(plan).toMatchObject({
      kind: 'post',
      entries: [
        { kind: 'reversal', entryId: 'e1' },
        { kind: 'lines', measuredOn: '2026-11-10' },
      ],
    });
    const state = plan.kind === 'post' ? plan.entries[1] : undefined;
    const rates = [...BULLETINS, bulletin('125.0000', '2026-12-03')];
    // 250.00 × 122 = 30,500.00 SYP, not × 125.
    expect(rows(postLines(state, sypUsd, '2026-12-03', rates).lines)).toEqual([
      ['511001', 'USD', 25_000n, 3_050_000n, 25_000n],
      ['211002', 'USD', -25_000n, -3_050_000n, -25_000n],
    ]);
    expect(planEvent(changed, NO_REFERENCES, contextOf(sypUsd))).toMatchObject({
      reason: 'UNKNOWN_REFERENCE',
    });
  });

  it('holds NO_MAPPING without its slots; leaves another client’s contract to the accountant', () => {
    const recorded = expense('project_expense.recorded', {
      currency: 'USD',
      amount: 20_000,
      spentOn: '2026-11-10',
    });
    expect(
      planEvent(recorded, NO_REFERENCES, contextOf(sypUsd, { project_cost: null })),
    ).toMatchObject({
      reason: 'NO_MAPPING',
      detail: 'slot_unmapped:project_cost',
    });
    const other = expense('project_expense.recorded', {
      currency: 'USD',
      amount: 20_000,
      spentOn: '2026-11-10',
      contract: { ...P1, client_external_id: 'C2' },
    });
    expect(planEvent(other, NO_REFERENCES, contextOf(sypUsd))).toMatchObject({
      decision: 'contract_client_mismatch',
    });
  });
});

describe('properties of the ad funds and expenses', () => {
  const funds = fc
    .tuple(fc.bigInt({ min: -2_000_000n, max: 2_000_000n }), fc.bigInt({ min: 1n, max: 200n }))
    .map(([amount, perUsd]) =>
      amount === 0n ? emptyBalance('USD', true) : usdOf(amount, amount * perUsd, amount),
    );

  it('a spend posts no difference: the payable carries exactly what the funds gave up', () => {
    fc.assert(
      fc.property(funds, fc.integer({ min: 1, max: 5_000_000 }), (balance, usd) => {
        const plan = planEvent(
          spend('ad_spend.recorded', usd, '2026-11-19'),
          NO_REFERENCES,
          contextOf(sypUsd),
        );
        const { lines } = postLines(only(plan), sypUsd, '2026-11-19', BULLETINS, balance);
        expect(lines.every((line) => line.kind !== 'difference' && line.kind !== 'rounding')).toBe(
          true,
        );
        expect(ledgerTotal(lines, 'book')).toBe(0n);
        expect(ledgerTotal(lines, 'parallel')).toBe(0n);
      }),
    );
  });

  it('a wallet entry balances in every ledger and shape, its differences each in one ledger', () => {
    const shapes = [sypOnly, sypUsd, usdSyp] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...shapes),
        fc.constantFrom('ad_wallet.deposited' as const, 'ad_wallet.refunded' as const),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 100, max: 200 }),
        fc.boolean(),
        (ledgers, type, usd, perUsd, inSyp) => {
          const entry = wallet(type, 1, '2026-11-10', {
            method: 'cash',
            currency: inSyp ? 'SYP' : 'USD',
            amount: inSyp ? usd * perUsd : usd,
            syp: `${perUsd}.0000`,
            usd,
          });
          const plan = walletEntryPlan(entry, contextOf(ledgers));
          expect(plan).toMatchObject({ decision: null });
          const { lines } = postLines(only(plan), ledgers, '2026-11-10', BULLETINS);
          expect(ledgerTotal(lines, 'book')).toBe(0n);
          if (ledgers.parallel !== null) expect(ledgerTotal(lines, 'parallel')).toBe(0n);
        },
      ),
    );
  });

  it('decides the wallet tolerance symmetrically around its bound', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 1_000_000 }),
        fc.integer({ min: -300, max: 300 }),
        (usd, gap) => {
          const decision = walletDecision(
            {
              entry: WALLET(1),
              client: C1,
              entered_on: '2026-11-10',
              method: 'cash',
              currency: 'SYP',
              amount: usd * 124,
              syp_per_usd: '124.0000',
              usd_amount: usd + gap,
            },
            { SYP: 100n, USD: 100n },
          );
          expect(decision).toBe(Math.abs(gap) > 100 ? 'wallet_gap_beyond_tolerance' : null);
        },
      ),
    );
  });
});
