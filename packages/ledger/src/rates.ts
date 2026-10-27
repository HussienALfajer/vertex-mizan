import type { CrossRate, CurrencyCode, ExchangeRate, RateType } from '@vertex-mizan/contracts';

/** A rate lookup: the rate of `type` between two currencies in force on the date `on`. */
export interface RateQuery {
  readonly type: RateType;
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly on: string;
}

/**
 * The company's bulletin publication calendar (ADR 0011, S02 rules 16–17): the ISO weekdays
 * (1 Monday … 7 Sunday) the bank publishes no bulletin, and the holidays the accountant marked.
 */
export interface PublicationCalendar {
  readonly daysOff: readonly number[];
  readonly holidays: readonly string[];
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 of a `YYYY-MM-DD` date (proleptic Gregorian; no clock, no `Date`). */
function dayNumber(date: string): number {
  const match = DATE.exec(date);
  if (match === null) throw new RangeError(`Expected a date YYYY-MM-DD, got ${date}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The `YYYY-MM-DD` date of a day number (`dayNumber`'s inverse). */
function dateOf(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The ISO weekday of a day number: 1970-01-01 was a Thursday (4). */
function isoWeekday(days: number): number {
  return ((((days + 3) % 7) + 7) % 7) + 1;
}

/**
 * The latest publication day on or before `on` (*P*, S02 rule 16): a day that is neither a weekly
 * day off nor a holiday. Null when every weekday is a day off, so no bulletin is ever in force.
 */
export function lastPublicationDay(on: string, calendar: PublicationCalendar): string | null {
  const daysOff = new Set(calendar.daysOff);
  if ([1, 2, 3, 4, 5, 6, 7].every((weekday) => daysOff.has(weekday))) return null;
  const holidays = new Set(calendar.holidays);
  let day = dayNumber(on);
  for (;;) {
    const date = dateOf(day);
    if (!daysOff.has(isoWeekday(day)) && !holidays.has(date)) return date;
    day -= 1;
  }
}

/** Whether a rate quotes one of two currencies in the other, either way round. */
export function quotesPair(rate: ExchangeRate, a: CurrencyCode, b: CurrencyCode): boolean {
  return (rate.base === a && rate.quote === b) || (rate.base === b && rate.quote === a);
}

/**
 * The rate of a type for a pair in force on a date (ADR 0007, amended for the bulletin by
 * ADR 0011): the newest row effective on or before that date, and among rows of that date the one
 * recorded last (a correction is a newer row). A `bulletin` row is in force only if it is
 * effective on or after the latest publication day on or before the date (`lastPublicationDay`):
 * a working day needs its own bulletin, a day off or a holiday takes the last published one. A
 * `market` row ignores the calendar. A row converts both ways, from its quote currency by
 * dividing, so the order of `from` and `to` does not matter. `rates` is the company rate table in
 * recording order. Null when no row is in force: a missing rate never defaults.
 */
export function rateInForce(
  rates: readonly ExchangeRate[],
  query: RateQuery,
  calendar: PublicationCalendar,
): ExchangeRate | null {
  let found: ExchangeRate | null = null;
  for (const rate of rates) {
    if (rate.type !== query.type || rate.effectiveOn > query.on) continue;
    if (!quotesPair(rate, query.from, query.to)) continue;
    if (found === null || rate.effectiveOn >= found.effectiveOn) found = rate;
  }
  if (found === null || query.type !== 'bulletin') return found;
  const published = lastPublicationDay(query.on, calendar);
  return published !== null && found.effectiveOn >= published ? found : null;
}

/**
 * The rate a ledger's policy converts at: the most recent of the direct rate in force and a cross
 * through `via` of two rates of the same type, each in force on the entry date under
 * `rateInForce`'s rule, the bulletin calendar included (their effective dates may differ; owner,
 * 2026-10-20). A cross is as recent as its older quote, and the direct
 * rate wins a tie, so a stale direct rate never overrides fresher quotes (IAS 21.21: the spot
 * rate at the date of the transaction; owner, 2026-10-20). Null when neither exists.
 */
export function policyRate(
  rates: readonly ExchangeRate[],
  query: RateQuery & { readonly via: CurrencyCode | null },
  calendar: PublicationCalendar,
): ExchangeRate | CrossRate | null {
  const { type, from, to, on, via } = query;
  const direct = rateInForce(rates, { type, from, to, on }, calendar);
  if (via === null || via === from || via === to) return direct;
  const first = rateInForce(rates, { type, from, to: via, on }, calendar);
  const second = rateInForce(rates, { type, from: via, to, on }, calendar);
  if (first === null || second === null) return direct;
  const crossDate = first.effectiveOn < second.effectiveOn ? first.effectiveOn : second.effectiveOn;
  if (direct !== null && direct.effectiveOn >= crossDate) return direct;
  return { on, legs: [first, second] };
}
