import { money } from '@vertex-mizan/contracts';
import { describe, expect, it } from 'vitest';
import { allocate, allocateCarried } from './allocation.js';

describe('allocate', () => {
  it('splits with cumulative rounding so the parts sum exactly', () => {
    // 100.00 in three: round(10 000 ÷ 3) = 3 333, round(20 000 ÷ 3) = 6 667, then 10 000.
    expect(allocate(10_000n, [1n, 1n, 1n])).toEqual([3_333n, 3_334n, 3_333n]);
    expect(allocate(-10_000n, [1n, 1n, 1n])).toEqual([-3_333n, -3_334n, -3_333n]);
    // A tie goes away from zero: 500.00 × 33 333 ÷ 100 000 = 166.665 → 166.67.
    expect(allocate(50_000n, [33_333n, 33_333n, 33_334n])).toEqual([16_667n, 16_666n, 16_667n]);
  });

  it('gives a zero weight a zero part, and refuses negative or all-zero weights', () => {
    expect(allocate(10_000n, [0n, 1n, 0n, 1n])).toEqual([0n, 5_000n, 0n, 5_000n]);
    expect(allocate(0n, [1n, 2n])).toEqual([0n, 0n]);
    expect(() => allocate(10_000n, [1n, -1n, 1n])).toThrow(RangeError);
    expect(() => allocate(10_000n, [0n, 0n])).toThrow(RangeError);
    expect(() => allocate(10_000n, [])).toThrow(RangeError);
  });
});

describe('allocateCarried', () => {
  it("allocates each ledger's amount separately with the same weights", () => {
    // A 300.00 USD retainer charge deferred at 121.1111 (36 333.33 SYP), 16 days in one month
    // and 14 in the next: round(3 633 333 × 16 ÷ 30) = round(1 937 777.6) = 1 937 778.
    const deferred = {
      transaction: money(-30_000n, 'USD'),
      bookMinor: -3_633_333n,
      parallelMinor: -30_000n,
    };
    expect(allocateCarried(deferred, [16n, 14n])).toEqual([
      { transaction: money(-16_000n, 'USD'), bookMinor: -1_937_778n, parallelMinor: -16_000n },
      { transaction: money(-14_000n, 'USD'), bookMinor: -1_695_555n, parallelMinor: -14_000n },
    ]);
  });

  it('splits a deposit by installments, ties away from zero', () => {
    // 500.00 USD at 120.5 (60 250.00 SYP) by installments of 333.33, 333.33 and 333.34:
    // book round(6 025 000 × 33 333 ÷ 100 000) = 2 008 313,
    // round(6 025 000 × 66 666 ÷ 100 000) = round(4 016 626.5) = 4 016 627.
    const deposit = {
      transaction: money(50_000n, 'USD'),
      bookMinor: 6_025_000n,
      parallelMinor: null,
    };
    expect(allocateCarried(deposit, [33_333n, 33_333n, 33_334n])).toEqual([
      { transaction: money(16_667n, 'USD'), bookMinor: 2_008_313n, parallelMinor: null },
      { transaction: money(16_666n, 'USD'), bookMinor: 2_008_314n, parallelMinor: null },
      { transaction: money(16_667n, 'USD'), bookMinor: 2_008_373n, parallelMinor: null },
    ]);
  });
});
