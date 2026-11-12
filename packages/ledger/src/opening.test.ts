import {
  type CompanyLedgers,
  type ExchangeRate,
  money,
  type OpeningSnapshot,
  openingSnapshotSchema,
} from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceEntry, ledgerTotal } from './balance.js';
import { reverseLines } from './carried.js';
import type { Line } from './lines.js';
import {
  balancingLine,
  hubItemFigure,
  type OpeningRateContext,
  openingHubItems,
  openingItemLine,
  openingRecordLine,
  openingScheduleLine,
  openingSchedules,
  recordsDifferences,
} from './opening.js';
import { releaseParts, remainingReleaseParts } from './recognition.js';
import { calendar, rate, sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

// The numbers of `docs/scenarios/opening/opening-entry.md` (owner, 2026-11-12). Synthetic ids.
const id = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ref = (code: string) => ({ external_id: code, code, name: code });
const contract = (code: string, kind: 'retainer' | 'project', client: string) => ({
  ...ref(code),
  kind,
  client_external_id: client,
});
let ids = 100;
const doc = (number: string) => ({ id: id(ids++), number });

function monthly(amount: number, from: string, to: string, service = 'S1') {
  return {
    id: id(ids++),
    amount,
    service: ref(service),
    source: 'retainer_charge' as const,
    charge_kind: 'monthly' as const,
    cycle_start: from,
    cycle_end: to,
  };
}

function snapshotOf(input: Partial<Record<keyof OpeningSnapshot, unknown>>): OpeningSnapshot {
  return openingSnapshotSchema.parse({
    as_of: '2026-09-30',
    generated_at: '2026-10-25T08:00:00+03:00',
    ...input,
  });
}

const contextOf = (ledgers: CompanyLedgers, rates: ExchangeRate[]): OpeningRateContext => ({
  ledgers,
  asOf: '2026-09-30',
  rates,
  calendar,
});

const accounts = {
  receivable: '112001',
  contract_asset: '113001',
  ad_funds: '213001',
  liability: '212001',
  retained: '312001',
};

function entryOf(
  snapshot: OpeningSnapshot,
  context: OpeningRateContext,
  records: Parameters<typeof openingRecordLine>[0][],
) {
  const { items } = openingHubItems(snapshot, context);
  const { schedules } = openingSchedules(snapshot, context);
  const lines: Line[] = [
    ...items.map((item) => openingItemLine(item, accounts[item.slot])),
    ...schedules.map((schedule) => openingScheduleLine(schedule, accounts.liability)),
    ...records.map((record) => {
      const measured = openingRecordLine(record, context, []);
      if (measured.kind !== 'line') throw new Error(`A record line ${measured.kind}`);
      return measured.line;
    }),
  ];
  const balancing = balancingLine(lines, context.ledgers, accounts.retained);
  return balancing === null ? lines : [...lines, balancing];
}

const amounts = (lines: readonly Line[]) =>
  lines.map((line) => ({
    account: line.account,
    kind: line.kind,
    amount: line.transaction.amountMinor,
    currency: line.transaction.currency,
    book: line.bookMinor,
    parallel: line.parallelMinor,
  }));

describe('the opening entry (S10 rules 11â€“19)', () => {
  it("posts the spec's worked example", () => {
    const snapshot = snapshotOf({
      invoices: [
        {
          invoice: doc('INV-2026-7'),
          client: ref('C1'),
          contract: contract('R1', 'retainer', 'C1'),
          currency: 'USD',
          syp_per_usd: '117.0000',
          issued_on: '2026-09-10',
          due_on: '2026-09-25',
          total: 30_000,
          outstanding: 30_000,
          lines: [monthly(30_000, '2026-09-16', '2026-10-15')],
        },
      ],
      wallets: [{ client: ref('C1'), balance: 50_000 }],
    });
    const context = contextOf(sypUsd, [
      rate('USD', 'SYP', '114.0000', 'bulletin', '2026-09-10'),
      rate('USD', 'SYP', '115.0000', 'bulletin', '2026-09-30'),
      rate('USD', 'SYP', '118.0000', 'market', '2026-09-30'),
    ]);
    const lines = entryOf(snapshot, context, [
      {
        account: '111001',
        monetary: true,
        amount: money(200_000_000n, 'SYP'),
        bookMinor: null,
        parallelMinor: null,
      },
      {
        account: '311001',
        monetary: false,
        amount: money(-100_000_000n, 'SYP'),
        bookMinor: null,
        parallelMinor: -1_000_000n,
      },
      {
        account: '312002',
        monetary: false,
        amount: money(-30_000_000n, 'SYP'),
        bookMinor: null,
        parallelMinor: -260_000n,
      },
    ]);
    expect(amounts(lines)).toEqual([
      {
        account: '112001',
        kind: 'measured',
        amount: 30_000n,
        currency: 'USD',
        book: 3_450_000n,
        parallel: 30_000n,
      },
      {
        account: '213001',
        kind: 'measured',
        amount: -50_000n,
        currency: 'USD',
        book: -5_750_000n,
        parallel: -50_000n,
      },
      {
        account: '212001',
        kind: 'stated',
        amount: -15_000n,
        currency: 'USD',
        book: -1_710_000n,
        parallel: -15_000n,
      },
      {
        account: '111001',
        kind: 'measured',
        amount: 200_000_000n,
        currency: 'SYP',
        book: 200_000_000n,
        parallel: 1_694_915n,
      },
      {
        account: '311001',
        kind: 'stated',
        amount: -100_000_000n,
        currency: 'SYP',
        book: -100_000_000n,
        parallel: -1_000_000n,
      },
      {
        account: '312002',
        kind: 'stated',
        amount: -30_000_000n,
        currency: 'SYP',
        book: -30_000_000n,
        parallel: -260_000n,
      },
      {
        account: '312001',
        kind: 'stated',
        amount: -65_990_000n,
        currency: 'SYP',
        book: -65_990_000n,
        parallel: -399_915n,
      },
    ]);
    expect(
      balanceEntry({ on: '2026-10-01', ledgers: sypUsd, lines, rounding: { account: '531900' } }),
    ).toHaveLength(7);
    const [schedule] = openingSchedules(snapshot, context).schedules;
    expect(schedule).toMatchObject({
      deferred: {
        transaction: money(30_000n, 'USD'),
        bookMinor: 3_420_000n,
        parallelMinor: 30_000n,
      },
      beforeOpening: {
        transaction: money(-15_000n, 'USD'),
        bookMinor: -1_710_000n,
        parallelMinor: -15_000n,
      },
      releasedMonths: ['2026-09'],
      creditMinor: 0n,
    });
  });

  it('opens every kind of Hub balance, a credit before the eve all to the liability', () => {
    const snapshot = snapshotOf({
      invoices: [
        {
          invoice: doc('INV-2026-8'),
          client: ref('C1'),
          contract: contract('P1', 'project', 'C1'),
          currency: 'USD',
          syp_per_usd: '117.5000',
          issued_on: '2026-09-15',
          due_on: '2026-09-30',
          total: 20_000,
          outstanding: 0,
          lines: [
            {
              id: id(1),
              amount: 20_000,
              service: ref('S1'),
              source: 'deposit',
              milestone_id: id(50),
            },
          ],
        },
        {
          invoice: doc('INV-2026-10'),
          client: ref('C2'),
          contract: contract('R2', 'retainer', 'C2'),
          currency: 'SYP',
          syp_per_usd: '116.0000',
          issued_on: '2026-09-21',
          due_on: '2026-10-05',
          total: 12_000_000,
          outstanding: 6_000_000,
          lines: [monthly(12_000_000, '2026-09-21', '2026-10-20', 'S2')],
        },
        {
          invoice: doc('INV-2026-11'),
          client: ref('C1'),
          contract: contract('R1', 'retainer', 'C1'),
          currency: 'USD',
          syp_per_usd: '117.0000',
          issued_on: '2026-09-10',
          due_on: '2026-09-25',
          total: 60_000,
          outstanding: 60_000,
          lines: [monthly(60_000, '2026-09-11', '2026-10-10')],
        },
      ],
      credits: [
        {
          invoice: doc('INV-2026-12'),
          client: ref('C1'),
          contract: contract('R1', 'retainer', 'C1'),
          currency: 'USD',
          syp_per_usd: '117.5000',
          issued_on: '2026-09-24',
          line: {
            id: id(2),
            amount: -6_000,
            service: ref('S1'),
            source: 'retainer_charge',
            charge_kind: 'credit',
            cycle_start: '2026-09-11',
          },
        },
      ],
      milestones: [
        {
          milestone: { id: id(50), number: 'MS-1' },
          client: ref('C1'),
          project: contract('P1', 'project', 'C1'),
          currency: 'USD',
          amount: 20_000,
          service: ref('S1'),
        },
        {
          milestone: { id: id(51), number: 'MS-2' },
          client: ref('C2'),
          project: contract('P2', 'project', 'C2'),
          currency: 'USD',
          amount: 40_000,
          service: ref('S2'),
          done_on: '2026-09-25',
        },
      ],
      wallets: [
        { client: ref('C1'), balance: 25_000 },
        { client: ref('C2'), balance: -12_000 },
      ],
    });
    const context = contextOf(sypUsd, [
      rate('USD', 'SYP', '114.0000', 'bulletin', '2026-09-10'),
      rate('USD', 'SYP', '114.5000', 'bulletin', '2026-09-15'),
      rate('USD', 'SYP', '114.8000', 'bulletin', '2026-09-21'),
      rate('USD', 'SYP', '115.0000', 'bulletin', '2026-09-30'),
      rate('USD', 'SYP', '118.0000', 'market', '2026-09-30'),
    ]);
    const lines = entryOf(snapshot, context, [
      {
        account: '111001',
        monetary: true,
        amount: money(50_000_000n, 'SYP'),
        bookMinor: null,
        parallelMinor: null,
      },
      {
        account: '111004',
        monetary: true,
        amount: money(100_000n, 'USD'),
        bookMinor: null,
        parallelMinor: null,
      },
      {
        account: '121001',
        monetary: false,
        amount: money(300_000_000n, 'SYP'),
        bookMinor: null,
        parallelMinor: 2_500_000n,
      },
      {
        account: '311001',
        monetary: false,
        amount: money(-300_000_000n, 'SYP'),
        bookMinor: null,
        parallelMinor: -3_000_000n,
      },
      {
        account: '312002',
        monetary: false,
        amount: money(15_000_000n, 'SYP'),
        bookMinor: null,
        parallelMinor: 130_000n,
      },
    ]);
    expect(
      amounts(lines).map(({ account, amount, book, parallel }) => [
        account,
        amount,
        book,
        parallel,
      ]),
    ).toEqual([
      ['112001', 6_000_000n, 6_000_000n, 50_847n],
      ['112001', 60_000n, 6_900_000n, 60_000n],
      ['113001', 40_000n, 4_600_000n, 40_000n],
      ['213001', -25_000n, -2_875_000n, -25_000n],
      ['213001', 12_000n, 1_380_000n, 12_000n],
      ['212001', -20_000n, -2_290_000n, -20_000n],
      ['212001', -8_000_000n, -8_000_000n, -68_965n],
      ['212001', -18_000n, -2_052_000n, -18_000n],
      ['111001', 50_000_000n, 50_000_000n, 423_729n],
      ['111004', 100_000n, 11_500_000n, 100_000n],
      ['121001', 300_000_000n, 300_000_000n, 2_500_000n],
      ['311001', -300_000_000n, -300_000_000n, -3_000_000n],
      ['312002', 15_000_000n, 15_000_000n, 130_000n],
      ['312001', -80_163_000n, -80_163_000n, -184_611n],
    ]);
    const credited = openingSchedules(snapshot, context).schedules[2];
    expect(credited).toMatchObject({
      invoice: { number: 'INV-2026-11' },
      creditMinor: 6_000n,
      deferred: { bookMinor: 6_840_000n },
      beforeOpening: { transaction: money(-42_000n, 'USD'), bookMinor: -4_788_000n },
    });
    const { items } = openingHubItems(snapshot, context);
    const hub = items.flatMap((item) => hubItemFigure(item) ?? []);
    expect(
      recordsDifferences(hub, [
        { slot: 'receivable', client: 'C1', currency: 'USD', amountMinor: 60_000n },
        { slot: 'receivable', client: 'C2', currency: 'SYP', amountMinor: 6_000_000n },
        { slot: 'ad_funds', client: 'C1', currency: 'USD', amountMinor: 25_000n },
      ]),
    ).toEqual([
      { slot: 'ad_funds', client: 'C2', currency: 'USD', hubMinor: -12_000n, recordsMinor: null },
    ]);
  });

  it('holds a deposit whose milestone was done for another amount, and opens no asset a line bills', () => {
    const deposit = (amount: number) =>
      snapshotOf({
        invoices: [
          {
            invoice: doc('INV-2026-8'),
            client: ref('C2'),
            contract: contract('P2', 'project', 'C2'),
            currency: 'USD',
            syp_per_usd: '117.5000',
            issued_on: '2026-09-15',
            due_on: '2026-09-30',
            total: amount,
            outstanding: 0,
            lines: [
              { id: id(60), amount, service: ref('S2'), source: 'deposit', milestone_id: id(61) },
            ],
          },
        ],
        milestones: [
          {
            milestone: { id: id(61), number: 'MS-1' },
            client: ref('C2'),
            project: contract('P2', 'project', 'C2'),
            currency: 'USD',
            amount: 40_000,
            service: ref('S2'),
            done_on: '2026-09-25',
          },
        ],
      });
    const context = contextOf(sypUsd, [
      rate('USD', 'SYP', '114.5000', 'bulletin', '2026-09-15'),
      rate('USD', 'SYP', '115.0000', 'bulletin', '2026-09-30'),
      rate('USD', 'SYP', '118.0000', 'market', '2026-09-30'),
    ]);
    // 150.00 USD against a 400.00 USD milestone: S06 holds the done.
    expect(openingSchedules(deposit(15_000), context)).toMatchObject({
      schedules: [],
      failures: [{ invoice: 'INV-2026-8', position: 1, detail: 'milestone_amount_differs' }],
    });
    expect(openingHubItems(deposit(15_000), context).items).toEqual([]);
    // At the milestone's amount, released at its done: nothing deferred, and no contract asset.
    expect(openingSchedules(deposit(40_000), context)).toMatchObject({
      schedules: [],
      failures: [],
    });
    expect(openingHubItems(deposit(40_000), context).items).toEqual([]);
  });

  it('names the rates the measurements miss and the lines S06 would hold', () => {
    const snapshot = snapshotOf({
      invoices: [
        {
          invoice: doc('INV-1'),
          client: ref('C1'),
          contract: contract('P1', 'project', 'C1'),
          currency: 'USD',
          syp_per_usd: '117.0000',
          issued_on: '2026-09-10',
          due_on: '2026-09-25',
          total: 30_000,
          outstanding: 30_000,
          // A monthly charge on a project: its pattern is unclear (S06 rule 1).
          lines: [monthly(30_000, '2026-09-16', '2026-10-15')],
        },
      ],
    });
    const context = contextOf(sypUsd, [rate('USD', 'SYP', '118.0000', 'market', '2026-09-30')]);
    expect(openingSchedules(snapshot, context).failures).toEqual([
      { invoice: 'INV-1', position: 1, detail: 'recognition_pattern_unclear:1' },
    ]);
    expect(openingHubItems(snapshot, context).missingRates).toEqual([
      { ledger: 'book', rateType: 'bulletin', from: 'USD', to: 'SYP', on: '2026-09-30' },
    ]);
  });

  it('refuses a stated line missing an amount, and takes the amount itself in its own currency', () => {
    const context = contextOf(sypUsd, []);
    const stated = {
      account: '121001',
      monetary: false,
      amount: money(100n, 'SYP'),
      bookMinor: null,
      parallelMinor: null,
    };
    expect(openingRecordLine(stated, context, [])).toEqual({
      kind: 'incomplete',
      ledger: 'parallel',
    });
    expect(
      openingRecordLine({ ...stated, bookMinor: 99n, parallelMinor: 1n }, context, []),
    ).toEqual({
      kind: 'incomplete',
      ledger: 'book',
    });
    expect(
      openingRecordLine({ ...stated, parallelMinor: 1n }, contextOf(sypOnly, []), []),
    ).toMatchObject({
      kind: 'line',
      line: { bookMinor: 100n, parallelMinor: null },
    });
  });

  it('posts no balancing line when the records balance', () => {
    const lines: Line[] = [
      {
        kind: 'stated',
        account: 'a',
        dimensions: {},
        transaction: money(5n, 'USD'),
        bookMinor: 5n,
        parallelMinor: 600n,
      },
      {
        kind: 'stated',
        account: 'b',
        dimensions: {},
        transaction: money(-5n, 'USD'),
        bookMinor: -5n,
        parallelMinor: -600n,
      },
    ];
    expect(balancingLine(lines, usdSyp, 'r')).toBeNull();
    expect(balancingLine(lines.slice(0, 1), usdSyp, 'r')).toMatchObject({
      transaction: money(-5n, 'USD'),
      parallelMinor: -600n,
    });
  });
});

// Properties (S10 "Acceptance"): generated retainer cycles, credits and eves.
const cycleArbitrary = fc.record({
  startDay: fc.integer({ min: 1, max: 28 }),
  startMonth: fc.constantFrom('2026-07', '2026-08', '2026-09'),
  days: fc.integer({ min: 1, max: 80 }),
  amount: fc.integer({ min: 1, max: 5_000_000 }),
  issueOffset: fc.integer({ min: 0, max: 40 }),
  currency: fc.constantFrom('USD' as const, 'SYP' as const),
  credit: fc.option(
    fc.record({ share: fc.integer({ min: 1, max: 100 }), offset: fc.integer({ min: 0, max: 60 }) }),
  ),
});
type Cycle = typeof cycleArbitrary extends fc.Arbitrary<infer T> ? T : never;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const earliest = (a: string, b: string) => (a < b ? a : b);
// A bulletin and a market rate every day, so any issue date is measured.
const generatedRates: ExchangeRate[] = [];
for (let day = '2026-06-01'; day <= '2026-09-30'; day = addDays(day, 1)) {
  generatedRates.push(rate('USD', 'SYP', '114.5000', 'bulletin', day));
  generatedRates.push(rate('USD', 'SYP', '117.2500', 'market', day));
}

function generated(cycles: readonly Cycle[], asOf: string): OpeningSnapshot {
  const invoices: unknown[] = [];
  const credits: unknown[] = [];
  cycles.forEach((cycle, k) => {
    const from = `${cycle.startMonth}-${String(cycle.startDay).padStart(2, '0')}`;
    const to = addDays(from, cycle.days - 1);
    const issuedOn = earliest(addDays(from, cycle.issueOffset - 10), asOf);
    const code = `R${k}`;
    invoices.push({
      invoice: { id: id(1000 + k), number: `INV-${String(k).padStart(3, '0')}` },
      client: ref('C1'),
      contract: contract(code, 'retainer', 'C1'),
      currency: cycle.currency,
      syp_per_usd: '116.5000',
      issued_on: issuedOn,
      due_on: issuedOn,
      total: cycle.amount,
      outstanding: cycle.amount,
      lines: [{ ...monthly(cycle.amount, from, to), id: id(4000 + k) }],
    });
    if (cycle.credit !== null) {
      const amount = Math.max(1, Math.floor((cycle.amount * cycle.credit.share) / 100));
      credits.push({
        invoice: { id: id(2000 + k), number: `CR-${k}` },
        client: ref('C1'),
        contract: contract(code, 'retainer', 'C1'),
        currency: cycle.currency,
        syp_per_usd: '116.5000',
        issued_on: earliest(addDays(issuedOn, cycle.credit.offset), asOf),
        line: {
          id: id(3000 + k),
          amount: -amount,
          service: ref('S1'),
          source: 'retainer_charge',
          charge_kind: 'credit',
          cycle_start: from,
        },
      });
    }
  });
  return snapshotOf({ as_of: asOf, invoices, credits });
}

const atEve = (ledgers: CompanyLedgers, asOf: string): OpeningRateContext => ({
  ...contextOf(ledgers, generatedRates),
  asOf,
});

describe('opening properties', () => {
  it("a schedule never credited holds its deferral less S06's releases through the eve", () => {
    fc.assert(
      fc.property(
        fc.array(
          cycleArbitrary.map((cycle) => ({ ...cycle, credit: null })),
          { minLength: 1, maxLength: 4 },
        ),
        (cycles) => {
          const { schedules, failures, missingRates } = openingSchedules(
            generated(cycles, '2026-09-30'),
            atEve(sypUsd, '2026-09-30'),
          );
          expect(failures).toEqual([]);
          expect(missingRates).toEqual([]);
          for (const schedule of schedules) {
            const parts = releaseParts(schedule.deferred, schedule.months, sypUsd);
            const open = schedule.months.filter((month) => !month.elapsed);
            let transaction = schedule.deferred.transaction.amountMinor;
            let book = schedule.deferred.bookMinor;
            let parallel = schedule.deferred.parallelMinor ?? 0n;
            open.forEach((month, k) => {
              const part = parts[k];
              if (month.lastDay > '2026-09-30' || part === undefined) return;
              transaction -= part.transaction.amountMinor;
              book -= part.bookMinor;
              parallel -= part.parallelMinor ?? 0n;
            });
            expect(schedule.remaining.transaction.amountMinor).toBe(transaction);
            expect(schedule.remaining.bookMinor).toBe(book);
            expect(schedule.remaining.parallelMinor).toBe(parallel);
            expect(transaction).toBeGreaterThan(0n);
            expect((schedule.serviceTo ?? '') > '2026-09-30').toBe(true);
          }
        },
      ),
    );
  });

  it('an opening a month later is the earlier one continued by S06, credits included', () => {
    fc.assert(
      fc.property(fc.array(cycleArbitrary, { minLength: 1, maxLength: 4 }), (cycles) => {
        const snapshot = generated(cycles, '2026-08-31');
        const early = openingSchedules(snapshot, atEve(sypUsd, '2026-08-31'));
        const late = openingSchedules(
          { ...snapshot, as_of: '2026-09-30' },
          atEve(sypUsd, '2026-09-30'),
        );
        expect(late.failures).toEqual(early.failures);
        for (const schedule of late.schedules) {
          const before = early.schedules.find((s) => s.invoice.id === schedule.invoice.id);
          expect(before).toBeDefined();
          if (before === undefined) continue;
          // September's release of what the earlier eve left (S06 rules 4, 6).
          const left = before.months.filter(
            (month) => !month.elapsed && !before.releasedMonths.includes(month.month),
          );
          const parts =
            before.creditMinor === 0n
              ? releaseParts(before.deferred, before.months, sypUsd).slice(
                  before.releasedMonths.length,
                )
              : remainingReleaseParts(before.remaining, left, sypUsd);
          const released = parts[left.findIndex((month) => month.month === '2026-09')];
          expect(schedule.remaining.bookMinor).toBe(
            before.remaining.bookMinor - (released?.bookMinor ?? 0n),
          );
          expect(schedule.remaining.parallelMinor).toBe(
            (before.remaining.parallelMinor ?? 0n) - (released?.parallelMinor ?? 0n),
          );
          expect(schedule.beforeOpening.bookMinor).toBe(
            schedule.remaining.bookMinor - schedule.deferred.bookMinor,
          );
        }
      }),
    );
  });

  it('balances in every ledger for any snapshot and lines, the balancing line the only remainder, netting to zero with its reversal', () => {
    fc.assert(
      fc.property(
        fc.array(cycleArbitrary, { maxLength: 3 }),
        fc.array(
          fc.record({
            monetary: fc.boolean(),
            currency: fc.constantFrom('USD' as const, 'SYP' as const),
            amount: fc
              .bigInt({ min: -1_000_000_000n, max: 1_000_000_000n })
              .filter((amount) => amount !== 0n),
            other: fc.bigInt({ min: -10_000_000n, max: 10_000_000n }),
          }),
          { maxLength: 5 },
        ),
        fc.constantFrom(sypUsd, usdSyp, sypOnly),
        (cycles, records, ledgers) => {
          const lines = entryOf(
            generated(cycles, '2026-09-30'),
            atEve(ledgers, '2026-09-30'),
            records.map((record, k) => ({
              account: `R${k}`,
              monetary: record.monetary,
              amount: money(record.amount, record.currency),
              bookMinor: record.currency === ledgers.book.currency ? null : record.other,
              parallelMinor:
                ledgers.parallel === null || record.currency === ledgers.parallel.currency
                  ? null
                  : record.other,
            })),
          );
          if (lines.length < 2) return;
          const posted = balanceEntry({
            on: '2026-10-01',
            ledgers,
            lines,
            rounding: { account: 'X' },
          });
          expect(posted).toHaveLength(lines.length);
          expect(ledgerTotal(posted, 'book')).toBe(0n);
          if (ledgers.parallel !== null) expect(ledgerTotal(posted, 'parallel')).toBe(0n);
          const others = lines.filter((line) => line.account !== accounts.retained);
          const balancing = balancingLine(others, ledgers, accounts.retained);
          expect(lines.length - others.length).toBe(balancing === null ? 0 : 1);
          const reversed = [...posted, ...reverseLines(posted)];
          expect(ledgerTotal(reversed, 'book')).toBe(0n);
          if (ledgers.parallel !== null) expect(ledgerTotal(reversed, 'parallel')).toBe(0n);
          for (const account of new Set(posted.map((line) => line.account))) {
            const own = reversed.filter((line) => line.account === account);
            expect(own.reduce((sum, line) => sum + line.transaction.amountMinor, 0n)).toBe(0n);
          }
        },
      ),
    );
  });
});
