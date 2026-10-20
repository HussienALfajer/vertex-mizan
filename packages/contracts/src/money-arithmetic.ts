/**
 * The exact integer arithmetic behind `money.ts`. Internal to the package (not re-exported from
 * `index.ts`), so that `convert()` stays the one public conversion; the property tests drive it
 * directly with exponents the currency table does not have yet.
 */

/**
 * The range of a stored amount: PostgreSQL `bigint`, made symmetric (−(2⁶³ − 1) to 2⁶³ − 1) so
 * that a reversal can always negate an amount exactly.
 */
export const MINOR_MAX = 2n ** 63n - 1n;
export const MINOR_MIN = -MINOR_MAX;

/** A rate as an exact fraction: units of the target currency per one unit of the source. */
export interface Ratio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** `numerator ÷ denominator`, rounded half away from zero (1.5 → 2, −1.5 → −2); `denominator` > 0. */
export function divideHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  // BigInt division truncates toward zero and the remainder takes the numerator's sign.
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

/**
 * An amount in minor units of a currency with `fromExponent` decimals, times `ratio`, in minor
 * units of a currency with `toExponent` decimals. One exact division, one rounding.
 */
export function scaleMinor(
  amountMinor: bigint,
  ratio: Ratio,
  fromExponent: number,
  toExponent: number,
): bigint {
  return divideHalfAwayFromZero(
    amountMinor * ratio.numerator * 10n ** BigInt(toExponent),
    ratio.denominator * 10n ** BigInt(fromExponent),
  );
}
