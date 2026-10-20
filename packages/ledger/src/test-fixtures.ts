import type {
  CompanyLedgers,
  CurrencyCode,
  ErrorCode,
  ExchangeRate,
  RateType,
} from '@vertex-mizan/contracts';
import { DomainError } from '@vertex-mizan/contracts';

/**
 * Synthetic companies and rates for the tests (no real rates, companies or amounts). Not part of
 * the build (`tsconfig.build.json`). Account codes are placeholders until the chart-of-accounts
 * templates are approved (Q3), as in `docs/scenarios/README.md`.
 */

/** A rate-table row: `rate` units of `quote` per one `base`. */
export function rate(
  base: CurrencyCode,
  quote: CurrencyCode,
  value: string,
  type: RateType,
  effectiveOn: string,
  source: ExchangeRate['source'] = 'manual',
): ExchangeRate {
  return { effectiveOn, base, quote, rate: value, type, source };
}

/** Hub's own SYP-per-USD rate on an event, as the transaction rate. */
export function hubRate(value: string, on: string): ExchangeRate {
  return rate('USD', 'SYP', value, 'market', on, 'hub');
}

/** Shape `syp`: SYP books at the bulletin, no parallel ledger (the default company). */
export const sypOnly: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: null,
};

/** Shape `syp-usd` (Vertex Media): SYP books at the bulletin, USD parallel at the market, Hub's rate accepted. */
export const sypUsd: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

/** Shape `usd-syp`: USD books at the bulletin, SYP parallel at the market. */
export const usdSyp: CompanyLedgers = {
  book: { currency: 'USD', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'SYP', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

/** The code of the `DomainError` that `run` throws, or `none`. */
export function refusal(run: () => unknown): ErrorCode | 'none' {
  try {
    run();
    return 'none';
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
}
