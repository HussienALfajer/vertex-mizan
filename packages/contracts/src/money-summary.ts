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

/**
 * A line's signed amount as an entry's debit and credit columns show it (S03): a positive amount
 * is a debit, a negative one a credit, each column a magnitude; an empty amount empties both.
 */
export function debitCreditOf(amountMinor: bigint | null): {
  debitMinor: bigint | null;
  creditMinor: bigint | null;
} {
  if (amountMinor === null) return { debitMinor: null, creditMinor: null };
  return amountMinor < 0n
    ? { debitMinor: null, creditMinor: -amountMinor }
    : { debitMinor: amountMinor, creditMinor: null };
}

/** The signed amount of a magnitude typed in the debit or the credit column. */
export function signedAmount(side: 'debit' | 'credit', magnitudeMinor: bigint): bigint {
  return side === 'credit' ? -magnitudeMinor : magnitudeMinor;
}

/**
 * An entry's totals in one transaction currency: the debits, the credits (as a magnitude) and the
 * residual (debits less credits), zero when the currency balances (S03 rule 14).
 */
export interface CurrencyTotals {
  readonly currency: CurrencyCode;
  readonly debitMinor: bigint;
  readonly creditMinor: bigint;
  readonly residualMinor: bigint;
}

/** The totals per currency of signed line amounts, in the order each currency first appears. */
export function entryTotals(amounts: readonly Money[]): CurrencyTotals[] {
  const byCurrency = new Map<CurrencyCode, { debit: bigint; credit: bigint }>();
  for (const { amountMinor, currency } of amounts) {
    const totals = byCurrency.get(currency) ?? { debit: 0n, credit: 0n };
    if (amountMinor < 0n) totals.credit -= amountMinor;
    else totals.debit += amountMinor;
    byCurrency.set(currency, totals);
  }
  return [...byCurrency].map(([currency, { debit, credit }]) => ({
    currency,
    debitMinor: debit,
    creditMinor: credit,
    residualMinor: debit - credit,
  }));
}

/**
 * The signed amount a line in `currency` needs so that the entry's other lines in that currency
 * balance (the entry screen's `=`): minus their sum; zero when they already balance.
 */
export function balancingAmount(others: readonly Money[], currency: CurrencyCode): bigint {
  let sum = 0n;
  for (const line of others) if (line.currency === currency) sum += line.amountMinor;
  return -sum;
}
