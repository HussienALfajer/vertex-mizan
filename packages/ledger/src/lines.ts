import {
  type CompanyLedgers,
  type CrossRate,
  type CurrencyCode,
  type ExchangeRate,
  type Ledger,
  type LedgerSettings,
  type Money,
  money,
} from '@vertex-mizan/contracts';

/**
 * Journal lines with their three amounts (ADR 0007): the transaction amount in its own currency,
 * the book amount and the parallel amount, each in minor units, positive debit and negative
 * credit. Every line also says how its ledger amounts were obtained.
 */

/** Analysis tags on a line, dimension → value (client, project, service…), as the caller names them. */
export type Dimensions = Readonly<Record<string, string>>;

/**
 * How one ledger amount of a new measurement was converted: at the ledger policy's rate (a row of
 * the company rate table, or a cross of two rows), or at the transaction's own rate when the
 * policy accepts it. The rate is recorded as quoted, with its base, type, source and effective
 * date; a cross with both quotes.
 */
export type Conversion =
  | { readonly basis: 'policy'; readonly rate: ExchangeRate | CrossRate }
  | { readonly basis: 'transaction'; readonly rate: ExchangeRate };

/** A balance carried in both ledgers: its transaction amount and its book and parallel amounts. */
export interface CarriedAmounts {
  /** The amount in its own currency: positive debit, negative credit. */
  readonly transaction: Money;
  /** The amount in the book currency, in its minor units. */
  readonly bookMinor: bigint;
  /** The amount in the parallel currency; null when the company keeps no parallel ledger. */
  readonly parallelMinor: bigint | null;
}

interface LineFields extends CarriedAmounts {
  readonly account: string;
  readonly dimensions: Dimensions;
}

/**
 * A journal line. Its `kind` says how its ledger amounts were obtained:
 * - `measured`: a new amount, converted per ledger (`conversions`, null in a ledger whose currency
 *   is the transaction currency: the amount is used as is);
 * - `carried`: releases, clears or settles an existing balance at that balance's own amounts,
 *   never converted again (IAS 21.23(b), IFRIC 22);
 * - `difference`: an exchange difference, with an amount in `ledger` only;
 * - `rounding`: the conversion rounding of its entry, with an amount in `ledger` only.
 */
export type Line =
  | (LineFields & {
      readonly kind: 'measured';
      readonly conversions: {
        readonly book: Conversion | null;
        readonly parallel: Conversion | null;
      };
    })
  | (LineFields & { readonly kind: 'carried' })
  | (LineFields & { readonly kind: 'difference' | 'rounding'; readonly ledger: Ledger });

/** The company's ledgers that are kept: the book ledger, then the parallel ledger when set. */
export function keptLedgers(ledgers: CompanyLedgers): [Ledger, LedgerSettings][] {
  return ledgers.parallel === null
    ? [['book', ledgers.book]]
    : [
        ['book', ledgers.book],
        ['parallel', ledgers.parallel],
      ];
}

/** The currency of one of the company's ledgers; refuses the parallel ledger when none is kept. */
export function ledgerCurrency(ledgers: CompanyLedgers, ledger: Ledger): CurrencyCode {
  const settings = ledger === 'book' ? ledgers.book : ledgers.parallel;
  if (settings === null) throw new TypeError('The company keeps no parallel ledger');
  return settings.currency;
}

/** An amount's value in one ledger; null in the parallel ledger of a company that keeps none. */
export function ledgerAmount(amounts: CarriedAmounts, ledger: Ledger): bigint | null {
  return ledger === 'book' ? amounts.bookMinor : amounts.parallelMinor;
}

/** The same amounts with the opposite sign, exactly: a stored amount always has a negation. */
export function negate(amounts: CarriedAmounts): CarriedAmounts {
  return {
    transaction: money(-amounts.transaction.amountMinor, amounts.transaction.currency),
    bookMinor: -amounts.bookMinor,
    parallelMinor: amounts.parallelMinor === null ? null : -amounts.parallelMinor,
  };
}

/** A line that carries existing amounts: a release, clearing or settlement of a balance. */
export function carriedLine(input: {
  readonly account: string;
  readonly dimensions?: Dimensions;
  readonly amounts: CarriedAmounts;
}): Line {
  const { transaction, bookMinor, parallelMinor } = input.amounts;
  return {
    kind: 'carried',
    account: input.account,
    dimensions: input.dimensions ?? {},
    transaction,
    bookMinor,
    parallelMinor,
  };
}
