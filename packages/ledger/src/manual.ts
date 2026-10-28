import {
  type CurrencyCode,
  DomainError,
  type ExchangeRate,
  type Money,
} from '@vertex-mizan/contracts';
import { type RealisedTargets, realisedDifferenceLines } from './balance.js';
import { reverseLines } from './carried.js';
import { type Dimensions, keptLedgers, type Line } from './lines.js';
import { type MeasureContext, measuredLine } from './measure.js';
import { lastDayOfMonth, periodOf } from './periods.js';
import { quotesPair } from './rates.js';

/** A manual line as the accountant types it: a transaction amount, never a ledger amount. */
export interface ManualLine {
  readonly account: string;
  readonly dimensions?: Dimensions;
  readonly amount: Money;
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

/**
 * The lines of a manual entry before its rounding lines (S03 rules 12–15, ADR 0012): every line a
 * new measurement (`measuredLine()`) at each ledger's policy rate on the entry date, or at the
 * pair's dealt rate where the ledger accepts it. In more than one transaction currency (a currency
 * purchase or sale, a payment in another currency), each ledger's residual, rounding included, is a
 * realised exchange difference to the gain or loss account by its sign (IAS 21.28). In one
 * currency, `balanceEntry()` posts the residual as conversion rounding.
 */
export function manualEntryLines(
  entry: ManualEntry,
  context: MeasureContext,
  targets: RealisedTargets,
): Line[] {
  checkDealtRates(entry, context);
  const at: MeasureContext = { ...context, dealtRates: entry.dealtRates };
  const lines = entry.lines.map((line) => measuredLine(line, at));
  const currencies = new Set(lines.map((line) => line.transaction.currency));
  if (currencies.size < 2) return lines;
  return [...lines, ...realisedDifferenceLines(context.ledgers, lines, targets)];
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

/** Where a posted entry came from (S03 `journal_entries.source`). */
export const ENTRY_SOURCES = [
  'manual',
  'hub_event',
  'opening',
  'revaluation',
  'revenue_release',
] as const;

export type EntrySource = (typeof ENTRY_SOURCES)[number];

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
 * revaluation, release and opening entries are reversed by their own process, and a reversal is
 * copied instead), once (`ENTRY_ALREADY_REVERSED`; the unique `reverses_entry_id` settles a race),
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
