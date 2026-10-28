import {
  type CurrencyCode,
  DomainError,
  type ExchangeRate,
  type Money,
} from '@vertex-mizan/contracts';
import { type RealisedTargets, realisedDifferenceLines } from './balance.js';
import { type Dimensions, keptLedgers, type Line } from './lines.js';
import { type MeasureContext, measuredLine } from './measure.js';
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
