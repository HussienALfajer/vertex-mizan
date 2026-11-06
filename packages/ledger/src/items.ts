import {
  type CurrencyCode,
  DomainError,
  type ItemKind,
  type ItemSource,
  type Money,
  money,
} from '@vertex-mizan/contracts';
import { differenceLine, type RealisedTargets, realisedDifferenceLines } from './balance.js';
import { clearOpenItem, moveRunningBalance } from './carried.js';
import {
  type CarriedAmounts,
  carriedLine,
  type Dimensions,
  type ItemRef,
  keptLedgers,
  type Line,
  ledgerAmount,
  ledgerCurrency,
  negate,
} from './lines.js';
import { type MeasureContext, measure, measuredLine } from './measure.js';

/**
 * Open items behind the control accounts (S04, ADR 0013): the lines that open, clear and move
 * them, and the exchange difference that follows the void of a movement on a running item. The
 * posting function reads each item's balance row `FOR UPDATE`, calls these functions and stores one
 * movement per item line, with the line's three amounts; the item's balance is the sum of its
 * movements, so it is always its carrying amount.
 */

/** An item as a line moves it: what it carries now, without month-end revaluations (S07). */
export interface ItemState {
  readonly id: string;
  readonly kind: ItemKind;
  /**
   * A document item's opening sign: 1 for a debit item (a receivable), −1 for a credit item; null
   * for a running item, and for a document item the line opens.
   */
  readonly direction: 1 | -1 | null;
  /**
   * A document item the line opens: the sign of its account's normal balance, the one its opening
   * must have (S04 rule 2, ADR 0013): a receivable opens as a debit, so a client's advance is never
   * a credit item on a receivable account (IFRS 15.106, IAS 1.32).
   */
  readonly opensAs?: 1 | -1;
  /** Its open transaction amount and its carrying amount in each ledger. */
  readonly balance: CarriedAmounts;
}

/** Where an item line goes: the item's account and its dimensions. */
export interface ItemTarget {
  readonly account: string;
  readonly dimensions: Dimensions;
}

/** The lines of one movement on an item and what the item carries after it. */
export interface ItemMove {
  readonly lines: readonly Line[];
  readonly after: ItemState;
}

function sign(value: bigint): -1 | 0 | 1 {
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}

/** Nothing yet: a new item's balance, before the line that opens or first moves it. */
export function emptyBalance(currency: CurrencyCode, keepsParallel: boolean): CarriedAmounts {
  return {
    transaction: money(0n, currency),
    bookMinor: 0n,
    parallelMinor: keepsParallel ? 0n : null,
  };
}

function plus(balance: CarriedAmounts, lines: readonly Line[]): CarriedAmounts {
  let { bookMinor, parallelMinor } = balance;
  let amount = balance.transaction.amountMinor;
  for (const line of lines) {
    amount += line.transaction.amountMinor;
    bookMinor += line.bookMinor;
    parallelMinor =
      parallelMinor === null || line.parallelMinor === null
        ? null
        : parallelMinor + line.parallelMinor;
  }
  return { transaction: money(amount, balance.transaction.currency), bookMinor, parallelMinor };
}

/**
 * The net movement of `lines` on the item `id`: the sum of the lines that move it, from nothing in
 * its currency (a reversal's movement on a running item, for S04 rule 13).
 */
export function movementOn(
  lines: readonly Line[],
  id: string,
  currency: CurrencyCode,
  keepsParallel: boolean,
): CarriedAmounts {
  return plus(
    emptyBalance(currency, keepsParallel),
    lines.filter((line) => line.item?.id === id),
  );
}

/**
 * The lines of a movement of `amount` on an item (S04 rules 2–4), in the line's sign:
 * - a document item the line opens: a new measurement at each ledger's policy or dealt rate
 *   (`open`), with the sign of its account's normal balance (`OPEN_ITEM_DIRECTION` otherwise: an
 *   advance is a liability, never a credit item on a receivable account; ADR 0013);
 * - a document item already open: a clearing toward zero at its carrying amount, in proportion to
 *   what remains (`clear`, `clearOpenItem()`). A line with the item's sign is refused
 *   (`OPEN_ITEM_DIRECTION`: a second invoice is a second item), and so is clearing more than is
 *   open (`RELEASE_EXCEEDS_BALANCE`);
 * - a running item: with the balance or on a zero balance, a new measurement (`add`); against it, a
 *   clearing at the average carrying amount (`clear`); across zero, the clearing of the whole
 *   balance and then the excess as a new measurement (ADR 0007, `moveRunningBalance()`).
 *
 * Only the new measurements read a rate. The line's currency is the item's: the posting function
 * refuses another (`OPEN_ITEM_MISMATCH`) before.
 */
export function moveItem(
  item: ItemState,
  target: ItemTarget,
  amount: Money,
  context: MeasureContext,
): ItemMove {
  if (amount.currency !== item.balance.transaction.currency) {
    throw new TypeError("A movement in another currency than its item's");
  }
  if (amount.amountMinor === 0n) throw new RangeError('A movement of zero');
  const ref = (movement: ItemRef['movement']): ItemRef => ({ id: item.id, movement });
  const measured = (part: Money, movement: ItemRef['movement']): Line => ({
    ...measuredLine({ ...target, amount: part }, context),
    item: ref(movement),
  });
  const done = (lines: Line[], direction: ItemState['direction']): ItemMove => ({
    lines,
    // Once opened, an item's sign is its direction; `opensAs` was for its opening only.
    after: { id: item.id, kind: item.kind, direction, balance: plus(item.balance, lines) },
  });
  if (item.kind === 'document') {
    if (item.direction === null) {
      if (item.balance.transaction.amountMinor !== 0n) {
        throw new RangeError('A document item with a balance and no opening');
      }
      if (item.opensAs === undefined) {
        throw new TypeError("A new document item without its account's normal balance");
      }
      if (sign(amount.amountMinor) !== item.opensAs) {
        throw new DomainError(
          'OPEN_ITEM_DIRECTION',
          "A document item opens with its account's normal balance",
          { itemId: item.id },
        );
      }
      return done([measured(amount, 'open')], item.opensAs);
    }
    if (sign(amount.amountMinor) === item.direction) {
      throw new DomainError('OPEN_ITEM_DIRECTION', 'The line adds to a document item', {
        itemId: item.id,
      });
    }
    const amounts = clearOpenItem(item.balance, amount.amountMinor);
    return done([carriedLine({ ...target, amounts, item: ref('clear') })], item.direction);
  }
  const { cleared, measuredMinor } = moveRunningBalance(item.balance, amount.amountMinor);
  const lines: Line[] = [];
  if (cleared !== null)
    lines.push(carriedLine({ ...target, amounts: cleared, item: ref('clear') }));
  if (measuredMinor !== 0n) lines.push(measured(money(measuredMinor, amount.currency), 'add'));
  return done(lines, null);
}

/** The item a line names, as the posting function reads it, to check the line against it. */
export interface ItemRecord {
  readonly account: string;
  readonly currency: CurrencyCode;
  readonly dimensions: Dimensions;
  readonly source: ItemSource;
}

/**
 * Checks a manual line against the existing item it names (S04 rules 7–8): the line's account and
 * currency are the item's, and every dimension value it names is the item's value of that type,
 * since the line takes the item's dimensions (`OPEN_ITEM_MISMATCH`). A manual movement on an item
 * whose source is not manual (Hub's, the opening balances') needs a line memo
 * (`OPEN_ITEM_MEMO_REQUIRED`) and is stored as adjusted in Mizan: the answer says whether it is.
 */
export function checkItemLine(
  line: {
    readonly account: string;
    readonly currency: CurrencyCode;
    readonly dimensions: Dimensions;
    readonly memo: string | null;
  },
  item: ItemRecord,
): { readonly adjusted: boolean } {
  const named = Object.entries(line.dimensions);
  if (
    line.account !== item.account ||
    line.currency !== item.currency ||
    named.some(([type, value]) => item.dimensions[type] !== value)
  ) {
    throw new DomainError(
      'OPEN_ITEM_MISMATCH',
      "The line's account, currency or dimensions are not its item's",
      { account: item.account, currency: item.currency },
    );
  }
  if (item.source === 'manual') return { adjusted: false };
  if (line.memo === null || line.memo.trim() === '') {
    throw new DomainError(
      'OPEN_ITEM_MEMO_REQUIRED',
      `A manual movement on a ${item.source} item needs a line memo`,
      { source: item.source },
    );
  }
  return { adjusted: true };
}

/**
 * Refuses a new document item's due date before its document date, the entry date
 * (`VALIDATION_FAILED`, S04 rule 6; edge case 16). A later change may set any date (rule 15).
 */
export function checkDueDate(on: string, dueOn: string): void {
  if (dueOn < on) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `A due date ${dueOn} before the document date ${on}`,
      {
        on,
        dueOn,
      },
    );
  }
}

/** A running item a reversal moves, with what it carried before the reversal and what it moved. */
export interface VoidedRunningItem {
  readonly id: string;
  readonly target: ItemTarget;
  /** What the item carried just before the reversal. */
  readonly before: CarriedAmounts;
  /** The reversal's net movement on the item: the sum of its lines on the item. */
  readonly reversed: CarriedAmounts;
}

/**
 * The difference that follows a reversal's movement on a running item (S04 rule 13, ADR 0013), in
 * each ledger: what brings the item from where the exact reversal leaves it to the carrying amount
 * it would have if the void were a new movement under rule 3. Against the balance, the new movement
 * clears at the average carrying amount; across zero, it clears the whole balance and measures the
 * excess at the void date's policy rates (`context`, with no dealt or transaction rate). Null when
 * the reversal runs with the balance or onto a zero balance, where the item regains exactly what
 * the movement cleared (owner, 2026-11-06), and when the difference is zero in every ledger.
 */
export function runningVoidDifference(
  item: VoidedRunningItem,
  context: MeasureContext,
): CarriedAmounts | null {
  const { before, reversed } = item;
  const currency = before.transaction.currency;
  if (reversed.transaction.currency !== currency) {
    throw new TypeError("A reversal in another currency than its item's");
  }
  const movedMinor = reversed.transaction.amountMinor;
  const heldMinor = before.transaction.amountMinor;
  if (movedMinor === 0n || heldMinor === 0n || sign(movedMinor) === sign(heldMinor)) return null;
  const { cleared, measuredMinor } = moveRunningBalance(before, movedMinor);
  if (cleared === null) throw new Error('A movement against a balance that clears nothing');
  const excess =
    measuredMinor === 0n
      ? null
      : measure(money(measuredMinor, currency), {
          ledgers: context.ledgers,
          on: context.on,
          rates: context.rates,
          calendar: context.calendar,
        });
  const bookMinor = cleared.bookMinor + (excess?.bookMinor ?? 0n) - reversed.bookMinor;
  const parallelMinor =
    cleared.parallelMinor === null || reversed.parallelMinor === null
      ? null
      : cleared.parallelMinor + (excess?.parallelMinor ?? 0n) - reversed.parallelMinor;
  if (bookMinor === 0n && (parallelMinor === null || parallelMinor === 0n)) return null;
  return { transaction: money(0n, currency), bookMinor, parallelMinor };
}

/**
 * The lines of the exchange-difference entry that follows a reversal's movements on running items
 * (S04 rule 13), for each item that needs one (`runningVoidDifference()`):
 * - against the balance, a difference line per ledger on the item, with a transaction amount of
 *   zero (a `difference` movement): the clearing at the average reads no rate;
 * - across zero (owner, 2026-11-06), the item cleared to zero at what the exact reversal left (a
 *   carried `clear`), then the excess measured anew at the void date's policy rates (an `add`,
 *   with its conversions recorded, so a correction of that rate lists the entry, S02 rule 15).
 *
 * Then each ledger's residual as a realised difference by its sign (IAS 21.28). Either way the
 * item ends at the carrying amount of a new movement under rule 3. Empty when no item needs one;
 * the posting function then posts no entry.
 */
export function runningVoidDifferenceLines(
  items: readonly VoidedRunningItem[],
  context: MeasureContext,
  targets: RealisedTargets,
): Line[] {
  const { ledgers } = context;
  const policy: MeasureContext = {
    ledgers,
    on: context.on,
    rates: context.rates,
    calendar: context.calendar,
  };
  const lines: Line[] = [];
  for (const item of items) {
    const difference = runningVoidDifference(item, context);
    if (difference === null) continue;
    const currency = item.before.transaction.currency;
    // What the exact reversal leaves on the item.
    const { before, reversed } = item;
    const exact: CarriedAmounts = {
      transaction: money(
        before.transaction.amountMinor + reversed.transaction.amountMinor,
        currency,
      ),
      bookMinor: before.bookMinor + reversed.bookMinor,
      parallelMinor:
        before.parallelMinor === null || reversed.parallelMinor === null
          ? null
          : before.parallelMinor + reversed.parallelMinor,
    };
    const held = before.transaction.amountMinor;
    const crosses = sign(exact.transaction.amountMinor) === -sign(held);
    if (crosses) {
      lines.push(
        carriedLine({
          ...item.target,
          amounts: negate(exact),
          item: { id: item.id, movement: 'clear' },
        }),
        {
          ...measuredLine({ ...item.target, amount: exact.transaction }, policy),
          item: { id: item.id, movement: 'add' },
        },
      );
      continue;
    }
    for (const [ledger] of keptLedgers(ledgers)) {
      const amount = ledgerAmount(difference, ledger) ?? 0n;
      if (amount === 0n) continue;
      if (ledgerCurrency(ledgers, ledger) === currency) {
        throw new Error('A running item differs in the ledger of its own currency');
      }
      lines.push({
        ...differenceLine(ledgers, ledger, amount, { kind: 'item', ...item.target, currency }),
        item: { id: item.id, movement: 'difference' },
      });
    }
  }
  if (lines.length === 0) return [];
  return [...lines, ...realisedDifferenceLines(ledgers, lines, targets)];
}
