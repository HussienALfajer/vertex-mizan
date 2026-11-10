import { type CompanyLedgers, type Money, money } from '@vertex-mizan/contracts';
import { allocate, allocateCarried } from './allocation.js';
import { clearOpenItem } from './carried.js';
import { type CarriedAmounts, keptLedgers, ledgerAmount, negate } from './lines.js';
import { daysBetween, lastDayOfMonth, periodOf } from './periods.js';
import { share } from './share.js';

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
 * The release of each month that is not elapsed, from what the line deferred at issue (what
 * remains to recognise in contract liabilities, in every ledger, as positive amounts; a release
 * debits the liability with each part): the transaction part is the month's part of
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

/**
 * A cycle's over-time schedule a retainer credit reduces (S06 rule 6): its transaction amount net of
 * earlier credits (*N*, positive) and what remains of it in contract liabilities in every ledger
 * (*R*, positive amounts), in the credit's currency.
 */
export interface CreditedSchedule {
  readonly netMinor: bigint;
  readonly remaining: CarriedAmounts;
}

/**
 * A schedule's part of a credit, as positive debits: the transaction amount that reduces service
 * revenue, which the posting rule measures anew at the credit invoice's rates (IFRS 15.88,
 * cumulative catch-up), and the carried amounts that reduce its contract liability, null when
 * nothing of the part is left to the liability (IAS 21.23(b)).
 */
export interface CreditPart {
  readonly revenueMinor: bigint;
  readonly liability: CarriedAmounts | null;
}

/**
 * Splits a retainer credit (`creditMinor`, positive: what Hub's negative line takes off) over a
 * cycle's active schedules, in the order they were created (`docs/scenarios/revenue/retainer-credit.md`,
 * owner 2026-11-10). The parts across the schedules are cut with cumulative rounding by each
 * schedule's amount net of earlier credits. On each schedule, the share already recognised,
 * `round(c × (N − R) ÷ N)`, reduces revenue, and the rest its liability at what the liability
 * carries, each ledger in proportion to what remains (`clearOpenItem()`), everything left when the
 * rest is all of *R*; so the measure of progress is the same before and after the credit (IFRS
 * 15.87–88). A credit larger than the schedules' net amounts is the caller's to hold
 * (`credit_exceeds_cycle`) before calling; a schedule in another currency, or whose remaining is
 * more than its net amount, is a programming error.
 */
export function creditParts(
  creditMinor: bigint,
  schedules: readonly CreditedSchedule[],
): CreditPart[] {
  if (creditMinor <= 0n) throw new RangeError('A credit of zero or less');
  const currencies = new Set(schedules.map((schedule) => schedule.remaining.transaction.currency));
  if (currencies.size !== 1) throw new TypeError("A cycle's schedules in other than one currency");
  const net = schedules.map((schedule) => schedule.netMinor);
  if (creditMinor > net.reduce((total, value) => total + value, 0n)) {
    throw new RangeError("A credit larger than the cycle's amount net of earlier credits");
  }
  const parts = allocate(creditMinor, net);
  return schedules.map((schedule, k) => {
    const part = parts[k] ?? 0n;
    const { netMinor, remaining } = schedule;
    const remainingMinor = remaining.transaction.amountMinor;
    if (remainingMinor < 0n || remainingMinor > netMinor) {
      throw new RangeError('A remaining outside zero and the net amount');
    }
    if (part === 0n) return { revenueMinor: 0n, liability: null };
    const revenueMinor = share(part, netMinor - remainingMinor, netMinor);
    const liabilityMinor = part - revenueMinor;
    return {
      revenueMinor,
      liability: liabilityMinor === 0n ? null : clearOpenItem(negate(remaining), liabilityMinor),
    };
  });
}

/** What a credit's void gives a schedule back, split for the void's date and for later months. */
export interface VoidedCreditParts {
  /** Released on the void date at these carried amounts; null when no day was released since. */
  readonly released: CarriedAmounts | null;
  /** Joins the schedule's remaining, which `remainingReleaseParts()` cuts over its later months. */
  readonly remaining: CarriedAmounts;
}

/**
 * Splits the liability part a credit's void gives a schedule back (`givenBack`, positive amounts:
 * the negation of the reversed `credited` movement; S06 rule 8, owner 2026-11-10): the share of the
 * months released since the credit, `releasedDays` out of `daysAtCredit` (the days of the months not
 * released when the credit posted), is released on the void date (IFRS 15.88), all of it when every
 * one of those days has been released; the rest joins the remaining. Each ledger is split with the
 * same days with cumulative rounding (`allocateCarried()`), so the two parts sum to what came back
 * exactly and none is converted again.
 */
export function voidedCreditParts(
  givenBack: CarriedAmounts,
  releasedDays: bigint,
  daysAtCredit: bigint,
): VoidedCreditParts {
  if (givenBack.transaction.amountMinor <= 0n) throw new RangeError('Nothing given back');
  if (releasedDays < 0n || releasedDays > daysAtCredit) {
    throw new RangeError('Released days outside zero and the days not released at the credit');
  }
  const [released, remaining] = allocateCarried(givenBack, [
    releasedDays,
    daysAtCredit - releasedDays,
  ]) as [CarriedAmounts, CarriedAmounts];
  // A part of zero in the transaction amount takes nothing in any ledger, so what is released and
  // what remains are each zero in every ledger when zero in the transaction (ADR 0007).
  if (released.transaction.amountMinor === 0n) return { released: null, remaining: givenBack };
  if (remaining.transaction.amountMinor === 0n) {
    const { currency } = givenBack.transaction;
    const none = givenBack.parallelMinor === null ? null : 0n;
    return {
      released: givenBack,
      remaining: { transaction: money(0n, currency), bookMinor: 0n, parallelMinor: none },
    };
  }
  return { released, remaining };
}

/**
 * The releases of a schedule whose remaining changed after its deferral (a credit, or the void of
 * a credit; S06 rules 6 and 8): what remains in contract liabilities (positive amounts) is cut
 * again over `months`, the months of its period not yet released and not elapsed, by their days,
 * with cumulative rounding in every ledger (prospective, owner 2026-11-10). A ledger in the
 * line's currency holds the transaction amount and takes the transaction parts. The parts sum to
 * the remaining exactly in every ledger, and none is converted again. A schedule never credited
 * keeps `releaseParts()`.
 */
export function remainingReleaseParts(
  remaining: CarriedAmounts,
  months: readonly OverTimeMonth[],
  ledgers: CompanyLedgers,
): CarriedAmounts[] {
  const { currency, amountMinor } = remaining.transaction;
  if (months.some((month) => month.elapsed)) {
    throw new RangeError('An elapsed month among the months to release');
  }
  if (months.length === 0) {
    if (amountMinor !== 0n) throw new RangeError('A remaining with no month left to release it');
    return [];
  }
  const days = months.map((month) => month.days);
  const transactionParts = allocate(amountMinor, days);
  const parts = new Map(
    keptLedgers(ledgers).map(([ledger, settings]) => {
      const remainingMinor = ledgerAmount(remaining, ledger);
      if (remainingMinor === null) throw new TypeError('A remaining without its parallel amount');
      if (settings.currency !== currency) return [ledger, allocate(remainingMinor, days)];
      if (remainingMinor !== amountMinor) {
        throw new TypeError("A ledger in the line's currency holding another amount");
      }
      return [ledger, transactionParts];
    }),
  );
  const book = parts.get('book') ?? [];
  const parallel = parts.get('parallel');
  return months.map((_, k) => ({
    transaction: money(transactionParts[k] ?? 0n, currency),
    bookMinor: book[k] ?? 0n,
    parallelMinor: parallel === undefined ? null : (parallel[k] ?? 0n),
  }));
}

/**
 * Revenue recognised at a point in time (S06 rules 11–14; `docs/scenarios/revenue/milestones.md`,
 * owner 2026-11-10): a project's milestone, its deposit included, on Hub's done date.
 */

/** The details a milestone's done or its invoice is held `NEEDS_DECISION` with (S06 rule 18). */
export type MilestoneDecision =
  | 'milestone_amount_differs'
  | 'milestone_already_done'
  | 'milestone_service_missing';

/** What the books hold for a milestone when its `milestone.done` arrives. */
export interface MilestoneStanding {
  /** Whether a done of the milestone stands: posted, and not reversed by a reopen. */
  readonly done: boolean;
  /**
   * What remains in contract liabilities of the milestone's standing point-in-time schedule
   * (positive amounts) when its deposit or milestone line was invoiced before; null when it was
   * not, or when that invoice was voided.
   */
  readonly deferred: CarriedAmounts | null;
}

/**
 * What a `milestone.done` posts: the release of what its invoice deferred, at the amounts the
 * liability carries (Dr the schedule's liability / Cr revenue; IAS 21.23(b)); a contract asset for
 * the installment, which the posting rule measures anew at each ledger's policy rate of `done_on`
 * (IFRS 15.107, IAS 21.21–22); or a decision for the accountant.
 */
export type MilestoneDone =
  | { readonly kind: 'release'; readonly amounts: CarriedAmounts }
  | { readonly kind: 'contract_asset'; readonly amount: Money }
  | { readonly kind: 'decision'; readonly detail: MilestoneDecision };

/**
 * The rule of a milestone's done (S06 rule 11; IFRS 15.38): a second done while one stands is
 * `milestone_already_done`, a done without Hub's service `milestone_service_missing`, and a done
 * whose amount is not what its standing schedule still defers, in its currency,
 * `milestone_amount_differs` (a change in the transaction price, IFRS 15.87–88; a schedule
 * already released by the project's completion defers nothing). Otherwise a schedule invoiced
 * before is released whole, and a milestone not invoiced opens its contract asset.
 */
export function milestoneDone(
  amount: Money,
  hasService: boolean,
  standing: MilestoneStanding,
): MilestoneDone {
  if (amount.amountMinor <= 0n) throw new RangeError('A milestone of zero or less');
  if (standing.done) return { kind: 'decision', detail: 'milestone_already_done' };
  if (!hasService) return { kind: 'decision', detail: 'milestone_service_missing' };
  const { deferred } = standing;
  if (deferred === null) return { kind: 'contract_asset', amount };
  const { transaction } = deferred;
  if (transaction.currency !== amount.currency || transaction.amountMinor !== amount.amountMinor) {
    return { kind: 'decision', detail: 'milestone_amount_differs' };
  }
  return { kind: 'release', amounts: deferred };
}

/**
 * The line of a milestone's invoice once the milestone is done (S06 rule 12; IFRS 15.108): the
 * credit to its contract asset item (`item`, the item's open carrying amounts, a debit) for the
 * line's amount, at what the item carries, so the item reaches zero in every ledger; the posting
 * rule posts each ledger's residual of the invoice as a realised difference (IAS 21.28). A line in
 * another currency or of another amount than the item has open is `milestone_amount_differs`.
 */
export function milestoneItemClearing(
  line: Money,
  item: CarriedAmounts,
):
  | { readonly kind: 'clear'; readonly amounts: CarriedAmounts }
  | { readonly kind: 'decision'; readonly detail: 'milestone_amount_differs' } {
  if (item.transaction.amountMinor <= 0n) throw new RangeError('A contract asset item not open');
  if (
    line.currency !== item.transaction.currency ||
    line.amountMinor !== item.transaction.amountMinor
  ) {
    return { kind: 'decision', detail: 'milestone_amount_differs' };
  }
  return { kind: 'clear', amounts: clearOpenItem(item, -line.amountMinor) };
}

/**
 * The reference of a milestone's contract asset item (S06 "Data"): Hub's milestone number for its
 * first done, and `<number>/<n>` for the *n*-th done after reopens, since a reopen settles the
 * earlier item at zero and an item is opened once (S04 rule 2; owner, 2026-11-10).
 */
export function milestoneItemReference(number: string, earlierItems: number): string {
  if (!Number.isInteger(earlierItems) || earlierItems < 0) {
    throw new RangeError('A count of earlier items that is not a whole number');
  }
  return earlierItems === 0 ? number : `${number}/${earlierItems + 1}`;
}

/**
 * What `project.completed` releases (S06 rule 14): the remaining of each of the project's
 * point-in-time schedules (positive amounts) that still defers something, at its carried amounts.
 * None left: the event is recorded with no entry. A remaining of zero in its transaction amount is
 * zero in every ledger (ADR 0007), or it is a programming error.
 */
export function completedProjectReleases(remaining: readonly CarriedAmounts[]): CarriedAmounts[] {
  return remaining.filter((amounts) => {
    if (amounts.transaction.amountMinor < 0n) throw new RangeError('A remaining below zero');
    if (amounts.transaction.amountMinor !== 0n) return true;
    if (amounts.bookMinor !== 0n || (amounts.parallelMinor ?? 0n) !== 0n) {
      throw new RangeError('A remaining of zero that is not zero in a ledger');
    }
    return false;
  });
}

function dayAfter(monthEnd: string): string {
  const [year, month] = monthEnd.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}
