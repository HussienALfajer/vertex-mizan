import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  type CrossRate,
  CURRENCY_CODES,
  type CurrencyCode,
  convert,
  currencies,
  type ExchangeRate,
  exactConversion,
  money,
} from './money.js';
import { MINOR_MAX, type Ratio, scaleMinor } from './money-arithmetic.js';

/**
 * The ADR 0007 properties of the conversion: exactness (one rounding, half away from zero), sign
 * symmetry, and a conversion and its inverse within half a minor unit of the intermediate currency.
 * The expected values are computed here from the generated digits, not by the code under test.
 */

const abs = (value: bigint) => (value < 0n ? -value : value);

/** A rate as generated: `units × 10^-scale`, with up to 12 integer digits and 10 decimals. */
const rateDigits = fc
  .integer({ min: 0, max: 10 })
  .chain((scale) =>
    fc.bigInt({ min: 1n, max: 10n ** BigInt(12 + scale) - 1n }).map((units) => ({ units, scale })),
  );

function rateText({ units, scale }: { units: bigint; scale: number }): string {
  const digits = units.toString().padStart(scale + 1, '0');
  return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

const pair = fc
  .tuple(fc.constantFrom(...CURRENCY_CODES), fc.constantFrom(...CURRENCY_CODES))
  .filter(([base, quote]) => base !== quote);

const amount = fc.oneof(
  fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
  fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }),
);

function quote(base: CurrencyCode, quoteCurrency: CurrencyCode, rate: string): ExchangeRate {
  return {
    effectiveOn: '2026-10-20',
    base,
    quote: quoteCurrency,
    rate,
    type: 'market',
    source: 'manual',
  };
}

/** The exact value `amount × ratio`, rescaled between exponents, as a fraction N / D (D > 0). */
function exact(amountMinor: bigint, ratio: Ratio, fromExponent: number, toExponent: number) {
  return {
    numerator: amountMinor * ratio.numerator * 10n ** BigInt(toExponent),
    denominator: ratio.denominator * 10n ** BigInt(fromExponent),
  };
}

/** `result` is the exact value rounded half away from zero. */
function expectRounded(result: bigint, value: { numerator: bigint; denominator: bigint }) {
  const error = abs(2n * (value.numerator - result * value.denominator));
  expect(error <= value.denominator).toBe(true);
  // A tie goes away from zero.
  if (error === value.denominator)
    expect(abs(result * value.denominator) > abs(value.numerator)).toBe(true);
  if (value.numerator % value.denominator === 0n)
    expect(result).toBe(value.numerator / value.denominator);
}

/** Runs a conversion; `null` when it is refused for leaving the stored range. */
function convertOrOutOfRange(...args: Parameters<typeof convert>): bigint | null {
  try {
    return convert(...args).amountMinor;
  } catch (error) {
    if (error instanceof DomainError && error.code === 'AMOUNT_OUT_OF_RANGE') return null;
    throw error;
  }
}

describe('convert properties', () => {
  it('is exact: one rounding of the exact value, half away from zero, refused only out of range', () => {
    fc.assert(
      fc.property(
        amount,
        rateDigits,
        pair,
        fc.boolean(),
        (x, digits, [base, quoteCurrency], forward) => {
          const [from, to] = forward ? [base, quoteCurrency] : [quoteCurrency, base];
          const unit = 10n ** BigInt(digits.scale);
          const ratio = forward
            ? { numerator: digits.units, denominator: unit }
            : { numerator: unit, denominator: digits.units };
          const value = exact(x, ratio, currencies[from].exponent, currencies[to].exponent);
          const result = convertOrOutOfRange(
            money(x, from),
            to,
            quote(base, quoteCurrency, rateText(digits)),
          );
          if (result === null) {
            expect(abs(value.numerator) * 2n >= (2n * MINOR_MAX + 1n) * value.denominator).toBe(
              true,
            );
            return;
          }
          expectRounded(result, value);
        },
      ),
      { numRuns: 5_000 },
    );
  });

  it('exposes the exact value it rounds through exactConversion()', () => {
    fc.assert(
      fc.property(amount, rateDigits, pair, (x, digits, [base, quoteCurrency]) => {
        const rate = quote(base, quoteCurrency, rateText(digits));
        const ratio = { numerator: digits.units, denominator: 10n ** BigInt(digits.scale) };
        const value = exact(
          x,
          ratio,
          currencies[base].exponent,
          currencies[quoteCurrency].exponent,
        );
        const result = exactConversion(money(x, base), quoteCurrency, rate);
        expect(result.denominator > 0n).toBe(true);
        expect(result.numerator * value.denominator).toBe(value.numerator * result.denominator);
      }),
      { numRuns: 2_000 },
    );
  });

  it('is exact for any pair of exponents', () => {
    const exponent = fc.integer({ min: 0, max: 4 });
    fc.assert(
      fc.property(amount, rateDigits, exponent, exponent, (x, digits, fromExponent, toExponent) => {
        const ratio = { numerator: digits.units, denominator: 10n ** BigInt(digits.scale) };
        const result = scaleMinor(x, ratio, fromExponent, toExponent);
        expectRounded(result, exact(x, ratio, fromExponent, toExponent));
      }),
      { numRuns: 5_000 },
    );
  });

  it('is symmetric in sign: converting −x gives −convert(x)', () => {
    fc.assert(
      fc.property(amount, rateDigits, pair, (x, digits, [base, quoteCurrency]) => {
        const rate = quote(base, quoteCurrency, rateText(digits));
        for (const [from, to] of [
          [base, quoteCurrency],
          [quoteCurrency, base],
        ] as const) {
          const positive = convertOrOutOfRange(money(x, from), to, rate);
          const negative = convertOrOutOfRange(money(-x, from), to, rate);
          expect(negative).toBe(positive === null ? null : -positive);
        }
      }),
      { numRuns: 3_000 },
    );
  });

  it('round-trips within half a minor unit of the intermediate currency, plus the final rounding', () => {
    fc.assert(
      fc.property(amount, rateDigits, pair, (x, digits, [base, quoteCurrency]) => {
        const rate = quote(base, quoteCurrency, rateText(digits));
        const there = convertOrOutOfRange(money(x, base), quoteCurrency, rate);
        if (there === null) return;
        const back = convertOrOutOfRange(money(there, quoteCurrency), base, rate);
        if (back === null) return;
        // One quote minor unit is D / N base minor units, with N / D the base→quote factor.
        const n = digits.units * 10n ** BigInt(currencies[quoteCurrency].exponent);
        const d = 10n ** BigInt(digits.scale) * 10n ** BigInt(currencies[base].exponent);
        // The exact inverse of `there` is within half a quote unit of x: |there/k − x| ≤ ½·D/N.
        expect(abs(2n * (there * d - x * n)) <= d).toBe(true);
        // Rounded back: |back − x| ≤ ½ + ½·D/N.
        expect(2n * n * abs(back - x) <= n + d).toBe(true);
        // Through a finer intermediate unit (D < N) the round trip is lossless.
        if (d < n) expect(back).toBe(x);
      }),
      { numRuns: 5_000 },
    );
  });
});

describe('cross rate properties', () => {
  const thirdCurrency = fc
    .tuple(
      fc.constantFrom(...CURRENCY_CODES),
      fc.constantFrom(...CURRENCY_CODES),
      fc.constantFrom(...CURRENCY_CODES),
    )
    .filter(([from, via, to]) => new Set([from, via, to]).size === 3);

  it('rounds the exact product of both quotes once, whichever way each is quoted', () => {
    fc.assert(
      fc.property(
        amount,
        thirdCurrency,
        rateDigits,
        rateDigits,
        fc.boolean(),
        fc.boolean(),
        (x, [from, via, to], first, second, firstFromBase, secondFromBase) => {
          const legs: CrossRate = {
            on: '2026-10-20',
            legs: [
              firstFromBase ? quote(from, via, rateText(first)) : quote(via, from, rateText(first)),
              secondFromBase ? quote(via, to, rateText(second)) : quote(to, via, rateText(second)),
            ],
          };
          const factor = (digits: typeof first, fromBase: boolean): Ratio => {
            const unit = 10n ** BigInt(digits.scale);
            return fromBase
              ? { numerator: digits.units, denominator: unit }
              : { numerator: unit, denominator: digits.units };
          };
          const a = factor(first, firstFromBase);
          const b = factor(second, secondFromBase);
          const ratio = {
            numerator: a.numerator * b.numerator,
            denominator: a.denominator * b.denominator,
          };
          const result = convertOrOutOfRange(money(x, from), to, legs);
          if (result === null) return;
          expectRounded(
            result,
            exact(x, ratio, currencies[from].exponent, currencies[to].exponent),
          );
          expect(convertOrOutOfRange(money(-x, from), to, legs)).toBe(-result);
        },
      ),
      { numRuns: 3_000 },
    );
  });

  it('never converts a currency to itself through an intermediate one', () => {
    fc.assert(
      fc.property(
        amount,
        pair,
        rateDigits,
        rateDigits,
        fc.boolean(),
        fc.boolean(),
        (x, [from, via], first, second, firstFromBase, secondFromBase) => {
          const legs: CrossRate = {
            on: '2026-10-20',
            legs: [
              firstFromBase ? quote(from, via, rateText(first)) : quote(via, from, rateText(first)),
              secondFromBase
                ? quote(via, from, rateText(second))
                : quote(from, via, rateText(second)),
            ],
          };
          expect(() => convert(money(x, from), from, legs)).toThrow(
            expect.objectContaining({ code: 'RATE_PAIR_MISMATCH' }),
          );
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
