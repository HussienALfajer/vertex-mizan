import { createHash } from 'node:crypto';
import {
  canonicalPayload,
  DomainError,
  dayStateIsClean,
  EVENT_TYPES,
  type EventState,
  type EventType,
  type HoldReason,
  type HubCurrency,
  type HubDelivery,
  MATCHED_STREAK_LIMIT,
  parseEventEnvelope,
  RECEIVED_EVENTS_PAGE_SIZE,
  type ReceivedEventsPage,
  type ReconciliationAmount,
  type ReconciliationAnnotation,
  type ReconciliationClient,
  type ReconciliationClientDay,
  type ReconciliationDay,
  type ReconciliationDayState,
  type ReconciliationMonth,
  type ReconciliationReport,
  type ReconciliationResult,
  reconciliationAmountOf,
  reportAmountOf,
  wireAmountOf,
  worstDayState,
} from '@vertex-mizan/contracts';
import {
  type ComparedEvent,
  compareDay,
  dayAfter,
  dayState,
  daysOfMonth,
  dayTotals,
  gapsOf,
  type HubSideEvent,
  lastDayOfMonth,
  type MizanSideEvent,
  periodOf,
  type ReportedEvent,
} from '@vertex-mizan/ledger';
import { and, asc, between, desc, eq, inArray, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { isClosedPeriod, readClosedPeriods } from '../posting/periods.js';
import { apiClients } from '../schema/api-clients.js';
import { inboundEventActions, inboundEventStates, inboundEvents } from '../schema/inbox.js';
import { journalEntries } from '../schema/ledger.js';
import { openItemMovements, openItems } from '../schema/open-items.js';
import { reconciliationReportEvents, reconciliationReports } from '../schema/reconciliation.js';

// The daily reconciliation (S08 rules 4–16, ADR 0017), inside `withCompany`: a report received
// and kept as sent, the latest report of a client and date compared with the events the inbox
// received from that client, event by event (`packages/ledger`'s `compareDay()`), the days of a
// month, a day in full, the checklist item `reconciliation_clean` and the events of a date for
// `GET /v1/events`. Nothing is stored but the reports: the comparison is computed on read, so a
// late event or a later report changes a day without a job.

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A date's day off in Damascus, from a timestamp (`archived_at`). */
const damascusDate = (column: unknown) =>
  sql<string>`to_char((${column} at time zone 'Asia/Damascus')::date, 'YYYY-MM-DD')`;

/** A client the reconciliation follows: one with a start date (rule 13). */
export interface FollowedClient extends ReconciliationClient {
  /** The day it was archived in Damascus, its last required day (rule 13); null while active. */
  readonly archivedOn: string | null;
}

/** The company's clients with a start date, oldest first (rule 13), inside `withCompany`. */
export async function readReconciledClients(tx: Transaction): Promise<FollowedClient[]> {
  const rows = await tx
    .select({
      id: apiClients.id,
      name: apiClients.name,
      reconcileFrom: apiClients.reconcileFrom,
      archivedAt: apiClients.archivedAt,
      archivedOn: damascusDate(apiClients.archivedAt),
    })
    .from(apiClients)
    .where(
      and(
        sql`${apiClients.scopeCompanyId} = current_company_id()`,
        isNotNull(apiClients.reconcileFrom),
      ),
    )
    .orderBy(asc(apiClients.createdAt), asc(apiClients.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    reconcileFrom: row.reconcileFrom as string,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedOn: row.archivedAt === null ? null : row.archivedOn,
  }));
}

/** A report row with the events it lists, as the comparison reads them. */
interface StoredReport {
  readonly id: string;
  readonly reportId: string;
  readonly reportDate: string;
  readonly generatedAt: Date;
  readonly receivedAt: Date;
  readonly eventCount: number;
}

const amountOfRow = (currency: string | null, amount: bigint | null) =>
  currency === null || amount === null
    ? null
    : ({ currency: currency as HubCurrency, amount } satisfies ReconciliationAmount);

/** The latest report of each date of a client in a range (rule 5). */
async function latestReports(
  tx: Transaction,
  clientId: string,
  from: string,
  to: string,
): Promise<Map<string, StoredReport>> {
  const rows = await tx
    .selectDistinctOn([reconciliationReports.reportDate], {
      id: reconciliationReports.id,
      reportId: reconciliationReports.reportId,
      reportDate: reconciliationReports.reportDate,
      generatedAt: reconciliationReports.generatedAt,
      receivedAt: reconciliationReports.receivedAt,
      eventCount: reconciliationReports.eventCount,
    })
    .from(reconciliationReports)
    .where(
      and(
        eq(reconciliationReports.apiClientId, clientId),
        between(reconciliationReports.reportDate, from, to),
      ),
    )
    .orderBy(
      asc(reconciliationReports.reportDate),
      desc(reconciliationReports.generatedAt),
      desc(reconciliationReports.receivedAt),
      desc(reconciliationReports.id),
    );
  return new Map(rows.map((row) => [row.reportDate, row]));
}

/** The events each report lists, in their order. */
async function reportEventsOf(
  tx: Transaction,
  reportIds: readonly string[],
): Promise<Map<string, HubSideEvent[]>> {
  const listed = new Map<string, HubSideEvent[]>(reportIds.map((id) => [id, []]));
  if (reportIds.length === 0) return listed;
  const rows = await tx
    .select()
    .from(reconciliationReportEvents)
    .where(inArray(reconciliationReportEvents.reportId, [...reportIds]))
    .orderBy(asc(reconciliationReportEvents.id));
  for (const row of rows) {
    listed.get(row.reportId)?.push({
      id: row.eventId,
      type: row.type as EventType,
      amount: amountOfRow(row.currency, row.amountMinor),
      delivery: row.delivery as HubDelivery,
      refusalCode: row.refusalCode,
    });
  }
  return listed;
}

/** Mizan's events of a client (rule 7), by date range or by Hub's ids, in received order. */
async function receivedEvents(
  tx: Transaction,
  clientId: string,
  where: { readonly from: string; readonly to: string } | { readonly ids: readonly string[] },
): Promise<(MizanSideEvent & { readonly receivedAt: Date; readonly version: number })[]> {
  if ('ids' in where && where.ids.length === 0) return [];
  const rows = await tx
    .select({
      event: inboundEvents,
      state: inboundEventStates.state,
      holdReason: inboundEventStates.holdReason,
    })
    .from(inboundEvents)
    .innerJoin(
      inboundEventStates,
      and(
        eq(inboundEventStates.companyId, inboundEvents.companyId),
        eq(inboundEventStates.eventId, inboundEvents.id),
      ),
    )
    .where(
      and(
        eq(inboundEvents.apiClientId, clientId),
        'ids' in where
          ? inArray(inboundEvents.eventId, [...where.ids])
          : between(inboundEvents.accountingDate, where.from, where.to),
      ),
    )
    .orderBy(asc(inboundEvents.receivedAt), asc(inboundEvents.id));
  return rows.map(({ event, state, holdReason }) => ({
    id: event.eventId,
    inboxId: event.id,
    type: event.type as EventType,
    accountingDate: event.accountingDate,
    amount: reconciliationAmountOf(
      parseEventEnvelope({
        id: event.eventId,
        type: event.type,
        version: event.version,
        occurred_at: event.occurredAt.toISOString(),
        accounting_date: event.accountingDate,
        payload: event.payload,
      }),
    ),
    state: state as EventState,
    holdReason: holdReason as HoldReason | null,
    receivedAt: event.receivedAt,
    version: event.version,
  }));
}

/**
 * Hub's events, by id, as another date's latest report of the client lists them (rule 8: an event
 * Mizan holds on a date whose report does not list it, but another date's does, is `date_differs`).
 */
async function reportedOnOtherDates(
  tx: Transaction,
  clientId: string,
  unlisted: readonly MizanSideEvent[],
): Promise<Map<string, ReportedEvent>> {
  const found = new Map<string, ReportedEvent>();
  if (unlisted.length === 0) return found;
  const rows = await tx
    .select({
      eventId: reconciliationReportEvents.eventId,
      reportDate: reconciliationReports.reportDate,
      type: reconciliationReportEvents.type,
      currency: reconciliationReportEvents.currency,
      amountMinor: reconciliationReportEvents.amountMinor,
      delivery: reconciliationReportEvents.delivery,
      refusalCode: reconciliationReportEvents.refusalCode,
    })
    .from(reconciliationReportEvents)
    .innerJoin(
      reconciliationReports,
      and(
        eq(reconciliationReports.companyId, reconciliationReportEvents.companyId),
        eq(reconciliationReports.id, reconciliationReportEvents.reportId),
      ),
    )
    .where(
      and(
        eq(reconciliationReports.apiClientId, clientId),
        inArray(
          reconciliationReportEvents.eventId,
          unlisted.map((event) => event.id),
        ),
        sql`${reconciliationReports.id} = (
          select r.id from ${reconciliationReports} r
          where r.company_id = ${reconciliationReports.companyId}
            and r.api_client_id = ${reconciliationReports.apiClientId}
            and r.report_date = ${reconciliationReports.reportDate}
          order by r.generated_at desc, r.received_at desc, r.id desc
          limit 1)`,
      ),
    )
    .orderBy(asc(reconciliationReports.reportDate));
  const dateOf = new Map(unlisted.map((event) => [event.id, event.accountingDate]));
  for (const row of rows) {
    if (row.reportDate === dateOf.get(row.eventId) || found.has(row.eventId)) continue;
    found.set(row.eventId, {
      id: row.eventId,
      type: row.type as EventType,
      amount: amountOfRow(row.currency, row.amountMinor),
      delivery: row.delivery as HubDelivery,
      refusalCode: row.refusalCode,
      accountingDate: row.reportDate,
    });
  }
  return found;
}

/** One date of a client compared (rules 8, 10, 11). */
export interface ComparedDate {
  readonly date: string;
  readonly report: StoredReport | null;
  readonly reportEvents: readonly HubSideEvent[] | null;
  /** Mizan's events of the client dated on the date. */
  readonly receivedOnDate: readonly MizanSideEvent[];
  readonly compared: readonly ComparedEvent[];
  readonly gaps: number;
}

/** A report being received, compared as the date's latest before it is stored (rule 4). */
interface PendingReport {
  readonly date: string;
  readonly events: readonly HubSideEvent[];
}

/**
 * Every date of a client from `from` to `to`, compared (rule 8) with the date's latest report, or
 * with `pending` in place of it for the date of a report being received.
 */
async function compareRange(
  tx: Transaction,
  clientId: string,
  from: string,
  to: string,
  pending: PendingReport | null = null,
): Promise<ComparedDate[]> {
  const reports = await latestReports(tx, clientId, from, to);
  if (pending) reports.delete(pending.date);
  const listedBy = await reportEventsOf(
    tx,
    [...reports.values()].map((report) => report.id),
  );
  const reportOf = (date: string): readonly HubSideEvent[] | null => {
    if (pending?.date === date) return pending.events;
    const report = reports.get(date);
    return report ? (listedBy.get(report.id) ?? []) : null;
  };
  const inRange = await receivedEvents(tx, clientId, { from, to });
  const listedIds = new Set<string>();
  for (const date of [...reports.keys(), ...(pending ? [pending.date] : [])]) {
    for (const event of reportOf(date) ?? []) listedIds.add(event.id);
  }
  const known = new Set(inRange.map((event) => event.id));
  const outside = await receivedEvents(tx, clientId, {
    ids: [...listedIds].filter((id) => !known.has(id)),
  });
  const byId = new Map([...inRange, ...outside].map((event) => [event.id, event]));
  const unlisted = inRange.filter(
    (event) => !(reportOf(event.accountingDate) ?? []).some((listed) => listed.id === event.id),
  );
  const elsewhere = await reportedOnOtherDates(tx, clientId, unlisted);
  // A pending report is not stored yet: the events it lists are on its date, not elsewhere.
  if (pending) {
    for (const event of pending.events) {
      const mizan = byId.get(event.id);
      if (mizan && mizan.accountingDate !== pending.date && !elsewhere.has(event.id)) {
        const own = reportOf(mizan.accountingDate) ?? [];
        if (!own.some((listed) => listed.id === event.id)) {
          elsewhere.set(event.id, { ...event, accountingDate: pending.date });
        }
      }
    }
  }
  const dates: string[] = [];
  for (let date = from; date <= to; date = dayAfter(date)) dates.push(date);
  return dates.map((date) => {
    const reportEvents = reportOf(date);
    const receivedOnDate = inRange.filter((event) => event.accountingDate === date);
    const received = [
      ...receivedOnDate,
      ...(reportEvents ?? []).flatMap((event) => {
        const mizan = byId.get(event.id);
        return mizan && mizan.accountingDate !== date ? [mizan] : [];
      }),
    ];
    const compared = compareDay({
      date,
      report: reportEvents,
      received,
      reportedElsewhere: elsewhere,
    });
    return {
      date,
      report: pending?.date === date ? null : (reports.get(date) ?? null),
      reportEvents,
      receivedOnDate,
      compared,
      gaps: gapsOf(compared).length,
    };
  });
}

/** A client's day state from its comparison (rule 10). */
function stateOf(client: FollowedClient, compared: ComparedDate, now: string) {
  return dayState({
    date: compared.date,
    reconcileFrom: client.reconcileFrom,
    archivedOn: client.archivedOn,
    reported: compared.reportEvents !== null,
    gaps: compared.gaps,
    now,
  });
}

/** The day states of every followed client over a range, and the company's (rule 10). */
async function statesOver(
  tx: Transaction,
  from: string,
  to: string,
  now: string,
): Promise<{ date: string; state: ReconciliationDayState; gaps: number }[]> {
  const clients = await readReconciledClients(tx);
  const perClient: { state: ReconciliationDayState; gaps: number }[][] = [];
  for (const client of clients) {
    const compared = await compareRange(tx, client.id, from, to);
    perClient.push(compared.map((day) => ({ state: stateOf(client, day, now), gaps: day.gaps })));
  }
  const days: { date: string; state: ReconciliationDayState; gaps: number }[] = [];
  let index = 0;
  for (let date = from; date <= to; date = dayAfter(date), index += 1) {
    const states = perClient.map((days) => days[index]);
    days.push({
      date,
      state: worstDayState(states.map((day) => day?.state ?? 'not_required')),
      gaps: states.reduce(
        (total, day) => total + (day && day.state === 'differences' ? day.gaps : 0),
        0,
      ),
    });
  }
  return days;
}

/**
 * The checklist item `reconciliation_clean` of a month (rule 12): the days of the month that are
 * not `matched` or `not_required` for some client, counted once each; not applicable when every
 * day is `not_required`. Computed inside the close's transaction like the other items. A day
 * awaited and a day missed both fail, so the time of day does not change the result.
 */
export async function reconciliationCheck(
  tx: Transaction,
  period: string,
): Promise<{ readonly applicable: boolean; readonly uncleanDays: number }> {
  const days = daysOfMonth(period);
  const first = days[0] as string;
  const last = days.at(-1) as string;
  const states = await statesOver(tx, first, last, `${first}T00:00`);
  return {
    applicable: states.some((day) => day.state !== 'not_required'),
    uncleanDays: states.filter((day) => !dayStateIsClean(day.state)).length,
  };
}

/**
 * The days on or after a start date that are `missing` or `differences`, the latest first, up to
 * `limit`, from `from` to the day before `today` (rule 16, the daily email).
 */
export async function uncleanReconciliationDays(
  tx: Transaction,
  input: {
    readonly from: string;
    readonly today: string;
    readonly now: string;
    readonly limit: number;
  },
): Promise<
  { date: string; state: 'missing' | 'differences'; gaps: number; afterClose: boolean }[]
> {
  const clients = await readReconciledClients(tx);
  if (clients.length === 0) return [];
  const yesterday = previousDay(input.today);
  if (yesterday < input.from) return [];
  const closed = await readClosedPeriods(tx);
  const days = await statesOver(tx, input.from, yesterday, input.now);
  return days
    .filter((day) => day.state === 'missing' || day.state === 'differences')
    .reverse()
    .slice(0, input.limit)
    .map((day) => ({
      date: day.date,
      state: day.state as 'missing' | 'differences',
      gaps: day.gaps,
      afterClose: isClosedPeriod(closed, periodOf(day.date)),
    }));
}

/** The calendar day before a date. */
function previousDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  if (day > 1) return `${date.slice(0, 8)}${String(day - 1).padStart(2, '0')}`;
  const before = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  return lastDayOfMonth(`${before}-01`);
}

/** Today's last accounting date: the last day of the current month in Damascus (S05 rule 3). */
function latestAccountingDate(today: string): string {
  return lastDayOfMonth(today);
}

/** The /v1 answer of a date's comparison now (S08 "API"). */
function resultOf(
  report: { readonly id: string; readonly date: string },
  day: ComparedDate,
  flags: { readonly superseded: boolean; readonly replayed: boolean },
): ReconciliationResult {
  const gaps = gapsOf(day.compared);
  return {
    report_id: report.id,
    date: report.date,
    status: gaps.length === 0 ? 'matched' : 'differences',
    superseded: flags.superseded,
    replayed: flags.replayed,
    gaps: gaps.length,
    differences: gaps.map((gap) => ({
      kind: gap.kind,
      event_id: gap.eventId,
      hub: gap.hub && {
        type: gap.hub.type,
        accounting_date: gap.hub.accountingDate,
        amount: wireAmountOf(gap.hub.amount),
        delivery: gap.hub.delivery,
        refusal_code: gap.hub.refusalCode,
      },
      mizan: gap.mizan && {
        type: gap.mizan.type,
        accounting_date: gap.mizan.accountingDate,
        amount: wireAmountOf(gap.mizan.amount),
        state: gap.mizan.state,
        inbox_id: gap.mizan.inboxId,
      },
    })),
    totals: dayTotals(day.reportEvents, day.receivedOnDate, EVENT_TYPES).map((total) => ({
      type: total.type,
      currency: total.currency,
      hub_count: total.hubCount,
      hub_amount: total.hubAmount === null ? null : Number(total.hubAmount),
      mizan_count: total.receivedCount,
      mizan_amount: total.receivedAmount === null ? null : Number(total.receivedAmount),
    })),
  };
}

/**
 * Receives a daily report (rules 1, 4, 5), inside `withCompany` with the client from the key.
 * Refused, storing nothing: a date after the last day of the current month in Damascus
 * (`VALIDATION_FAILED` on `date`); the same id with another payload (`IDEMPOTENCY_CONFLICT`). The
 * same id with the same payload stores nothing and answers the comparison now (`replayed`). A
 * report older than the date's latest is stored and answered `superseded`. The answer is the
 * date's comparison by its latest report.
 */
export async function receiveReconciliationReport(
  tx: Transaction,
  companyId: string,
  input: {
    /** The request's JSON body as Hub sent it: kept and hashed as received. */
    readonly raw: Readonly<Record<string, unknown>>;
    /** The same body parsed by `reconciliationReportSchema`. */
    readonly report: ReconciliationReport;
    readonly apiClientId: string;
    readonly requestId: string;
    readonly today: string;
  },
): Promise<{ result: ReconciliationResult; replayed: boolean }> {
  const { report, raw } = input;
  if (raw.id !== report.id) throw new TypeError('The raw body is the report that was parsed');
  if (report.date > latestAccountingDate(input.today)) {
    throw new DomainError('VALIDATION_FAILED', 'A date after the current month', {
      issues: [{ path: ['date'], message: 'After the last day of the current month' }],
    });
  }
  const payloadHash = sha256(canonicalPayload(raw));
  const answerNow = async (
    stored: { reportDate: string },
    replayed: boolean,
    superseded: boolean,
  ) => {
    const [day] = await compareRange(tx, input.apiClientId, stored.reportDate, stored.reportDate);
    if (!day) throw new Error('A date compared');
    return {
      result: resultOf({ id: report.id, date: report.date }, day, { replayed, superseded }),
      replayed,
    };
  };
  const existing = async () => {
    const [first] = await tx
      .select()
      .from(reconciliationReports)
      .where(
        and(
          eq(reconciliationReports.apiClientId, input.apiClientId),
          eq(reconciliationReports.reportId, report.id),
        ),
      );
    return first;
  };
  const replay = async (first: NonNullable<Awaited<ReturnType<typeof existing>>>) => {
    if (first.payloadHash !== payloadHash) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'The report id was sent with another payload', {
        reportId: report.id,
      });
    }
    const [latest] = (
      await latestReports(tx, input.apiClientId, first.reportDate, first.reportDate)
    ).values();
    return answerNow(first, true, latest?.id !== first.id);
  };
  const found = await existing();
  if (found) return replay(found);
  const generatedAt = new Date(report.generated_at);
  const [newer] = await tx
    .select({ id: reconciliationReports.id })
    .from(reconciliationReports)
    .where(
      and(
        eq(reconciliationReports.apiClientId, input.apiClientId),
        eq(reconciliationReports.reportDate, report.date),
        sql`${reconciliationReports.generatedAt} > ${generatedAt.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  const superseded = newer !== undefined;
  const listed: HubSideEvent[] = report.events.map((event) => ({
    id: event.id,
    type: event.type,
    amount: reportAmountOf(event),
    delivery: event.delivery,
    refusalCode: event.refusal_code ?? null,
  }));
  const [atReceipt] = await compareRange(
    tx,
    input.apiClientId,
    report.date,
    report.date,
    superseded ? null : { date: report.date, events: listed },
  );
  if (!atReceipt) throw new Error('A date compared');
  const [inserted] = await tx
    .insert(reconciliationReports)
    .values({
      companyId,
      apiClientId: input.apiClientId,
      reportId: report.id,
      reportDate: report.date,
      generatedAt,
      payload: raw,
      payloadHash,
      eventCount: report.events.length,
      requestId: input.requestId,
      statusAtReceipt: atReceipt.gaps === 0 ? 'matched' : 'differences',
      gapsAtReceipt: atReceipt.gaps,
    })
    .onConflictDoNothing()
    .returning({ id: reconciliationReports.id });
  if (!inserted) {
    // The same report sent twice at once: the first one's commit decides.
    const first = await existing();
    if (!first) throw new Error('A report neither stored nor found');
    return replay(first);
  }
  for (let start = 0; start < listed.length; start += 1000) {
    await tx.insert(reconciliationReportEvents).values(
      listed.slice(start, start + 1000).map((event) => ({
        companyId,
        reportId: inserted.id,
        eventId: event.id,
        type: event.type,
        currency: event.amount?.currency ?? null,
        amountMinor: event.amount?.amount ?? null,
        delivery: event.delivery,
        refusalCode: event.refusalCode,
      })),
    );
  }
  return answerNow({ reportDate: report.date }, false, superseded);
}

/**
 * `GET /v1/events?date=` (rule 14): the events the calling client sent with that accounting date,
 * in received order, a page of 500 after the cursor (the last event's inbox id).
 */
export async function readReceivedEvents(
  tx: Transaction,
  input: {
    readonly apiClientId: string;
    readonly date: string;
    readonly cursor?: string | undefined;
  },
): Promise<ReceivedEventsPage> {
  let after: { receivedAt: Date; id: string } | undefined;
  if (input.cursor !== undefined) {
    const [row] = /^[0-9a-f-]{36}$/.test(input.cursor)
      ? await tx
          .select({ receivedAt: inboundEvents.receivedAt, id: inboundEvents.id })
          .from(inboundEvents)
          .where(
            and(
              eq(inboundEvents.id, input.cursor),
              eq(inboundEvents.apiClientId, input.apiClientId),
            ),
          )
      : [];
    if (!row) {
      throw new DomainError('VALIDATION_FAILED', 'An unknown cursor', {
        issues: [{ path: ['cursor'], message: 'An unknown cursor' }],
      });
    }
    after = row;
  }
  const rows = await tx
    .select({
      event: inboundEvents,
      state: inboundEventStates.state,
      holdReason: inboundEventStates.holdReason,
    })
    .from(inboundEvents)
    .innerJoin(
      inboundEventStates,
      and(
        eq(inboundEventStates.companyId, inboundEvents.companyId),
        eq(inboundEventStates.eventId, inboundEvents.id),
      ),
    )
    .where(
      and(
        eq(inboundEvents.apiClientId, input.apiClientId),
        eq(inboundEvents.accountingDate, input.date),
        after &&
          sql`(${inboundEvents.receivedAt}, ${inboundEvents.id}) > (
            select e.received_at, e.id from ${inboundEvents} e where e.id = ${after.id})`,
      ),
    )
    .orderBy(asc(inboundEvents.receivedAt), asc(inboundEvents.id))
    .limit(RECEIVED_EVENTS_PAGE_SIZE + 1);
  const page = rows.slice(0, RECEIVED_EVENTS_PAGE_SIZE);
  return {
    events: page.map(({ event, state, holdReason }) => ({
      id: event.eventId,
      type: event.type as EventType,
      version: event.version,
      received_at: event.receivedAt.toISOString(),
      state: state as EventState,
      hold_reason: holdReason as HoldReason | null,
      amount: wireAmountOf(
        reconciliationAmountOf(
          parseEventEnvelope({
            id: event.eventId,
            type: event.type,
            version: event.version,
            occurred_at: event.occurredAt.toISOString(),
            accounting_date: event.accountingDate,
            payload: event.payload,
          }),
        ),
      ),
    })),
    next_cursor: rows.length > RECEIVED_EVENTS_PAGE_SIZE ? (page.at(-1)?.event.id ?? null) : null,
  };
}

/** The clients a read covers: one asked for (of the company), or all followed. */
async function clientsOf(tx: Transaction, clientId: string | undefined) {
  const clients = await readReconciledClients(tx);
  if (clientId === undefined) return clients;
  const client = clients.find((candidate) => candidate.id === clientId);
  if (!client) throw new DomainError('NOT_FOUND', 'No such client in the reconciliation');
  return [client];
}

/** Manual movements on items of a client's Hub documents, dated in a range (rule 9). */
async function adjustmentsOf(tx: Transaction, clientId: string, from: string, to: string) {
  return tx
    .select({
      entryDate: openItemMovements.entryDate,
      entryId: openItemMovements.entryId,
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
      itemId: openItems.id,
    })
    .from(openItemMovements)
    .innerJoin(
      openItems,
      and(
        eq(openItems.companyId, openItemMovements.companyId),
        eq(openItems.id, openItemMovements.itemId),
      ),
    )
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.companyId, openItemMovements.companyId),
        eq(journalEntries.id, openItemMovements.entryId),
      ),
    )
    .where(
      and(
        eq(openItemMovements.adjusted, true),
        between(openItemMovements.entryDate, from, to),
        notInArray(openItems.source, ['manual']),
        sql`exists (
          select 1 from ${inboundEvents} ev
          where ev.company_id = ${openItems.companyId}
            and ev.api_client_id = ${clientId}
            and ev.document_type = ${openItems.hubDocument} ->> 'type'
            and ev.document_id = ${openItems.hubDocument} ->> 'id')`,
      ),
    )
    .orderBy(asc(openItemMovements.entryDate), asc(openItemMovements.id));
}

/** The annotations of a compared date (rule 9): held, resolved and dismissed matched events. */
async function eventAnnotations(
  tx: Transaction,
  compared: readonly ComparedEvent[],
): Promise<ReconciliationAnnotation[]> {
  const explained = compared.filter(
    (event) =>
      event.kind === 'matched' &&
      event.mizan !== null &&
      event.mizan.state !== 'posted' &&
      event.mizan.state !== 'recorded',
  );
  if (explained.length === 0) return [];
  const inboxIds = explained.map((event) => event.mizan?.inboxId as string);
  const states = await tx
    .select({
      eventId: inboundEventStates.eventId,
      entryId: journalEntries.id,
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
    })
    .from(inboundEventStates)
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.companyId, inboundEventStates.companyId),
        eq(journalEntries.id, inboundEventStates.resolvedByEntryId),
      ),
    )
    .where(inArray(inboundEventStates.eventId, inboxIds));
  const dismissals = await tx
    .select({ eventId: inboundEventActions.eventId, reason: inboundEventActions.reason })
    .from(inboundEventActions)
    .where(
      and(
        inArray(inboundEventActions.eventId, inboxIds),
        or(eq(inboundEventActions.action, 'dismissed'), eq(inboundEventActions.action, 'resolved')),
      ),
    )
    .orderBy(asc(inboundEventActions.id));
  return explained.map((event) => {
    const mizan = event.mizan as MizanSideEvent;
    const state = states.find((row) => row.eventId === mizan.inboxId);
    const reason = dismissals.filter((row) => row.eventId === mizan.inboxId).at(-1)?.reason ?? null;
    return {
      kind: mizan.state === 'held' ? 'held' : mizan.state === 'resolved' ? 'resolved' : 'dismissed',
      eventId: mizan.id,
      inboxId: mizan.inboxId,
      type: mizan.type,
      holdReason: mizan.holdReason,
      reason: mizan.state === 'held' ? null : reason,
      entry:
        state?.entryId && state.fiscalYear !== null && state.number !== null
          ? { id: state.entryId, number: { fiscalYear: state.fiscalYear, number: state.number } }
          : null,
      openItemId: null,
    } satisfies ReconciliationAnnotation;
  });
}

/** `GET /api/reconciliation/days?month=&client=` (S08 "API", "Screens"). */
export async function readReconciliationMonth(
  tx: Transaction,
  input: {
    readonly month: string;
    readonly clientId?: string | undefined;
    readonly today: string;
    readonly now: string;
  },
): Promise<ReconciliationMonth> {
  const clients = await clientsOf(tx, input.clientId);
  const days = daysOfMonth(input.month);
  const first = days[0] as string;
  const last = days.at(-1) as string;
  const perClient: ReconciliationClientDay[][] = [];
  for (const client of clients) {
    const compared = await compareRange(tx, client.id, first, last);
    const adjusted = await adjustmentsOf(tx, client.id, first, last);
    perClient.push(
      compared.map((day) => ({
        clientId: client.id,
        state: stateOf(client, day, input.now),
        hubCount: day.report?.eventCount ?? day.reportEvents?.length ?? null,
        receivedCount: day.receivedOnDate.length,
        postedCount: day.receivedOnDate.filter((event) => event.state === 'posted').length,
        gaps: day.gaps,
        annotations:
          day.compared.filter(
            (event) =>
              event.kind === 'matched' &&
              event.mizan !== null &&
              ['held', 'resolved', 'dismissed'].includes(event.mizan.state),
          ).length + adjusted.filter((row) => row.entryDate === day.date).length,
      })),
    );
  }
  const closed = isClosedPeriod(await readClosedPeriods(tx), input.month);
  return {
    month: input.month,
    closed,
    clients: clients.map(({ archivedOn: _archivedOn, ...client }) => client),
    days: days.map((date, index) => {
      const clientDays = perClient.map((list) => list[index]).filter((day) => day !== undefined);
      return {
        date,
        state: worstDayState(clientDays.map((day) => day.state)),
        clients: clientDays,
      };
    }),
    matchedStreak: await matchedStreak(tx, input.today, input.now),
  };
}

/** The matched days in a row up to yesterday, at most `MATCHED_STREAK_LIMIT` (S08 "Screens"). */
async function matchedStreak(tx: Transaction, today: string, now: string): Promise<number> {
  const yesterday = previousDay(today);
  let from = yesterday;
  for (let back = 1; back < MATCHED_STREAK_LIMIT; back += 1) from = previousDay(from);
  const days = await statesOver(tx, from, yesterday, now);
  let streak = 0;
  for (const day of [...days].reverse()) {
    if (day.state !== 'matched') break;
    streak += 1;
  }
  return streak;
}

const moneyOf = (amount: ReconciliationAmount | null) =>
  amount === null ? null : { currency: amount.currency, amountMinor: amount.amount.toString() };

/** `GET /api/reconciliation/days/:date?client=` (S08 "API", "Screens"). */
export async function readReconciliationDay(
  tx: Transaction,
  input: { readonly date: string; readonly clientId?: string | undefined; readonly now: string },
): Promise<ReconciliationDay> {
  const clients = await clientsOf(tx, input.clientId);
  const details = [];
  for (const client of clients) {
    const [day] = await compareRange(tx, client.id, input.date, input.date);
    if (!day) throw new Error('A date compared');
    const reports = await tx
      .select()
      .from(reconciliationReports)
      .where(
        and(
          eq(reconciliationReports.apiClientId, client.id),
          eq(reconciliationReports.reportDate, input.date),
        ),
      )
      .orderBy(
        desc(reconciliationReports.generatedAt),
        desc(reconciliationReports.receivedAt),
        desc(reconciliationReports.id),
      );
    const adjusted = await adjustmentsOf(tx, client.id, input.date, input.date);
    const { archivedOn: _archivedOn, ...shown } = client;
    details.push({
      client: shown,
      state: stateOf(client, day, input.now),
      totals: dayTotals(day.reportEvents, day.receivedOnDate, EVENT_TYPES).map((total) => ({
        type: total.type,
        currency: total.currency,
        hubCount: total.hubCount,
        hubAmountMinor: total.hubAmount?.toString() ?? null,
        receivedCount: total.receivedCount,
        receivedAmountMinor: total.receivedAmount?.toString() ?? null,
        posted: total.states.posted,
        recorded: total.states.recorded,
        held: total.states.held,
        resolved: total.states.resolved,
        dismissed: total.states.dismissed,
      })),
      differences: gapsOf(day.compared).map((gap) => ({
        kind: gap.kind,
        eventId: gap.eventId,
        hub: gap.hub && {
          type: gap.hub.type,
          accountingDate: gap.hub.accountingDate,
          amount: moneyOf(gap.hub.amount),
          delivery: gap.hub.delivery,
          refusalCode: gap.hub.refusalCode,
        },
        mizan: gap.mizan && {
          type: gap.mizan.type,
          accountingDate: gap.mizan.accountingDate,
          amount: moneyOf(gap.mizan.amount),
          state: gap.mizan.state,
          holdReason: gap.mizan.holdReason,
          inboxId: gap.mizan.inboxId,
        },
      })),
      annotations: [
        ...(await eventAnnotations(tx, day.compared)),
        ...adjusted.map(
          (row): ReconciliationAnnotation => ({
            kind: 'adjusted',
            eventId: null,
            inboxId: null,
            type: null,
            holdReason: null,
            reason: null,
            entry: { id: row.entryId, number: { fiscalYear: row.fiscalYear, number: row.number } },
            openItemId: row.itemId,
          }),
        ),
      ],
      reports: reports.map((report, index) => ({
        reportId: report.reportId,
        generatedAt: report.generatedAt.toISOString(),
        receivedAt: report.receivedAt.toISOString(),
        eventCount: report.eventCount,
        latest: index === 0,
      })),
    });
  }
  return {
    date: input.date,
    state: worstDayState(details.map((detail) => detail.state)),
    closed: isClosedPeriod(await readClosedPeriods(tx), periodOf(input.date)),
    clients: details,
  };
}

/**
 * Sets or moves a client's start date (rule 13), inside `withCompany` with the company row locked
 * by the caller, which the close locks too. Earlier is always allowed; later only while no closed
 * month holds a day between the old and the new date (`RECONCILIATION_START_LOCKED`).
 */
export async function checkReconcileFromMove(
  tx: Transaction,
  input: { readonly from: string | null; readonly to: string },
): Promise<void> {
  if (input.from === null || input.to <= input.from) return;
  const closed = await readClosedPeriods(tx);
  const lastReleased = previousDay(input.to);
  for (let month = periodOf(input.from); month <= periodOf(lastReleased); ) {
    if (isClosedPeriod(closed, month)) {
      throw new DomainError('RECONCILIATION_START_LOCKED', `The month ${month} is closed`, {
        period: month,
      });
    }
    month = periodOf(dayAfter(lastDayOfMonth(`${month}-01`)));
  }
}
