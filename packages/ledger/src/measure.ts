import {
  type CompanyLedgers,
  type CrossRate,
  type CurrencyCode,
  convert,
  DomainError,
  type ExchangeRate,
  type Ledger,
  type LedgerSettings,
  type Money,
} from '@vertex-mizan/contracts';
import type { Conversion, Dimensions, Line } from './lines.js';
import { type PublicationCalendar, policyRate, quotesPair } from './rates.js';

/**
 * What a new measurement needs: the company's ledgers, the entry date, the rates and the bulletin
 * publication calendar.
 */
export interface MeasureContext {
  readonly ledgers: CompanyLedgers;
  /** The entry date: each ledger converts at the rate of its policy in force on it. */
  readonly on: string;
  /** The company rate table, in recording order (`rateInForce`). */
  readonly rates: readonly ExchangeRate[];
  /** The company's bulletin publication calendar: which bulletin is in force (`rateInForce`). */
  readonly calendar: PublicationCalendar;
  /**
   * The rate the transaction was dealt at (a connected system's own rate, such as Hub's SYP per
   * USD). A ledger uses it only when its policy accepts it and it quotes the pair to convert.
   */
  readonly transactionRate?: ExchangeRate;
  /**
   * The rates a manual entry was dealt at, one per currency pair (S03 rule 13, ADR 0012). A ledger
   * uses the one that quotes the pair to convert, under the same policy as the transaction's own
   * rate.
   */
  readonly dealtRates?: readonly ExchangeRate[];
}

/** A new amount's value in each ledger, with how each was converted. */
export interface Measurement {
  readonly bookMinor: bigint;
  readonly parallelMinor: bigint | null;
  readonly conversions: { readonly book: Conversion | null; readonly parallel: Conversion | null };
}

/**
 * A third currency crosses through the company's other ledger currency: the book currency for the
 * parallel ledger, the parallel currency for the book ledger (for example TRY→USD market through
 * TRY→SYP market and USD→SYP market).
 */
function crossVia(ledgers: CompanyLedgers, ledger: Ledger): CurrencyCode | null {
  return ledger === 'book' ? (ledgers.parallel?.currency ?? null) : ledgers.book.currency;
}

function measureIn(
  amount: Money,
  ledger: Ledger,
  settings: LedgerSettings,
  context: MeasureContext,
): { readonly minor: bigint; readonly conversion: Conversion | null } {
  const to = settings.currency;
  if (amount.currency === to) return { minor: amount.amountMinor, conversion: null };
  const { rateType, acceptsTransactionRate } = settings.ratePolicy;
  const own = [context.transactionRate, ...(context.dealtRates ?? [])].find(
    (candidate) => candidate !== undefined && quotesPair(candidate, amount.currency, to),
  );
  // Only a market policy accepts a transaction's own rate (ADR 0007, IAS 21.26).
  if (own !== undefined && acceptsTransactionRate && rateType === 'market') {
    return {
      minor: convert(amount, to, own).amountMinor,
      conversion: { basis: 'transaction', rate: own },
    };
  }
  const rate = ledgerPolicyRate({ ...context, ledger, from: amount.currency });
  return { minor: convert(amount, to, rate).amountMinor, conversion: { basis: 'policy', rate } };
}

/** What `ledgerPolicyRate()` reads: a ledger, a currency to convert from and the rates of `on`. */
export interface PolicyRateQuery {
  readonly ledgers: CompanyLedgers;
  readonly ledger: Ledger;
  readonly from: CurrencyCode;
  readonly on: string;
  readonly rates: readonly ExchangeRate[];
  readonly calendar: PublicationCalendar;
}

/**
 * The rate of a ledger's policy in force on `on` for converting `from` into the ledger's currency,
 * direct or crossed through the company's other ledger currency, never a transaction's own rate:
 * a new measurement's when its policy takes no transaction rate, and a month end's closing rate
 * (S07 rule 11). A missing rate is refused with `RATE_MISSING`, naming the pair and the date.
 */
export function ledgerPolicyRate(query: PolicyRateQuery): ExchangeRate | CrossRate {
  const settings = query.ledger === 'book' ? query.ledgers.book : query.ledgers.parallel;
  if (settings === null) throw new TypeError('The company keeps no parallel ledger');
  const { ledger, from, on } = query;
  const to = settings.currency;
  const { rateType } = settings.ratePolicy;
  const via = crossVia(query.ledgers, ledger);
  const rate = policyRate(query.rates, { type: rateType, from, to, on, via }, query.calendar);
  if (rate === null) {
    throw new DomainError(
      'RATE_MISSING',
      `No ${rateType} rate between ${from} and ${to} in force on ${on} for the ${ledger} ledger`,
      { ledger, rateType, from, to, on },
    );
  }
  return rate;
}

/**
 * Measures a new amount (revenue, a new receivable, cash received, an expense) in each ledger
 * (ADR 0007): as is in a ledger of its own currency; otherwise converted with the transaction's
 * own rate or the pair's dealt rate when the ledger's policy accepts it, or else with the
 * policy's rate type in force on the entry date, direct or crossed. A missing rate is refused with
 * `RATE_MISSING`, never defaulted.
 */
export function measure(amount: Money, context: MeasureContext): Measurement {
  const { book, parallel } = context.ledgers;
  const inBook = measureIn(amount, 'book', book, context);
  const inParallel = parallel === null ? null : measureIn(amount, 'parallel', parallel, context);
  return {
    bookMinor: inBook.minor,
    parallelMinor: inParallel === null ? null : inParallel.minor,
    conversions: {
      book: inBook.conversion,
      parallel: inParallel === null ? null : inParallel.conversion,
    },
  };
}

/** A line that measures a new amount in each ledger (`measure()`). */
export function measuredLine(
  input: { readonly account: string; readonly dimensions?: Dimensions; readonly amount: Money },
  context: MeasureContext,
): Line {
  const measured = measure(input.amount, context);
  return {
    kind: 'measured',
    account: input.account,
    dimensions: input.dimensions ?? {},
    transaction: input.amount,
    bookMinor: measured.bookMinor,
    parallelMinor: measured.parallelMinor,
    conversions: measured.conversions,
  };
}
