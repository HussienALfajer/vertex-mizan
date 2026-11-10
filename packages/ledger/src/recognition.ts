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
  | 'milestone_service_missing'
  | 'milestone_released_at_completion';

/** What the books hold for a milestone when its `milestone.done` arrives. */
export interface MilestoneStanding {
  /**
   * Whether a done of the milestone stands: its entry posted and not reversed, by a reopen or by
   * the void of its invoice (owner, 2026-11-10, Q14).
   */
  readonly done: boolean;
  /**
   * Whether a re-issue's revenue at issue for the milestone stands (S06 rule 9): its entry posted
   * and not reversed by a later void. The milestone is recognised, so a done then is a second one
   * (owner, 2026-11-10); once a void reverses that entry, it is false again.
   */
  readonly recognisedAtIssue: boolean;
  /**
   * What remains in contract liabilities of the milestone's standing point-in-time schedule
   * (positive amounts) when its deposit or milestone line was invoiced before; null when it was
   * not, or when that invoice was voided. A schedule the project's completion released defers
   * nothing (zero in every ledger).
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
 * whose amount is not its standing schedule's, in its currency, `milestone_amount_differs` (a
 * change in the transaction price, IFRS 15.87–88). Otherwise a schedule invoiced before is released
 * whole, and a milestone not invoiced opens its contract asset. A point-in-time schedule defers its
 * whole amount until its done or the project's completion, so one that defers nothing was released
 * by the completion: `milestone_released_at_completion`, so that nothing is recognised twice (owner,
 * 2026-11-10, Q14).
 */
export function milestoneDone(
  amount: Money,
  hasService: boolean,
  standing: MilestoneStanding,
): MilestoneDone {
  if (amount.amountMinor <= 0n) throw new RangeError('A milestone of zero or less');
  if (standing.done || standing.recognisedAtIssue) {
    return { kind: 'decision', detail: 'milestone_already_done' };
  }
  if (!hasService) return { kind: 'decision', detail: 'milestone_service_missing' };
  const { deferred } = standing;
  if (deferred === null) return { kind: 'contract_asset', amount };
  const { transaction } = deferred;
  if (transaction.amountMinor < 0n) throw new RangeError('A schedule deferring less than nothing');
  if (transaction.amountMinor === 0n) {
    return { kind: 'decision', detail: 'milestone_released_at_completion' };
  }
  if (transaction.currency !== amount.currency || transaction.amountMinor !== amount.amountMinor) {
    return { kind: 'decision', detail: 'milestone_amount_differs' };
  }
  return { kind: 'release', amounts: deferred };
}

/** What the books hold for a milestone when its `milestone.reopened` arrives. */
export interface MilestoneReopenStanding {
  /** Whether a done's entry stands: posted, and reversed neither by a reopen nor by a void. */
  readonly doneStanding: boolean;
  /**
   * Whether the milestone's latest done had its release reversed by the void of its invoice, with
   * no reopen since (S06 rule 8). A fact of the milestone's history: it stays true through later
   * voids and re-issues, so every re-issue after it is revenue at issue.
   */
  readonly doneTakenBackByVoid: boolean;
}

/**
 * The rule of `milestone.reopened` (S06 rule 13; owner, 2026-11-10, Q14): the exact reversal of the
 * done's entry while it stands; recorded with no entry when the void of its invoice already took
 * the done's release back (`revenue/void-and-reissue.md`); otherwise no done to reopen,
 * `UNKNOWN_REFERENCE`, retried when a done posts (rule 19).
 */
export function milestoneReopen(
  standing: MilestoneReopenStanding,
): 'reverse' | 'record' | 'unknown_reference' {
  if (standing.doneStanding && standing.doneTakenBackByVoid) {
    throw new TypeError('A done both standing and taken back by its void');
  }
  if (standing.doneStanding) return 'reverse';
  return standing.doneTakenBackByVoid ? 'record' : 'unknown_reference';
}

/** What the books hold for a milestone when a re-issue of its voided line arrives. */
export interface ReissuedMilestoneStanding extends MilestoneReopenStanding {
  /**
   * Whether the project's completion released one of the milestone's schedules and a void took
   * that release back, with no done or reopen of the milestone since. A fact of the milestone's
   * history, like `doneTakenBackByVoid`: it stays true through later voids and re-issues, so a
   * second re-issue is revenue at issue too (owner, 2026-11-10); a done since makes it false.
   */
  readonly completionTakenBackByVoid: boolean;
}

/**
 * What a re-issued deposit or milestone line posts (S06 rule 9; owner, 2026-11-10,
 * `revenue/void-and-reissue.md`): it clears the milestone's contract asset when a done stands (rule
 * 12); it is revenue at issue when the void reversed the done's release or the project's
 * completion's, with no reopen since, since the milestone or the project is delivered and Hub sends
 * no new done; otherwise, the milestone reopened or never done, it is deferred until its done (rule 1).
 */
export function reissuedMilestoneLine(
  standing: ReissuedMilestoneStanding,
): 'clear_item' | 'revenue_at_issue' | 'defer' {
  const takenBack = standing.doneTakenBackByVoid || standing.completionTakenBackByVoid;
  if (standing.doneStanding && takenBack) {
    throw new TypeError('A done both standing and taken back by its void');
  }
  if (standing.doneStanding) return 'clear_item';
  return takenBack ? 'revenue_at_issue' : 'defer';
}

/** A re-issued over-time line: its part recognised at issue, and the months it still has. */
export interface ReissueParts {
  readonly kind: 'parts';
  /**
   * The re-issued line's part of the months the void took back, recognised as revenue at issue,
   * a new measurement at the re-issue's rates.
   */
  readonly catchUpMinor: bigint;
  /**
   * The line's other months, as `overTimeMonths()` marked them: elapsed ones are contract assets at
   * their month ends' rates (rule 7), the rest are deferred and released (`releaseParts()`).
   */
  readonly months: OverTimeMonth[];
}

/**
 * Splits a re-issued over-time line (S06 rule 9; owner, 2026-11-10): `months` is the line's own
 * day split (`overTimeMonths()` at the re-issue's issue date) and `takenBack` the months the void
 * took back, those of the voided schedule released or elapsed before the void. The re-issued line's
 * parts of those months are recognised at issue, so a re-issue at another amount recognises its own
 * part of them (IFRS 15.88), and with the voided line's amount exactly what the void took back. Its
 * other months follow rules 3–7. A re-issue whose period does not cover every month taken back
 * (Hub shortened the cycle) is `reissue_period_differs`, held for the accountant (owner, 2026-11-10).
 */
export function reissueParts(
  months: readonly OverTimeMonth[],
  takenBack: ReadonlySet<string>,
): ReissueParts | { readonly kind: 'decision'; readonly detail: 'reissue_period_differs' } {
  const covered = new Set(months.map((month) => month.month));
  for (const month of takenBack) {
    if (!covered.has(month)) return { kind: 'decision', detail: 'reissue_period_differs' };
  }
  return {
    kind: 'parts',
    catchUpMinor: months
      .filter((month) => takenBack.has(month.month))
      .reduce((total, month) => total + month.transactionMinor, 0n),
    months: months.filter((month) => !takenBack.has(month.month)),
  };
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
 * point-in-time schedules (positive amounts) that still defers something, at its carried amounts,
 * each schedule's release its own entry, so a void of its invoice reverses it alone (owner,
 * 2026-11-10).
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
