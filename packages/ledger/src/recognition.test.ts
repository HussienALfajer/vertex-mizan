import { type CompanyLedgers, type CurrencyCode, money } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceEntry, realisedDifferenceLines } from './balance.js';
import { reverseLines } from './carried.js';
import { type CarriedAmounts, carriedLine, type Line, negate } from './lines.js';
import { measuredLine } from './measure.js';
import { daysBetween } from './periods.js';
import {
  type CreditedSchedule,
  completedProjectReleases,
  creditParts,
  milestoneDone,
  milestoneItemClearing,
  milestoneItemReference,
  milestoneReopen,
  overTimeMonths,
  reissuedMilestoneLine,
  reissueParts,
  releaseParts,
  remainingReleaseParts,
  voidedCreditParts,
} from './recognition.js';
import { calendar, hubRate, rate, sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

/**
 * The day split of revenue recognised over time (S06 rules 3–5 and 7), with the numbers of
 * `docs/scenarios/revenue/over-time-release.md` (owner, 2026-11-10, option A), and a retainer
 * credit's split (S06 rules 6 and 8), with the numbers of `docs/scenarios/revenue/retainer-credit.md`
 * (owner, 2026-11-10); a milestone's done, its invoice and the project's completion (S06 rules 11–14),
 * with the numbers of `docs/scenarios/revenue/milestones.md` (owner, 2026-11-10); the void's re-issue (S06 rule 9) and a reopen after a void, with the numbers
 * of `docs/scenarios/revenue/void-and-reissue.md` (owner, 2026-11-10); and their properties.
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

/** The months of a cycle not yet released, from `month` on (an invoice on time: none elapsed). */
function monthsFrom(month: string, amount: bigint, from: string, to: string) {
  return overTimeMonths(amount, from, to, from).filter((m) => m.month >= month);
}

describe('creditParts', () => {
  it('splits a credit by the share recognised: 48.00 to revenue and 42.00 to the liability at 121', () => {
    // INV-2026-41's credit of 90.00 USD to the cycle at 121 with 16/30 released.
    expect(
      creditParts(9_000n, [{ netMinor: 90_000n, remaining: usd(42_000n, 5_082_000n, 42_000n) }]),
    ).toEqual([{ revenueMinor: 4_800n, liability: usd(4_200n, 508_200n, 4_200n) }]);
    expect(
      creditParts(9_000n, [{ netMinor: 90_000n, remaining: usd(42_000n, 5_082_000n, null) }]),
    ).toEqual([{ revenueMinor: 4_800n, liability: usd(4_200n, 508_200n, null) }]);
    // USD books, an SYP cycle: 726 000 × 3 872 000 ÷ 7 260 000 = 387 200; the book carries 28 000 × 338 800 ÷ 3 388 000.
    expect(
      creditParts(726_000n, [
        { netMinor: 7_260_000n, remaining: syp(3_388_000n, 28_000n, 3_388_000n) },
      ]),
    ).toEqual([{ revenueMinor: 387_200n, liability: syp(338_800n, 2_800n, 338_800n) }]);
  });

  it('gives a fully released cycle all to revenue, and an unreleased one all to its liabilities, shared with cumulative rounding', () => {
    expect(creditParts(6_000n, [{ netMinor: 60_000n, remaining: usd(0n, 0n, 0n) }])).toEqual([
      { revenueMinor: 6_000n, liability: null },
    ]);
    // 10 001 × 90 000 ÷ 120 000 = 7 500.75 → 7 501; the addition 2 500; each liability at what it carries.
    expect(
      creditParts(10_001n, [
        { netMinor: 90_000n, remaining: usd(90_000n, 10_890_000n, 90_000n) },
        { netMinor: 30_000n, remaining: usd(30_000n, 3_645_000n, 30_000n) },
      ]),
    ).toEqual([
      { revenueMinor: 0n, liability: usd(7_501n, 907_621n, 7_501n) },
      { revenueMinor: 0n, liability: usd(2_500n, 303_750n, 2_500n) },
    ]);
    // A credit of the whole remaining clears every ledger exactly.
    expect(
      creditParts(5_000n, [{ netMinor: 5_000n, remaining: usd(5_000n, 605_001n, 5_000n) }]),
    ).toEqual([{ revenueMinor: 0n, liability: usd(5_000n, 605_001n, 5_000n) }]);
  });

  it('refuses a credit larger than the cycle net of earlier credits, of zero, or in two currencies', () => {
    const credited = { netMinor: 30_000n, remaining: usd(30_000n, 3_630_000n, 30_000n) };
    expect(() => creditParts(40_000n, [credited])).toThrow(RangeError);
    expect(creditParts(30_000n, [credited])[0]?.liability).toEqual(
      usd(30_000n, 3_630_000n, 30_000n),
    );
    expect(() => creditParts(0n, [credited])).toThrow(RangeError);
    expect(() =>
      creditParts(100n, [credited, { netMinor: 100n, remaining: syp(100n, 100n, 1n) }]),
    ).toThrow(TypeError);
    expect(() => creditParts(100n, [{ netMinor: 100n, remaining: usd(101n, 1n, 101n) }])).toThrow(
      RangeError,
    );
  });

  it('builds the credit entry of the first case: an 84.00 SYP realised loss, nothing in the parallel ledger', () => {
    const context = {
      ledgers: sypUsd,
      on: '2026-12-15',
      rates: [rate('USD', 'SYP', '123.0000', 'bulletin', '2026-12-15')],
      calendar,
    };
    const [part] = creditParts(9_000n, [
      { netMinor: 90_000n, remaining: usd(42_000n, 5_082_000n, 42_000n) },
    ]);
    if (part?.liability == null) throw new Error('A part with its liability');
    const lines: Line[] = [
      measuredLine({ account: '112001', amount: money(81_000n, 'USD') }, context),
      measuredLine({ account: '212001', amount: money(-90_000n, 'USD') }, context),
      measuredLine({ account: '411001', amount: money(part.revenueMinor, 'USD') }, context),
      carriedLine({ account: '212001', amounts: part.liability }),
    ];
    const differences = realisedDifferenceLines(sypUsd, lines, {
      gain: { account: '421001' },
      loss: { account: '541001' },
    });
    expect(lines.map((line) => line.bookMinor)).toEqual([
      9_963_000n,
      -11_070_000n,
      590_400n,
      508_200n,
    ]);
    expect(differences.map((line) => [line.account, line.bookMinor, line.parallelMinor])).toEqual([
      ['541001', 8_400n, 0n],
    ]);
    expect(
      balanceEntry({
        ...context,
        lines: [...lines, ...differences],
        rounding: { account: '541003' },
      }),
    ).toHaveLength(5);
  });
});

describe('remainingReleaseParts', () => {
  it('cuts what remains after a credit over the months not released, each ledger by their days', () => {
    // The cycle of 15 Nov to 14 Dec after a credit of 75.01 on 26 Nov, before November's release.
    const cycle = monthsFrom('2026-11', 90_000n, '2026-11-15', '2026-12-14');
    expect(remainingReleaseParts(usd(82_499n, 9_982_379n, 82_499n), cycle, sypUsd)).toEqual([
      usd(43_999n, 5_323_935n, 43_999n),
      usd(38_500n, 4_658_444n, 38_500n),
    ]);
    expect(remainingReleaseParts(usd(27_500n, 3_341_250n, 27_500n), cycle, sypUsd)).toEqual([
      usd(14_667n, 1_782_000n, 14_667n),
      usd(12_833n, 1_559_250n, 12_833n),
    ]);
    // A credit of 50.00 then its void after November: 16/30 of 850.00, then all that grew back.
    expect(remainingReleaseParts(usd(85_000n, 10_285_000n, 85_000n), cycle, sypUsd)[0]).toEqual(
      usd(45_333n, 5_485_333n, 45_333n),
    );
    const december = monthsFrom('2026-12', 90_000n, '2026-11-15', '2026-12-14');
    expect(remainingReleaseParts(usd(44_667n, 5_404_667n, 44_667n), december, sypUsd)).toEqual([
      usd(44_667n, 5_404_667n, 44_667n),
    ]);
    expect(remainingReleaseParts(usd(37_800n, 4_573_800n, null), december, sypOnly)).toEqual([
      usd(37_800n, 4_573_800n, null),
    ]);
  });

  it('refuses an elapsed month, a remaining with no month, and a ledger of the line currency holding another amount', () => {
    const late = overTimeMonths(62_000n, '2026-10-20', '2026-11-19', '2026-11-05');
    expect(() => remainingReleaseParts(usd(38_000n, 4_579_000n, 38_000n), late, sypUsd)).toThrow(
      RangeError,
    );
    expect(remainingReleaseParts(usd(0n, 0n, 0n), [], sypUsd)).toEqual([]);
    expect(() => remainingReleaseParts(usd(1n, 120n, 1n), [], sypUsd)).toThrow(RangeError);
    const december = monthsFrom('2026-12', 90_000n, '2026-11-15', '2026-12-14');
    expect(() => remainingReleaseParts(usd(100n, 12_100n, 99n), december, sypUsd)).toThrow(
      TypeError,
    );
  });
});

describe('voidedCreditParts', () => {
  it('releases on the void date the share of the months released since the credit, all of it when none is left', () => {
    // The 50.00 USD credit of 19 Nov voided on 3 Dec: November's 16 of the 30 days not released at the credit.
    expect(voidedCreditParts(usd(5_000n, 605_000n, 5_000n), 16n, 30n)).toEqual({
      released: usd(2_667n, 322_667n, 2_667n),
      remaining: usd(2_333n, 282_333n, 2_333n),
    });
    // December then releases 39 667 + 2 333 = 42 000 and 4 799 667 + 282 333 = 5 082 000.
    const december = monthsFrom('2026-12', 90_000n, '2026-11-15', '2026-12-14');
    expect(remainingReleaseParts(usd(42_000n, 5_082_000n, 42_000n), december, sypUsd)).toEqual([
      usd(42_000n, 5_082_000n, 42_000n),
    ]);
    // Voided on 5 Jan 2027, after the cycle fully released.
    expect(voidedCreditParts(usd(5_000n, 605_000n, null), 30n, 30n)).toEqual({
      released: usd(5_000n, 605_000n, null),
      remaining: usd(0n, 0n, null),
    });
    expect(voidedCreditParts(usd(5_000n, 605_000n, 5_000n), 0n, 30n)).toEqual({
      released: null,
      remaining: usd(5_000n, 605_000n, 5_000n),
    });
  });

  it('refuses nothing given back, and released days outside the days not released at the credit', () => {
    expect(() => voidedCreditParts(usd(0n, 0n, 0n), 1n, 30n)).toThrow(RangeError);
    expect(() => voidedCreditParts(usd(5_000n, 605_000n, 5_000n), 31n, 30n)).toThrow(RangeError);
    expect(() => voidedCreditParts(usd(5_000n, 605_000n, 5_000n), -1n, 30n)).toThrow(RangeError);
  });

  it('keeps a ledger amount whole when a part rounds to zero in the transaction amount', () => {
    // 1 × 2 ÷ 5 = 0.4 → 0, while the book's 2 × 2 ÷ 5 = 0.8 → 1: nothing is released, in any ledger.
    expect(voidedCreditParts(usd(1n, 2n, null), 2n, 5n)).toEqual({
      released: null,
      remaining: usd(1n, 2n, null),
    });
    // 1 × 4 ÷ 5 = 0.8 → 1: all of it is released, and nothing is left in any ledger.
    expect(voidedCreditParts(usd(1n, 3n, 1n), 4n, 5n)).toEqual({
      released: usd(1n, 3n, 1n),
      remaining: usd(0n, 0n, 0n),
    });
  });
});

/**
 * A cycle's schedules before a credit: each one's net amount, what remains of it in liabilities
 * in every ledger, and a credit no larger than their net amounts.
 */
const creditArb = fc
  .record({
    currency: fc.constantFrom<CurrencyCode>('USD', 'SYP'),
    shape: fc.constantFrom(...shapes),
    schedules: fc.array(
      fc.record({
        net: fc.bigInt({ min: 1n, max: 10n ** 12n }),
        // The share of the net amount still in liabilities, in millionths.
        left: fc.bigInt({ min: 0n, max: 1_000_000n }),
        bookRate: fc.bigInt({ min: 1n, max: 20_000n }),
        parallelRate: fc.bigInt({ min: 1n, max: 20_000n }),
      }),
      { minLength: 1, maxLength: 4 },
    ),
    creditShare: fc.bigInt({ min: 1n, max: 1_000_000n }),
    measureRate: fc.integer({ min: 1, max: 30_000 }),
  })
  .map((input) => {
    const [ledgers] = input.shape;
    const schedules: CreditedSchedule[] = input.schedules.map((schedule) => {
      const remainingMinor = (schedule.net * schedule.left) / 1_000_000n;
      const inLedger = (currency: CurrencyCode, rate: bigint) =>
        currency === input.currency ? remainingMinor : (remainingMinor * rate) / 100n;
      return {
        netMinor: schedule.net,
        remaining: {
          transaction: money(remainingMinor, input.currency),
          bookMinor: inLedger(ledgers.book.currency, schedule.bookRate),
          parallelMinor:
            ledgers.parallel === null
              ? null
              : inLedger(ledgers.parallel.currency, schedule.parallelRate),
        },
      };
    });
    const totalNet = sum(schedules.map((schedule) => schedule.netMinor));
    const creditMinor = (totalNet * input.creditShare) / 1_000_000n || 1n;
    return { ...input, ledgers, schedules, creditMinor };
  });

/** What remains of a schedule after its part of a credit. */
function remainingAfter(
  schedule: CreditedSchedule,
  liability: CarriedAmounts | null,
): CarriedAmounts {
  const { remaining } = schedule;
  if (liability === null) return remaining;
  return {
    transaction: money(
      remaining.transaction.amountMinor - liability.transaction.amountMinor,
      remaining.transaction.currency,
    ),
    bookMinor: remaining.bookMinor - liability.bookMinor,
    parallelMinor:
      remaining.parallelMinor === null || liability.parallelMinor === null
        ? remaining.parallelMinor
        : remaining.parallelMinor - liability.parallelMinor,
  };
}

describe('a credit', () => {
  it('is shared exactly, never takes more than remains, and leaves a schedule at zero in every ledger when its remaining reaches zero', () => {
    fc.assert(
      fc.property(creditArb, ({ schedules, creditMinor }) => {
        const parts = creditParts(creditMinor, schedules);
        const taken = parts.map(
          (p) => p.revenueMinor + (p.liability?.transaction.amountMinor ?? 0n),
        );
        expect(sum(taken)).toBe(creditMinor);
        for (const [k, part] of parts.entries()) {
          const schedule = schedules[k] as CreditedSchedule;
          expect(part.revenueMinor).toBeGreaterThanOrEqual(0n);
          expect(taken[k]).toBeLessThanOrEqual(schedule.netMinor);
          const rest = remainingAfter(schedule, part.liability);
          expect(rest.transaction.amountMinor).toBeGreaterThanOrEqual(0n);
          if (rest.transaction.amountMinor === 0n) {
            expect(rest.bookMinor).toBe(0n);
            expect(rest.parallelMinor ?? 0n).toBe(0n);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it('keeps the measure of progress: the revenue part is the recognised share of the credit, within half a unit', () => {
    fc.assert(
      fc.property(creditArb, ({ schedules, creditMinor }) => {
        for (const [k, part] of creditParts(creditMinor, schedules).entries()) {
          const { netMinor, remaining } = schedules[k] as CreditedSchedule;
          const c = part.revenueMinor + (part.liability?.transaction.amountMinor ?? 0n);
          const gap =
            c * (netMinor - remaining.transaction.amountMinor) - netMinor * part.revenueMinor;
          expect(2n * (gap < 0n ? -gap : gap)).toBeLessThanOrEqual(netMinor);
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it('builds an entry that balances in every ledger with its realised residual, and whose reversal nets to zero', () => {
    fc.assert(
      fc.property(creditArb, ({ currency, ledgers, schedules, creditMinor, measureRate }) => {
        // Any whole number of SYP per USD, as the bulletin and the market rate of the credit's date.
        const quoted = `${measureRate}.0000`;
        const context = {
          ledgers,
          on: '2026-12-15',
          rates: [
            rate('USD', 'SYP', quoted, 'bulletin', '2026-12-15'),
            rate('USD', 'SYP', quoted, 'market', '2026-12-15'),
          ],
          calendar,
        };
        const lines: Line[] = [
          measuredLine({ account: '112001', amount: money(-creditMinor, currency) }, context),
        ];
        for (const part of creditParts(creditMinor, schedules)) {
          if (part.revenueMinor !== 0n) {
            lines.push(
              measuredLine(
                { account: '411001', amount: money(part.revenueMinor, currency) },
                context,
              ),
            );
          }
          if (part.liability !== null) {
            lines.push(carriedLine({ account: '212001', amounts: part.liability }));
          }
        }
        const differences = realisedDifferenceLines(ledgers, lines, {
          gain: { account: '421001' },
          loss: { account: '541001' },
        });
        const entry = balanceEntry({
          ...context,
          lines: [...lines, ...differences],
          rounding: { account: '541003' },
        });
        const both = [...entry, ...reverseLines(entry)];
        // The credit's own lines balance in its currency; the residual lines are in a ledger's.
        const own = entry.filter((line) => line.kind !== 'difference' && line.kind !== 'rounding');
        expect(sum(own.map((line) => line.transaction.amountMinor))).toBe(0n);
        expect(sum(both.map((line) => line.bookMinor))).toBe(0n);
        expect(sum(both.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
      }),
      { numRuns: 300 },
    );
  });

  it('leaves a remainder whose releases sum to it exactly in every ledger, and recomputes to the same parts', () => {
    fc.assert(
      fc.property(creditArb, deferralArb, ({ schedules, creditMinor, ledgers }, { from, to }) => {
        const months = overTimeMonths(1n, from, to, from);
        for (const [k, part] of creditParts(creditMinor, schedules).entries()) {
          const rest = remainingAfter(schedules[k] as CreditedSchedule, part.liability);
          const releases = remainingReleaseParts(rest, months, ledgers);
          expect(remainingReleaseParts(rest, months, ledgers)).toEqual(releases);
          expect(sum(releases.map((p) => p.transaction.amountMinor))).toBe(
            rest.transaction.amountMinor,
          );
          expect(sum(releases.map((p) => p.bookMinor))).toBe(rest.bookMinor);
          expect(sum(releases.map((p) => p.parallelMinor ?? 0n))).toBe(rest.parallelMinor ?? 0n);
        }
        expect(creditParts(creditMinor, schedules)).toEqual(creditParts(creditMinor, schedules));
      }),
      { numRuns: 300 },
    );
  });
});

describe("a credit's void", () => {
  it('gives back exactly what the credit took from the liability, in every ledger, the released part never more than its days', () => {
    fc.assert(
      fc.property(
        creditArb,
        fc.bigInt({ min: 1n, max: 400n }),
        fc.bigInt({ min: 0n, max: 400n }),
        ({ schedules, creditMinor }, daysAtCredit, released) => {
          const releasedDays = released > daysAtCredit ? daysAtCredit : released;
          for (const part of creditParts(creditMinor, schedules)) {
            if (part.liability === null) continue;
            const split = voidedCreditParts(part.liability, releasedDays, daysAtCredit);
            const parts =
              split.released === null ? [split.remaining] : [split.released, split.remaining];
            expect(sum(parts.map((p) => p.transaction.amountMinor))).toBe(
              part.liability.transaction.amountMinor,
            );
            expect(sum(parts.map((p) => p.bookMinor))).toBe(part.liability.bookMinor);
            expect(sum(parts.map((p) => p.parallelMinor ?? 0n))).toBe(
              part.liability.parallelMinor ?? 0n,
            );
            // A part zero in the transaction amount is zero in every ledger.
            if (split.remaining.transaction.amountMinor === 0n) {
              expect(split.remaining.bookMinor).toBe(0n);
              expect(split.remaining.parallelMinor ?? 0n).toBe(0n);
            }
            if (split.released !== null) {
              expect(split.released.transaction.amountMinor).toBeGreaterThan(0n);
            }
            if (releasedDays === daysAtCredit) {
              expect(split.remaining.transaction.amountMinor).toBe(0n);
            }
            if (releasedDays === 0n) expect(split.released).toBeNull();
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

const realised = { gain: { account: '421001' }, loss: { account: '541001' } } as const;

/** The context of a new measurement on `on` at one bulletin and one market rate of SYP per USD. */
function measuredOn(ledgers: CompanyLedgers, on: string, bulletin: string, market = bulletin) {
  return {
    ledgers,
    on,
    rates: [rate('USD', 'SYP', bulletin, 'bulletin', on), rate('USD', 'SYP', market, 'market', on)],
    calendar,
  };
}

/** A carried amount as the line it is: Dr the item or the liability, or its negation. */
const carried = (account: string, amounts: CarriedAmounts) => carriedLine({ account, amounts });

describe('milestoneDone', () => {
  const standing = (deferred: CarriedAmounts | null, done = false) => ({ done, deferred });

  it('releases a deposit invoiced before at what the liability carries, and opens a contract asset otherwise', () => {
    // The first case: 300.00 USD deferred at 120.
    const deferred = usd(30_000n, 3_600_000n, 30_000n);
    expect(milestoneDone(money(30_000n, 'USD'), true, standing(deferred))).toEqual({
      kind: 'release',
      amounts: deferred,
    });
    expect(milestoneDone(money(40_000n, 'USD'), true, standing(null))).toEqual({
      kind: 'contract_asset',
      amount: money(40_000n, 'USD'),
    });
  });

  it('holds a second done, a done without its service and a done differing from its deferral, in that order', () => {
    const deferred = usd(30_000n, 3_600_000n, 30_000n);
    const detail = (outcome: ReturnType<typeof milestoneDone>) =>
      outcome.kind === 'decision' ? outcome.detail : outcome.kind;
    expect(detail(milestoneDone(money(40_000n, 'USD'), false, standing(null, true)))).toBe(
      'milestone_already_done',
    );
    expect(detail(milestoneDone(money(40_000n, 'USD'), false, standing(null)))).toBe(
      'milestone_service_missing',
    );
    expect(detail(milestoneDone(money(35_000n, 'USD'), true, standing(deferred)))).toBe(
      'milestone_amount_differs',
    );
    expect(detail(milestoneDone(money(30_000n, 'SYP'), true, standing(deferred)))).toBe(
      'milestone_amount_differs',
    );
    // A schedule the project's completion released defers nothing (Q14, owner 2026-11-10).
    expect(detail(milestoneDone(money(30_000n, 'USD'), true, standing(usd(0n, 0n, 0n))))).toBe(
      'milestone_released_at_completion',
    );
    expect(() => milestoneDone(money(30_000n, 'USD'), true, standing(usd(-1n, 0n, 0n)))).toThrow(
      RangeError,
    );
    expect(() => milestoneDone(money(0n, 'USD'), true, standing(null))).toThrow(RangeError);
  });

  it("builds the second case's entries: the asset at 122, cleared by the invoice at 123 with a 400.00 SYP gain", () => {
    const done = measuredOn(sypUsd, '2026-12-01', '122.0000');
    const asset = measuredLine({ account: '113001', amount: money(40_000n, 'USD') }, done);
    const revenue = measuredLine({ account: '411001', amount: money(-40_000n, 'USD') }, done);
    expect(
      balanceEntry({ ...done, lines: [asset, revenue], rounding: { account: '541003' } }),
    ).toHaveLength(2);
    const clearing = milestoneItemClearing(money(40_000n, 'USD'), asset);
    if (clearing.kind !== 'clear') throw new Error('The invoice clears the item');
    const invoice = measuredOn(sypUsd, '2026-12-03', '123.0000');
    const lines: Line[] = [
      measuredLine({ account: '112001', amount: money(40_000n, 'USD') }, invoice),
      carried('113001', clearing.amounts),
    ];
    const differences = realisedDifferenceLines(sypUsd, lines, realised);
    expect(lines.map((line) => [line.bookMinor, line.parallelMinor])).toEqual([
      [4_920_000n, 40_000n],
      [-4_880_000n, -40_000n],
    ]);
    expect(differences.map((line) => [line.account, line.bookMinor, line.parallelMinor])).toEqual([
      ['421001', -40_000n, 0n],
    ]);
  });

  it("builds the SYP case: the parallel at the market 122 at done, Hub's 125 at invoice, a 9.60 USD loss", () => {
    const asset = measuredLine(
      { account: '113001', amount: money(4_880_000n, 'SYP') },
      measuredOn(sypUsd, '2026-12-01', '120.0000', '122.0000'),
    );
    expect([asset.bookMinor, asset.parallelMinor]).toEqual([4_880_000n, 40_000n]);
    const clearing = milestoneItemClearing(money(4_880_000n, 'SYP'), asset);
    if (clearing.kind !== 'clear') throw new Error('The invoice clears the item');
    const lines: Line[] = [
      measuredLine(
        { account: '112001', amount: money(4_880_000n, 'SYP') },
        {
          ...measuredOn(sypUsd, '2026-12-03', '123.0000'),
          transactionRate: hubRate('125.0000', '2026-12-03'),
        },
      ),
      carried('113001', clearing.amounts),
    ];
    expect(lines[0]?.parallelMinor).toBe(39_040n);
    const differences = realisedDifferenceLines(sypUsd, lines, realised);
    expect(differences.map((line) => [line.account, line.bookMinor, line.parallelMinor])).toEqual([
      ['541001', 0n, 960n],
    ]);
  });

  it('builds the USD books case of SYP: 400.00 USD at 122, 393.55 at 124, a 6.45 USD loss', () => {
    const asset = measuredLine(
      { account: '113001', amount: money(4_880_000n, 'SYP') },
      measuredOn(usdSyp, '2026-12-01', '122.0000'),
    );
    expect([asset.bookMinor, asset.parallelMinor]).toEqual([40_000n, 4_880_000n]);
    const clearing = milestoneItemClearing(money(4_880_000n, 'SYP'), asset);
    if (clearing.kind !== 'clear') throw new Error('The invoice clears the item');
    const lines: Line[] = [
      measuredLine(
        { account: '112001', amount: money(4_880_000n, 'SYP') },
        measuredOn(usdSyp, '2026-12-03', '124.0000'),
      ),
      carried('113001', clearing.amounts),
    ];
    expect(lines[0]?.bookMinor).toBe(39_355n);
    const differences = realisedDifferenceLines(usdSyp, lines, realised);
    expect(differences.map((line) => [line.account, line.bookMinor, line.parallelMinor])).toEqual([
      ['541001', 645n, 0n],
    ]);
  });

  it('builds the reopen case: its reversal nets the first done, the second at 124 cleared at 123 with a 400.00 SYP loss', () => {
    const first = measuredOn(sypUsd, '2026-12-01', '122.0000');
    const done = [
      measuredLine({ account: '113001', amount: money(40_000n, 'USD') }, first),
      measuredLine({ account: '411001', amount: money(-40_000n, 'USD') }, first),
    ];
    const reopened = [...done, ...reverseLines(done)];
    expect(sum(reopened.map((line) => line.bookMinor))).toBe(0n);
    const again = measuredLine(
      { account: '113001', amount: money(40_000n, 'USD') },
      measuredOn(sypUsd, '2026-12-10', '124.0000'),
    );
    expect(again.bookMinor).toBe(4_960_000n);
    const clearing = milestoneItemClearing(money(40_000n, 'USD'), again);
    if (clearing.kind !== 'clear') throw new Error('The invoice clears the item');
    const lines: Line[] = [
      measuredLine(
        { account: '112001', amount: money(40_000n, 'USD') },
        measuredOn(sypUsd, '2026-12-15', '123.0000'),
      ),
      carried('113001', clearing.amounts),
    ];
    const differences = realisedDifferenceLines(sypUsd, lines, realised);
    expect(differences.map((line) => [line.account, line.bookMinor, line.parallelMinor])).toEqual([
      ['541001', 40_000n, 0n],
    ]);
  });

  it("builds the USD books case of USD: the parallel at the market 122.5 at done, Hub's 124 at invoice, a 600.00 SYP gain", () => {
    const asset = measuredLine(
      { account: '113001', amount: money(40_000n, 'USD') },
      measuredOn(usdSyp, '2026-12-01', '120.0000', '122.5000'),
    );
    expect([asset.bookMinor, asset.parallelMinor]).toEqual([40_000n, 4_900_000n]);
    const clearing = milestoneItemClearing(money(40_000n, 'USD'), asset);
    if (clearing.kind !== 'clear') throw new Error('The invoice clears the item');
    const lines: Line[] = [
      measuredLine(
        { account: '112001', amount: money(40_000n, 'USD') },
        {
          ...measuredOn(usdSyp, '2026-12-03', '123.0000'),
          transactionRate: hubRate('124.0000', '2026-12-03'),
        },
      ),
      carried('113001', clearing.amounts),
    ];
    expect(lines[0]?.parallelMinor).toBe(4_960_000n);
    const differences = realisedDifferenceLines(usdSyp, lines, realised);
    expect(differences.map((line) => [line.account, line.bookMinor, line.parallelMinor])).toEqual([
      ['421001', 0n, -60_000n],
    ]);
  });
});

describe('milestoneItemClearing', () => {
  it('holds an invoice line of another amount or currency than the item has open', () => {
    const item = usd(40_000n, 4_880_000n, 40_000n);
    expect(milestoneItemClearing(money(45_000n, 'USD'), item)).toEqual({
      kind: 'decision',
      detail: 'milestone_amount_differs',
    });
    expect(milestoneItemClearing(money(40_000n, 'SYP'), item).kind).toBe('decision');
    expect(() => milestoneItemClearing(money(40_000n, 'USD'), usd(0n, 0n, 0n))).toThrow(RangeError);
  });
});

describe('milestoneItemReference', () => {
  it("names the first done's item by Hub's number, and each done after a reopen by its place", () => {
    expect(milestoneItemReference('MS-8', 0)).toBe('MS-8');
    expect(milestoneItemReference('MS-8', 1)).toBe('MS-8/2');
    expect(milestoneItemReference('MS-8', 2)).toBe('MS-8/3');
    expect(() => milestoneItemReference('MS-8', -1)).toThrow(RangeError);
    expect(() => milestoneItemReference('MS-8', 1.5)).toThrow(RangeError);
  });
});

describe('completedProjectReleases', () => {
  it('releases what remains of the schedules never done, and nothing when none defers anything', () => {
    // The completion case: MS-11 released at its done, MS-13 deferred 200.00 USD at 123.
    const left = usd(20_000n, 2_460_000n, 20_000n);
    expect(completedProjectReleases([usd(0n, 0n, 0n), left])).toEqual([left]);
    expect(completedProjectReleases([usd(0n, 0n, 0n)])).toEqual([]);
    expect(() => completedProjectReleases([usd(0n, 1n, 0n)])).toThrow(RangeError);
    expect(() => completedProjectReleases([usd(-1n, -120n, -1n)])).toThrow(RangeError);
  });
});

/** A milestone in either currency, in any shape, with whole SYP-per-USD rates at its two dates. */
const milestoneArb = fc
  .record({
    currency: fc.constantFrom<CurrencyCode>('USD', 'SYP'),
    shape: fc.constantFrom(...shapes),
    amountMinor: fc.bigInt({ min: 1n, max: 10n ** 12n }),
    doneBulletin: fc.integer({ min: 1, max: 30_000 }),
    doneMarket: fc.integer({ min: 1, max: 30_000 }),
    invoiceBulletin: fc.integer({ min: 1, max: 30_000 }),
    invoiceMarket: fc.integer({ min: 1, max: 30_000 }),
  })
  .map((input) => ({
    ...input,
    ledgers: input.shape[0],
    amount: money(input.amountMinor, input.currency),
    done: measuredOn(
      input.shape[0],
      '2026-12-01',
      `${input.doneBulletin}.0000`,
      `${input.doneMarket}.0000`,
    ),
    invoice: measuredOn(
      input.shape[0],
      '2026-12-03',
      `${input.invoiceBulletin}.0000`,
      `${input.invoiceMarket}.0000`,
    ),
  }));

describe('a milestone done before its invoice', () => {
  it('balances at done, clears its item to zero in every ledger at invoice with the realised residual, and its reopen nets to zero', () => {
    fc.assert(
      fc.property(milestoneArb, ({ ledgers, amount, done, invoice }) => {
        const outcome = milestoneDone(amount, true, { done: false, deferred: null });
        if (outcome.kind !== 'contract_asset') throw new Error('A contract asset');
        const asset = measuredLine({ account: '113001', amount: outcome.amount }, done);
        const revenue = measuredLine(
          { account: '411001', amount: money(-amount.amountMinor, amount.currency) },
          done,
        );
        const doneEntry = balanceEntry({
          ...done,
          lines: [asset, revenue],
          rounding: { account: '541003' },
        });
        // One amount measured on both sides: no rounding line.
        expect(doneEntry).toHaveLength(2);
        const reopened = [...doneEntry, ...reverseLines(doneEntry)];
        expect(sum(reopened.map((line) => line.bookMinor))).toBe(0n);
        expect(sum(reopened.map((line) => line.parallelMinor ?? 0n))).toBe(0n);

        const clearing = milestoneItemClearing(amount, asset);
        if (clearing.kind !== 'clear') throw new Error('The invoice clears the item');
        expect(clearing.amounts).toEqual(negate(asset));
        const lines: Line[] = [
          measuredLine({ account: '112001', amount }, invoice),
          carried('113001', clearing.amounts),
        ];
        const entry = balanceEntry({
          ...invoice,
          lines: [...lines, ...realisedDifferenceLines(ledgers, lines, realised)],
          rounding: { account: '541003' },
        });
        expect(sum(entry.map((line) => line.bookMinor))).toBe(0n);
        expect(sum(entry.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
        const both = [...entry, ...reverseLines(entry)];
        expect(sum(both.map((line) => line.bookMinor))).toBe(0n);
        expect(sum(both.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
      }),
      { numRuns: 300 },
    );
  });

  it('never posts a line of another amount: the invoice and a done differing from what stands are decisions', () => {
    fc.assert(
      fc.property(
        milestoneArb,
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        ({ amount, done }, otherMinor) => {
          fc.pre(otherMinor !== amount.amountMinor);
          const asset = measuredLine({ account: '113001', amount }, done);
          const other = money(otherMinor, amount.currency);
          expect(milestoneItemClearing(other, asset).kind).toBe('decision');
          expect(milestoneDone(other, true, { done: false, deferred: asset }).kind).toBe(
            'decision',
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('a milestone invoiced before its done', () => {
  it('is released at its deferral exactly in every ledger, with no rounding line, the same on a replay, and its reopen nets to zero', () => {
    fc.assert(
      fc.property(milestoneArb, ({ amount, invoice }) => {
        const deferral = measuredLine(
          { account: '212001', amount: money(-amount.amountMinor, amount.currency) },
          invoice,
        );
        const deferred = negate(deferral);
        const outcome = milestoneDone(amount, true, { done: false, deferred });
        expect(milestoneDone(amount, true, { done: false, deferred })).toEqual(outcome);
        if (outcome.kind !== 'release') throw new Error('A release');
        expect(outcome.amounts).toEqual(deferred);
        const entry = balanceEntry({
          ...invoice,
          lines: [carried('212001', outcome.amounts), carried('411001', negate(outcome.amounts))],
          rounding: { account: '541003' },
        });
        expect(entry).toHaveLength(2);
        const both = [...entry, ...reverseLines(entry)];
        expect(sum(both.map((line) => line.bookMinor))).toBe(0n);
        expect(sum(both.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
        // The project's completion releases the same amounts while the done never came.
        expect(completedProjectReleases([deferred])).toEqual([deferred]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('milestoneReopen and reissuedMilestoneLine', () => {
  const states = [
    [{ doneStanding: true, doneTakenBackByVoid: false }, 'reverse', 'clear_item'],
    [{ doneStanding: false, doneTakenBackByVoid: true }, 'record', 'revenue_at_issue'],
    [{ doneStanding: false, doneTakenBackByVoid: false }, 'unknown_reference', 'defer'],
  ] as const;

  it('reverses a standing done, records a reopen after the void, and re-issues a line by the same facts', () => {
    for (const [standing, reopen, line] of states) {
      expect(milestoneReopen(standing)).toBe(reopen);
      expect(reissuedMilestoneLine(standing)).toBe(line);
    }
    const both = { doneStanding: true, doneTakenBackByVoid: true };
    expect(() => milestoneReopen(both)).toThrow(TypeError);
    expect(() => reissuedMilestoneLine(both)).toThrow(TypeError);
  });
});

describe('reissueParts', () => {
  it("catches up November on a re-issue in December and defers December: the first case's numbers", () => {
    const months = overTimeMonths(90_000n, '2026-11-15', '2026-12-14', '2026-12-07');
    const { catchUpMinor, months: rest } = reissueParts(months, new Set(['2026-11']));
    expect(catchUpMinor).toBe(48_000n);
    expect(rest.map((m) => [m.month, m.transactionMinor, m.elapsed])).toEqual([
      ['2026-12', 42_000n, false],
    ]);
    // At 122: 5,856,000 at issue; the deferral 5,124,000 released in December.
    const context = measuredOn(sypUsd, '2026-12-07', '122.0000');
    const lines: Line[] = [
      measuredLine({ account: '112001', amount: money(90_000n, 'USD') }, context),
      measuredLine({ account: '411001', amount: money(-catchUpMinor, 'USD') }, context),
      measuredLine({ account: '212001', amount: money(-42_000n, 'USD') }, context),
    ];
    expect(lines.map((line) => line.bookMinor)).toEqual([10_980_000n, -5_856_000n, -5_124_000n]);
    const deferral = lines[2];
    if (deferral === undefined) throw new Error('The deferral');
    expect(releaseParts(negate(deferral), rest, sypUsd).map((part) => part.bookMinor)).toEqual([
      5_124_000n,
    ]);
  });

  it('marks December elapsed on a re-issue in January, and cuts a re-issue at 930.00 by its own days', () => {
    const january = reissueParts(
      overTimeMonths(90_000n, '2026-11-15', '2026-12-14', '2027-01-05'),
      new Set(['2026-11']),
    );
    expect(january.catchUpMinor).toBe(48_000n);
    expect(january.months.map((m) => [m.month, m.transactionMinor, m.elapsed])).toEqual([
      ['2026-12', 42_000n, true],
    ]);
    const other = reissueParts(
      overTimeMonths(93_000n, '2026-11-15', '2026-12-14', '2026-12-07'),
      new Set(['2026-11']),
    );
    expect([other.catchUpMinor, other.months[0]?.transactionMinor]).toEqual([49_600n, 43_400n]);
    // The late cycle with October elapsed and November released: all of it at issue.
    const late = reissueParts(
      overTimeMonths(62_000n, '2026-10-20', '2026-11-19', '2026-12-07'),
      new Set(['2026-10', '2026-11']),
    );
    expect([late.catchUpMinor, late.months]).toEqual([62_000n, []]);
    expect(() =>
      reissueParts(
        overTimeMonths(90_000n, '2026-11-15', '2026-12-14', '2026-12-07'),
        new Set(['2026-10']),
      ),
    ).toThrow(RangeError);
  });

  it('converts the USD books case at 122 with no rounding line: 595.08 = 317.38 + 277.70', () => {
    const months = overTimeMonths(7_260_000n, '2026-11-15', '2026-12-14', '2026-12-07');
    const { catchUpMinor, months: rest } = reissueParts(months, new Set(['2026-11']));
    const context = measuredOn(usdSyp, '2026-12-07', '122.0000');
    const lines: Line[] = [
      measuredLine({ account: '112001', amount: money(7_260_000n, 'SYP') }, context),
      measuredLine({ account: '411001', amount: money(-catchUpMinor, 'SYP') }, context),
      measuredLine(
        { account: '212001', amount: money(-(rest[0]?.transactionMinor ?? 0n), 'SYP') },
        context,
      ),
    ];
    expect(lines.map((line) => line.bookMinor)).toEqual([59_508n, -31_738n, -27_770n]);
    expect(balanceEntry({ ...context, lines, rounding: { account: '541003' } })).toHaveLength(3);
  });
});

describe('a re-issue', () => {
  it('recognises exactly the re-issued amount over its catch-up and its months, and with the voided amount catches up exactly what the void took back', () => {
    fc.assert(
      fc.property(
        deferralArb,
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 400 }),
        ({ amount, from, to }, reissuedMinor, lateDays) => {
          // The void took back the months ended before it; the re-issue comes later.
          const voidedOn = addDays(from, lateDays);
          const reissuedOn = addDays(voidedOn, 5);
          const voided = overTimeMonths(amount, from, to, from);
          const takenBack = new Set(voided.filter((m) => m.lastDay < voidedOn).map((m) => m.month));
          const reissue = reissueParts(
            overTimeMonths(reissuedMinor, from, to, reissuedOn),
            takenBack,
          );
          expect(reissue.catchUpMinor + sum(reissue.months.map((m) => m.transactionMinor))).toBe(
            reissuedMinor,
          );
          const same = reissueParts(overTimeMonths(amount, from, to, reissuedOn), takenBack);
          expect(same.catchUpMinor).toBe(
            sum(voided.filter((m) => takenBack.has(m.month)).map((m) => m.transactionMinor)),
          );
          // A replay of the same re-issue computes the same parts.
          expect(reissueParts(overTimeMonths(amount, from, to, reissuedOn), takenBack)).toEqual(
            same,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('builds an issue entry of new measurements that balances in every shape, and whose reversal nets to zero', () => {
    fc.assert(
      fc.property(milestoneArb, deferralArb, ({ ledgers, amount, invoice }, { from, to }) => {
        const months = overTimeMonths(amount.amountMinor, from, to, invoice.on);
        const takenBack = new Set(months.slice(0, 1).map((m) => m.month));
        const { catchUpMinor, months: rest } = reissueParts(months, takenBack);
        const deferredMinor = sum(rest.filter((m) => !m.elapsed).map((m) => m.transactionMinor));
        const elapsedMinor = sum(rest.filter((m) => m.elapsed).map((m) => m.transactionMinor));
        const lines: Line[] = [
          measuredLine(
            {
              account: '112001',
              amount: money(amount.amountMinor - elapsedMinor, amount.currency),
            },
            invoice,
          ),
        ];
        if (catchUpMinor !== 0n) {
          lines.push(
            measuredLine(
              { account: '411001', amount: money(-catchUpMinor, amount.currency) },
              invoice,
            ),
          );
        }
        if (deferredMinor !== 0n) {
          lines.push(
            measuredLine(
              { account: '212001', amount: money(-deferredMinor, amount.currency) },
              invoice,
            ),
          );
        }
        fc.pre(lines.length >= 2);
        const entry = balanceEntry({ ...invoice, ledgers, lines, rounding: { account: '541003' } });
        const both = [...entry, ...reverseLines(entry)];
        expect(sum(entry.map((line) => line.bookMinor))).toBe(0n);
        expect(sum(entry.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
        expect(sum(both.map((line) => line.bookMinor))).toBe(0n);
        expect(sum(both.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
      }),
      { numRuns: 300 },
    );
  });
});

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
