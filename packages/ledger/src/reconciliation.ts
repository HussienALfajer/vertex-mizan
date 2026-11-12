import type {
  EventState,
  EventType,
  HoldReason,
  HubDelivery,
  ReconciliationAmount,
  ReconciliationDayState,
  ReconciliationKind,
} from '@vertex-mizan/contracts';
import { totalKeyOf } from '@vertex-mizan/contracts';
import { dayAfter } from './periods.js';

/**
 * The daily reconciliation's comparison (S08 rules 7–11, ADR 0017): Hub's latest report of a
 * client and date against the events Mizan received from that client, event by event; the day's
 * state; the totals per type and currency on both sides. Pure: `packages/db` reads both sides and
 * calls these functions, on read and inside the close.
 */

/** An event of Hub's report (S08 rule 1), its amount by rule 2. */
export interface HubSideEvent {
  readonly id: string;
  readonly type: EventType;
  readonly amount: ReconciliationAmount | null;
  readonly delivery: HubDelivery;
  readonly refusalCode: string | null;
}

/** An event of Hub's report with the accounting date of the report that lists it. */
export interface ReportedEvent extends HubSideEvent {
  readonly accountingDate: string;
}

/** An event Mizan received (S08 rule 7): its type, date, amount by rule 2 and state (S05). */
export interface MizanSideEvent {
  readonly id: string;
  readonly inboxId: string;
  readonly type: EventType;
  readonly accountingDate: string;
  readonly amount: ReconciliationAmount | null;
  readonly state: EventState;
  readonly holdReason: HoldReason | null;
}

/** What the comparison of one date reads. */
export interface DayComparisonInput {
  /** The accounting date compared. */
  readonly date: string;
  /** The events of the date's latest report, in its order; null without a report. */
  readonly report: readonly HubSideEvent[] | null;
  /**
   * Mizan's events of the client dated `date`, in received order, and those whose id the report
   * lists under another accounting date.
   */
  readonly received: readonly MizanSideEvent[];
  /**
   * For Mizan's events dated `date` that the report does not list: the event as another date's
   * latest report lists it (rule 8: `date_differs`, not `missing_in_hub`).
   */
  readonly reportedElsewhere: ReadonlyMap<string, ReportedEvent>;
}

/** One event of the day with its kind (rule 8) and both sides, either null. */
export interface ComparedEvent {
  readonly kind: ReconciliationKind;
  readonly eventId: string;
  readonly hub: ReportedEvent | null;
  readonly mizan: MizanSideEvent | null;
}

const sameAmount = (a: ReconciliationAmount | null, b: ReconciliationAmount | null) =>
  a === null || b === null ? a === b : a.currency === b.currency && a.amount === b.amount;

/** The kind of an event found in both: date, then type, then amount (rule 8). */
function kindOf(hub: ReportedEvent, mizan: MizanSideEvent): ReconciliationKind {
  if (hub.accountingDate !== mizan.accountingDate) return 'date_differs';
  if (hub.type !== mizan.type) return 'type_differs';
  if (!sameAmount(hub.amount, mizan.amount)) return 'amount_differs';
  return 'matched';
}

/**
 * The comparison of one client and date (rule 8): each event of the report in its order, then
 * each event Mizan received dated `date` that the report does not list, in received order. Without
 * a report, Mizan's events of the date are `missing_in_hub` (or `date_differs`); the day's state
 * says the report is awaited.
 */
export function compareDay(input: DayComparisonInput): ComparedEvent[] {
  const received = new Map(input.received.map((event) => [event.id, event]));
  const compared: ComparedEvent[] = [];
  const listed = new Set<string>();
  for (const event of input.report ?? []) {
    const hub: ReportedEvent = { ...event, accountingDate: input.date };
    const mizan = received.get(event.id) ?? null;
    listed.add(event.id);
    compared.push({
      kind: mizan === null ? 'missing_in_mizan' : kindOf(hub, mizan),
      eventId: event.id,
      hub,
      mizan,
    });
  }
  for (const mizan of input.received) {
    if (mizan.accountingDate !== input.date || listed.has(mizan.id)) continue;
    const elsewhere = input.reportedElsewhere.get(mizan.id) ?? null;
    compared.push({
      kind: elsewhere === null ? 'missing_in_hub' : 'date_differs',
      eventId: mizan.id,
      hub: elsewhere,
      mizan,
    });
  }
  return compared;
}

/** The gaps of a comparison: every event that is not `matched` (rule 8). */
export function gapsOf(compared: readonly ComparedEvent[]): ComparedEvent[] {
  return compared.filter((event) => event.kind !== 'matched');
}

/** What a day's state reads (rule 10). */
export interface DayStateInput {
  readonly date: string;
  /** The client's start date (rule 13). */
  readonly reconcileFrom: string;
  /** The day the client was archived in Asia/Damascus, the last required; null while active. */
  readonly archivedOn: string | null;
  /** Whether a report for the date has arrived. */
  readonly reported: boolean;
  /** The gaps the date's latest report leaves (rule 8). */
  readonly gaps: number;
  /** Now in Asia/Damascus, `YYYY-MM-DDTHH:MM`. */
  readonly now: string;
}

/** The hour of the next day from which a missing report is `missing` (rule 10). */
const REPORT_DUE_TIME = '08:00';

/**
 * A client's day (rule 10): `not_required` before its start date or after its archive day;
 * without a report `pending` until 08:00 in Damascus the next day, `missing` from then on;
 * otherwise `differences` with a gap, `matched` without.
 */
export function dayState(input: DayStateInput): ReconciliationDayState {
  if (input.date < input.reconcileFrom) return 'not_required';
  if (input.archivedOn !== null && input.date > input.archivedOn) return 'not_required';
  if (!input.reported) {
    return input.now < `${dayAfter(input.date)}T${REPORT_DUE_TIME}` ? 'pending' : 'missing';
  }
  return input.gaps > 0 ? 'differences' : 'matched';
}

/** A type and currency's figures on both sides (rule 11). */
export interface DayTotal {
  readonly type: EventType;
  readonly currency: ReconciliationAmount['currency'] | null;
  readonly hubCount: number;
  readonly hubAmount: bigint | null;
  readonly receivedCount: number;
  readonly receivedAmount: bigint | null;
  readonly states: Readonly<Record<EventState, number>>;
}

const noStates = (): Record<EventState, number> => ({
  held: 0,
  posted: 0,
  recorded: 0,
  resolved: 0,
  dismissed: 0,
});

/**
 * The day's totals per type and currency (rule 11): Hub's count and total from its report beside
 * Mizan's received count and total of the date and its counts per state. Currencies are never
 * added together; a type without an amount has null totals. Ordered by the catalogue's type order
 * the caller gives, then currency.
 */
export function dayTotals(
  report: readonly HubSideEvent[] | null,
  receivedOnDate: readonly MizanSideEvent[],
  typeOrder: readonly EventType[],
): DayTotal[] {
  const totals = new Map<
    string,
    {
      type: EventType;
      currency: ReconciliationAmount['currency'] | null;
      hubCount: number;
      hubAmount: bigint | null;
      receivedCount: number;
      receivedAmount: bigint | null;
      states: Record<EventState, number>;
    }
  >();
  const rowOf = (type: EventType, amount: ReconciliationAmount | null) => {
    const currency = amount?.currency ?? null;
    const key = totalKeyOf(type, currency);
    const row = totals.get(key) ?? {
      type,
      currency,
      hubCount: 0,
      hubAmount: amount === null ? null : 0n,
      receivedCount: 0,
      receivedAmount: amount === null ? null : 0n,
      states: noStates(),
    };
    totals.set(key, row);
    return row;
  };
  for (const event of report ?? []) {
    const row = rowOf(event.type, event.amount);
    row.hubCount += 1;
    if (event.amount !== null && row.hubAmount !== null) row.hubAmount += event.amount.amount;
  }
  for (const event of receivedOnDate) {
    const row = rowOf(event.type, event.amount);
    row.receivedCount += 1;
    if (event.amount !== null && row.receivedAmount !== null) {
      row.receivedAmount += event.amount.amount;
    }
    row.states[event.state] += 1;
  }
  return [...totals.values()].sort(
    (a, b) =>
      typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) ||
      (a.currency ?? '').localeCompare(b.currency ?? ''),
  );
}
