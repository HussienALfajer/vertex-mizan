import { DomainError, money } from '@vertex-mizan/contracts';
import type { CarriedAmounts, Line } from './lines.js';
import { abs, share } from './share.js';

/**
 * Carried amounts (ADR 0007): a line that releases, clears, settles or reverses an existing
 * balance carries that balance's own book and parallel amounts. They are never converted again
 * (IAS 21.23(b), IFRIC 22), and a balance whose transaction amount reaches zero is zero in every
 * ledger.
 */

function sign(value: bigint): -1 | 0 | 1 {
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}

/**
 * The amounts of the line that clears `movementMinor` of an open item, signed as that line (against
 * the item). `carrying` is what the item carries now: its open transaction amount, signed as the
 * item, and its carrying amount in each ledger, without month-end revaluations (they reverse;
 * S07). Each ledger clears in proportion to what remains, `carrying × movement ÷ open`, rounded half
 * away from zero, and the movement that clears all that is open clears everything left in every
 * ledger (ADR 0013, amending ADR 0007's cumulative rule): a void is an exact reversal, and the next
 * clearing starts from what the ledger holds. No rate is read (IAS 21.23(b)). Refuses more than is
 * open (`RELEASE_EXCEEDS_BALANCE`); a movement with the item's sign is the caller's to refuse.
 *
 * A balance is split by one method only: a schedule known in advance (a deferral's months, a
 * deposit's milestones) with `allocateCarried()`, movements as they come with `clearOpenItem()`.
 * The two round differently, so mixing them on one balance would leave a remainder.
 */
export function clearOpenItem(carrying: CarriedAmounts, movementMinor: bigint): CarriedAmounts {
  const open = carrying.transaction.amountMinor;
  const { bookMinor, parallelMinor } = carrying;
  if (open === 0n && (bookMinor !== 0n || (parallelMinor !== null && parallelMinor !== 0n))) {
    throw new RangeError('A settled item that is not zero in a ledger');
  }
  if (movementMinor === 0n || (open !== 0n && sign(movementMinor) === sign(open))) {
    throw new RangeError('A clearing movement that would add to its item, or clear nothing');
  }
  if (abs(movementMinor) > abs(open)) {
    throw new DomainError(
      'RELEASE_EXCEEDS_BALANCE',
      'The movement clears more than the item has open',
      { openMinor: open.toString(), movementMinor: movementMinor.toString() },
    );
  }
  const clearsAll = -movementMinor === open;
  const part = (amount: bigint) => (clearsAll ? -amount : share(amount, movementMinor, open));
  return {
    transaction: money(movementMinor, carrying.transaction.currency),
    bookMinor: part(bookMinor),
    parallelMinor: parallelMinor === null ? null : part(parallelMinor),
  };
}

/** A movement on a running balance, split into what it clears and what it adds. */
export interface RunningMovement {
  /**
   * The line amounts that clear the balance at its average carrying amount, signed as the
   * movement; null when the movement only adds to the balance.
   */
  readonly cleared: CarriedAmounts | null;
  /**
   * The transaction amount the movement adds, to be measured new at the movement's rates: all of
   * it when it runs with the balance or the balance is zero, the excess when it crosses zero.
   */
  readonly measuredMinor: bigint;
}

/**
 * Splits a movement on a balance kept per counterparty (client ad funds; ADR 0007). Against the
 * balance, it clears book and parallel amounts in proportion to the transaction balance before it,
 * the average carrying amount, rounded half away from zero; clearing the whole transaction
 * balance clears every ledger exactly. A movement that crosses zero clears the balance in full,
 * and the excess is a new measurement.
 */
export function moveRunningBalance(
  balance: CarriedAmounts,
  movementMinor: bigint,
): RunningMovement {
  const { transaction, bookMinor, parallelMinor } = balance;
  const total = transaction.amountMinor;
  if (total === 0n && (bookMinor !== 0n || (parallelMinor !== null && parallelMinor !== 0n))) {
    throw new RangeError('A zero transaction balance that is not zero in a ledger');
  }
  if (movementMinor === 0n || sign(movementMinor) !== -sign(total)) {
    return { cleared: null, measuredMinor: movementMinor };
  }
  const clearsAll = abs(movementMinor) >= abs(total);
  const part = (amount: bigint) => (clearsAll ? -amount : share(amount, movementMinor, total));
  const clearedMinor = clearsAll ? -total : movementMinor;
  return {
    cleared: {
      transaction: money(clearedMinor, transaction.currency),
      bookMinor: part(bookMinor),
      parallelMinor: parallelMinor === null ? null : part(parallelMinor),
    },
    measuredMinor: movementMinor - clearedMinor,
  };
}

/**
 * The lines of an entry's reversal: every amount negated exactly, and everything else kept, so
 * the reversal mirrors the original line by line (ADR 0005, invariant 3). Nothing is converted
 * again: a measured line keeps the record of the rate its original amount was converted at.
 */
export function reverseLines(lines: readonly Line[]): Line[] {
  return lines.map((line) => ({
    ...line,
    transaction: money(-line.transaction.amountMinor, line.transaction.currency),
    bookMinor: -line.bookMinor,
    parallelMinor: line.parallelMinor === null ? null : -line.parallelMinor,
  }));
}
