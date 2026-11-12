import { z } from 'zod';
import {
  type EventEnvelope,
  type EventType,
  eventStateSchema,
  eventTypeSchema,
  type HubCurrency,
  holdReasonSchema,
  hubCurrencySchema,
} from './events.js';
import { periodSchema } from './periods.js';
import { entryNumberSchema, minorUnitsSchema } from './wire.js';

/**
 * The daily reconciliation with Hub (S08, ADR 0017): the report Hub sends for one accounting date
 * (`POST /v1/reconciliation/daily`), one definition of an event's amount for both sides, the
 * comparison's kinds and day states, the events Mizan received for a date
 * (`GET /v1/events?date=`), and the internal `/api/reconciliation` reads.
 *
 * `/v1` names are snake_case and its amounts JSON integers in minor units (within 2^53), as the
 * event contracts (ADR 0006); the internal `/api` sends amounts as `MinorUnits` strings (S03).
 * Every list here is append-only within `/v1`: Hub shows a value it does not know (ADR 0006).
 */

const dateSchema = z.iso.date();
const instantSchema = z.iso.datetime({ offset: true });

/** An amount in minor units as `/v1` carries it: a JSON integer, signed (a retainer credit). */
const hubSignedMinorSchema = z.int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

/** Hub's state of an event in its outbox (S08 rule 3): shown, never trusted. */
export const HUB_DELIVERY_STATES = ['pending', 'delivered', 'refused'] as const;

export const hubDeliverySchema = z.enum(HUB_DELIVERY_STATES).meta({ id: 'HubDelivery' });

export type HubDelivery = z.infer<typeof hubDeliverySchema>;

/** What each event of a day is (S08 rule 8); every kind but `matched` is a gap. */
export const RECONCILIATION_KINDS = [
  'matched',
  'missing_in_mizan',
  'missing_in_hub',
  'date_differs',
  'type_differs',
  'amount_differs',
] as const;

export const reconciliationKindSchema = z
  .enum(RECONCILIATION_KINDS)
  .meta({ id: 'ReconciliationKind' });

export type ReconciliationKind = z.infer<typeof reconciliationKindSchema>;

/** The kinds that are gaps (S08 rule 8). */
export type ReconciliationGapKind = Exclude<ReconciliationKind, 'matched'>;

/** A day's state for a client or a company (S08 rule 10). */
export const RECONCILIATION_DAY_STATES = [
  'not_required',
  'pending',
  'missing',
  'differences',
  'matched',
] as const;

export const reconciliationDayStateSchema = z
  .enum(RECONCILIATION_DAY_STATES)
  .meta({ id: 'ReconciliationDayState' });

export type ReconciliationDayState = z.infer<typeof reconciliationDayStateSchema>;

/** A company's day is the worst of its clients' (S08 rule 10), in this order, worst first. */
export const DAY_STATE_SEVERITY: readonly ReconciliationDayState[] = [
  'missing',
  'differences',
  'pending',
  'matched',
  'not_required',
];

/** The worst of some days' states; `not_required` for none (S08 rule 10). */
export function worstDayState(states: readonly ReconciliationDayState[]): ReconciliationDayState {
  return DAY_STATE_SEVERITY.find((state) => states.includes(state)) ?? 'not_required';
}

/** Whether a day counts as clean for the close (S08 rule 12). */
export function dayStateIsClean(state: ReconciliationDayState): boolean {
  return state === 'matched' || state === 'not_required';
}

/** What explains a matched event or a day without being a gap (S08 rule 9). */
export const RECONCILIATION_ANNOTATIONS = ['held', 'resolved', 'dismissed', 'adjusted'] as const;

export const reconciliationAnnotationKindSchema = z
  .enum(RECONCILIATION_ANNOTATIONS)
  .meta({ id: 'ReconciliationAnnotationKind' });

export type ReconciliationAnnotationKind = z.infer<typeof reconciliationAnnotationKindSchema>;

/** An event's amount (S08 rule 2), in minor units of its currency. */
export interface ReconciliationAmount {
  readonly currency: HubCurrency;
  readonly amount: bigint;
}

/** The types with an amount (S08 rule 2); every other type is counted only. */
const AMOUNT_TYPES: Readonly<Record<EventType, boolean>> = {
  'invoice.issued': true,
  'invoice.voided': false,
  'invoice.line_service_changed': false,
  'invoice.due_date_changed': false,
  'payment.recorded': true,
  'payment.voided': false,
  'milestone.done': true,
  'project.completed': false,
  'project.cancelled': false,
  'project_expense.recorded': true,
  'project_expense.changed': true,
  'project_expense.archived': false,
  'ad_wallet.deposited': true,
  'ad_wallet.refunded': true,
  'ad_wallet.entry_voided': false,
  'ad_spend.recorded': true,
  'ad_spend.changed': true,
  'ad_spend.archived': false,
  'rate.changed': false,
  'milestone.reopened': false,
};

/** Whether events of a type carry an amount in the reconciliation (S08 rule 2). */
export function eventTypeHasAmount(type: EventType): boolean {
  return AMOUNT_TYPES[type];
}

/**
 * An event's amount for the reconciliation (S08 rule 2), the one definition both sides read: an
 * invoice's currency and the sum of its lines (a retainer credit negative) and their taxes; a
 * payment's, a milestone's, a project expense's and an ad wallet entry's currency and amount; an
 * ad spend's `usd_spend` in USD; null for every other type. A type appended to the catalogue
 * appends its case here (ADR 0006).
 */
export function reconciliationAmountOf(event: EventEnvelope): ReconciliationAmount | null {
  switch (event.type) {
    case 'invoice.issued': {
      let amount = 0n;
      for (const line of event.payload.lines) {
        amount += BigInt(line.amount);
        for (const tax of line.taxes ?? []) amount += BigInt(tax.amount);
      }
      return { currency: event.payload.currency, amount };
    }
    case 'payment.recorded':
    case 'milestone.done':
    case 'project_expense.recorded':
    case 'project_expense.changed':
    case 'ad_wallet.deposited':
    case 'ad_wallet.refunded':
      return { currency: event.payload.currency, amount: BigInt(event.payload.amount) };
    case 'ad_spend.recorded':
    case 'ad_spend.changed':
      return { currency: 'USD', amount: BigInt(event.payload.usd_spend) };
    case 'invoice.voided':
    case 'invoice.line_service_changed':
    case 'invoice.due_date_changed':
    case 'payment.voided':
    case 'project.completed':
    case 'project.cancelled':
    case 'project_expense.archived':
    case 'ad_wallet.entry_voided':
    case 'ad_spend.archived':
    case 'rate.changed':
    case 'milestone.reopened':
      return null;
  }
}

/** An event's amount on `/v1`: its currency and minor units as a JSON integer. */
export const reconciliationAmountSchema = z
  .object({ currency: hubCurrencySchema, amount: hubSignedMinorSchema })
  .meta({ id: 'ReconciliationAmount' });

/** An event's amount as `/v1` answers it, or null for a type without one. */
export function wireAmountOf(amount: ReconciliationAmount | null) {
  return amount === null ? null : { currency: amount.currency, amount: Number(amount.amount) };
}

/** At most this many events in one report (S08 rule 1). */
export const RECONCILIATION_REPORT_EVENT_LIMIT = 5000;

/** An error code as Hub received it (S08 rule 3), upper snake case. */
const refusalCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, 'Expected an error code');

/** One event of Hub's report (S08 rule 1): its id, type, amount and Hub's delivery state. */
export const reconciliationReportEventSchema = z
  .object({
    id: z.uuid(),
    type: eventTypeSchema,
    amount: reconciliationAmountSchema.optional(),
    delivery: hubDeliverySchema,
    refusal_code: refusalCodeSchema.optional(),
  })
  .superRefine((event, context) => {
    if ((event.amount !== undefined) !== eventTypeHasAmount(event.type)) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: eventTypeHasAmount(event.type)
          ? 'This type carries an amount'
          : 'This type carries no amount',
      });
    }
    if ((event.refusal_code !== undefined) !== (event.delivery === 'refused')) {
      context.addIssue({
        code: 'custom',
        path: ['refusal_code'],
        message: 'A refused event, and only one, names its refusal code',
      });
    }
  })
  .meta({ id: 'ReconciliationReportEvent' });

export type ReconciliationReportEvent = z.infer<typeof reconciliationReportEventSchema>;

/** One total of a report (S08 rule 1): a type and currency's count and amount. */
export const reconciliationTotalSchema = z
  .object({
    type: eventTypeSchema,
    currency: hubCurrencySchema.nullable(),
    count: z.int().min(1).max(RECONCILIATION_REPORT_EVENT_LIMIT),
    amount: hubSignedMinorSchema.nullable(),
  })
  .meta({ id: 'ReconciliationTotal' });

export type ReconciliationTotal = z.infer<typeof reconciliationTotalSchema>;

/** A key of the totals: a type and its currency, or the type alone when it has no amount. */
export function totalKeyOf(type: EventType, currency: HubCurrency | null): string {
  return currency === null ? type : `${type}|${currency}`;
}

/** The counts and amounts of some events per type and currency, in the catalogue's order. */
export function totalsOf(
  events: readonly { type: EventType; amount: ReconciliationAmount | null }[],
): { type: EventType; currency: HubCurrency | null; count: number; amount: bigint | null }[] {
  const totals = new Map<
    string,
    { type: EventType; currency: HubCurrency | null; count: number; amount: bigint | null }
  >();
  for (const event of events) {
    const currency = event.amount?.currency ?? null;
    const key = totalKeyOf(event.type, currency);
    const total = totals.get(key) ?? {
      type: event.type,
      currency,
      count: 0,
      amount: event.amount === null ? null : 0n,
    };
    total.count += 1;
    if (event.amount !== null && total.amount !== null) total.amount += event.amount.amount;
    totals.set(key, total);
  }
  const order = (type: EventType) => eventTypeSchema.options.indexOf(type);
  return [...totals.values()].sort(
    (a, b) => order(a.type) - order(b.type) || (a.currency ?? '').localeCompare(b.currency ?? ''),
  );
}

/** A report event's amount as the comparison reads it. */
export function reportAmountOf(event: ReconciliationReportEvent): ReconciliationAmount | null {
  return event.amount === undefined
    ? null
    : { currency: event.amount.currency, amount: BigInt(event.amount.amount) };
}

/**
 * `POST /v1/reconciliation/daily` (S08 rule 1): every event Hub created whose accounting date is
 * `date`, and the totals per type and currency. Refused, storing nothing (rule 4): an event id
 * twice, an amount present or missing against its type, totals other than the sums of the list.
 * A date after the last day of the current month in Damascus is refused by the API, which knows
 * today.
 */
export const reconciliationReportSchema = z
  .object({
    /** Hub's report id, also the `Idempotency-Key` header. */
    id: z.uuid(),
    /** The accounting date reported. */
    date: dateSchema,
    /** When Hub built the report: the latest counts (rule 5). */
    generated_at: instantSchema,
    events: z.array(reconciliationReportEventSchema).max(RECONCILIATION_REPORT_EVENT_LIMIT),
    totals: z.array(reconciliationTotalSchema).max(RECONCILIATION_REPORT_EVENT_LIMIT),
  })
  .superRefine((report, context) => {
    const ids = new Set<string>();
    report.events.forEach((event, index) => {
      if (ids.has(event.id)) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'id'],
          message: 'An event twice',
        });
      }
      ids.add(event.id);
    });
    // The rest compares the list with its totals, which needs every event's own shape.
    const shaped = report.events.every(
      (event) => reconciliationReportEventSchema.safeParse(event).success,
    );
    if (!shaped) return;
    const expected = new Map(
      totalsOf(
        report.events.map((event) => ({ type: event.type, amount: reportAmountOf(event) })),
      ).map((total) => [totalKeyOf(total.type, total.currency), total]),
    );
    const seen = new Set<string>();
    report.totals.forEach((total, index) => {
      const key = totalKeyOf(total.type, total.currency);
      const sum = expected.get(key);
      const amount = total.amount === null ? null : BigInt(total.amount);
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['totals', index],
          message: 'A type and currency twice',
        });
      } else if (!sum || sum.count !== total.count || sum.amount !== amount) {
        context.addIssue({
          code: 'custom',
          path: ['totals', index],
          message: 'The total is not the sum of the events of its type and currency',
        });
      }
      seen.add(key);
    });
    for (const key of expected.keys()) {
      if (!seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['totals'],
          message: `No total for ${key}, which the events have`,
        });
      }
    }
  })
  .meta({ id: 'ReconciliationReport' });

export type ReconciliationReport = z.infer<typeof reconciliationReportSchema>;

/** Hub's side of a difference on `/v1`. */
export const reconciliationHubSideSchema = z
  .object({
    type: eventTypeSchema,
    accounting_date: dateSchema,
    amount: reconciliationAmountSchema.nullable(),
    delivery: hubDeliverySchema,
    refusal_code: z.string().nullable(),
  })
  .meta({ id: 'ReconciliationHubSide' });

/** Mizan's side of a difference on `/v1`: what it holds, with its inbox id. */
export const reconciliationMizanSideSchema = z
  .object({
    type: eventTypeSchema,
    accounting_date: dateSchema,
    amount: reconciliationAmountSchema.nullable(),
    state: eventStateSchema,
    inbox_id: z.uuid(),
  })
  .meta({ id: 'ReconciliationMizanSide' });

/** One gap of a day on `/v1` (S08 "API"); Hub shows a kind it does not know. */
export const reconciliationDifferenceSchema = z
  .object({
    kind: reconciliationKindSchema,
    event_id: z.uuid(),
    hub: reconciliationHubSideSchema.nullable(),
    mizan: reconciliationMizanSideSchema.nullable(),
  })
  .meta({ id: 'ReconciliationDifference' });

/** A type and currency's totals on both sides, on `/v1` (S08 rule 11). */
export const reconciliationTotalsRowSchema = z
  .object({
    type: eventTypeSchema,
    currency: hubCurrencySchema.nullable(),
    hub_count: z.int().min(0),
    hub_amount: hubSignedMinorSchema.nullable(),
    mizan_count: z.int().min(0),
    mizan_amount: hubSignedMinorSchema.nullable(),
  })
  .meta({ id: 'ReconciliationTotalsRow' });

/**
 * The answer of `POST /v1/reconciliation/daily`: the date's comparison now, by its latest report
 * (rules 5 and 10), whether this report is superseded by a later one, whether it was a replay, the
 * gaps and the totals.
 */
export const reconciliationResultSchema = z
  .object({
    report_id: z.uuid(),
    date: dateSchema,
    status: z.enum(['matched', 'differences']),
    superseded: z.boolean(),
    replayed: z.boolean(),
    gaps: z.int().min(0),
    differences: z.array(reconciliationDifferenceSchema),
    totals: z.array(reconciliationTotalsRowSchema),
  })
  .meta({ id: 'ReconciliationResult' });

export type ReconciliationResult = z.infer<typeof reconciliationResultSchema>;

/** Events per page of `GET /v1/events?date=` (S08 rule 14). */
export const RECEIVED_EVENTS_PAGE_SIZE = 500;

const cursorSchema = z.string().min(1).max(200);

/** `GET /v1/events?date=&cursor=` (S08 rule 14). */
export const receivedEventsQuerySchema = z
  .object({ date: dateSchema, cursor: cursorSchema.optional() })
  .meta({ id: 'ReceivedEventsQuery' });

export type ReceivedEventsQuery = z.infer<typeof receivedEventsQuerySchema>;

/** An event Mizan received from the calling client, with its state now (S08 rule 14). */
export const receivedEventSchema = z
  .object({
    id: z.uuid(),
    type: eventTypeSchema,
    version: z.int().min(1),
    received_at: instantSchema,
    state: eventStateSchema,
    hold_reason: holdReasonSchema.nullable(),
    amount: reconciliationAmountSchema.nullable(),
  })
  .meta({ id: 'ReceivedEvent' });

export type ReceivedEvent = z.infer<typeof receivedEventSchema>;

/** A page of `GET /v1/events?date=`, in received order. */
export const receivedEventsPageSchema = z
  .object({ events: z.array(receivedEventSchema), next_cursor: cursorSchema.nullable() })
  .meta({ id: 'ReceivedEventsPage' });

export type ReceivedEventsPage = z.infer<typeof receivedEventsPageSchema>;

// The internal `/api/reconciliation` (S08 "API"), read with `reconciliation.read`.

/** An amount with its Hub currency on the internal `/api`. */
export const reconciliationMoneySchema = z
  .object({ currency: hubCurrencySchema, amountMinor: minorUnitsSchema })
  .meta({ id: 'ReconciliationMoney' });

export type ReconciliationMoney = z.infer<typeof reconciliationMoneySchema>;

/** A client the reconciliation follows: one with a start date (S08 rule 13). */
export const reconciliationClientSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    reconcileFrom: dateSchema,
    archivedAt: instantSchema.nullable(),
  })
  .meta({ id: 'ReconciliationClient' });

export type ReconciliationClient = z.infer<typeof reconciliationClientSchema>;

/** `GET /api/reconciliation/days?month=&client=`. */
export const reconciliationMonthQuerySchema = z
  .object({ month: periodSchema, client: z.uuid().optional() })
  .meta({ id: 'ReconciliationMonthQuery' });

export type ReconciliationMonthQuery = z.infer<typeof reconciliationMonthQuerySchema>;

/** A client's day in the month (S08 "Screens"): its state, counts, gaps and annotations. */
export const reconciliationClientDaySchema = z
  .object({
    clientId: z.uuid(),
    state: reconciliationDayStateSchema,
    /** The events of the date's latest report; null without a report. */
    hubCount: z.int().min(0).nullable(),
    receivedCount: z.int().min(0),
    postedCount: z.int().min(0),
    gaps: z.int().min(0),
    annotations: z.int().min(0),
  })
  .meta({ id: 'ReconciliationClientDay' });

export type ReconciliationClientDay = z.infer<typeof reconciliationClientDaySchema>;

/** A day of the month: the company's state (the worst of its clients') and each client's day. */
export const reconciliationMonthDaySchema = z
  .object({
    date: dateSchema,
    state: reconciliationDayStateSchema,
    clients: z.array(reconciliationClientDaySchema),
  })
  .meta({ id: 'ReconciliationMonthDay' });

export type ReconciliationMonthDay = z.infer<typeof reconciliationMonthDaySchema>;

/** How far back the matched days in a row are counted (S08 "Screens"; the scope asks seven). */
export const MATCHED_STREAK_LIMIT = 90;

/**
 * `GET /api/reconciliation/days`: the clients followed, the month's days, whether the month is
 * closed ("بعد الإقفال", rule 15) and the matched days in a row up to yesterday (at most
 * `MATCHED_STREAK_LIMIT`).
 */
export const reconciliationMonthSchema = z
  .object({
    month: periodSchema,
    closed: z.boolean(),
    clients: z.array(reconciliationClientSchema),
    days: z.array(reconciliationMonthDaySchema),
    matchedStreak: z.int().min(0),
  })
  .meta({ id: 'ReconciliationMonth' });

export type ReconciliationMonth = z.infer<typeof reconciliationMonthSchema>;

/** `GET /api/reconciliation/days/:date`. */
export const reconciliationDayParamSchema = z
  .object({ date: dateSchema })
  .meta({ id: 'ReconciliationDayParam' });

export type ReconciliationDayParam = z.infer<typeof reconciliationDayParamSchema>;

export const reconciliationDayQuerySchema = z
  .object({ client: z.uuid().optional() })
  .meta({ id: 'ReconciliationDayQuery' });

export type ReconciliationDayQuery = z.infer<typeof reconciliationDayQuerySchema>;

/** A type and currency's figures on both sides (S08 rule 11). */
export const reconciliationDayTotalSchema = z
  .object({
    type: eventTypeSchema,
    currency: hubCurrencySchema.nullable(),
    hubCount: z.int().min(0),
    hubAmountMinor: minorUnitsSchema.nullable(),
    receivedCount: z.int().min(0),
    receivedAmountMinor: minorUnitsSchema.nullable(),
    posted: z.int().min(0),
    recorded: z.int().min(0),
    held: z.int().min(0),
    resolved: z.int().min(0),
    dismissed: z.int().min(0),
  })
  .meta({ id: 'ReconciliationDayTotal' });

export type ReconciliationDayTotal = z.infer<typeof reconciliationDayTotalSchema>;

/** Hub's side of a difference on the screens. */
export const reconciliationDayHubSideSchema = z
  .object({
    type: eventTypeSchema,
    accountingDate: dateSchema,
    amount: reconciliationMoneySchema.nullable(),
    delivery: hubDeliverySchema,
    refusalCode: z.string().nullable(),
  })
  .meta({ id: 'ReconciliationDayHubSide' });

/** Mizan's side of a difference on the screens, with its inbox id. */
export const reconciliationDayMizanSideSchema = z
  .object({
    type: eventTypeSchema,
    accountingDate: dateSchema,
    amount: reconciliationMoneySchema.nullable(),
    state: eventStateSchema,
    holdReason: holdReasonSchema.nullable(),
    inboxId: z.uuid(),
  })
  .meta({ id: 'ReconciliationDayMizanSide' });

/** One gap of the day (S08 rule 8). */
export const reconciliationDayDifferenceSchema = z
  .object({
    kind: reconciliationKindSchema,
    eventId: z.uuid(),
    hub: reconciliationDayHubSideSchema.nullable(),
    mizan: reconciliationDayMizanSideSchema.nullable(),
  })
  .meta({ id: 'ReconciliationDayDifference' });

export type ReconciliationDayDifference = z.infer<typeof reconciliationDayDifferenceSchema>;

const entryRefSchema = z
  .object({ id: z.uuid(), number: entryNumberSchema })
  .meta({ id: 'ReconciliationEntryRef' });

/**
 * What explains a matched event or a day (S08 rule 9): a held event with its reason; an event
 * resolved by a manual entry (with the entry) or dismissed (with its reason); a manual movement
 * dated on the day on an item of a Hub document of the client (with its entry and item).
 */
export const reconciliationAnnotationSchema = z
  .object({
    kind: reconciliationAnnotationKindSchema,
    eventId: z.uuid().nullable(),
    inboxId: z.uuid().nullable(),
    type: eventTypeSchema.nullable(),
    holdReason: holdReasonSchema.nullable(),
    reason: z.string().nullable(),
    entry: entryRefSchema.nullable(),
    openItemId: z.uuid().nullable(),
  })
  .meta({ id: 'ReconciliationAnnotation' });

export type ReconciliationAnnotation = z.infer<typeof reconciliationAnnotationSchema>;

/** A report of the date as received, the latest marked (rule 5). */
export const reconciliationReportRowSchema = z
  .object({
    reportId: z.uuid(),
    generatedAt: instantSchema,
    receivedAt: instantSchema,
    eventCount: z.int().min(0),
    latest: z.boolean(),
  })
  .meta({ id: 'ReconciliationReportRow' });

export type ReconciliationReportRow = z.infer<typeof reconciliationReportRowSchema>;

/** A client's day in full (S08 "Screens", `/reconciliation/:date`). */
export const reconciliationClientDayDetailSchema = z
  .object({
    client: reconciliationClientSchema,
    state: reconciliationDayStateSchema,
    totals: z.array(reconciliationDayTotalSchema),
    differences: z.array(reconciliationDayDifferenceSchema),
    annotations: z.array(reconciliationAnnotationSchema),
    reports: z.array(reconciliationReportRowSchema),
  })
  .meta({ id: 'ReconciliationClientDayDetail' });

export type ReconciliationClientDayDetail = z.infer<typeof reconciliationClientDayDetailSchema>;

/** `GET /api/reconciliation/days/:date`: the company's state and each client's day. */
export const reconciliationDaySchema = z
  .object({
    date: dateSchema,
    state: reconciliationDayStateSchema,
    closed: z.boolean(),
    clients: z.array(reconciliationClientDayDetailSchema),
  })
  .meta({ id: 'ReconciliationDay' });

export type ReconciliationDay = z.infer<typeof reconciliationDaySchema>;
