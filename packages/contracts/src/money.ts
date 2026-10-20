import { z } from 'zod';
import { DomainError, type ErrorCode } from './errors.js';
import { MINOR_MAX, MINOR_MIN, type Ratio, scaleMinor } from './money-arithmetic.js';

/**
 * Money (ADR 0007): integer minor units (`bigint`) with an ISO 4217 code, never floats. Rates are
 * stored as quoted and never inverted; `convert()` is the one conversion, exact, rounding half
 * away from zero. Arithmetic on amounts belongs here and in `packages/ledger` only (a Biome plugin
 * refuses it on `*Minor` fields elsewhere).
 */

export const CURRENCY_CODES = ['USD', 'SYP', 'TRY', 'EUR'] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

interface CurrencyDefinition {
  /** Decimal places of the minor unit: amounts are integers of 10^-exponent. */
  readonly exponent: number;
}

/** The currency table. More currencies are added as data (ADR 0007). */
export const currencies: { readonly [Code in CurrencyCode]: CurrencyDefinition } = {
  USD: { exponent: 2 },
  // The new Syrian pound. No ISO 4217 amendment for Syria was found, so `SYP` stands (REPORTED).
  SYP: { exponent: 2 },
  TRY: { exponent: 2 },
  EUR: { exponent: 2 },
};

/** The first day of the new pound: SYP amounts and rates dated earlier are refused (ADR 0007). */
export const SYP_REDENOMINATED_ON = '2026-01-01';

/**
 * The exponent of each code travels with the schema (`x-exponents` in its JSON Schema), so a client
 * that does not run TypeScript reads the minor unit from the contract, not from a copy of the table.
 */
export const currencyCodeSchema = z.enum(CURRENCY_CODES).meta({
  id: 'CurrencyCode',
  description: 'ISO 4217 code; amounts are integers in minor units of 10^-exponent.',
  'x-exponents': Object.fromEntries(
    CURRENCY_CODES.map((code) => [code, currencies[code].exponent]),
  ),
});

/** An amount in minor units, within the stored `bigint` range. */
export const minorAmountSchema = z.bigint().min(MINOR_MIN).max(MINOR_MAX);

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

function fail(code: ErrorCode, message: string): never {
  throw new DomainError(code, message);
}

function checkMinor(amountMinor: bigint, currency: CurrencyCode): bigint {
  if (amountMinor < MINOR_MIN || amountMinor > MINOR_MAX) {
    fail('AMOUNT_OUT_OF_RANGE', `${currency} amount outside the stored range`);
  }
  return amountMinor;
}

/** An amount in minor units with its currency, refused outside the stored range. */
export function money(amountMinor: bigint, currency: CurrencyCode): Money {
  return { amountMinor: checkMinor(amountMinor, currency), currency };
}

/** Refuses an SYP amount dated before the new pound (`SYP_BEFORE_REDENOMINATION`). */
export function checkCurrencyDate(currency: CurrencyCode, on: string): void {
  if (currency === 'SYP' && on < SYP_REDENOMINATED_ON) {
    fail('SYP_BEFORE_REDENOMINATION', `SYP dated ${on}, before ${SYP_REDENOMINATED_ON}`);
  }
}

/** `market`: the rate the company deals at. `bulletin`: the Central Bank of Syria bulletin. */
export const RATE_TYPES = ['market', 'bulletin'] as const;

export const rateTypeSchema = z.enum(RATE_TYPES).meta({ id: 'RateType' });

export type RateType = z.infer<typeof rateTypeSchema>;

export const RATE_SOURCES = ['hub', 'manual', 'import'] as const;

export const rateSourceSchema = z.enum(RATE_SOURCES).meta({ id: 'RateSource' });

export type RateSource = z.infer<typeof rateSourceSchema>;

/** Up to 12 integer digits and 10 decimal places, no leading zeros, no exponent. */
const RATE_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,10})?$/;

/**
 * Quote units per one base unit, as an exact decimal string (`"118.5000"`), stored as `numeric`
 * exactly as quoted.
 */
export const rateValueSchema = z
  .string()
  .regex(RATE_PATTERN, 'Expected a decimal with up to 10 places')
  .refine((rate) => /[1-9]/.test(rate), 'The rate must be above zero');

/**
 * A row of the company rate table: `rate` units of `quote` per one `base`, effective from
 * `effectiveOn`. Hub's "SYP per USD" is base `USD`, quote `SYP`. Never inverted into a stored
 * decimal: converting from the quote currency divides by it.
 */
export const exchangeRateSchema = z
  .object({
    effectiveOn: z.iso.date(),
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: rateValueSchema,
    type: rateTypeSchema,
    source: rateSourceSchema,
  })
  .superRefine((rate, context) => {
    if (rate.base === rate.quote) {
      context.addIssue({
        code: 'custom',
        message: 'A rate quotes one currency in another',
        path: ['quote'],
        params: { code: 'INVALID_RATE' },
      });
    }
    if ((rate.base === 'SYP' || rate.quote === 'SYP') && rate.effectiveOn < SYP_REDENOMINATED_ON) {
      context.addIssue({
        code: 'custom',
        message: `An SYP rate dated before ${SYP_REDENOMINATED_ON}`,
        path: ['effectiveOn'],
        params: { code: 'SYP_BEFORE_REDENOMINATION' },
      });
    }
  })
  .meta({ id: 'ExchangeRate' });

export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

/**
 * A third-currency rate crossed through two quotes of the same type and effective date, recorded
 * with both (ADR 0007): the first pairs the source currency with an intermediate one, the second
 * pairs the intermediate currency with the target. For example TRY→USD market through TRY→SYP
 * market and USD→SYP market.
 */
export type CrossRate = readonly [ExchangeRate, ExchangeRate];

/** Validates a rate passed to `convert()`, with the money error codes instead of Zod's. */
function checkRate(rate: ExchangeRate): ExchangeRate {
  const result = exchangeRateSchema.safeParse(rate);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const code = issue?.code === 'custom' ? (issue.params?.code as ErrorCode | undefined) : null;
  return fail(code ?? 'INVALID_RATE', issue?.message ?? 'Invalid rate');
}

function rateRatio(rate: ExchangeRate, from: CurrencyCode, to: CurrencyCode): Ratio {
  const [whole = '', fraction = ''] = rate.rate.split('.');
  const units = BigInt(whole + fraction);
  const unit = 10n ** BigInt(fraction.length);
  if (rate.base === from && rate.quote === to) return { numerator: units, denominator: unit };
  // From the quote currency to the base: divide by the quote, never by a stored inverse.
  if (rate.quote === from && rate.base === to) return { numerator: unit, denominator: units };
  return fail(
    'RATE_PAIR_MISMATCH',
    `A ${rate.base}/${rate.quote} rate cannot convert ${from} to ${to}`,
  );
}

function crossRatio(from: CurrencyCode, to: CurrencyCode, [first, second]: CrossRate): Ratio {
  if (first.type !== second.type || first.effectiveOn !== second.effectiveOn) {
    fail('CROSS_RATE_MISMATCH', 'A cross rate needs two quotes of the same type and date');
  }
  const via = first.base === from ? first.quote : first.quote === from ? first.base : null;
  if (via === null || via === to) {
    fail(
      'RATE_PAIR_MISMATCH',
      `The first quote of a cross rate pairs ${from} with another currency`,
    );
  }
  const toVia = rateRatio(first, from, via);
  const fromVia = rateRatio(second, via, to);
  return {
    numerator: toVia.numerator * fromVia.numerator,
    denominator: toVia.denominator * fromVia.denominator,
  };
}

/**
 * Converts an amount to another currency with a quoted rate, or a cross rate of two quotes, using
 * exact integer arithmetic and both currencies' exponents, rounded half away from zero once.
 * A cross rate is applied as one exact product, so the result stays within half a minor unit of
 * the exact value. For non-negative amounts this equals Hub's half-up `convertMinor`. An amount in
 * its own currency is not a conversion: the caller uses it as is, with no rate.
 */
export function convert(amount: Money, to: CurrencyCode, rate: ExchangeRate | CrossRate): Money {
  const from = amount.currency;
  checkMinor(amount.amountMinor, from);
  const ratio =
    'base' in rate
      ? rateRatio(checkRate(rate), from, to)
      : crossRatio(from, to, [checkRate(rate[0]), checkRate(rate[1])]);
  const converted = scaleMinor(
    amount.amountMinor,
    ratio,
    currencies[from].exponent,
    currencies[to].exponent,
  );
  return money(converted, to);
}

/**
 * The rate policy of one ledger: the rate type it converts at, and whether it accepts a
 * transaction's own rate (the rate a connected system dealt at). Only a `market` policy accepts
 * one (ADR 0007, IAS 21.26).
 */
export const ratePolicySchema = z
  .object({
    rateType: rateTypeSchema,
    acceptsTransactionRate: z.boolean(),
  })
  .refine((policy) => !policy.acceptsTransactionRate || policy.rateType === 'market', {
    message: "Only a market policy accepts a transaction's own rate",
    path: ['acceptsTransactionRate'],
  })
  .meta({ id: 'RatePolicy' });

export type RatePolicy = z.infer<typeof ratePolicySchema>;

/** `book`: the statutory books. `parallel`: the optional full parallel ledger. */
export const LEDGERS = ['book', 'parallel'] as const;

export const ledgerSchema = z.enum(LEDGERS).meta({ id: 'Ledger' });

export type Ledger = z.infer<typeof ledgerSchema>;

export const ledgerSettingsSchema = z
  .object({ currency: currencyCodeSchema, ratePolicy: ratePolicySchema })
  .meta({ id: 'LedgerSettings' });

export type LedgerSettings = z.infer<typeof ledgerSettingsSchema>;

/**
 * A company's two ledgers: the book currency with its policy, and the optional parallel currency
 * with its own. Vertex Media: book SYP at `bulletin`; parallel USD at `market`, accepting Hub's rate.
 */
export const companyLedgersSchema = z
  .object({
    book: ledgerSettingsSchema,
    parallel: ledgerSettingsSchema.nullable(),
  })
  .refine((ledgers) => ledgers.parallel?.currency !== ledgers.book.currency, {
    message: 'The parallel currency differs from the book currency',
    path: ['parallel', 'currency'],
  })
  .meta({ id: 'CompanyLedgers' });

export type CompanyLedgers = z.infer<typeof companyLedgersSchema>;
