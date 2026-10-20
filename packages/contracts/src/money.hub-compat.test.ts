import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CurrencyCode, convert, type ExchangeRate, money } from './money.js';

/**
 * Compatibility with Vertex Hub's `convertMinor` (ADR 0007): for non-negative amounts, Mizan's
 * conversion equals Hub's half-up one. The examples are Hub's own (`packages/contracts/src/
 * money.test.ts` in D:\vertex-hub). Hub's rate is "SYP per USD", stored here as base USD, quote SYP.
 */

/** Hub's `convertMinor`, copied (never imported) and kept as bigint so large results compare exactly. */
function hubConvertMinor(amount: bigint, from: 'USD' | 'SYP', rate: string): bigint {
  const [whole = '0', fraction = ''] = rate.split('.');
  const rateE4 = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0').slice(0, 4) || '0');
  const divideHalfUp = (numerator: bigint, denominator: bigint) =>
    (2n * numerator + denominator) / (2n * denominator);
  return from === 'USD'
    ? divideHalfUp(amount * rateE4, 10_000n)
    : divideHalfUp(amount * 10_000n, rateE4);
}

function hubRate(sypPerUsd: string): ExchangeRate {
  return {
    effectiveOn: '2026-10-20',
    base: 'USD',
    quote: 'SYP',
    rate: sypPerUsd,
    type: 'market',
    source: 'hub',
  };
}

function mizan(amount: bigint, from: CurrencyCode, to: CurrencyCode, sypPerUsd: string): bigint {
  return convert(money(amount, from), to, hubRate(sypPerUsd)).amountMinor;
}

describe("Hub's convertMinor examples", () => {
  it('converts USD to SYP and SYP to USD', () => {
    // $100.00 at 118.5 = 11 850.00 SYP
    expect(mizan(10_000n, 'USD', 'SYP', '118.5')).toBe(1_185_000n);
    expect(mizan(1_185_000n, 'SYP', 'USD', '118.5000')).toBe(10_000n);
  });

  it('rounds half up at .5', () => {
    // 1 cent × 0.5 = 0.5 → 1; 3 cents × 0.5 = 1.5 → 2
    expect(mizan(1n, 'USD', 'SYP', '0.5')).toBe(1n);
    expect(mizan(3n, 'USD', 'SYP', '0.5')).toBe(2n);
    // 1 SYP cent ÷ 2 = 0.5 → 1; 1 ÷ 3 = 0.33 → 0
    expect(mizan(1n, 'SYP', 'USD', '2')).toBe(1n);
    expect(mizan(1n, 'SYP', 'USD', '3')).toBe(0n);
  });

  it('uses all four decimals of the rate exactly', () => {
    // 1 000 000.00 USD × 13 000.1234 = 13 000 123 400.00 SYP
    expect(mizan(100_000_000n, 'USD', 'SYP', '13000.1234')).toBe(1_300_012_340_000n);
  });

  it('stays exact for large amounts', () => {
    expect(mizan(9_000_000_000_000n, 'SYP', 'USD', '13000')).toBe(692_307_692n);
    // The intermediate product (6.5 × 10¹⁹) is far above the safe integer range.
    expect(mizan(500_000_000_000n, 'USD', 'SYP', '13000')).toBe(6_500_000_000_000_000n);
  });

  it('converts SYP to USD as toUsdMinor does', () => {
    expect(mizan(1_300_000n, 'SYP', 'USD', '13000')).toBe(100n);
  });

  it("does not convert an amount in its own currency: Hub's identity is the caller's (ADR 0007)", () => {
    // Hub's convertMinor(12_345, 'USD', 'USD', '118.5') returns 12 345. Mizan uses the amount as
    // is with no rate, so a rate passed for it is refused rather than silently ignored.
    expect(() => mizan(12_345n, 'USD', 'USD', '118.5')).toThrow(/cannot convert USD to USD/);
  });
});

describe("Hub's convertMinor equivalence", () => {
  // Hub's domain: non-negative safe-integer amounts, rates > 0 with up to 8 digits and 4 decimals.
  const hubRateValue = fc
    .tuple(fc.integer({ min: 0, max: 99_999_999 }), fc.integer({ min: 0, max: 9_999 }))
    .filter(([whole, fraction]) => whole > 0 || fraction > 0)
    .map(([whole, fraction]) => `${whole}.${String(fraction).padStart(4, '0')}`);
  const hubAmount = fc.bigInt({ min: 0n, max: BigInt(Number.MAX_SAFE_INTEGER) });

  it('gives the same result for every non-negative amount, in both directions', () => {
    fc.assert(
      fc.property(hubAmount, hubRateValue, fc.constantFrom('USD', 'SYP'), (amount, rate, from) => {
        const to = from === 'USD' ? 'SYP' : 'USD';
        const expected = hubConvertMinor(amount, from, rate);
        // Above the stored range Mizan refuses instead of returning a number Hub could not hold.
        if (expected > 2n ** 63n - 1n) return;
        expect(mizan(amount, from, to, rate)).toBe(expected);
      }),
      { numRuns: 2_000 },
    );
  });
});
