import type { CurrencyCode, Money } from './money.js';
import { divideHalfAwayFromZero } from './money-arithmetic.js';

/**
 * The summary of a selection of amounts (ADR 0010 §4: the grid's selection summary bar): count,
 * sum, average, minimum and maximum, one summary per currency, because amounts in different
 * currencies are never added. The sum is exact; the average is rounded once, half away from zero.
 */
export interface MoneySummary {
  readonly currency: CurrencyCode;
  readonly count: number;
  readonly sumMinor: bigint;
  readonly averageMinor: bigint;
  readonly minMinor: bigint;
  readonly maxMinor: bigint;
}

/** One summary per currency, in the order each currency first appears. */
export function summarizeAmounts(amounts: readonly Money[]): MoneySummary[] {
  const byCurrency = new Map<
    CurrencyCode,
    { count: bigint; sum: bigint; min: bigint; max: bigint }
  >();
  for (const { amountMinor, currency } of amounts) {
    const seen = byCurrency.get(currency);
    if (!seen) {
      byCurrency.set(currency, { count: 1n, sum: amountMinor, min: amountMinor, max: amountMinor });
      continue;
    }
    seen.count += 1n;
    seen.sum += amountMinor;
    if (amountMinor < seen.min) seen.min = amountMinor;
    if (amountMinor > seen.max) seen.max = amountMinor;
  }
  return [...byCurrency].map(([currency, { count, sum, min, max }]) => ({
    currency,
    count: Number(count),
    sumMinor: sum,
    averageMinor: divideHalfAwayFromZero(sum, count),
    minMinor: min,
    maxMinor: max,
  }));
}
