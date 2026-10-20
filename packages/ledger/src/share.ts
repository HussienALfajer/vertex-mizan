import { divideHalfAwayFromZero } from '@vertex-mizan/contracts';

/**
 * `total × part ÷ whole`, rounded half away from zero once, on the exact value (ADR 0007): the
 * rounding of every allocation and proportional release. `whole` may have either sign but is not
 * zero. Internal: not re-exported from `index.ts`.
 */
export function share(total: bigint, part: bigint, whole: bigint): bigint {
  if (whole === 0n) throw new RangeError('A share of a zero whole');
  return whole < 0n
    ? divideHalfAwayFromZero(-(total * part), -whole)
    : divideHalfAwayFromZero(total * part, whole);
}

export function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
