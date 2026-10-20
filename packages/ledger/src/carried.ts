import { DomainError, money } from '@vertex-mizan/contracts';
import type { CarriedAmounts, Line } from './lines.js';
import { abs, share } from './share.js';

/**
 * Carried amounts (ADR 0007): a line that releases, clears, settles or reverses an existing
 * balance carries that balance's own book and parallel amounts. They are never converted again
 * (IAS 21.23(b), IFRIC 22), and a balance whose transaction amount reaches zero is zero in every
 * ledger.
 */

/** An open item measured once (an invoice's receivable, a contract asset, a contract liability). */
export interface OpenItem {
  /** The amounts the item was measured at. Month-end revaluations reverse, so they are not here. */
  readonly measured: CarriedAmounts;
  /** The transaction amount still open, signed as the item. */
  readonly openMinor: bigint;
}

function sign(value: bigint): -1 | 0 | 1 {
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}

function checkOpenItem({ measured, openMinor }: OpenItem): void {
  const total = measured.transaction.amountMinor;
  if (total === 0n) throw new RangeError('An open item measured at zero');
  if (sign(openMinor) === -sign(total) || abs(openMinor) > abs(total)) {
    throw new RangeError('An open amount outside its item');
  }
}

/** The item's ledger amounts with `cleared` of its transaction amount cleared, cumulatively rounded. */
function remaining(item: OpenItem, cleared: bigint): CarriedAmounts {
  const { transaction, bookMinor, parallelMinor } = item.measured;
  const total = transaction.amountMinor;
  return {
    transaction: money(total - cleared, transaction.currency),
    bookMinor: bookMinor - share(bookMinor, cleared, total),
    parallelMinor:
      parallelMinor === null ? null : parallelMinor - share(parallelMinor, cleared, total),
  };
}

/**
 * An open item's carrying amount in each ledger: the amounts it was measured at, less what was
 * cleared before, in proportion to the transaction amount cleared with cumulative rounding.
 */
export function openItemCarrying(item: OpenItem): CarriedAmounts {
  checkOpenItem(item);
  return remaining(item, item.measured.transaction.amountMinor - item.openMinor);
}

/**
 * The amounts of the line that clears `movementMinor` of an open item, signed as that line (against
 * the item). Each ledger clears in proportion to the transaction amount, with cumulative rounding
 * over everything cleared so far, so the parts sum exactly and the last part clears whatever
 * remains (ADR 0007). Refuses more than is open (`RELEASE_EXCEEDS_BALANCE`).
 */
export function clearOpenItem(item: OpenItem, movementMinor: bigint): CarriedAmounts {
  checkOpenItem(item);
  const total = item.measured.transaction.amountMinor;
  if (sign(movementMinor) === sign(total)) {
    throw new RangeError('A clearing movement that would add to its item');
  }
  if (abs(movementMinor) > abs(item.openMinor)) {
    throw new DomainError(
      'RELEASE_EXCEEDS_BALANCE',
      'The movement clears more than the item has open',
      { openMinor: item.openMinor.toString(), movementMinor: movementMinor.toString() },
    );
  }
  const clearedBefore = total - item.openMinor;
  const before = remaining(item, clearedBefore);
  const after = remaining(item, clearedBefore - movementMinor);
  return {
    transaction: money(movementMinor, item.measured.transaction.currency),
    bookMinor: after.bookMinor - before.bookMinor,
    parallelMinor:
      before.parallelMinor === null || after.parallelMinor === null
        ? null
        : after.parallelMinor - before.parallelMinor,
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
