import type { CompanyLedgers, CurrencyCode, ExchangeRate } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceEntry, ledgerTotal } from './balance.js';
import { checkLineAgainstChart } from './chart.js';
import { type Line, ledgerAmount } from './lines.js';
import { ledgerPolicyRate } from './measure.js';
import {
  firstDayOfNextMonth,
  type RevaluationBalance,
  type RevaluedBalance,
  revaluationFingerprintValue,
  revaluationLines,
  revaluationReversalLines,
  revalueBalance,
} from './revaluation.js';
import { calendar, rate, refusal, sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

// The numbers of `docs/scenarios/currency/month-end-revaluation.md` (S07 rules 10–15).

const targets = { gain: { account: '421002' }, loss: { account: '541002' } };
const third: CompanyLedgers = sypUsd;

function closing(
  ledgers: CompanyLedgers,
  ledger: 'book' | 'parallel',
  from: CurrencyCode,
  on: string,
  rates: readonly ExchangeRate[],
) {
  return ledgerPolicyRate({ ledgers, ledger, from, on, rates, calendar });
}

function balance(
  account: string,
  currency: CurrencyCode,
  transactionMinor: bigint,
  carryingMinor: bigint,
  extra: Partial<RevaluationBalance> = {},
): RevaluationBalance {
  return {
    account,
    dimensions: {},
    currency,
    transactionMinor,
    carryingMinor,
    revaluedMinor: 0n,
    ...extra,
  };
}

/** The entry as the posting function stores it: balanced, with no rounding line added. */
function entry(ledgers: CompanyLedgers, lines: readonly Line[], on = '2026-11-30'): Line[] {
  const balanced = balanceEntry({ on, ledgers, lines, rounding: { account: '541003' } });
  expect(balanced).toHaveLength(lines.length);
  return balanced;
}

const amounts = (lines: readonly Line[]) =>
  lines.map((line) => ({
    account: line.account,
    currency: line.transaction.currency,
    amount: line.transaction.amountMinor,
    book: line.bookMinor,
    parallel: line.parallelMinor,
    item: line.item,
  }));

describe('the closing rate (S07 rule 11)', () => {
  it('is the bulletin of the last day, or of the last publication day when it is a day off', () => {
    const rates = [
      rate('USD', 'SYP', '118.0000', 'bulletin', '2026-10-01'),
      rate('USD', 'SYP', '119.5000', 'bulletin', '2026-10-29'),
    ];
    // Saturday 31 October: Thursday's bulletin.
    expect(closing(sypOnly, 'book', 'USD', '2026-10-31', rates)).toMatchObject({
      rate: '119.5000',
    });
    // Monday 30 November, a publication day, without its bulletin: refused.
    const november = [rate('USD', 'SYP', '124.0000', 'bulletin', '2026-11-26')];
    expect(refusal(() => closing(sypUsd, 'book', 'USD', '2026-11-30', november))).toBe(
      'RATE_MISSING',
    );
  });

  it('is the newest market rate on or before the last day, however old', () => {
    const rates = [rate('USD', 'SYP', '128.0000', 'market', '2026-11-05')];
    expect(closing(sypUsd, 'parallel', 'SYP', '2026-11-30', rates)).toMatchObject({
      rate: '128.0000',
      effectiveOn: '2026-11-05',
    });
  });

  it('crosses a third currency through the other ledger currency (ADR 0007)', () => {
    const rates = [
      rate('USD', 'SYP', '125.0000', 'bulletin', '2026-11-30'),
      rate('USD', 'TRY', '42.0000', 'bulletin', '2026-11-30'),
      rate('USD', 'TRY', '42.5000', 'market', '2026-11-27'),
    ];
    expect(closing(third, 'book', 'TRY', '2026-11-30', rates)).toHaveProperty('legs');
    expect(closing(third, 'parallel', 'TRY', '2026-11-30', rates)).toMatchObject({
      rate: '42.5000',
    });
  });
});

describe('revalueBalance (S07 rules 10, 12)', () => {
  const bulletin125 = rate('USD', 'SYP', '125.0000', 'bulletin', '2026-11-30');

  it('takes the target at the closing rate and the difference from the carrying amount', () => {
    const m1 = revalueBalance(
      balance('112001', 'USD', 100000n, 12000000n, { item: 'M-1' }),
      sypUsd,
      'book',
      bulletin125,
    );
    expect([m1.targetMinor, m1.differenceMinor]).toEqual([12500000n, 500000n]);
    const bank = revalueBalance(
      balance('111003', 'SYP', 125000000n, 1000000n),
      sypUsd,
      'parallel',
      rate('USD', 'SYP', '128.0000', 'market', '2026-11-25'),
    );
    // 1,250,000.00 / 128 = 9,765.625 → 9,765.63 USD, half away from zero
    expect([bank.targetMinor, bank.differenceMinor]).toEqual([976563n, -23437n]);
  });

  it('rounds a liability half away from zero and brings a zero balance to zero', () => {
    const payable = revalueBalance(
      balance('211002', 'USD', -18735n, -2285670n),
      sypUsd,
      'book',
      rate('USD', 'SYP', '125.5000', 'bulletin', '2026-11-30'),
    );
    expect([payable.targetMinor, payable.differenceMinor]).toEqual([-2351243n, -65573n]);
    const cash = revalueBalance(balance('111002', 'USD', 0n, -30000n), sypUsd, 'book', bulletin125);
    expect([cash.targetMinor, cash.differenceMinor]).toEqual([0n, 30000n]);
  });

  it('posts only what an earlier revaluation of the same day has not', () => {
    const settled = revalueBalance(
      balance('112001', 'USD', 0n, 0n, { item: 'M-1', revaluedMinor: 500000n }),
      sypUsd,
      'book',
      bulletin125,
    );
    expect(settled.differenceMinor).toBe(-500000n);
  });

  it('refuses a balance in the ledger currency', () => {
    expect(() =>
      revalueBalance(balance('111003', 'SYP', 1n, 1n), sypUsd, 'book', bulletin125),
    ).toThrow(TypeError);
  });

  it('revalues a USD book against SYP and a TRY balance through the cross', () => {
    const usdBook = revalueBalance(
      balance('111003', 'SYP', 2400000n, 20000n),
      usdSyp,
      'book',
      rate('USD', 'SYP', '125.0000', 'bulletin', '2026-11-30'),
    );
    expect(usdBook.differenceMinor).toBe(-800n);
    const rates = [
      rate('USD', 'SYP', '125.0000', 'bulletin', '2026-11-30'),
      rate('USD', 'TRY', '42.0000', 'bulletin', '2026-11-30'),
    ];
    const cross = closing(third, 'book', 'TRY', '2026-11-30', rates);
    const cash = revalueBalance(balance('111007', 'TRY', 200000n, 595122n), third, 'book', cross);
    const payable = revalueBalance(
      balance('211003', 'TRY', -410000n, -1220000n),
      third,
      'book',
      cross,
    );
    expect([cash.differenceMinor, payable.differenceMinor]).toEqual([116n, -238n]);
  });
});

describe('revaluationLines (S07 rule 13)', () => {
  const at = (value: string) => rate('USD', 'SYP', value, 'bulletin', '2026-11-30');

  it('posts two lines per difference, gross, in the ledger only', () => {
    const balances = [
      balance('111004', 'USD', 130000n, 15600000n),
      balance('213001', 'USD', -100000n, -12000000n, { item: 'C1' }),
      balance('213001', 'USD', 15000n, 1845000n, { item: 'C2' }),
      balance('211001', 'USD', -45000n, -5445000n),
    ].map((b) => revalueBalance(b, sypUsd, 'book', at('125.0000')));
    const lines = entry(sypUsd, revaluationLines(sypUsd, 'book', balances, targets));
    expect(amounts(lines)).toEqual([
      {
        account: '111004',
        currency: 'USD',
        amount: 0n,
        book: 650000n,
        parallel: 0n,
        item: undefined,
      },
      {
        account: '421002',
        currency: 'SYP',
        amount: -650000n,
        book: -650000n,
        parallel: 0n,
        item: undefined,
      },
      {
        account: '213001',
        currency: 'USD',
        amount: 0n,
        book: -500000n,
        parallel: 0n,
        item: { id: 'C1', movement: 'revaluation' },
      },
      {
        account: '541002',
        currency: 'SYP',
        amount: 500000n,
        book: 500000n,
        parallel: 0n,
        item: undefined,
      },
      {
        account: '213001',
        currency: 'USD',
        amount: 0n,
        book: 30000n,
        parallel: 0n,
        item: { id: 'C2', movement: 'revaluation' },
      },
      {
        account: '421002',
        currency: 'SYP',
        amount: -30000n,
        book: -30000n,
        parallel: 0n,
        item: undefined,
      },
      {
        account: '211001',
        currency: 'USD',
        amount: 0n,
        book: -180000n,
        parallel: 0n,
        item: undefined,
      },
      {
        account: '541002',
        currency: 'SYP',
        amount: 180000n,
        book: 180000n,
        parallel: 0n,
        item: undefined,
      },
    ]);
  });

  it('posts in the parallel ledger in its currency, and nothing for a zero difference', () => {
    const bank = revalueBalance(
      balance('111003', 'SYP', 125000000n, 1000000n),
      sypUsd,
      'parallel',
      rate('USD', 'SYP', '128.0000', 'market', '2026-11-25'),
    );
    const lines = entry(sypUsd, revaluationLines(sypUsd, 'parallel', [bank], targets));
    expect(amounts(lines)).toEqual([
      {
        account: '111003',
        currency: 'SYP',
        amount: 0n,
        book: 0n,
        parallel: -23437n,
        item: undefined,
      },
      {
        account: '541002',
        currency: 'USD',
        amount: 23437n,
        book: 0n,
        parallel: 23437n,
        item: undefined,
      },
    ]);
    const unchanged = revalueBalance(
      balance('112001', 'USD', 100000n, 12000000n, { item: 'M-1' }),
      sypUsd,
      'book',
      at('120.0000'),
    );
    expect(revaluationLines(sypUsd, 'book', [unchanged], targets)).toEqual([]);
  });

  it('keeps no parallel amount in a company without a parallel ledger', () => {
    const m1 = revalueBalance(
      balance('112001', 'USD', 25025n, 2952950n, { item: 'M-1' }),
      sypOnly,
      'book',
      rate('USD', 'SYP', '119.5000', 'bulletin', '2026-10-29'),
    );
    const lines = entry(sypOnly, revaluationLines(sypOnly, 'book', [m1], targets), '2026-10-31');
    expect(amounts(lines).map((line) => [line.book, line.parallel])).toEqual([
      [37538n, null],
      [-37538n, null],
    ]);
  });
});

describe('revaluationReversalLines (S07 rule 14)', () => {
  const lines = revaluationLines(
    sypUsd,
    'book',
    [
      revalueBalance(
        balance('112001', 'USD', 100000n, 12000000n, { item: 'M-1' }),
        sypUsd,
        'book',
        rate('USD', 'SYP', '125.0000', 'bulletin', '2026-11-30'),
      ),
    ],
    targets,
  );
  const posted = {
    source: 'revaluation' as const,
    date: '2026-11-30',
    isReversal: false,
    reversed: false,
    lines,
  };

  it('negates the entry exactly on the next day, its items moved back as revaluations', () => {
    const reversal = revaluationReversalLines(posted, '2026-12-01');
    expect(amounts(reversal).map((line) => [line.book, line.item?.movement])).toEqual([
      [-500000n, 'revaluation'],
      [500000n, undefined],
    ]);
    expect(firstDayOfNextMonth('2026-12-31')).toBe('2027-01-01');
  });

  it('reverses only a revaluation, once, on the first day of the next month', () => {
    expect(
      refusal(() => revaluationReversalLines({ ...posted, source: 'manual' }, '2026-12-01')),
    ).toBe('ENTRY_NOT_REVERSIBLE');
    expect(
      refusal(() => revaluationReversalLines({ ...posted, isReversal: true }, '2026-12-01')),
    ).toBe('ENTRY_NOT_REVERSIBLE');
    expect(
      refusal(() => revaluationReversalLines({ ...posted, reversed: true }, '2026-12-01')),
    ).toBe('ENTRY_ALREADY_REVERSED');
    expect(() => revaluationReversalLines(posted, '2026-12-02')).toThrow(RangeError);
  });
});

describe('a revaluation line and the chart (S07 rule 10)', () => {
  it('accepts a blocked account, never an archived one', () => {
    const account = {
      id: 'A',
      kind: 'postable' as const,
      currency: null,
      blocked: true,
      archived: false,
      isControl: false,
      itemKind: null,
      requiredDimensionTypeIds: [],
    };
    const line = {
      account,
      currency: 'USD' as const,
      dimensions: [],
      origin: 'revaluation' as const,
    };
    expect(refusal(() => checkLineAgainstChart(line))).toBe('none');
    expect(refusal(() => checkLineAgainstChart({ ...line, origin: 'reversal' }))).toBe(
      'ACCOUNT_BLOCKED',
    );
    expect(
      refusal(() => checkLineAgainstChart({ ...line, account: { ...account, archived: true } })),
    ).toBe('ACCOUNT_ARCHIVED');
  });
});

describe('the fingerprint (S07 rule 17)', () => {
  it('changes with any amount, rate row or posted revaluation, never with the order of dimensions', () => {
    const base = {
      period: '2026-11',
      ledger: 'book' as const,
      posted: [] as string[],
      rates: [{ currency: 'USD' as const, rowIds: ['r1'] }],
      balances: [
        {
          ...balance('112001', 'USD', 100000n, 12000000n, { dimensions: { a: '1', b: '2' } }),
          targetMinor: 12500000n,
          differenceMinor: 500000n,
        },
      ],
    };
    const json = (value: typeof base) =>
      JSON.stringify(revaluationFingerprintValue(value), (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
    const reordered = {
      ...base,
      balances: base.balances.map((b) => ({ ...b, dimensions: { b: '2', a: '1' } })),
    };
    expect(json(reordered)).toBe(json(base));
    expect(json({ ...base, rates: [{ currency: 'USD', rowIds: ['r2'] }] })).not.toBe(json(base));
    // The same books after a revaluation posted give another fingerprint (rule 17).
    expect(json({ ...base, posted: ['v1'] })).not.toBe(json(base));
    expect(
      json({ ...base, balances: base.balances.map((b) => ({ ...b, revaluedMinor: 1n })) }),
    ).not.toBe(json(base));
  });
});

// Properties (S07 "Acceptance", tests).
const ledgersArb = fc.constantFrom(
  { ledgers: sypUsd, ledger: 'book' as const, currency: 'USD' as const, quote: 'SYP' as const },
  { ledgers: sypUsd, ledger: 'parallel' as const, currency: 'SYP' as const, quote: 'SYP' as const },
  { ledgers: usdSyp, ledger: 'book' as const, currency: 'SYP' as const, quote: 'SYP' as const },
  { ledgers: sypOnly, ledger: 'book' as const, currency: 'USD' as const, quote: 'SYP' as const },
);
const rateArb = fc
  .bigInt({ min: 1n, max: 2_000_000n })
  .map((value) => `${value / 10_000n}.${String(value % 10_000n).padStart(4, '0')}`)
  .filter((text) => text !== '0.0000');
const balanceArb = fc.record({
  transaction: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
  carrying: fc.bigInt({ min: -(10n ** 13n), max: 10n ** 13n }),
  item: fc.boolean(),
});

describe('revaluation properties', () => {
  it('balances exactly in its ledger and is zero in the other, and its reversal nets it to zero', () => {
    fc.assert(
      fc.property(
        ledgersArb,
        fc.array(balanceArb, { maxLength: 6 }),
        rateArb,
        (shape, raw, value) => {
          const at = rate('USD', shape.quote, value, 'bulletin', '2026-11-30');
          const revalued = raw.map((b, index) =>
            revalueBalance(
              balance(
                `1${index}`,
                shape.currency,
                b.transaction,
                b.carrying,
                b.item ? { item: `I${index}` } : {},
              ),
              shape.ledgers,
              shape.ledger,
              at,
            ),
          );
          const lines = revaluationLines(shape.ledgers, shape.ledger, revalued, targets);
          expect(lines).toHaveLength(2 * revalued.filter((b) => b.differenceMinor !== 0n).length);
          if (lines.length === 0) return;
          const posted = entry(shape.ledgers, lines);
          const other = shape.ledger === 'book' ? 'parallel' : 'book';
          expect(ledgerTotal(posted, shape.ledger)).toBe(0n);
          for (const line of posted) {
            expect(
              line.transaction.currency === shape.currency ? line.transaction.amountMinor : 0n,
            ).toBe(0n);
            const inOther = ledgerAmount(line, other);
            if (inOther !== null) expect(inOther).toBe(0n);
          }
          const reversal = revaluationReversalLines(
            {
              source: 'revaluation',
              date: '2026-11-30',
              isReversal: false,
              reversed: false,
              lines: posted,
            },
            '2026-12-01',
          );
          const net = new Map<string, bigint>();
          for (const line of [...posted, ...reversal]) {
            net.set(
              line.account,
              (net.get(line.account) ?? 0n) + (ledgerAmount(line, shape.ledger) ?? 0n),
            );
          }
          for (const total of net.values()) expect(total).toBe(0n);
        },
      ),
    );
  });

  it('leaves every balance at its target after any sequence of postings, revaluations and adjustments', () => {
    fc.assert(
      fc.property(
        ledgersArb,
        balanceArb,
        fc.array(
          fc.record({
            moveTransaction: fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }),
            moveCarrying: fc.bigInt({ min: -(10n ** 11n), max: 10n ** 11n }),
            rate: rateArb,
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (shape, start, steps) => {
          let transaction = start.transaction;
          let carrying = start.carrying;
          let revalued = 0n;
          let last: RevaluedBalance | null = null;
          for (const step of steps) {
            // A back-dated posting moves the carrying amount, never the revaluations (ADR 0007).
            transaction += step.moveTransaction;
            carrying += step.moveCarrying;
            last = revalueBalance(
              balance('1', shape.currency, transaction, carrying, { revaluedMinor: revalued }),
              shape.ledgers,
              shape.ledger,
              rate('USD', shape.quote, step.rate, 'bulletin', '2026-11-30'),
            );
            const lines = revaluationLines(shape.ledgers, shape.ledger, [last], targets);
            revalued += lines
              .filter((line) => line.account === '1')
              .reduce((sum, line) => sum + (ledgerAmount(line, shape.ledger) ?? 0n), 0n);
            expect(carrying + revalued).toBe(last.targetMinor);
          }
          // The adjustment is current: another revaluation at the same rate posts nothing.
          if (last !== null) {
            const again = revalueBalance(
              { ...last, revaluedMinor: revalued },
              shape.ledgers,
              shape.ledger,
              rate('USD', shape.quote, steps.at(-1)?.rate ?? '1.0000', 'bulletin', '2026-11-30'),
            );
            expect(again.differenceMinor).toBe(0n);
          }
        },
      ),
    );
  });
});
