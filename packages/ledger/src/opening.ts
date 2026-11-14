import {
  type CompanyLedgers,
  type CurrencyCode,
  DomainError,
  type ExchangeRate,
  type Ledger,
  type Money,
  money,
  type RateType,
} from '@vertex-mizan/contracts';
import { keptLedgers, type Line, ledgerAmount } from './lines.js';
import { type MeasureContext, measure } from './measure.js';
import type { PublicationCalendar } from './rates.js';

/**
 * The opening balances (S10 rules 14–19, 23; ADR 0019 as amended by ADR 0021;
 * `docs/scenarios/opening/opening-entry.md`, owner 2026-11-12): the accountant's lines from the old
 * records and the balancing figure on retained earnings, each ledger on its own. Pure:
 * `packages/db` reads the rates, the accounts and the draft, calls these functions and posts
 * through `post()`. Hub's part (its snapshot's items and schedules) left with Hub.
 */

/** What the opening reads to measure: the ledgers, the eve, the rate table and the calendar. */
export interface OpeningRateContext {
  readonly ledgers: CompanyLedgers;
  /** The eve of the books start (`as_of`): the date of every monetary measurement (rule 17). */
  readonly asOf: string;
  readonly rates: readonly ExchangeRate[];
  readonly calendar: PublicationCalendar;
}

/** A rate a measurement needed and the table lacks (check `rates`, S10 rule 21). */
export interface MissingRate {
  readonly ledger: Ledger;
  readonly rateType: RateType;
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly on: string;
}

/**
 * A new measurement in each ledger at the context's date, or the rate it misses: a measurement
 * that cannot be made is a failing check, not a refusal, so the preview lists every missing rate.
 */
function tryMeasure(
  amount: Money,
  context: MeasureContext,
  missing: MissingRate[],
): ReturnType<typeof measure> | null {
  try {
    return measure(amount, context);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'RATE_MISSING') {
      const details = error.details as unknown as MissingRate;
      const seen = missing.some(
        (rate) =>
          rate.ledger === details.ledger &&
          rate.from === details.from &&
          rate.to === details.to &&
          rate.on === details.on,
      );
      if (!seen) {
        missing.push({
          ledger: details.ledger,
          rateType: details.rateType,
          from: details.from,
          to: details.to,
          on: details.on,
        });
      }
      return null;
    }
    throw error;
  }
}

/**
 * A line of the accountant as the opening measures it (S10 rules 14, 17): `monetary` when its
 * account is monetary (a control account's item included). A stated line gives `bookMinor` and
 * `parallelMinor`, each null in its ledger's own currency, where the amount is itself.
 */
export interface OpeningRecordLine {
  readonly account: string;
  readonly monetary: boolean;
  readonly amount: Money;
  readonly bookMinor: bigint | null;
  readonly parallelMinor: bigint | null;
}

/** An accountant's line measured (rule 17), or why it cannot be: a stated amount missing. */
export type MeasuredRecordLine =
  | { readonly kind: 'line'; readonly line: Line }
  | { readonly kind: 'incomplete'; readonly ledger: Ledger }
  | { readonly kind: 'rate_missing' };

/**
 * The accountant's line (rule 17): monetary, a new measurement at each ledger's policy rate of the
 * eve; otherwise `stated`, its book and parallel amounts from the records, the amount itself in a
 * ledger of its own currency, where a typed amount must be the amount.
 */
export function openingRecordLine(
  input: OpeningRecordLine,
  context: OpeningRateContext,
  missingRates: MissingRate[],
): MeasuredRecordLine {
  const { ledgers } = context;
  if (input.monetary) {
    const measured = tryMeasure(
      input.amount,
      { ledgers, on: context.asOf, rates: context.rates, calendar: context.calendar },
      missingRates,
    );
    if (measured === null) return { kind: 'rate_missing' };
    return {
      kind: 'line',
      line: {
        kind: 'measured',
        account: input.account,
        dimensions: {},
        transaction: input.amount,
        bookMinor: measured.bookMinor,
        parallelMinor: measured.parallelMinor,
        conversions: measured.conversions,
      },
    };
  }
  const amounts = new Map<Ledger, bigint | null>();
  for (const [ledger, settings] of keptLedgers(ledgers)) {
    const typed = ledger === 'book' ? input.bookMinor : input.parallelMinor;
    if (settings.currency === input.amount.currency) {
      if (typed !== null && typed !== input.amount.amountMinor) {
        return { kind: 'incomplete', ledger };
      }
      amounts.set(ledger, input.amount.amountMinor);
      continue;
    }
    if (typed === null) return { kind: 'incomplete', ledger };
    amounts.set(ledger, typed);
  }
  return {
    kind: 'line',
    line: {
      kind: 'stated',
      account: input.account,
      dimensions: {},
      transaction: input.amount,
      bookMinor: amounts.get('book') ?? 0n,
      parallelMinor: ledgers.parallel === null ? null : (amounts.get('parallel') ?? 0n),
    },
  };
}

/**
 * The balancing figure (S10 rules 18–19): one stated line on the retained-earnings account in the
 * book currency, its book amount minus the other lines' book amounts and its parallel amount minus
 * their parallel amounts, so each ledger balances on its own; null when it is zero in both. Its
 * transaction amount is its book amount (the book currency's own).
 */
export function balancingLine(
  lines: readonly Line[],
  ledgers: CompanyLedgers,
  account: string,
): Line | null {
  let book = 0n;
  let parallel: bigint | null = ledgers.parallel === null ? null : 0n;
  for (const line of lines) {
    book -= line.bookMinor;
    if (parallel !== null) {
      const amount = ledgerAmount(line, 'parallel');
      if (amount === null) throw new TypeError('A line without the parallel amount');
      parallel -= amount;
    }
  }
  if (book === 0n && (parallel === null || parallel === 0n)) return null;
  return {
    kind: 'stated',
    account,
    dimensions: {},
    transaction: money(book, ledgers.book.currency),
    bookMinor: book,
    parallelMinor: parallel,
  };
}

/**
 * What the preview's fingerprint hashes (S10 rules 20, 23): the draft's version and the rate rows
 * the lines were measured with, so a save or a rate recorded changes it.
 */
export function openingFingerprintValue(input: {
  readonly version: number;
  readonly rateIds: readonly string[];
}): { version: string; rateIds: string[] } {
  return {
    version: String(input.version),
    rateIds: [...new Set(input.rateIds)].sort(),
  };
}

/** The debits of an entry's lines in each ledger (S10 "Audit": the opening's totals per ledger). */
export function debitTotals(
  lines: readonly { readonly bookMinor: bigint; readonly parallelMinor: bigint | null }[],
): { bookMinor: bigint; parallelMinor: bigint | null } {
  let book = 0n;
  let parallel: bigint | null = null;
  for (const line of lines) {
    if (line.bookMinor > 0n) book += line.bookMinor;
    if (line.parallelMinor !== null) {
      parallel = (parallel ?? 0n) + (line.parallelMinor > 0n ? line.parallelMinor : 0n);
    }
  }
  return { bookMinor: book, parallelMinor: parallel };
}
