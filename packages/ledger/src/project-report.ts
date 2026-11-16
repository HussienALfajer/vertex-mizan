import { type CurrencyCode, currencies, divideHalfAwayFromZero } from '@vertex-mizan/contracts';
import { allocate } from './allocation.js';

/**
 * The project report's presentation (S12 "Reports", `docs/scenarios/reports/project-report.md`):
 * every figure is a sum of stored ledger amounts read in `packages/db`; this module only derives
 * the variances, the shares and the averages, rounding nothing but those.
 */

/** `numerator / denominator` with `places` decimals, half away from zero; null over zero. */
export function decimalShare(
  numerator: bigint,
  denominator: bigint,
  places: number,
): string | null {
  if (denominator === 0n) return null;
  const scale = 10n ** BigInt(places);
  // The money module divides by a positive denominator: a negative one moves its sign up.
  const units =
    denominator > 0n
      ? divideHalfAwayFromZero(numerator * scale, denominator)
      : divideHalfAwayFromZero(-numerator * scale, -denominator);
  const sign = units < 0n ? '-' : '';
  const magnitude = units < 0n ? -units : units;
  const fraction = (magnitude % scale).toString().padStart(places, '0');
  return places === 0 ? `${sign}${magnitude}` : `${sign}${magnitude / scale}.${fraction}`;
}

/** A part's share of a whole as a percentage with one decimal ("30.0"); null without a whole. */
export function percentOf(part: bigint, whole: bigint): string | null {
  return decimalShare(part * 100n, whole, 1);
}

/** A quantity in thousandths as its text with 3 places ("12.500", "-5.000", "0.000"). */
export function quantityText(thousandths: bigint): string {
  const sign = thousandths < 0n ? '-' : '';
  const magnitude = thousandths < 0n ? -thousandths : thousandths;
  return `${sign}${magnitude / 1000n}.${(magnitude % 1000n).toString().padStart(3, '0')}`;
}

/**
 * The average unit cost of a material in its transaction currency, with 4 places: the amount over
 * the net quantity, half away from zero; null at a net quantity of zero.
 */
export function averageUnitCost(
  amountMinor: bigint,
  currency: CurrencyCode,
  quantityThousandths: bigint,
): string | null {
  const minor = 10n ** BigInt(currencies[currency].exponent);
  return decimalShare(amountMinor * 1000n, minor * quantityThousandths, 4);
}

/** A direct cost's figures against its budget (S12 answer 15). */
export interface ProjectCostInput {
  readonly inRange: bigint;
  readonly toDate: bigint;
  /** The budget in the terms' currency, zero without one. */
  readonly budget: bigint;
}

export interface ProjectCostFiguresValue extends ProjectCostInput {
  /** The budget less the cost to date; null when no variance is shown. */
  readonly variance: bigint | null;
  /** The cost to date over the budget, one decimal; null when no variance is shown or no budget. */
  readonly used: string | null;
}

/**
 * Whether the budget is compared with the actual costs: only when the terms are in the book
 * currency and the report reads the book ledger (S12 answer 15), never in a parallel ledger even
 * in the terms' currency.
 */
export function showsVariance(input: {
  readonly termsCurrency: CurrencyCode | null;
  readonly bookCurrency: CurrencyCode;
  readonly ledger: 'book' | 'parallel';
}): boolean {
  return input.ledger === 'book' && input.termsCurrency === input.bookCurrency;
}

function costFigures(row: ProjectCostInput, variance: boolean): ProjectCostFiguresValue {
  return {
    ...row,
    variance: variance ? row.budget - row.toDate : null,
    used: variance ? percentOf(row.toDate, row.budget) : null,
  };
}

/** Each direct-cost account's figures and their totals, which sum the rows. */
export function projectCosts<T extends ProjectCostInput>(
  rows: readonly T[],
  variance: boolean,
): { rows: (T & ProjectCostFiguresValue)[]; totals: ProjectCostFiguresValue } {
  let inRange = 0n;
  let toDate = 0n;
  let budget = 0n;
  for (const row of rows) {
    inRange += row.inRange;
    toDate += row.toDate;
    budget += row.budget;
  }
  return {
    rows: rows.map((row) => ({ ...row, ...costFigures(row, variance) })),
    totals: costFigures({ inRange, toDate, budget }, variance),
  };
}

/** A billing's net due: its period's value less its retention and its recovery (S12 rule 15). */
export function billingNet(input: {
  readonly cumulative: bigint;
  readonly previous: bigint;
  readonly retention: bigint;
  readonly advance: bigint;
}): { period: bigint; net: bigint } {
  const period = input.cumulative - input.previous;
  return { period, net: period - input.retention - input.advance };
}

/** A balance read as a net debit, shown positive on its own side: a credit balance negated. */
export function onItsSide(netDebit: bigint, side: 'debit' | 'credit'): bigint {
  return side === 'debit' ? netDebit : -netDebit;
}

/** A rate in basis points as a percentage with up to 2 decimals, no trailing zero ("10", "12.5"). */
export function basisPointsText(basisPoints: number): string {
  const text = decimalShare(BigInt(basisPoints), 100n, 2) ?? '0';
  return text.replace(/\.?0+$/, '');
}

/**
 * A running item's remeasurement shared over its projects (owner, 2026-11-16; IAS 21.23): a
 * running item (a subcontractor's retentions on `211006`) is held per counterparty and currency
 * over all its projects, and its month-end revaluation is posted on the counterparty alone, with
 * no project. What the item carries beyond its projects' own lines (`unassigned`) is shared over
 * the projects in proportion to each project's balance in the item's currency on the item's side,
 * with cumulative rounding in the order given (`allocate()`), so the shares sum to it exactly.
 * A project with no balance on that side takes none; with none at all, nothing is shared.
 */
export function shareRunningRemeasurement(
  unassigned: bigint,
  balances: readonly { readonly key: string; readonly amount: bigint }[],
): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  const total = balances.reduce((sum, balance) => sum + balance.amount, 0n);
  if (unassigned === 0n || total === 0n) return shares;
  const weights = balances.map((balance) =>
    balance.amount > 0n === total > 0n && balance.amount !== 0n
      ? balance.amount > 0n
        ? balance.amount
        : -balance.amount
      : 0n,
  );
  if (weights.every((weight) => weight === 0n)) return shares;
  const parts = allocate(unassigned, weights);
  balances.forEach((balance, index) => {
    shares.set(balance.key, parts[index] ?? 0n);
  });
  return shares;
}
