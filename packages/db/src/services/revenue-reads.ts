import {
  type CurrencyCode,
  DomainError,
  hubMinor,
  type OpeningRevenueSchedule,
  type RecognitionAmounts,
  type RecognitionState,
  type RevenueMonth,
  type RevenueMovement,
  type RevenuePreview,
  type RevenueSchedule,
  type RevenueScheduleDetail,
} from '@vertex-mizan/contracts';
import {
  type CarriedAmounts,
  lastDayOfMonth,
  negate,
  periodOf,
  sumCarried,
} from '@vertex-mizan/ledger';
import { and, asc, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { isClosedPeriod, readClosedPeriods } from '../posting/periods.js';
import { dimensionValues } from '../schema/dimensions.js';
import { inboundEventStates, inboundEvents } from '../schema/inbox.js';
import { journalEntries } from '../schema/ledger.js';
import { recognitionMovements, recognitionSchedules } from '../schema/recognition.js';
import {
  amountsOf,
  companyLedgers,
  currentService,
  movementsOf,
  overTimeStates,
  releasedRevenueAccount,
  type ScheduleState,
  scheduleIssuesOf,
} from './recognition.js';

// The reads of `/api/revenue` (S06 "API", "Screens"; ADR 0015): the schedules with what they
// released and still hold, a schedule's movements and months, each month's releases and what is
// missing, and the releases the job would post. Everything is read in the caller's `withCompany`
// transaction; a schedule's figures come from its movements, as the postings read them, so the
// screens reconcile to the ledger (S06 "Reports").

type ScheduleRow = typeof recognitionSchedules.$inferSelect;
type MovementRow = typeof recognitionMovements.$inferSelect;

/** Schedules per page of `/api/revenue/schedules`. */
export const REVENUE_PAGE_SIZE = 50;

const wire = (amounts: CarriedAmounts): RecognitionAmounts => ({
  transactionMinor: amounts.transaction.amountMinor.toString(),
  bookMinor: amounts.bookMinor.toString(),
  parallelMinor: amounts.parallelMinor === null ? null : amounts.parallelMinor.toString(),
});

/** The movements that take what a schedule recognised out of its liability. */
const RECOGNISED: readonly MovementRow['kind'][] = [
  'released',
  'adjusted',
  'elapsed',
  'remainder_released',
  // What S06 released before the books start, on an opening schedule (S10 rule 13).
  'before_opening',
];

/** A schedule's derived state (S06 "Data"). */
function stateOf(movements: readonly MovementRow[], remaining: CarriedAmounts): RecognitionState {
  if (movements.some((movement) => movement.kind === 'reversed')) return 'voided';
  return remaining.transaction.amountMinor === 0n ? 'completed' : 'active';
}

/** The values the schedules name, by id. */
async function valuesOf(tx: Transaction, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const rows =
    unique.length === 0
      ? []
      : await tx
          .select({
            id: dimensionValues.id,
            code: dimensionValues.code,
            name: dimensionValues.name,
          })
          .from(dimensionValues)
          .where(inArray(dimensionValues.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

/** A schedule as `/revenue` lists it, without the issue it names (an event or the opening). */
type ShapedSchedule = Omit<RevenueSchedule, 'inboxId'>;

/** Schedules from an event as `/revenue` lists them, from their rows. */
async function shape(
  tx: Transaction,
  schedules: readonly ScheduleRow[],
): Promise<RevenueSchedule[]> {
  const shaped = await shapeRows(tx, schedules);
  return shaped.map((schedule, index) => ({
    ...schedule,
    inboxId: schedules[index]?.eventId as string,
  }));
}

/** The opening's schedules as `/revenue` lists them (S10), from their rows. */
async function shapeOpening(
  tx: Transaction,
  schedules: readonly ScheduleRow[],
): Promise<OpeningRevenueSchedule[]> {
  const shaped = await shapeRows(tx, schedules);
  return shaped.map((schedule, index) => ({
    ...schedule,
    openingId: schedules[index]?.openingId as string,
  }));
}

async function shapeRows(
  tx: Transaction,
  schedules: readonly ScheduleRow[],
): Promise<ShapedSchedule[]> {
  if (schedules.length === 0) return [];
  const ledgers = await companyLedgers(tx);
  const parallel = ledgers.parallel !== null;
  const movements = await movementsOf(
    tx,
    schedules.map((schedule) => schedule.id),
  );
  const issues = await scheduleIssuesOf(tx, schedules);
  const services = new Map(
    schedules.map((schedule) => [
      schedule.id,
      currentService(schedule, movements.get(schedule.id) ?? []),
    ]),
  );
  const values = await valuesOf(
    tx,
    [
      ...schedules.flatMap((schedule) => [schedule.clientValueId, schedule.contractValueId ?? []]),
      ...services.values(),
    ].flat(),
  );
  const valueById = (id: string) => {
    const value = values.get(id);
    if (!value) throw new Error('A schedule names a value that is not there');
    return value;
  };
  return schedules.map((schedule) => {
    const own = movements.get(schedule.id) ?? [];
    const currency = schedule.currency as CurrencyCode;
    const sum = (rows: readonly MovementRow[]) =>
      sumCarried(
        rows.map((movement) => amountsOf(movement, currency)),
        currency,
        parallel,
      );
    const remaining = sum(own);
    const line = issues
      .get(schedule.id)
      ?.payload.lines.find((candidate) => candidate.id === schedule.lineId);
    if (!line) throw new Error('A schedule without its line');
    return {
      id: schedule.id,
      invoiceDocumentId: schedule.invoiceDocumentId,
      invoiceNumber: schedule.invoiceNumber,
      lineId: schedule.lineId,
      pattern: schedule.pattern as RevenueSchedule['pattern'],
      lineSource: schedule.lineSource as RevenueSchedule['lineSource'],
      chargeKind: schedule.chargeKind as RevenueSchedule['chargeKind'],
      currency: currency as RevenueSchedule['currency'],
      client: valueById(schedule.clientValueId),
      contract: schedule.contractValueId === null ? null : valueById(schedule.contractValueId),
      service: valueById(services.get(schedule.id) as string),
      serviceFrom: schedule.serviceFrom,
      serviceTo: schedule.serviceTo,
      milestoneId: schedule.milestoneId,
      amountMinor: hubMinor(line.amount).toString(),
      released: wire(negate(sum(own.filter((movement) => RECOGNISED.includes(movement.kind))))),
      remaining: wire(remaining),
      state: stateOf(own, remaining),
      reissueOfId: schedule.reissueOfScheduleId,
      createdAt: schedule.createdAt.toISOString(),
    };
  });
}

/** The SQL of a schedule's derived state, for the list's filter. */
function stateFilter(state: RecognitionState) {
  const reversed = sql`exists (select 1 from ${recognitionMovements} m where m.company_id = ${recognitionSchedules.companyId} and m.schedule_id = ${recognitionSchedules.id} and m.kind = 'reversed')`;
  const empty = sql`(select coalesce(sum(m.transaction_minor), 0) from ${recognitionMovements} m where m.company_id = ${recognitionSchedules.companyId} and m.schedule_id = ${recognitionSchedules.id}) = 0`;
  switch (state) {
    case 'voided':
      return reversed;
    case 'completed':
      return sql`not ${reversed} and ${empty}`;
    case 'active':
      return sql`not ${reversed} and not ${empty}`;
  }
}

/**
 * `GET /api/revenue/schedules` (S06 "API"): newest first, `REVENUE_PAGE_SIZE` a page after the
 * schedule `after`; by state, client and contract value, and a month: an over-time schedule whose
 * service period touches it, or a schedule with a movement of an entry dated in it.
 */
export async function readRevenueSchedules(
  tx: Transaction,
  filter: {
    readonly state?: RecognitionState;
    readonly client?: string;
    readonly contract?: string;
    readonly month?: string;
  },
  after: string | null,
): Promise<{
  schedules: RevenueSchedule[];
  more: boolean;
  openingSchedules: OpeningRevenueSchedule[];
}> {
  const first = filter.month === undefined ? null : `${filter.month}-01`;
  const last = first === null ? null : lastDayOfMonth(first);
  const filters: (SQL | undefined)[] = [
    filter.state === undefined ? undefined : stateFilter(filter.state),
    filter.client === undefined ? undefined : eq(recognitionSchedules.clientValueId, filter.client),
    filter.contract === undefined
      ? undefined
      : eq(recognitionSchedules.contractValueId, filter.contract),
    first === null || last === null
      ? undefined
      : sql`((${recognitionSchedules.serviceFrom} <= ${last} and ${recognitionSchedules.serviceTo} >= ${first})
          or exists (select 1 from ${recognitionMovements} m join ${journalEntries} e on e.company_id = m.company_id and e.id = m.entry_id
            where m.company_id = ${recognitionSchedules.companyId} and m.schedule_id = ${recognitionSchedules.id}
              and e.entry_date between ${first} and ${last}))`,
  ];
  const rows = await tx
    .select()
    .from(recognitionSchedules)
    .where(
      and(
        // `schedules` names each schedule's issue event (`inboxId`, required in the published API);
        // the opening's schedules (S10) come apart, in `openingSchedules`.
        isNotNull(recognitionSchedules.eventId),
        ...filters,
        after === null
          ? undefined
          : sql`(${recognitionSchedules.createdAt}, ${recognitionSchedules.id}) < (select s.created_at, s.id from ${recognitionSchedules} s where s.id = ${after})`,
      ),
    )
    .orderBy(desc(recognitionSchedules.createdAt), desc(recognitionSchedules.id))
    .limit(REVENUE_PAGE_SIZE + 1);
  const openingRows =
    after === null
      ? await tx
          .select()
          .from(recognitionSchedules)
          .where(and(isNull(recognitionSchedules.eventId), ...filters))
          .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id))
      : [];
  return {
    schedules: await shape(tx, rows.slice(0, REVENUE_PAGE_SIZE)),
    more: rows.length > REVENUE_PAGE_SIZE,
    openingSchedules: await shapeOpening(tx, openingRows),
  };
}

/**
 * `GET /api/revenue/schedules/:id` (S06 "API"): the schedule, its movements with their entries,
 * and for an over-time schedule each month's planned part and whether it is released; null when
 * there is no such schedule in the company.
 */
export async function readRevenueSchedule(
  tx: Transaction,
  id: string,
): Promise<RevenueScheduleDetail | null> {
  const [row] = await tx.select().from(recognitionSchedules).where(eq(recognitionSchedules.id, id));
  if (!row || row.eventId === null) return null;
  const [summary] = await shape(tx, [row]);
  if (!summary) return null;
  const ledgers = await companyLedgers(tx);
  const movements = (await movementsOf(tx, [row.id])).get(row.id) ?? [];
  const entryIds = movements.flatMap((movement) => movement.entryId ?? []);
  const entries =
    entryIds.length === 0
      ? []
      : await tx
          .select({
            id: journalEntries.id,
            date: journalEntries.entryDate,
            fiscalYear: journalEntries.fiscalYear,
            number: journalEntries.number,
          })
          .from(journalEntries)
          .where(inArray(journalEntries.id, entryIds));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const services = await valuesOf(
    tx,
    movements.flatMap((movement) => movement.serviceValueId ?? []),
  );
  const currency = row.currency as CurrencyCode;
  const shaped: RevenueMovement[] = movements.map((movement) => {
    const entry = movement.entryId === null ? undefined : entryById.get(movement.entryId);
    return {
      id: movement.id,
      kind: movement.kind as RevenueMovement['kind'],
      month: movement.month === null ? null : movement.month.slice(0, 7),
      entry:
        entry === undefined
          ? null
          : { id: entry.id, date: entry.date, fiscalYear: entry.fiscalYear, number: entry.number },
      amounts: wire(amountsOf(movement, currency)),
      creditMinor: movement.creditMinor === null ? null : movement.creditMinor.toString(),
      service:
        movement.serviceValueId === null ? null : (services.get(movement.serviceValueId) ?? null),
      createdAt: movement.createdAt.toISOString(),
    };
  });
  let months: RevenueScheduleDetail['months'] = [];
  if (row.pattern === 'over_time') {
    const [state] = await overTimeStates(tx, [row], ledgers);
    if (!state) throw new Error('A schedule without its state');
    months = state.months.map((month) => {
      const elapsed = movements.find(
        (movement) => movement.kind === 'elapsed' && movement.month?.slice(0, 7) === month.month,
      );
      const part = month.elapsed
        ? elapsed === undefined
          ? null
          : negate(amountsOf(elapsed, currency))
        : (state.parts.get(month.month) ?? null);
      return {
        month: month.month,
        days: Number(month.days),
        elapsed: month.elapsed,
        part: wire(
          part ?? {
            transaction: { amountMinor: 0n, currency },
            bookMinor: 0n,
            parallelMinor: ledgers.parallel === null ? null : 0n,
          },
        ),
        released: movements.some(
          (movement) =>
            (movement.kind === 'released' || movement.kind === 'before_opening') &&
            movement.month?.slice(0, 7) === month.month,
        ),
      };
    });
  }
  return { ...summary, movements: shaped, months };
}

/** Every over-time schedule whose service period touches a month of the range, with its state. */
async function statesTouching(tx: Transaction, from: string, to: string) {
  const schedules = await tx
    .select()
    .from(recognitionSchedules)
    .where(
      and(
        eq(recognitionSchedules.pattern, 'over_time'),
        sql`${recognitionSchedules.serviceFrom} <= ${lastDayOfMonth(`${to}-01`)}`,
        sql`${recognitionSchedules.serviceTo} >= ${`${from}-01`}`,
      ),
    )
    .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id));
  return overTimeStates(tx, schedules, await companyLedgers(tx));
}

/** A month's part of a schedule still to release, or null for none. */
function unreleased(state: ScheduleState, month: string): CarriedAmounts | null {
  if (state.voided) return null;
  const part = state.parts.get(month);
  if (part === undefined || part.transaction.amountMinor === 0n) return null;
  const released = state.movements.some(
    (movement) =>
      (movement.kind === 'released' || movement.kind === 'before_opening') &&
      movement.month?.slice(0, 7) === month,
  );
  return released ? null : part;
}

/**
 * `GET /api/revenue/months` (S06 "API", "Screens"): each month of the range, at most 24, with what
 * its releases took to revenue in each ledger and their entries, the schedules that ended the month
 * without its release and why (the period closed, the revenue slot unusable, or not run yet), and
 * the recognition events held for the accountant dated in it.
 */
export async function readRevenueMonths(
  tx: Transaction,
  months: readonly string[],
  today: string,
): Promise<RevenueMonth[]> {
  const [from, to] = [months[0], months.at(-1)];
  if (from === undefined || to === undefined) return [];
  const ledgers = await companyLedgers(tx);
  const released = await tx
    .select({
      month: sql<string>`to_char(${recognitionMovements.month}, 'YYYY-MM')`,
      book: sql<string>`(-sum(${recognitionMovements.bookMinor}))::text`,
      parallel: sql<string | null>`(-sum(${recognitionMovements.parallelMinor}))::text`,
      entries: sql<number>`count(distinct ${recognitionMovements.entryId})::int`,
    })
    .from(recognitionMovements)
    .where(
      and(
        inArray(recognitionMovements.kind, ['released', 'adjusted']),
        sql`${recognitionMovements.month} between ${`${from}-01`} and ${`${to}-01`}`,
      ),
    )
    .groupBy(sql`to_char(${recognitionMovements.month}, 'YYYY-MM')`);
  const byMonth = new Map(released.map((row) => [row.month, row]));
  const closed = await readClosedPeriods(tx);
  const revenue = await releasedRevenueAccount(tx);
  const states = await statesTouching(tx, from, to);
  const decisions = await tx
    .select({
      month: sql<string>`to_char(${inboundEvents.accountingDate}, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
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
        eq(inboundEventStates.state, 'held'),
        inArray(inboundEventStates.holdReason, ['NEEDS_DECISION', 'SERVICE_PERIOD_CLOSED']),
        inArray(inboundEvents.type, [
          'invoice.issued',
          'invoice.voided',
          'invoice.line_service_changed',
          'milestone.done',
          'milestone.reopened',
          'project.completed',
          'project.cancelled',
        ]),
        sql`${inboundEvents.accountingDate} between ${`${from}-01`} and ${lastDayOfMonth(`${to}-01`)}`,
      ),
    )
    .groupBy(sql`to_char(${inboundEvents.accountingDate}, 'YYYY-MM')`);
  const decisionsOf = new Map(decisions.map((row) => [row.month, row.count]));
  return months.map((month) => {
    const row = byMonth.get(month);
    const ended = lastDayOfMonth(`${month}-01`) < today;
    const missing = ended
      ? states.flatMap((state) =>
          unreleased(state, month) === null
            ? []
            : [
                {
                  scheduleId: state.schedule.id,
                  invoiceNumber: state.schedule.invoiceNumber,
                  reason: isClosedPeriod(closed, month)
                    ? 'PERIOD_CLOSED'
                    : 'refusal' in revenue
                      ? revenue.refusal
                      : null,
                },
              ],
        )
      : [];
    return {
      month,
      releasedBookMinor: row?.book ?? '0',
      releasedParallelMinor: ledgers.parallel === null ? null : (row?.parallel ?? '0'),
      entryCount: row?.entries ?? 0,
      missing,
      decisionCount: decisionsOf.get(month) ?? 0,
    };
  });
}

/**
 * `GET /api/revenue/preview?month=` (S06 "API", rule 5): the releases the month's job would post
 * for the current month or a past open one, per invoice in the order the job posts them, each
 * schedule's part; a month to come or a closed one is `VALIDATION_FAILED`.
 */
export async function previewRevenueMonth(
  tx: Transaction,
  month: string,
  today: string,
): Promise<RevenuePreview> {
  if (month > periodOf(today)) {
    throw new DomainError('VALIDATION_FAILED', 'A month to come has no preview', { month });
  }
  if (isClosedPeriod(await readClosedPeriods(tx), month)) {
    throw new DomainError('VALIDATION_FAILED', 'A closed month has no preview', { month });
  }
  const states = await statesTouching(tx, month, month);
  const values = await valuesOf(
    tx,
    states
      .flatMap((state) => [
        state.schedule.clientValueId,
        state.schedule.contractValueId ?? [],
        state.serviceValueId,
      ])
      .flat(),
  );
  const valueById = (id: string) => values.get(id) as NonNullable<ReturnType<typeof values.get>>;
  const byInvoice = new Map<string, RevenuePreview['entries'][number]>();
  // The opening's invoices are released by the job too, one entry per invoice (S10 rule 24); they
  // have no issue event, so they are listed apart.
  const byOpeningInvoice = new Map<string, RevenuePreview['openingEntries'][number]>();
  for (const state of states) {
    const part = unreleased(state, month);
    if (part === null) continue;
    const { schedule } = state;
    const fields = {
      invoiceNumber: schedule.invoiceNumber,
      date: lastDayOfMonth(`${month}-01`),
      lines: [] as RevenuePreview['entries'][number]['lines'],
    };
    let entry: { lines: RevenuePreview['entries'][number]['lines'] };
    if (schedule.eventId !== null) {
      const key = schedule.eventId;
      entry = byInvoice.get(key) ?? { inboxId: key, ...fields };
      byInvoice.set(key, entry as RevenuePreview['entries'][number]);
    } else {
      const openingId = schedule.openingId as string;
      const key = `${openingId}:${schedule.invoiceDocumentId}`;
      entry = byOpeningInvoice.get(key) ?? { openingId, ...fields };
      byOpeningInvoice.set(key, entry as RevenuePreview['openingEntries'][number]);
    }
    entry.lines.push({
      scheduleId: schedule.id,
      client: valueById(schedule.clientValueId),
      contract: schedule.contractValueId === null ? null : valueById(schedule.contractValueId),
      service: valueById(state.serviceValueId),
      amounts: wire(part),
    });
  }
  return {
    month,
    entries: [...byInvoice.values()],
    openingEntries: [...byOpeningInvoice.values()],
  };
}
