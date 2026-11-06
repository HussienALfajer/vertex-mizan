import { money } from '@vertex-mizan/contracts';
import { describe, expect, it } from 'vitest';
import { clearOpenItem, moveRunningBalance, reverseLines } from './carried.js';
import { type CarriedAmounts, carriedLine } from './lines.js';
import { measuredLine } from './measure.js';
import { calendar, rate, refusal, sypUsd } from './test-fixtures.js';

/** A USD 100.00 receivable measured at a bulletin of 121.3333: 12 133.33 SYP, 100.00 USD. */
const receivable: CarriedAmounts = {
  transaction: money(10_000n, 'USD'),
  bookMinor: 1_213_333n,
  parallelMinor: 10_000n,
};

describe('clearOpenItem (ADR 0013)', () => {
  it('clears in proportion to what remains, and the last clearing clears everything left', () => {
    // 33.33, 33.33 and 33.34 USD: round(1 213 333 × 3 333 ÷ 10 000) = 404 404, leaving 808 929;
    // round(808 929 × 3 333 ÷ 6 667) = round(404 404.24) = 404 404, leaving 404 525; then all.
    const first = clearOpenItem(receivable, -3_333n);
    expect(first).toEqual({
      transaction: money(-3_333n, 'USD'),
      bookMinor: -404_404n,
      parallelMinor: -3_333n,
    });
    const afterFirst = {
      transaction: money(6_667n, 'USD'),
      bookMinor: 808_929n,
      parallelMinor: 6_667n,
    };
    const second = clearOpenItem(afterFirst, -3_333n);
    expect(second).toEqual({
      transaction: money(-3_333n, 'USD'),
      bookMinor: -404_404n,
      parallelMinor: -3_333n,
    });
    const last = clearOpenItem(
      { transaction: money(3_334n, 'USD'), bookMinor: 404_525n, parallelMinor: 3_334n },
      -3_334n,
    );
    expect(last).toEqual({
      transaction: money(-3_334n, 'USD'),
      bookMinor: -404_525n,
      parallelMinor: -3_334n,
    });
  });

  it('starts from what the item carries after a void, so the last clearing leaves zero', () => {
    // S04's SYP item with halves in the parallel ledger (receivables/manual-settlement): 82 645
    // parallel; 30 000 cleared (24 794), 35 000 cleared (28 926), the first voided (+24 794), so
    // 65 000 SYP open carry 53 719 USD cents, all of which the last receipt clears.
    const item = {
      transaction: money(10_000_000n, 'SYP'),
      bookMinor: 10_000_000n,
      parallelMinor: 82_645n,
    };
    const first = clearOpenItem(item, -3_000_000n);
    expect(first.parallelMinor).toBe(-24_794n);
    const second = clearOpenItem(
      { transaction: money(7_000_000n, 'SYP'), bookMinor: 7_000_000n, parallelMinor: 57_851n },
      -3_500_000n,
    );
    expect(second.parallelMinor).toBe(-28_926n);
    const last = clearOpenItem(
      { transaction: money(6_500_000n, 'SYP'), bookMinor: 6_500_000n, parallelMinor: 53_719n },
      -6_500_000n,
    );
    expect(last).toEqual({
      transaction: money(-6_500_000n, 'SYP'),
      bookMinor: -6_500_000n,
      parallelMinor: -53_719n,
    });
  });

  it('refuses to clear more than is open, and a movement that would add to the item', () => {
    const rest = { transaction: money(3_334n, 'USD'), bookMinor: 404_525n, parallelMinor: 3_334n };
    expect(refusal(() => clearOpenItem(rest, -3_335n))).toBe('RELEASE_EXCEEDS_BALANCE');
    const settled = { transaction: money(0n, 'USD'), bookMinor: 0n, parallelMinor: 0n };
    expect(refusal(() => clearOpenItem(settled, -1n))).toBe('RELEASE_EXCEEDS_BALANCE');
    expect(() => clearOpenItem(rest, 1n)).toThrow(RangeError);
    expect(() => clearOpenItem(rest, 0n)).toThrow(RangeError);
    // A settled item that is not zero in a ledger breaks invariant 9: never cleared further.
    expect(() => clearOpenItem({ ...settled, bookMinor: 1n }, -1n)).toThrow(RangeError);
  });

  it('clears a credit balance with debits the same way', () => {
    // A contract liability of 300.00 USD, 36 333.33 SYP, released by 100.00 USD.
    const liability = {
      transaction: money(-30_000n, 'USD'),
      bookMinor: -3_633_333n,
      parallelMinor: -30_000n,
    };
    // round(−3 633 333 × 10 000 ÷ −30 000) = round(1 211 111) = 1 211 111
    expect(clearOpenItem(liability, 10_000n)).toEqual({
      transaction: money(10_000n, 'USD'),
      bookMinor: 1_211_111n,
      parallelMinor: 10_000n,
    });
  });
});

describe('moveRunningBalance', () => {
  // Client ad funds held: 100.00 USD deposited at 120 and 50.00 USD at 125.
  const funds: CarriedAmounts = {
    transaction: money(-15_000n, 'USD'),
    bookMinor: -1_825_000n,
    parallelMinor: -15_000n,
  };

  it('clears at the average carrying amount of the balance before the movement', () => {
    // A 10.00 USD spend: round(1 825 000 × 1 000 ÷ 15 000) = round(121 666.67) = 121 667.
    expect(moveRunningBalance(funds, 1_000n)).toEqual({
      cleared: { transaction: money(1_000n, 'USD'), bookMinor: 121_667n, parallelMinor: 1_000n },
      measuredMinor: 0n,
    });
  });

  it('clears the balance in full and measures the excess new when it crosses zero', () => {
    const balance = {
      transaction: money(-14_000n, 'USD'),
      bookMinor: -1_703_333n,
      parallelMinor: -14_000n,
    };
    // A 150.00 USD spend against 140.00 USD held: 10.00 USD is owed by the client.
    expect(moveRunningBalance(balance, 15_000n)).toEqual({
      cleared: {
        transaction: money(14_000n, 'USD'),
        bookMinor: 1_703_333n,
        parallelMinor: 14_000n,
      },
      measuredMinor: 1_000n,
    });
    // Clearing exactly the balance clears every ledger exactly, with no excess.
    expect(moveRunningBalance(balance, 14_000n)).toEqual({
      cleared: {
        transaction: money(14_000n, 'USD'),
        bookMinor: 1_703_333n,
        parallelMinor: 14_000n,
      },
      measuredMinor: 0n,
    });
  });

  it('measures new a movement that adds to the balance or starts from zero', () => {
    expect(moveRunningBalance(funds, -5_000n)).toEqual({ cleared: null, measuredMinor: -5_000n });
    const empty = { transaction: money(0n, 'USD'), bookMinor: 0n, parallelMinor: 0n };
    expect(moveRunningBalance(empty, 2_000n)).toEqual({ cleared: null, measuredMinor: 2_000n });
    expect(moveRunningBalance(funds, 0n)).toEqual({ cleared: null, measuredMinor: 0n });
  });

  it('refuses a zero transaction balance that is not zero in a ledger', () => {
    const broken = { transaction: money(0n, 'USD'), bookMinor: 1n, parallelMinor: 0n };
    expect(() => moveRunningBalance(broken, 1_000n)).toThrow(RangeError);
  });
});

describe('reverseLines', () => {
  it('negates every amount exactly and keeps the rest, rate records included', () => {
    const bulletin = rate('USD', 'SYP', '120.0000', 'bulletin', '2026-11-03');
    const lines = [
      measuredLine(
        { account: '1210', dimensions: { client: 'C1' }, amount: money(10_000n, 'USD') },
        { ledgers: sypUsd, on: '2026-11-03', calendar, rates: [bulletin] },
      ),
      carriedLine({
        account: '2310',
        amounts: {
          ...receivable,
          transaction: money(-10_000n, 'USD'),
          bookMinor: -1_200_000n,
          parallelMinor: -10_000n,
        },
      }),
    ];
    const reversal = reverseLines(lines);
    expect(reversal).toEqual([
      {
        ...lines[0],
        transaction: money(-10_000n, 'USD'),
        bookMinor: -1_200_000n,
        parallelMinor: -10_000n,
      },
      {
        ...lines[1],
        transaction: money(10_000n, 'USD'),
        bookMinor: 1_200_000n,
        parallelMinor: 10_000n,
      },
    ]);
  });
});
