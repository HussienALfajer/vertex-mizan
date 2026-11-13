import { type CompanyLedgers, type CurrencyCode, money } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balanceEntry, realisedDifferenceLines } from './balance.js';
import { clearOpenItem, reverseLines } from './carried.js';
import { type CarriedAmounts, carriedLine, type Line, negate } from './lines.js';
import { measuredLine } from './measure.js';
import { daysBetween } from './periods.js';
import {
  type CreditedSchedule,
  cancelledProjectRemainder,
  cancelledProjectSplit,
  completedProjectReleases,
  creditParts,
  invoicedAfterCancellationSplit,
  milestoneDone,
  milestoneItemClearing,
  milestoneItemReference,
  milestoneLineAtIssue,
  milestoneReopen,
  netOfCredits,
  type OverTimeMonth,
  overTimeMonths,
  type ReissueParts,
  recutReleases,
  reissuedMilestoneLine,
  reissueParts,
  releaseParts,
  remainingReleaseParts,
  reversedMovement,
  voidedCreditParts,
} from './recognition.js';
import { calendar, hubRate, rate, refusal, sypOnly, sypUsd, usdSyp } from './test-fixtures.js';

/**
 * The day split of revenue recognised over time (S06 rules 3–5 and 7), with the numbers of
 * `docs/scenarios/revenue/over-time-release.md` (owner, 2026-11-10, option A), and a retainer
 * credit's split (S06 rules 6 and 8), with the numbers of `docs/scenarios/revenue/retainer-credit.md`
 * (owner, 2026-11-10); a milestone's done, its invoice and the project's completion (S06 rules 11–14),
 * with the numbers of `docs/scenarios/revenue/milestones.md` (owner, 2026-11-10); the void's re-issue (S06 rule 9) and a reopen after a void, with the numbers
 * of `docs/scenarios/revenue/void-and-reissue.md` (owner, 2026-11-10); a cancelled project's
 * remainder split (S06 rule 15), with the numbers of `docs/scenarios/revenue/cancelled-project.md`
 * (owner, 2026-11-10); and their properties.
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
        // As `manualEntry()` posts it: a residual is a realised difference only beside a carried
        // line; new measurements alone in one currency leave conversion rounding (a credit to
        // cycles fully released).
        const differences = lines.some((line) => line.kind === 'carried')
          ? realisedDifferenceLines(ledgers, lines, {
              gain: { account: '421001' },
              loss: { account: '541001' },
            })
          : [];
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
  const standing = (deferred: CarriedAmounts | null, done = false) => ({
    done,
    recognisedAtIssue: false,
    deferred,
  });

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
    // A re-issue recognised it at issue after its void: a done then is a second one.
    expect(
      detail(
        milestoneDone(money(30_000n, 'USD'), true, { ...standing(null), recognisedAtIssue: true }),
      ),
    ).toBe('milestone_already_done');
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
        const outcome = milestoneDone(amount, true, {
          done: false,
          recognisedAtIssue: false,
          deferred: null,
        });
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
          expect(
            milestoneDone(other, true, { done: false, recognisedAtIssue: false, deferred: asset })
              .kind,
          ).toBe('decision');
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
        const outcome = milestoneDone(amount, true, {
          done: false,
          recognisedAtIssue: false,
          deferred,
        });
        expect(
          milestoneDone(amount, true, { done: false, recognisedAtIssue: false, deferred }),
        ).toEqual(outcome);
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
  const no = { completionTakenBackByVoid: false };
  const states = [
    [{ doneStanding: true, doneTakenBackByVoid: false }, 'reverse', 'clear_item'],
    [{ doneStanding: false, doneTakenBackByVoid: true }, 'record', 'revenue_at_issue'],
    [{ doneStanding: false, doneTakenBackByVoid: false }, 'unknown_reference', 'defer'],
  ] as const;

  it('reverses a standing done, records a reopen after the void, and re-issues a line by the same facts', () => {
    for (const [standing, reopen, line] of states) {
      expect(milestoneReopen(standing)).toBe(reopen);
      expect(reissuedMilestoneLine({ ...standing, ...no })).toBe(line);
    }
    // A schedule the completion released and the void took back: revenue at issue (owner, 2026-11-10).
    expect(
      reissuedMilestoneLine({
        doneStanding: false,
        doneTakenBackByVoid: false,
        completionTakenBackByVoid: true,
      }),
    ).toBe('revenue_at_issue');
    const both = { doneStanding: true, doneTakenBackByVoid: true };
    expect(() => milestoneReopen(both)).toThrow(TypeError);
    expect(() => reissuedMilestoneLine({ ...both, ...no })).toThrow(TypeError);
    expect(() =>
      reissuedMilestoneLine({
        doneStanding: true,
        doneTakenBackByVoid: false,
        completionTakenBackByVoid: true,
      }),
    ).toThrow(TypeError);
  });
});

describe('reissueParts', () => {
  it("catches up November on a re-issue in December and defers December: the first case's numbers", () => {
    const months = overTimeMonths(90_000n, '2026-11-15', '2026-12-14', '2026-12-07');
    const { catchUpMinor, months: rest } = partsOf(months, new Set(['2026-11']));
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
    const january = partsOf(
      overTimeMonths(90_000n, '2026-11-15', '2026-12-14', '2027-01-05'),
      new Set(['2026-11']),
    );
    expect(january.catchUpMinor).toBe(48_000n);
    expect(january.months.map((m) => [m.month, m.transactionMinor, m.elapsed])).toEqual([
      ['2026-12', 42_000n, true],
    ]);
    const other = partsOf(
      overTimeMonths(93_000n, '2026-11-15', '2026-12-14', '2026-12-07'),
      new Set(['2026-11']),
    );
    expect([other.catchUpMinor, other.months[0]?.transactionMinor]).toEqual([49_600n, 43_400n]);
    // The late cycle with October elapsed and November released: all of it at issue.
    const late = partsOf(
      overTimeMonths(62_000n, '2026-10-20', '2026-11-19', '2026-12-07'),
      new Set(['2026-10', '2026-11']),
    );
    expect([late.catchUpMinor, late.months]).toEqual([62_000n, []]);
    // A re-issue whose period does not cover a month taken back is held for the accountant.
    expect(
      reissueParts(
        overTimeMonths(90_000n, '2026-11-15', '2026-12-14', '2026-12-07'),
        new Set(['2026-10']),
      ),
    ).toEqual({ kind: 'decision', detail: 'reissue_period_differs' });
  });

  it("builds the next month's re-issue: November at 125, December elapsed at 124 and cleared, a 420.00 SYP gain", () => {
    const { catchUpMinor, months } = partsOf(
      overTimeMonths(90_000n, '2026-11-15', '2026-12-14', '2027-01-05'),
      new Set(['2026-11']),
    );
    const december = months[0];
    if (december === undefined) throw new Error('December');
    const asset = measuredLine(
      { account: '113001', amount: money(december.transactionMinor, 'USD') },
      measuredOn(sypUsd, december.lastDay, '124.0000'),
    );
    expect(asset.bookMinor).toBe(5_208_000n);
    const at = measuredOn(sypUsd, '2027-01-05', '125.0000');
    const lines: Line[] = [
      measuredLine({ account: '112001', amount: money(90_000n, 'USD') }, at),
      measuredLine({ account: '411001', amount: money(-catchUpMinor, 'USD') }, at),
      carried('113001', clearOpenItem(asset, -december.transactionMinor)),
    ];
    expect(lines.map((line) => line.bookMinor)).toEqual([11_250_000n, -6_000_000n, -5_208_000n]);
    const differences = realisedDifferenceLines(sypUsd, lines, realised);
    expect(differences.map((line) => [line.account, line.bookMinor, line.parallelMinor])).toEqual([
      ['421001', -42_000n, 0n],
    ]);
  });

  it('converts the USD books case at 122 with no rounding line: 595.08 = 317.38 + 277.70', () => {
    const months = overTimeMonths(7_260_000n, '2026-11-15', '2026-12-14', '2026-12-07');
    const { catchUpMinor, months: rest } = partsOf(months, new Set(['2026-11']));
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
          const reissue = partsOf(overTimeMonths(reissuedMinor, from, to, reissuedOn), takenBack);
          expect(reissue.catchUpMinor + sum(reissue.months.map((m) => m.transactionMinor))).toBe(
            reissuedMinor,
          );
          const same = partsOf(overTimeMonths(amount, from, to, reissuedOn), takenBack);
          expect(same.catchUpMinor).toBe(
            sum(voided.filter((m) => takenBack.has(m.month)).map((m) => m.transactionMinor)),
          );
          // A replay of the same re-issue computes the same parts.
          expect(partsOf(overTimeMonths(amount, from, to, reissuedOn), takenBack)).toEqual(same);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('builds the issue entry rule 9 posts: catch-up and deferral measured anew, elapsed items cleared at what they carry with the realised residual; balanced in every shape, its reversal netting to zero', () => {
    fc.assert(
      fc.property(
        fc.record({
          start: fc.integer({ min: 0, max: 300 }),
          length: fc.integer({ min: 0, max: 120 }),
          voidAfter: fc.integer({ min: 0, max: 200 }),
          reissueAfter: fc.integer({ min: 1, max: 60 }),
          amount: fc.bigInt({ min: 1n, max: 10n ** 12n }),
          reissued: fc.bigInt({ min: 1n, max: 10n ** 12n }),
          currency: fc.constantFrom<CurrencyCode>('USD', 'SYP'),
          shape: fc.constantFrom(...shapes),
          monthEndRate: fc.integer({ min: 1, max: 30_000 }),
          reissueRate: fc.integer({ min: 1, max: 30_000 }),
        }),
        (input) => {
          const [ledgers] = input.shape;
          const from = dateAfter(input.start);
          const to = dateAfter(input.start + input.length);
          const voidedOn = dateAfter(input.start + input.voidAfter);
          const reissuedOn = dateAfter(input.start + input.voidAfter + input.reissueAfter);
          // The void took back the months released before it: those that ended before its date.
          const takenBack = new Set(
            overTimeMonths(input.amount, from, to, from)
              .filter((m) => m.lastDay < voidedOn)
              .map((m) => m.month),
          );
          const { catchUpMinor, months } = partsOf(
            overTimeMonths(input.reissued, from, to, reissuedOn),
            takenBack,
          );
          const at = measuredOn(ledgers, reissuedOn, `${input.reissueRate}.0000`);
          const money_ = (minor: bigint) => money(minor, input.currency);
          const lines: Line[] = [
            measuredLine({ account: '112001', amount: money_(input.reissued) }, at),
          ];
          if (catchUpMinor !== 0n) {
            lines.push(measuredLine({ account: '411001', amount: money_(-catchUpMinor) }, at));
          }
          const deferredMinor = sum(
            months.filter((m) => !m.elapsed).map((m) => m.transactionMinor),
          );
          if (deferredMinor !== 0n) {
            lines.push(measuredLine({ account: '212001', amount: money_(-deferredMinor) }, at));
          }
          for (const month of months.filter((m) => m.elapsed && m.transactionMinor !== 0n)) {
            const monthEnd = measuredOn(ledgers, month.lastDay, `${input.monthEndRate}.0000`);
            const asset = measuredLine(
              { account: '113001', amount: money_(month.transactionMinor) },
              monthEnd,
            );
            const elapsedEntry = balanceEntry({
              ...monthEnd,
              lines: [
                asset,
                measuredLine(
                  { account: '411001', amount: money_(-month.transactionMinor) },
                  monthEnd,
                ),
              ],
              rounding: { account: '541003' },
            });
            expect(elapsedEntry).toHaveLength(2);
            const clearing = clearOpenItem(asset, -month.transactionMinor);
            // The item reaches zero in every ledger.
            expect(clearing).toEqual(negate(asset));
            lines.push(carried('113001', clearing));
          }
          const entry = balanceEntry({
            ...at,
            // A carried line makes the residual a realised difference (ADR 0013); new measurements
            // alone leave rounding only, which balanceEntry() posts (S06 "Residuals").
            lines: lines.some((line) => line.kind === 'carried')
              ? [...lines, ...realisedDifferenceLines(ledgers, lines, realised)]
              : lines,
            rounding: { account: '541003' },
          });
          const own = entry.filter(
            (line) => line.kind !== 'difference' && line.kind !== 'rounding',
          );
          expect(sum(own.map((line) => line.transaction.amountMinor))).toBe(0n);
          const both = [...entry, ...reverseLines(entry)];
          expect(sum(both.map((line) => line.bookMinor))).toBe(0n);
          expect(sum(both.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
        },
      ),
      { numRuns: 300 },
    );
  });
});

/** A re-issue's parts, when its period covers every month the void took back. */
function partsOf(months: readonly OverTimeMonth[], takenBack: ReadonlySet<string>): ReissueParts {
  const parts = reissueParts(months, takenBack);
  if (parts.kind !== 'parts') throw new Error('A re-issue held for the accountant');
  return parts;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The entry of a cancelled project's split as S06 rule 15 posts it: Dr each schedule's liability
 * at its remaining, Cr revenue at each carried share, Cr the refund payable measured anew on the
 * cancellation's date, and each ledger's residual as a realised difference.
 */
function cancellationEntry(
  ledgers: CompanyLedgers,
  on: ReturnType<typeof measuredOn>,
  remaining: readonly CarriedAmounts[],
  revenueMinor: bigint,
): Line[] {
  const split = cancelledProjectSplit(revenueMinor, remaining);
  const lines: Line[] = remaining.map((amounts) => carried('212001', amounts));
  for (const part of split.parts) {
    if (part.revenue) lines.push(carried('411001', negate(part.revenue)));
  }
  if (split.refund) {
    const { amountMinor, currency } = split.refund;
    lines.push(measuredLine({ account: '211005', amount: money(-amountMinor, currency) }, on));
  }
  return balanceEntry({
    ...on,
    lines: [...lines, ...realisedDifferenceLines(ledgers, lines, realised)],
    rounding: { account: '541003' },
  });
}

/** Each line as account, book and parallel, in order, for the scenario's numbers. */
const amountsOf = (entry: readonly Line[]) =>
  entry.map((line) => [line.account, line.bookMinor, line.parallelMinor]);

describe('cancelledProjectRemainder', () => {
  it('records a cancellation with nothing deferred and holds one with a remainder for the split', () => {
    const left = usd(30_000n, 3_600_000n, 30_000n);
    expect(cancelledProjectRemainder([])).toEqual({ kind: 'record' });
    expect(cancelledProjectRemainder([usd(0n, 0n, 0n)])).toEqual({ kind: 'record' });
    expect(cancelledProjectRemainder([usd(0n, 0n, 0n), left])).toEqual({
      kind: 'decision',
      detail: 'cancelled_project_remainder',
      remaining: [left],
    });
    expect(() => cancelledProjectRemainder([usd(0n, 1n, 0n)])).toThrow(RangeError);
  });
});

describe('cancelledProjectSplit', () => {
  const on = (ledgers: CompanyLedgers, bulletin: string, market = bulletin) =>
    measuredOn(ledgers, '2026-12-10', bulletin, market);

  it('splits a deposit 1:2 at its carried share and measures the refund at 124: the first case', () => {
    const remaining = usd(30_000n, 3_600_000n, 30_000n);
    expect(cancelledProjectSplit(10_000n, [remaining])).toEqual({
      parts: [
        {
          revenue: usd(10_000n, 1_200_000n, 10_000n),
          refunded: usd(20_000n, 2_400_000n, 20_000n),
        },
      ],
      refund: money(20_000n, 'USD'),
    });
    expect(
      amountsOf(cancellationEntry(sypUsd, on(sypUsd, '124.0000'), [remaining], 10_000n)),
    ).toEqual([
      ['212001', 3_600_000n, 30_000n],
      ['411001', -1_200_000n, -10_000n],
      ['211005', -2_480_000n, -20_000n],
      ['541001', 80_000n, 0n],
    ]);
    // SYP books only: the same book amounts, no parallel.
    const books = usd(30_000n, 3_600_000n, null);
    expect(
      amountsOf(cancellationEntry(sypOnly, on(sypOnly, '124.0000'), [books], 10_000n)),
    ).toEqual([
      ['212001', 3_600_000n, null],
      ['411001', -1_200_000n, null],
      ['211005', -2_480_000n, null],
      ['541001', 80_000n, null],
    ]);
  });

  it('cuts the revenue across two schedules with cumulative rounding and its carried share half away from zero', () => {
    const first = usd(7_000n, 840_000n, 7_000n);
    const second = usd(23_000n, 2_817_500n, 23_000n);
    const split = cancelledProjectSplit(10_000n, [first, second]);
    // round(10,000 × 7,000 ÷ 30,000) = 2,333; 10,000 − 2,333 = 7,667; 2,817,500 × 7,667 ÷ 23,000 = 939,207.5
    expect(split.parts.map((part) => part.revenue)).toEqual([
      usd(2_333n, 279_960n, 2_333n),
      usd(7_667n, 939_208n, 7_667n),
    ]);
    expect(split.refund).toEqual(money(20_000n, 'USD'));
    expect(
      amountsOf(cancellationEntry(sypUsd, on(sypUsd, '124.0000'), [first, second], 10_000n)),
    ).toEqual([
      ['212001', 840_000n, 7_000n],
      ['212001', 2_817_500n, 23_000n],
      ['411001', -279_960n, -2_333n],
      ['411001', -939_208n, -7_667n],
      ['211005', -2_480_000n, -20_000n],
      ['541001', 41_668n, 0n],
    ]);
  });

  it('puts all to revenue with no refund and no residual, and refunds an SYP deposit whole at the market rate', () => {
    const deposit = usd(30_000n, 3_600_000n, 30_000n);
    const milestone = usd(50_000n, 6_100_000n, 50_000n);
    const all = cancelledProjectSplit(80_000n, [deposit, milestone]);
    expect(all).toEqual({
      parts: [
        { revenue: deposit, refunded: null },
        { revenue: milestone, refunded: null },
      ],
      refund: null,
    });
    expect(
      cancellationEntry(sypUsd, on(sypUsd, '124.0000'), [deposit, milestone], 80_000n),
    ).toHaveLength(4);

    const sypDeposit = syp(3_600_000n, 3_600_000n, 30_000n);
    expect(cancelledProjectSplit(0n, [sypDeposit])).toEqual({
      parts: [{ revenue: null, refunded: sypDeposit }],
      refund: money(3_600_000n, 'SYP'),
    });
    expect(
      amountsOf(cancellationEntry(sypUsd, on(sypUsd, '124.0000', '125.0000'), [sypDeposit], 0n)),
    ).toEqual([
      ['212001', 3_600_000n, 30_000n],
      ['211005', -3_600_000n, -28_800n],
      ['421001', 0n, -1_200n],
    ]);
  });

  it('splits an SYP deposit in USD books: the refund at the bulletin of 120 and a 6.67 USD loss', () => {
    const deposit = syp(3_720_000n, 30_000n, 3_720_000n);
    expect(
      amountsOf(cancellationEntry(usdSyp, on(usdSyp, '120.0000'), [deposit], 1_240_000n)),
    ).toEqual([
      ['212001', 30_000n, 3_720_000n],
      ['411001', -10_000n, -1_240_000n],
      ['211005', -20_667n, -2_480_000n],
      ['541001', 667n, 0n],
    ]);
  });

  it('refuses a revenue part outside zero to the remainder, and a remainder it cannot split', () => {
    const deposit = usd(30_000n, 3_600_000n, 30_000n);
    expect(refusal(() => cancelledProjectSplit(30_001n, [deposit]))).toBe('VALIDATION_FAILED');
    expect(refusal(() => cancelledProjectSplit(-1n, [deposit]))).toBe('VALIDATION_FAILED');
    expect(refusal(() => cancelledProjectSplit(30_000n, [deposit]))).toBe('none');
    expect(() => cancelledProjectSplit(0n, [])).toThrow(RangeError);
    expect(() => cancelledProjectSplit(0n, [deposit, usd(0n, 0n, 0n)])).toThrow(RangeError);
    expect(() => cancelledProjectSplit(0n, [deposit, syp(100n, 100n, 1n)])).toThrow(TypeError);
  });
});

/** A cancelled project: one to four schedules deferred in one currency, a split and the rates of `on`. */
const cancellationArb = fc
  .record({
    currency: fc.constantFrom<CurrencyCode>('USD', 'SYP'),
    shape: fc.constantFrom(...shapes),
    schedules: fc.array(
      fc.record({
        amountMinor: fc.bigInt({ min: 1n, max: 10n ** 12n }),
        bulletin: fc.integer({ min: 1, max: 30_000 }),
        market: fc.integer({ min: 1, max: 30_000 }),
      }),
      { minLength: 1, maxLength: 4 },
    ),
    revenueShare: fc.bigInt({ min: 0n, max: 1_000n }),
    onBulletin: fc.integer({ min: 1, max: 30_000 }),
    onMarket: fc.integer({ min: 1, max: 30_000 }),
  })
  .map((input) => {
    const ledgers = input.shape[0];
    const remaining = input.schedules.map(({ amountMinor, bulletin, market }) =>
      negate(
        measuredLine(
          { account: '212001', amount: money(-amountMinor, input.currency) },
          measuredOn(ledgers, '2026-11-03', `${bulletin}.0000`, `${market}.0000`),
        ),
      ),
    );
    const totalMinor = sum(input.schedules.map((schedule) => schedule.amountMinor));
    return {
      ledgers,
      remaining,
      totalMinor,
      // From none to all of it, both ends included.
      revenueMinor: (totalMinor * input.revenueShare) / 1_000n,
      on: measuredOn(ledgers, '2026-12-10', `${input.onBulletin}.0000`, `${input.onMarket}.0000`),
    };
  });

describe("a cancelled project's split", () => {
  it('gives each schedule parts that sum to its remaining in every ledger, the revenue exactly and the rest to the refund', () => {
    fc.assert(
      fc.property(cancellationArb, ({ remaining, totalMinor, revenueMinor }) => {
        const split = cancelledProjectSplit(revenueMinor, remaining);
        const none = (amounts: CarriedAmounts) => ({
          transaction: money(0n, amounts.transaction.currency),
          bookMinor: 0n,
          parallelMinor: amounts.parallelMinor === null ? null : 0n,
        });
        split.parts.forEach((part, k) => {
          const left = remaining[k] as CarriedAmounts;
          const revenue = part.revenue ?? none(left);
          const refunded = part.refunded ?? none(left);
          expect(revenue.transaction.amountMinor + refunded.transaction.amountMinor).toBe(
            left.transaction.amountMinor,
          );
          expect(revenue.bookMinor + refunded.bookMinor).toBe(left.bookMinor);
          expect((revenue.parallelMinor ?? 0n) + (refunded.parallelMinor ?? 0n)).toBe(
            left.parallelMinor ?? 0n,
          );
          // A part of zero in the transaction amount is no part in any ledger.
          if (part.revenue) expect(part.revenue.transaction.amountMinor).toBeGreaterThan(0n);
          if (part.refunded) expect(part.refunded.transaction.amountMinor).toBeGreaterThan(0n);
        });
        expect(sum(split.parts.map((part) => part.revenue?.transaction.amountMinor ?? 0n))).toBe(
          revenueMinor,
        );
        expect(split.refund?.amountMinor ?? 0n).toBe(totalMinor - revenueMinor);
      }),
      { numRuns: 1_000 },
    );
  });

  it('posts an entry balanced in every shape with its realised residual, netting to zero with its reversal, the same on a replay', () => {
    fc.assert(
      fc.property(cancellationArb, ({ ledgers, remaining, revenueMinor, on }) => {
        const entry = cancellationEntry(ledgers, on, remaining, revenueMinor);
        expect(sum(entry.map((line) => line.bookMinor))).toBe(0n);
        expect(sum(entry.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
        // The liability is cleared whole, in every ledger.
        const liability = entry.filter((line) => line.account === '212001');
        expect(sum(liability.map((line) => line.bookMinor))).toBe(
          sum(remaining.map((amounts) => amounts.bookMinor)),
        );
        // No refund: every line is carried, so no residual in any ledger.
        if (revenueMinor === sum(remaining.map((a) => a.transaction.amountMinor))) {
          expect(entry.every((line) => line.account !== '211005')).toBe(true);
          expect(entry).toHaveLength(remaining.length * 2);
        }
        const both = [...entry, ...reverseLines(entry)];
        expect(sum(both.map((line) => line.bookMinor))).toBe(0n);
        expect(sum(both.map((line) => line.parallelMinor ?? 0n))).toBe(0n);
        expect(cancellationEntry(ledgers, on, remaining, revenueMinor)).toEqual(entry);
      }),
      { numRuns: 500 },
    );
  });
});

describe('milestoneLineAtIssue', () => {
  it('clears a standing done, holds a line invoiced after the cancellation, and defers otherwise, after the completion too', () => {
    expect(milestoneLineAtIssue(true, false)).toBe('clear_item');
    expect(milestoneLineAtIssue(true, true)).toBe('clear_item');
    expect(milestoneLineAtIssue(false, true)).toEqual({
      kind: 'decision',
      detail: 'invoiced_after_cancellation',
    });
    // A line invoiced after the completion (a project reopened in Hub) waits for its done.
    expect(milestoneLineAtIssue(false, false)).toBe('defer');
  });
});

describe('invoicedAfterCancellationSplit', () => {
  it("splits a deposit invoiced after its project's cancellation 1:2: the case's numbers", () => {
    expect(invoicedAfterCancellationSplit(10_000n, [money(30_000n, 'USD')])).toEqual({
      revenueMinor: [10_000n],
      refund: money(20_000n, 'USD'),
    });
    const on = measuredOn(sypUsd, '2026-12-15', '125.0000');
    const entry = balanceEntry({
      ...on,
      lines: [
        measuredLine({ account: '112001', amount: money(30_000n, 'USD') }, on),
        measuredLine({ account: '411001', amount: money(-10_000n, 'USD') }, on),
        measuredLine({ account: '211005', amount: money(-20_000n, 'USD') }, on),
      ],
      rounding: { account: '541003' },
    });
    expect(amountsOf(entry)).toEqual([
      ['112001', 3_750_000n, 30_000n],
      ['411001', -1_250_000n, -10_000n],
      ['211005', -2_500_000n, -20_000n],
    ]);
  });

  it('cuts the revenue across the lines exactly, refuses a part outside zero to the total, and is the same on a replay', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 10n ** 12n }), { minLength: 1, maxLength: 4 }),
        fc.constantFrom<CurrencyCode>('USD', 'SYP'),
        fc.bigInt({ min: 0n, max: 1_000n }),
        (amounts, currency, share) => {
          const lines = amounts.map((amount) => money(amount, currency));
          const totalMinor = sum(amounts);
          const revenueMinor = (totalMinor * share) / 1_000n;
          const split = invoicedAfterCancellationSplit(revenueMinor, lines);
          expect(sum(split.revenueMinor)).toBe(revenueMinor);
          split.revenueMinor.forEach((part, k) => {
            expect(part).toBeGreaterThanOrEqual(0n);
            expect(part).toBeLessThanOrEqual(amounts[k] as bigint);
          });
          expect(split.refund?.amountMinor ?? 0n).toBe(totalMinor - revenueMinor);
          expect(invoicedAfterCancellationSplit(revenueMinor, lines)).toEqual(split);
          expect(refusal(() => invoicedAfterCancellationSplit(totalMinor + 1n, lines))).toBe(
            'VALIDATION_FAILED',
          );
          expect(refusal(() => invoicedAfterCancellationSplit(-1n, lines))).toBe(
            'VALIDATION_FAILED',
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('netOfCredits and reversedMovement (S06 rules 6, 8)', () => {
  it('takes each credit’s part off the line, a void’s negative part giving it back', () => {
    // The 900.00 USD cycle credited 600.00, then 100.00, then the first credit voided.
    expect(netOfCredits(90_000n, [null, 60_000n, null])).toBe(30_000n);
    expect(netOfCredits(90_000n, [60_000n, 10_000n, -60_000n])).toBe(80_000n);
  });

  it('negates a movement in every ledger and its credit part', () => {
    const credited = {
      transaction: money(-4_200n, 'USD'),
      bookMinor: -508_200n,
      parallelMinor: -4_200n,
    };
    expect(reversedMovement(credited, 9_000n)).toEqual({
      amounts: { transaction: money(4_200n, 'USD'), bookMinor: 508_200n, parallelMinor: 4_200n },
      creditMinor: -9_000n,
    });
    expect(reversedMovement({ ...credited, parallelMinor: null }, null)).toEqual({
      amounts: { transaction: money(4_200n, 'USD'), bookMinor: 508_200n, parallelMinor: null },
      creditMinor: null,
    });
  });
});

describe('recutReleases (revenue/retainer-credit, owner 2026-11-11)', () => {
  const cycle = monthsFrom('2026-11', 90_000n, '2026-11-15', '2026-12-14');

  it('recuts November and December released before a credit of 19 Nov posted', () => {
    // As of 19 Nov the cycle held 850.00 after the credit; both months were released from 900.00.
    expect(
      recutReleases(
        usd(85_000n, 10_285_000n, 85_000n),
        cycle,
        new Map([
          ['2026-11', usd(48_000n, 5_808_000n, 48_000n)],
          ['2026-12', usd(42_000n, 5_082_000n, 42_000n)],
        ]),
        sypUsd,
      ),
    ).toEqual([
      { month: '2026-11', adjustment: usd(2_667n, 322_667n, 2_667n) },
      { month: '2026-12', adjustment: usd(2_333n, 282_333n, 2_333n) },
    ]);
  });

  it('releases more of December after a credit’s void of 3 Dec posted, and nothing for a month right', () => {
    const december = monthsFrom('2026-12', 90_000n, '2026-11-15', '2026-12-14');
    expect(
      recutReleases(
        usd(42_000n, 5_082_000n, 42_000n),
        december,
        new Map([['2026-12', usd(39_667n, 4_799_667n, 39_667n)]]),
        sypUsd,
      ),
    ).toEqual([{ month: '2026-12', adjustment: usd(-2_333n, -282_333n, -2_333n) }]);
    expect(
      recutReleases(
        usd(42_000n, 5_082_000n, null),
        december,
        new Map([['2026-12', usd(42_000n, 5_082_000n, null)]]),
        sypOnly,
      ),
    ).toEqual([]);
  });

  it('brings every month released to what was held, exactly in every ledger (a property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 100, max: 150 }),
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 2, maxLength: 2 }),
        (held, rate, releases) => {
          const remaining = BigInt(held);
          const at = usd(remaining, remaining * BigInt(rate), remaining);
          const posted = new Map(
            cycle.map((month, k) => {
              const minor = BigInt(releases[k] ?? 0);
              return [month.month, usd(minor, minor * 121n, minor)] as const;
            }),
          );
          const recut = recutReleases(at, cycle, posted, sypUsd);
          const net = (pick: (amounts: CarriedAmounts) => bigint) =>
            cycle.reduce((sum, month) => {
              const release = posted.get(month.month) as CarriedAmounts;
              const adjustment = recut.find((item) => item.month === month.month)?.adjustment;
              return sum + pick(release) - (adjustment === undefined ? 0n : pick(adjustment));
            }, 0n);
          expect(net((amounts) => amounts.transaction.amountMinor)).toBe(remaining);
          expect(net((amounts) => amounts.bookMinor)).toBe(at.bookMinor);
          expect(net((amounts) => amounts.parallelMinor ?? 0n)).toBe(remaining);
          // A recut again from the books it leaves changes nothing.
          const after = new Map(
            cycle.map((month) => {
              const release = posted.get(month.month) as CarriedAmounts;
              const adjustment = recut.find((item) => item.month === month.month)?.adjustment;
              return [
                month.month,
                adjustment === undefined
                  ? release
                  : usd(
                      release.transaction.amountMinor - adjustment.transaction.amountMinor,
                      release.bookMinor - adjustment.bookMinor,
                      (release.parallelMinor ?? 0n) - (adjustment.parallelMinor ?? 0n),
                    ),
              ] as const;
            }),
          );
          expect(recutReleases(at, cycle, after, sypUsd)).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  });
});
