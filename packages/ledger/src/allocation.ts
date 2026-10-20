import { money } from '@vertex-mizan/contracts';
import type { CarriedAmounts } from './lines.js';
import { share } from './share.js';

function totalWeight(weights: readonly bigint[]): bigint {
  let whole = 0n;
  for (const weight of weights) {
    if (weight < 0n) throw new RangeError('A negative allocation weight');
    whole += weight;
  }
  if (whole === 0n) throw new RangeError('Allocation weights that sum to zero');
  return whole;
}

/**
 * Splits `total` by `weights` with cumulative rounding (ADR 0007): part k is
 * round(total × W_k ÷ W) − round(total × W_{k−1} ÷ W), where W_k is the sum of the weights up to k
 * and W the sum of all of them, rounded half away from zero. The parts sum to `total` exactly, and
 * each depends only on the weights, so a recomputation never changes a part already posted.
 * Weights are non-negative and not all zero: days of each month, milestone installments.
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const whole = totalWeight(weights);
  const parts: bigint[] = [];
  let cumulative = 0n;
  let allocated = 0n;
  for (const weight of weights) {
    cumulative += weight;
    const upTo = share(total, cumulative, whole);
    parts.push(upTo - allocated);
    allocated = upTo;
  }
  return parts;
}

/**
 * Splits a carried balance by `weights` (a deferral across the months of its service period, a
 * deposit across milestones). Each ledger's amount is allocated separately with the same weights
 * (ADR 0007), so every part's amounts come from the balance and are never converted again.
 */
export function allocateCarried(
  amounts: CarriedAmounts,
  weights: readonly bigint[],
): CarriedAmounts[] {
  const whole = totalWeight(weights);
  const { transaction, bookMinor, parallelMinor } = amounts;
  const upTo = (cumulative: bigint) => ({
    transaction: share(transaction.amountMinor, cumulative, whole),
    book: share(bookMinor, cumulative, whole),
    parallel: parallelMinor === null ? null : share(parallelMinor, cumulative, whole),
  });
  const parts: CarriedAmounts[] = [];
  let cumulative = 0n;
  let before = upTo(0n);
  for (const weight of weights) {
    cumulative += weight;
    const after = upTo(cumulative);
    parts.push({
      transaction: money(after.transaction - before.transaction, transaction.currency),
      bookMinor: after.book - before.book,
      parallelMinor:
        after.parallel === null || before.parallel === null
          ? null
          : after.parallel - before.parallel,
    });
    before = after;
  }
  return parts;
}
