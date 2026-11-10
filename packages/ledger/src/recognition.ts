import { type CompanyLedgers, money } from '@vertex-mizan/contracts';
import { allocate } from './allocation.js';
import { type CarriedAmounts, keptLedgers, ledgerAmount } from './lines.js';
import { daysBetween, lastDayOfMonth, periodOf } from './periods.js';

/**
 * Revenue recognised over time (S06 rules 3–5 and 7; `docs/scenarios/revenue/over-time-release.md`,
 * owner 2026-11-10): a line's amount is spread evenly over the days of its service period, both ends
 * included, actual days, and cut per month with cumulative rounding (ADR 0007 "Allocation"). Dates
 * are `YYYY-MM-DD` strings and months `YYYY-MM`; no clock.
 */

/** One calendar month a service period touches, with its part of the line's transaction amount. */
export interface OverTimeMonth {
  readonly month: string;
  /** The month's last day: the date of its release, or of its elapsed part's entry. */
  readonly lastDay: string;
  /** The days of the service period in this month. */
  readonly days: bigint;
  /** The month's part of the line's transaction amount (S06 rule 3). */
  readonly transactionMinor: bigint;
  /**
   * Whether the month ended before the month of the invoice's issue: its part is recognised at
   * issue as a contract asset at the month end's rates, not deferred (S06 rule 7).
   */
  readonly elapsed: boolean;
}

/**
 * The months of a service period `from`–`to` (both included) with their days and their part of the
 * transaction amount `amountMinor`: `round(A × days to the end of m ÷ T) − round(A × days to the end
 * of m−1 ÷ T)`, halves away from zero, from the period's first day whatever the issue date, so each
 * month's transaction part is the same whether the invoice is on time or late. `issuedOn` only marks
 * the elapsed months: those ending before its month.
 */
export function overTimeMonths(
  amountMinor: bigint,
  from: string,
  to: string,
  issuedOn: string,
): OverTimeMonth[] {
  if (daysBetween(from, to) < 0) throw new RangeError(`A service period ending before it starts`);
  const issueMonth = periodOf(issuedOn);
  const spans: { month: string; lastDay: string; days: bigint }[] = [];
  let start = from;
  for (;;) {
    const monthEnd = lastDayOfMonth(start);
    const end = daysBetween(monthEnd, to) < 0 ? to : monthEnd;
    spans.push({
      month: periodOf(start),
      lastDay: monthEnd,
      days: BigInt(daysBetween(start, end) + 1),
    });
    if (end === to) break;
    start = dayAfter(monthEnd);
  }
  const parts = allocate(
    amountMinor,
    spans.map((span) => span.days),
  );
  return spans.map((span, k) => ({
    ...span,
    transactionMinor: parts[k] ?? 0n,
    elapsed: span.month < issueMonth,
  }));
}

/**
 * The release of each month that is not elapsed, from what the line deferred at issue (its
 * contract-liability amounts, in every ledger): the transaction part is the month's part of
 * `overTimeMonths()`, which the deferred transaction amount must equal in total. A ledger in the
 * line's currency takes that part as is (ADR 0007); any other ledger cuts its own deferred amount
 * with cumulative rounding by the days of those months only (option A, owner 2026-11-10). The parts
 * sum to the deferral exactly in every ledger, and none is ever converted again (IAS 21.23(b)).
 */
export function releaseParts(
  deferred: CarriedAmounts,
  months: readonly OverTimeMonth[],
  ledgers: CompanyLedgers,
): CarriedAmounts[] {
  const released = months.filter((month) => !month.elapsed);
  const { currency, amountMinor } = deferred.transaction;
  const transactionTotal = released.reduce((total, month) => total + month.transactionMinor, 0n);
  if (transactionTotal !== amountMinor) {
    throw new RangeError('The deferral is not the transaction part of the months not elapsed');
  }
  if (released.length === 0) return [];
  const transactionParts = released.map((month) => month.transactionMinor);
  const days = released.map((month) => month.days);
  const parts = new Map(
    keptLedgers(ledgers).map(([ledger, settings]) => {
      const deferredMinor = ledgerAmount(deferred, ledger);
      if (deferredMinor === null) throw new TypeError('A deferral without its parallel amount');
      if (settings.currency !== currency) return [ledger, allocate(deferredMinor, days)];
      if (deferredMinor !== amountMinor) {
        throw new TypeError("A ledger in the line's currency deferred another amount");
      }
      return [ledger, transactionParts];
    }),
  );
  const book = parts.get('book') ?? [];
  const parallel = parts.get('parallel');
  return released.map((month, k) => ({
    transaction: money(month.transactionMinor, currency),
    bookMinor: book[k] ?? 0n,
    parallelMinor: parallel === undefined ? null : (parallel[k] ?? 0n),
  }));
}

function dayAfter(monthEnd: string): string {
  const [year, month] = monthEnd.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}
