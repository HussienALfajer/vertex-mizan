import { type CompanyLedgers, type CurrencyCode, money } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceEntry } from './balance.js';
import { reverseLines } from './carried.js';
import { type CarriedAmounts, carriedLine, negate } from './lines.js';
import { daysBetween } from './periods.js';
import { overTimeMonths, releaseParts } from './recognition.js';
import { sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

/**
 * The day split of revenue recognised over time (S06 rules 3–5 and 7), with the numbers of
 * `docs/scenarios/revenue/over-time-release.md` (owner, 2026-11-10, option A), and its properties.
 */

const usd = (amount: bigint, book: bigint, parallel: bigint | null): CarriedAmounts => ({
  transaction: money(amount, 'USD'),
  bookMinor: book,
  parallelMinor: parallel,
});
const syp = (amount: bigint, book: bigint, parallel: bigint | null): CarriedAmounts => ({
  transaction: money(amount, 'SYP'),
  bookMinor: book,
  parallelMinor: parallel,
});

describe('overTimeMonths', () => {
  it('cuts a cycle across two months by its days, 16 and 14 of 30', () => {
    expect(overTimeMonths(90_000n, '2026-11-15', '2026-12-14', '2026-11-15')).toEqual([
      {
        month: '2026-11',
        lastDay: '2026-11-30',
        days: 16n,
        transactionMinor: 48_000n,
        elapsed: false,
      },
      {
        month: '2026-12',
        lastDay: '2026-12-31',
        days: 14n,
        transactionMinor: 42_000n,
        elapsed: false,
      },
    ]);
  });

  it('counts the leap day and rounds each cumulative part half away from zero', () => {
    // 100 000 × 15 ÷ 29 = 51 724.13… → 51 724; and a half: 6 000 001 × 15 ÷ 30 = 3 000 000.5 → 3 000 001.
    expect(
      overTimeMonths(100_000n, '2028-02-15', '2028-03-14', '2028-02-15').map((m) => [
        m.days,
        m.transactionMinor,
      ]),
    ).toEqual([
      [15n, 51_724n],
      [14n, 48_276n],
    ]);
    expect(
      overTimeMonths(6_000_001n, '2026-11-16', '2026-12-15', '2026-11-16').map(
        (m) => m.transactionMinor,
      ),
    ).toEqual([3_000_001n, 3_000_000n]);
  });

  it('marks the months that ended before the issue month as elapsed, and only those', () => {
    const late = overTimeMonths(62_000n, '2026-10-20', '2026-11-19', '2026-11-05');
    expect(late.map((m) => [m.month, m.days, m.transactionMinor, m.elapsed])).toEqual([
      ['2026-10', 12n, 24_000n, true],
      ['2026-11', 19n, 38_000n, false],
    ]);
    // In advance of its cycle: nothing elapses, and the period starts in November.
    expect(overTimeMonths(6_000_000n, '2026-11-01', '2026-11-30', '2026-10-29')).toEqual([
      {
        month: '2026-11',
        lastDay: '2026-11-30',
        days: 30n,
        transactionMinor: 6_000_000n,
        elapsed: false,
      },
    ]);
    // Three months from 1 October, issued on 10 November: 33 696, 32 608, 33 696 of 92 days.
    expect(
      overTimeMonths(100_000n, '2026-10-01', '2026-12-31', '2026-11-10').map((m) => [
        m.days,
        m.transactionMinor,
        m.elapsed,
      ]),
    ).toEqual([
      [31n, 33_696n, true],
      [30n, 32_608n, false],
      [31n, 33_696n, false],
    ]);
  });

  it('crosses a year, keeps a one-day period, and refuses a period that ends before it starts', () => {
    expect(
      overTimeMonths(31_000n, '2026-12-20', '2027-01-19', '2026-12-20').map((m) => m.month),
    ).toEqual(['2026-12', '2027-01']);
    expect(overTimeMonths(100n, '2026-11-30', '2026-11-30', '2026-11-30')).toEqual([
      { month: '2026-11', lastDay: '2026-11-30', days: 1n, transactionMinor: 100n, elapsed: false },
    ]);
    expect(() => overTimeMonths(100n, '2026-12-01', '2026-11-30', '2026-11-01')).toThrow(
      RangeError,
    );
  });
});

describe('releaseParts', () => {
  it('cuts each ledger of an on-time deferral by the days of every month', () => {
    const months = overTimeMonths(90_000n, '2026-11-15', '2026-12-14', '2026-11-15');
    expect(releaseParts(usd(90_000n, 10_890_000n, 90_000n), months, sypUsd)).toEqual([
      usd(48_000n, 5_808_000n, 48_000n),
      usd(42_000n, 5_082_000n, 42_000n),
    ]);
    // Each ledger rounds its own half: parallel 49 587 × 15 ÷ 30 = 24 793.5 → 24 794.
    const halves = overTimeMonths(6_000_001n, '2026-11-16', '2026-12-15', '2026-11-16');
    expect(releaseParts(syp(6_000_001n, 6_000_001n, 49_587n), halves, sypUsd)).toEqual([
      syp(3_000_001n, 3_000_001n, 24_794n),
      syp(3_000_000n, 3_000_000n, 24_793n),
    ]);
    const bookOnly = overTimeMonths(100_001n, '2026-11-16', '2026-12-15', '2026-11-16');
    expect(releaseParts(usd(100_001n, 12_100_121n, null), bookOnly, sypOnly)).toEqual([
      usd(50_001n, 6_050_061n, null),
      usd(50_000n, 6_050_060n, null),
    ]);
  });

  it("releases a late issue's deferral over the months not elapsed, the other ledger by their days only", () => {
    const late = overTimeMonths(62_000n, '2026-10-20', '2026-11-19', '2026-11-05');
    expect(releaseParts(usd(38_000n, 4_579_000n, 38_000n), late, sypUsd)).toEqual([
      usd(38_000n, 4_579_000n, 38_000n),
    ]);
    // Option A: the SYP books cut 7 956 480 over the 61 days of November and December
    // (7 956 480 × 30 ÷ 61 = 3 913 022.95… → 3 913 023), not by the transaction's share (3 912 960).
    const manual = overTimeMonths(100_000n, '2026-10-01', '2026-12-31', '2026-11-10');
    expect(releaseParts(usd(66_304n, 7_956_480n, 66_304n), manual, sypUsd)).toEqual([
      usd(32_608n, 3_913_023n, 32_608n),
      usd(33_696n, 4_043_457n, 33_696n),
    ]);
    // USD books, an SYP line: the SYP parallel ledger takes the transaction part as is.
    const sypLate = overTimeMonths(7_440_000n, '2026-10-20', '2026-11-19', '2026-11-05');
    expect(releaseParts(syp(4_560_000n, 36_774n, 4_560_000n), sypLate, usdSyp)).toEqual([
      syp(4_560_000n, 36_774n, 4_560_000n),
    ]);
  });

  it('releases nothing when every month elapsed, and refuses a deferral that is not their part', () => {
    const allElapsed = overTimeMonths(62_000n, '2026-10-20', '2026-10-31', '2026-11-05');
    expect(releaseParts(usd(0n, 0n, 0n), allElapsed, sypUsd)).toEqual([]);
    const late = overTimeMonths(62_000n, '2026-10-20', '2026-11-19', '2026-11-05');
    expect(() => releaseParts(usd(62_000n, 7_471_000n, 62_000n), late, sypUsd)).toThrow(RangeError);
    expect(() => releaseParts(usd(38_000n, 4_579_000n, 37_999n), late, sypUsd)).toThrow(TypeError);
    expect(() => releaseParts(usd(38_000n, 4_579_000n, null), late, sypUsd)).toThrow(TypeError);
  });
});

/** A date `offset` days after 2026-01-01, written out here without the code under test. */
function dateAfter(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
}

const shapes: readonly [CompanyLedgers, string][] = [
  [sypOnly, 'syp'],
  [sypUsd, 'syp-usd'],
  [usdSyp, 'usd-syp'],
];

/** A line deferred at issue: its period, its issue date and its deferred amounts in each ledger. */
const deferralArb = fc
  .record({
    start: fc.integer({ min: 0, max: 1_500 }),
    length: fc.integer({ min: 0, max: 400 }),
    issueShift: fc.integer({ min: -60, max: 450 }),
    amount: fc.bigInt({ min: 1n, max: 10n ** 12n }),
    currency: fc.constantFrom<CurrencyCode>('USD', 'SYP'),
    // The deferral's rates: any positive number of ledger minor units per transaction minor unit.
    bookRate: fc.bigInt({ min: 1n, max: 20_000n }),
    parallelRate: fc.bigInt({ min: 1n, max: 20_000n }),
    shape: fc.constantFrom(...shapes),
  })
  .map((input) => {
    const from = dateAfter(input.start);
    const to = dateAfter(input.start + input.length);
    const issuedOn = dateAfter(input.start + input.issueShift);
    const months = overTimeMonths(input.amount, from, to, issuedOn);
    const deferredMinor = months
      .filter((month) => !month.elapsed)
      .reduce((total, month) => total + month.transactionMinor, 0n);
    const [ledgers] = input.shape;
    const inLedger = (currency: CurrencyCode, rate: bigint) =>
      currency === input.currency ? deferredMinor : (deferredMinor * rate) / 100n;
    const deferred: CarriedAmounts = {
      transaction: money(deferredMinor, input.currency),
      bookMinor: inLedger(ledgers.book.currency, input.bookRate),
      parallelMinor:
        ledgers.parallel === null ? null : inLedger(ledgers.parallel.currency, input.parallelRate),
    };
    return { ...input, from, to, issuedOn, months, deferred, ledgers };
  });

const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);

describe('the day split', () => {
  it('covers every day of the period once and sums to the amount exactly', () => {
    fc.assert(
      fc.property(deferralArb, ({ amount, from, to, months }) => {
        expect(sum(months.map((m) => m.days))).toBe(BigInt(daysBetween(from, to) + 1));
        expect(sum(months.map((m) => m.transactionMinor))).toBe(amount);
        for (const month of months) expect(month.days).toBeGreaterThan(0n);
      }),
      { numRuns: 1_000 },
    );
  });

  it('gives each month the same transaction part whatever the issue date, so a late part is never recognised twice', () => {
    fc.assert(
      fc.property(deferralArb, ({ amount, from, to, months }) => {
        const onTime = overTimeMonths(amount, from, to, from);
        expect(months.map((m) => m.transactionMinor)).toEqual(
          onTime.map((m) => m.transactionMinor),
        );
        expect(onTime.every((m) => !m.elapsed)).toBe(true);
      }),
      { numRuns: 1_000 },
    );
  });
});

describe('releases', () => {
  it("sum to the deferral exactly in every ledger, a ledger in the line's currency taking the transaction parts", () => {
    fc.assert(
      fc.property(deferralArb, ({ deferred, months, ledgers }) => {
        const parts = releaseParts(deferred, months, ledgers);
        expect(parts).toHaveLength(months.filter((m) => !m.elapsed).length);
        expect(sum(parts.map((p) => p.transaction.amountMinor))).toBe(
          deferred.transaction.amountMinor,
        );
        expect(sum(parts.map((p) => p.bookMinor))).toBe(deferred.bookMinor);
        if (deferred.parallelMinor !== null) {
          expect(sum(parts.map((p) => p.parallelMinor ?? 0n))).toBe(deferred.parallelMinor);
        }
        const currency = deferred.transaction.currency;
        for (const part of parts) {
          if (ledgers.book.currency === currency) {
            expect(part.bookMinor).toBe(part.transaction.amountMinor);
          }
          if (ledgers.parallel?.currency === currency) {
            expect(part.parallelMinor).toBe(part.transaction.amountMinor);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it('build entries that balance in every ledger with no rounding line, and whose reversals net to zero', () => {
    fc.assert(
      fc.property(deferralArb, ({ deferred, months, ledgers }) => {
        const parts = releaseParts(deferred, months, ledgers);
        for (const [k, part] of parts.entries()) {
          const on = months.filter((m) => !m.elapsed)[k]?.lastDay ?? '';
          const lines = [
            carriedLine({ account: '212001', amounts: part }),
            carriedLine({ account: '411001', amounts: negate(part) }),
          ];
          const entry = balanceEntry({ on, ledgers, lines, rounding: { account: '541003' } });
          expect(entry).toHaveLength(2);
          const both = [...entry, ...reverseLines(entry)];
          expect(sum(both.map((line) => line.transaction.amountMinor))).toBe(0n);
          expect(sum(both.map((line) => line.bookMinor))).toBe(0n);
          expect(sum(both.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('recompute to the same parts: a replayed release posts the same amounts it posted', () => {
    fc.assert(
      fc.property(deferralArb, ({ amount, from, to, issuedOn, deferred, ledgers }) => {
        const first = releaseParts(deferred, overTimeMonths(amount, from, to, issuedOn), ledgers);
        const again = releaseParts(deferred, overTimeMonths(amount, from, to, issuedOn), ledgers);
        expect(again).toEqual(first);
      }),
      { numRuns: 300 },
    );
  });
});
