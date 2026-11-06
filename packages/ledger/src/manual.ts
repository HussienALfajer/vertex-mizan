import {
  type CurrencyCode,
  DomainError,
  type EntrySource,
  type ExchangeRate,
  type Money,
} from '@vertex-mizan/contracts';
import { type RealisedTargets, realisedDifferenceLines } from './balance.js';
import { reverseLines } from './carried.js';
import { type ItemState, moveItem } from './items.js';
import { type Dimensions, keptLedgers, type Line } from './lines.js';
import { type MeasureContext, measuredLine } from './measure.js';
import { lastDayOfMonth, periodOf } from './periods.js';
import { quotesPair } from './rates.js';

/** A manual line as the accountant types it: a transaction amount, never a ledger amount. */
export interface ManualLine {
  readonly account: string;
  readonly dimensions?: Dimensions;
  readonly amount: Money;
  /**
   * The open item a line on a control account moves (S04 rules 5–9), as the posting function read
   * it: an existing item, a new document item the line opens, or the client's running item, found
   * or new. Two lines may move one item: the second moves it from where the first left it.
   */
  readonly item?: ItemState;
}

/** A manual entry's lines and the rates it was dealt at, one per currency pair (S03 rule 13). */
export interface ManualEntry {
  readonly lines: readonly ManualLine[];
  readonly dealtRates: readonly ExchangeRate[];
}

/**
 * Refuses a dealt rate that no ledger can use (`DEALT_RATE_NOT_ACCEPTED`): one is used only by a
 * ledger whose policy is `market` and accepts a transaction's rate, and only for the pair of a
 * line's currency and that ledger's currency (S03 rule 13, ADR 0012). Two rates for one pair are a
 * request the contract refuses first, so a programming error here.
 */
function checkDealtRates(entry: ManualEntry, context: MeasureContext): void {
  const currencies = new Set<CurrencyCode>(entry.lines.map((line) => line.amount.currency));
  for (const [index, dealt] of entry.dealtRates.entries()) {
    if (
      entry.dealtRates.slice(0, index).some((other) => quotesPair(other, dealt.base, dealt.quote))
    ) {
      throw new TypeError(`Two dealt rates for ${dealt.base}/${dealt.quote}`);
    }
    const used = keptLedgers(context.ledgers).some(
      ([, { currency, ratePolicy }]) =>
        ratePolicy.rateType === 'market' &&
        ratePolicy.acceptsTransactionRate &&
        [...currencies].some((from) => from !== currency && quotesPair(dealt, from, currency)),
    );
    if (!used) {
      throw new DomainError(
        'DEALT_RATE_NOT_ACCEPTED',
        `No ledger of the company takes a dealt ${dealt.base}/${dealt.quote} rate for this entry`,
        { base: dealt.base, quote: dealt.quote },
      );
    }
  }
}

/** A manual entry's lines, and for each the manual line it comes from. */
export interface ManualEntryLines {
  readonly lines: readonly Line[];
  /**
   * The index of the manual line each line comes from, null for a difference line. A running
   * item's line that crosses zero gives two lines (S04 rule 3), both from its manual line.
   */
  readonly typed: readonly (number | null)[];
}

/** Names the manual line (1-based, `details.lineNo`) in a refusal of what it does to its item. */
function onLine<T>(lineNo: number, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof DomainError) {
      throw new DomainError(error.code, error.message, { ...error.details, lineNo });
    }
    throw error;
  }
}

/**
 * The lines of a manual entry before its rounding lines (S03 rules 12–15, ADR 0012; S04 rules 2–10,
 * ADR 0013), with the manual line each comes from:
 * - a line with no item is a new measurement (`measuredLine()`) at each ledger's policy rate on the
 *   entry date, or at the pair's dealt rate where the ledger accepts it;
 * - a line on an item opens, clears or moves it (`moveItem()`): an opening and a running item's
 *   `add` are new measurements, a clearing carries the item's amounts and reads no rate;
 * - each ledger's residual, rounding included, is a realised exchange difference to the gain or
 *   loss account by its sign (IAS 21.28) when any line is carried (a settlement, a write-off, an
 *   offset; in one currency too) or the lines are in more than one transaction currency. Only an
 *   entry in one currency whose lines are all new measurements leaves its residual to
 *   `balanceEntry()` as conversion rounding. The lines other than differences still balance in
 *   their currency when they are in one, so an overpayment is never a gain (`ENTRY_UNBALANCED`).
 */
export function manualEntry(
  entry: ManualEntry,
  context: MeasureContext,
  targets: RealisedTargets,
): ManualEntryLines {
  checkDealtRates(entry, context);
  const at: MeasureContext = { ...context, dealtRates: entry.dealtRates };
  const items = new Map<string, ItemState>();
  const lines: Line[] = [];
  const typed: (number | null)[] = [];
  for (const [index, line] of entry.lines.entries()) {
    if (line.item === undefined) {
      lines.push(measuredLine(line, at));
      typed.push(index);
      continue;
    }
    const item = items.get(line.item.id) ?? line.item;
    const moved = onLine(index + 1, () =>
      moveItem(item, { account: line.account, dimensions: line.dimensions ?? {} }, line.amount, at),
    );
    items.set(item.id, moved.after);
    lines.push(...moved.lines);
    typed.push(...moved.lines.map(() => index));
  }
  const currencies = new Set(lines.map((line) => line.transaction.currency));
  if (currencies.size < 2 && lines.every((line) => line.kind === 'measured')) {
    return { lines, typed };
  }
  const differences = realisedDifferenceLines(context.ledgers, lines, targets);
  return { lines: [...lines, ...differences], typed: [...typed, ...differences.map(() => null)] };
}

/** The lines of a manual entry before its rounding lines: `manualEntry()`'s lines alone. */
export function manualEntryLines(
  entry: ManualEntry,
  context: MeasureContext,
  targets: RealisedTargets,
): Line[] {
  return [...manualEntry(entry, context, targets).lines];
}

/**
 * Refuses a manual entry, or the accountant's reversal, dated after the last day of the current
 * month (`ENTRY_DATE_OUT_OF_RANGE`, S03 rules 6 and 9, ADR 0012), so a month-end accrual may be
 * dated ahead within its month. `today` is the date at the moment of posting in Asia/Damascus, from
 * the caller's clock, not the date the draft was saved. The open period and the SYP date are the
 * posting function's and `balanceEntry()`'s checks.
 */
export function checkManualEntryDate(on: string, today: string): void {
  if (periodOf(on) > periodOf(today)) {
    const last = lastDayOfMonth(today);
    throw new DomainError(
      'ENTRY_DATE_OUT_OF_RANGE',
      `A manual entry dated ${on} is after the last day of the current month, ${last}`,
      { on, last },
    );
  }
}

/** Where a posted entry came from (S03 `journal_entries.source`): contracts' one list. */
export { ENTRY_SOURCES, type EntrySource } from '@vertex-mizan/contracts';

/** A posted entry as the posting function reads it, locked, to reverse it by hand. */
export interface PostedEntry {
  readonly source: EntrySource;
  /** Its accounting date, `YYYY-MM-DD`. */
  readonly date: string;
  /** It is itself a reversal (`reverses_entry_id` set). */
  readonly isReversal: boolean;
  /** A reversal of it is already posted. */
  readonly reversed: boolean;
  readonly lines: readonly Line[];
}

/**
 * The lines of the accountant's reversal of a posted entry dated `on` (S03 rule 9, ADR 0012): every
 * line negated at its posted amounts, rounding and difference lines included, never converted
 * again (`reverseLines()`), so it needs no rate and `balanceEntry()` adds nothing to it. Only a
 * manual entry that is not itself a reversal is reversed by hand (`ENTRY_NOT_REVERSIBLE`: Hub,
 * revaluation, release and opening entries are reversed by their own process, a reversal is copied
 * instead, and the difference entry that follows a running item's void goes with it), once (`ENTRY_ALREADY_REVERSED`; the unique `reverses_entry_id` settles a race),
 * and on or after its date (`REVERSAL_BEFORE_ORIGINAL`). The period and the date range are the
 * posting function's checks, as for any entry.
 */
export function manualReversalLines(original: PostedEntry, on: string): Line[] {
  if (original.source !== 'manual' || original.isReversal) {
    throw new DomainError(
      'ENTRY_NOT_REVERSIBLE',
      original.isReversal
        ? 'A reversal is never reversed; copy the original instead'
        : `A ${original.source} entry is reversed by its own process`,
      { source: original.source },
    );
  }
  // The difference entry that follows a running item's void (S04 rule 13) belongs to that
  // reversal, which is never reversed either.
  if (original.lines.some((line) => line.item?.movement === 'difference')) {
    throw new DomainError(
      'ENTRY_NOT_REVERSIBLE',
      "A void's exchange difference is never reversed by hand",
      { source: original.source },
    );
  }
  if (original.reversed) {
    throw new DomainError('ENTRY_ALREADY_REVERSED', 'The entry has a reversal already');
  }
  if (on < original.date) {
    throw new DomainError(
      'REVERSAL_BEFORE_ORIGINAL',
      `A reversal dated ${on} is before its original of ${original.date}`,
      { on, original: original.date },
    );
  }
  return reverseLines(original.lines);
}
