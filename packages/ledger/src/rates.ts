import type { CrossRate, CurrencyCode, ExchangeRate, RateType } from '@vertex-mizan/contracts';

/** A rate lookup: the rate of `type` between two currencies in force on the date `on`. */
export interface RateQuery {
  readonly type: RateType;
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly on: string;
}

/** Whether a rate quotes one of two currencies in the other, either way round. */
export function quotesPair(rate: ExchangeRate, a: CurrencyCode, b: CurrencyCode): boolean {
  return (rate.base === a && rate.quote === b) || (rate.base === b && rate.quote === a);
}

/**
 * The rate of a type for a pair in force on a date (ADR 0007): the newest row effective on or
 * before that date, and among rows of that date the one recorded last (a correction is a newer
 * row). A row converts both ways, from its quote currency by dividing, so the order of `from` and
 * `to` does not matter. `rates` is the company rate table in recording order. Null when no row is
 * in force: a missing rate never defaults.
 */
export function rateInForce(rates: readonly ExchangeRate[], query: RateQuery): ExchangeRate | null {
  let found: ExchangeRate | null = null;
  for (const rate of rates) {
    if (rate.type !== query.type || rate.effectiveOn > query.on) continue;
    if (!quotesPair(rate, query.from, query.to)) continue;
    if (found === null || rate.effectiveOn >= found.effectiveOn) found = rate;
  }
  return found;
}

/**
 * The rate a ledger's policy converts at: the most recent of the direct rate in force and a cross
 * through `via` of two rates of the same type, each in force on the entry date (their effective
 * dates may differ; owner, 2026-10-20). A cross is as recent as its older quote, and the direct
 * rate wins a tie, so a stale direct rate never overrides fresher quotes (IAS 21.21: the spot
 * rate at the date of the transaction; owner, 2026-10-20). Null when neither exists.
 */
export function policyRate(
  rates: readonly ExchangeRate[],
  query: RateQuery & { readonly via: CurrencyCode | null },
): ExchangeRate | CrossRate | null {
  const { type, from, to, on, via } = query;
  const direct = rateInForce(rates, { type, from, to, on });
  if (via === null || via === from || via === to) return direct;
  const first = rateInForce(rates, { type, from, to: via, on });
  const second = rateInForce(rates, { type, from: via, to, on });
  if (first === null || second === null) return direct;
  const crossDate = first.effectiveOn < second.effectiveOn ? first.effectiveOn : second.effectiveOn;
  if (direct !== null && direct.effectiveOn >= crossDate) return direct;
  return { on, legs: [first, second] };
}
