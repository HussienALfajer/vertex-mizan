import {
  type CompanyLedgers,
  type CurrencyCode,
  DomainError,
  type EventOf,
  hubMinor,
  money,
  type PostingSlot,
  parseEventEnvelope,
} from '@vertex-mizan/contracts';
import {
  type CarriedAmounts,
  firstOpenDayAfter,
  type HubDimensions,
  lastDayOfMonth,
  negate,
  overTimeMonths,
  type PlannedSchedule,
  periodOf,
  releaseParts,
  sumCarried,
} from '@vertex-mizan/ledger';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AuditActor } from '../audit.js';
import type { Transaction } from '../client.js';
import { type CarriedLineSpec, type HubSource, post } from '../posting/post.js';
import { chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { inboundEvents, postingRuleAccounts } from '../schema/inbox.js';
import { journalEntries, journalLines, ledgerHeads, periods } from '../schema/ledger.js';
import { recognitionMovements, recognitionSchedules } from '../schema/recognition.js';
import { ledgersOf } from './companies.js';

// Revenue recognition (S06, ADR 0015): the schedules an invoice's over-time lines open, their
// movements, and the releases that carry what they defer to revenue month by month. Everything runs
// in the caller's transaction inside `withCompany`, beside the entries `post()` writes: the
// schedules and movements describe those entries and are never written apart from them.

type EventRow = typeof inboundEvents.$inferSelect;
type ScheduleRow = typeof recognitionSchedules.$inferSelect;
type MovementRow = typeof recognitionMovements.$inferSelect;

/** Finds or makes Hub's dimension values of a line (S05 rule 23), as the inbox's attempt does. */
export interface HubValueIds {
  idsOf(dimensions: HubDimensions): Promise<string[]>;
}

/** A line's three amounts as stored. */
async function lineAmounts(
  tx: Transaction,
  entryId: string,
  lineNo: number,
): Promise<CarriedAmounts> {
  const [line] = await tx
    .select({
      currency: journalLines.currency,
      amountMinor: journalLines.amountMinor,
      bookMinor: journalLines.bookMinor,
      parallelMinor: journalLines.parallelMinor,
    })
    .from(journalLines)
    .where(and(eq(journalLines.entryId, entryId), eq(journalLines.lineNo, lineNo)));
  if (!line) throw new Error(`No line ${lineNo} on entry ${entryId}`);
  return {
    transaction: money(line.amountMinor, line.currency as CurrencyCode),
    bookMinor: line.bookMinor,
    parallelMinor: line.parallelMinor,
  };
}

/**
 * The schedules of an invoice's over-time lines (ADR 0015), after its entries posted: one row per
 * line, then its `deferred` movement (what it adds to recognise: its contract liability line and its
 * elapsed parts, positive) and one `elapsed` movement per elapsed month (its revenue line,
 * negative), so the remaining is what the liability holds for it in every ledger.
 */
export async function openSchedules(
  tx: Transaction,
  row: EventRow,
  event: EventOf<'invoice.issued'>,
  schedules: readonly PlannedSchedule[],
  posted: ReadonlyMap<string, string>,
  values: HubValueIds,
  parallel: boolean,
): Promise<void> {
  const entryOf = (key: string) => {
    const entryId = posted.get(key);
    if (entryId === undefined) throw new Error(`The plan's entry ${key} did not post`);
    return entryId;
  };
  for (const schedule of schedules) {
    const { client, contract, service } = schedule.dimensions;
    if (client === undefined || service === undefined) throw new TypeError('A line without values');
    const [clientValueId] = await values.idsOf({ client });
    const contractValueId =
      contract === undefined ? null : (await values.idsOf({ client, contract }))[1];
    const [serviceValueId] = await values.idsOf({ service });
    if (clientValueId === undefined || serviceValueId === undefined) {
      throw new Error('A value was not made');
    }
    const [made] = await tx
      .insert(recognitionSchedules)
      .values({
        companyId: row.companyId,
        eventId: row.id,
        invoiceDocumentId: event.payload.invoice.id,
        invoiceNumber: event.payload.invoice.number,
        lineId: schedule.lineId,
        pattern: 'over_time',
        lineSource: schedule.lineSource,
        chargeKind: schedule.chargeKind,
        serviceFrom: schedule.serviceFrom,
        serviceTo: schedule.serviceTo,
        cycleKey: schedule.cycleKey,
        clientValueId,
        contractValueId: contractValueId ?? null,
        serviceValueId,
        liabilityAccountId: schedule.liabilityAccountId,
        currency: event.payload.currency,
      })
      .returning({ id: recognitionSchedules.id });
    if (!made) throw new Error('The schedule was not made');
    const elapsed: { month: string; entryId: string; amounts: CarriedAmounts }[] = [];
    for (const part of schedule.elapsed) {
      const entryId = entryOf(part.key);
      elapsed.push({
        month: part.month,
        entryId,
        amounts: await lineAmounts(tx, entryId, part.lineNo),
      });
    }
    const deferredEntry = schedule.deferral === null ? null : entryOf(schedule.deferral.key);
    const liability =
      schedule.deferral === null || deferredEntry === null
        ? []
        : [negate(await lineAmounts(tx, deferredEntry, schedule.deferral.lineNo))];
    const deferred = sumCarried(
      [...liability, ...elapsed.map((part) => negate(part.amounts))],
      event.payload.currency,
      parallel,
    );
    const movement = (
      kind: MovementRow['kind'],
      entryId: string,
      amounts: CarriedAmounts,
      month: string | null,
    ) => ({
      companyId: row.companyId,
      scheduleId: made.id,
      kind,
      month,
      entryId,
      transactionMinor: amounts.transaction.amountMinor,
      bookMinor: amounts.bookMinor,
      parallelMinor: amounts.parallelMinor,
    });
    await tx
      .insert(recognitionMovements)
      .values(movement('deferred', deferredEntry ?? entryOf(event.id), deferred, null));
    for (const part of elapsed) {
      await tx
        .insert(recognitionMovements)
        .values(movement('elapsed', part.entryId, part.amounts, `${part.month}-01`));
    }
  }
}

/** A movement's amounts. */
function amountsOf(movement: MovementRow, currency: CurrencyCode): CarriedAmounts {
  return {
    transaction: money(movement.transactionMinor, currency),
    bookMinor: movement.bookMinor,
    parallelMinor: movement.parallelMinor,
  };
}

/** The ledgers of the company in context. */
async function companyLedgers(tx: Transaction): Promise<CompanyLedgers> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  return ledgersOf(settings);
}

/** What stops a month's release of an invoice, for `/revenue` and the checklist (S06 "Jobs"). */
export interface ReleaseRefusal {
  readonly invoiceNumber: string;
  readonly code: DomainError['code'] | 'NO_MAPPING';
  readonly detail: string | null;
}

/** The mapped `released_revenue` account, or what holds it (S06 "Jobs": the reason shown). */
async function releasedRevenueAccount(
  tx: Transaction,
): Promise<{ id: string } | { refusal: string }> {
  const [row] = await tx
    .select({
      id: chartAccounts.id,
      code: chartAccounts.code,
      blockedAt: chartAccounts.blockedAt,
      archivedAt: chartAccounts.archivedAt,
    })
    .from(postingRuleAccounts)
    .innerJoin(
      chartAccounts,
      and(
        eq(chartAccounts.companyId, postingRuleAccounts.companyId),
        eq(chartAccounts.id, postingRuleAccounts.accountId),
      ),
    )
    .where(
      and(eq(postingRuleAccounts.slot, 'released_revenue'), isNull(postingRuleAccounts.archivedAt)),
    );
  if (!row) return { refusal: 'slot_unmapped:released_revenue' };
  if (row.blockedAt !== null || row.archivedAt !== null) {
    return { refusal: `account_blocked:${row.code}` };
  }
  return { id: row.id };
}

/** An issue event's envelope, from its kept row. */
function issueOf(row: EventRow): EventOf<'invoice.issued'> {
  const envelope = parseEventEnvelope({
    id: row.eventId,
    type: row.type,
    version: row.version,
    occurred_at: row.occurredAt.toISOString(),
    accounting_date: row.accountingDate,
    payload: row.payload,
  });
  if (envelope.type !== 'invoice.issued') throw new TypeError('A schedule from another event');
  return envelope;
}

/** A schedule with its movements and the release part of each of its months not elapsed. */
interface ScheduleState {
  readonly schedule: ScheduleRow;
  readonly movements: readonly MovementRow[];
  /** Each month the schedule releases (`YYYY-MM`) with its part, carried. */
  readonly parts: ReadonlyMap<string, CarriedAmounts>;
  /** The service its releases take: the latest reclassification's, else its own. */
  readonly serviceValueId: string;
  readonly voided: boolean;
}

async function scheduleStates(
  tx: Transaction,
  issue: EventRow,
  ledgers: CompanyLedgers,
): Promise<ScheduleState[]> {
  const event = issueOf(issue);
  const schedules = await tx
    .select()
    .from(recognitionSchedules)
    .where(
      and(
        eq(recognitionSchedules.eventId, issue.id),
        eq(recognitionSchedules.pattern, 'over_time'),
      ),
    )
    .orderBy(asc(recognitionSchedules.id));
  if (schedules.length === 0) return [];
  const movements = await tx
    .select()
    .from(recognitionMovements)
    .where(
      inArray(
        recognitionMovements.scheduleId,
        schedules.map((schedule) => schedule.id),
      ),
    )
    .orderBy(asc(recognitionMovements.createdAt), asc(recognitionMovements.id));
  return schedules.map((schedule) => {
    const own = movements.filter((movement) => movement.scheduleId === schedule.id);
    const line = event.payload.lines.find((candidate) => candidate.id === schedule.lineId);
    if (!line || schedule.serviceFrom === null || schedule.serviceTo === null) {
      throw new Error('A schedule without its line or its period');
    }
    const currency = schedule.currency as CurrencyCode;
    // What the line deferred at issue: its deferral less its elapsed parts (ADR 0015).
    const atIssue = sumCarried(
      own
        .filter((movement) => movement.kind === 'deferred' || movement.kind === 'elapsed')
        .map((movement) => amountsOf(movement, currency)),
      currency,
      ledgers.parallel !== null,
    );
    const months = overTimeMonths(
      hubMinor(line.amount),
      schedule.serviceFrom,
      schedule.serviceTo,
      event.payload.issued_on,
    );
    const parts = releaseParts(atIssue, months, ledgers);
    const released = months.filter((month) => !month.elapsed);
    const reclassified = own.filter((movement) => movement.kind === 'reclassified').at(-1);
    return {
      schedule,
      movements: own,
      parts: new Map(released.map((month, k) => [month.month, parts[k] as CarriedAmounts])),
      serviceValueId: reclassified?.serviceValueId ?? schedule.serviceValueId,
      voided: own.some((movement) => movement.kind === 'reversed'),
    };
  });
}

/**
 * The release of an invoice's schedules for the month `month` (`YYYY-MM`; S06 rule 4), once the
 * month has ended (`today` is after its last day): one entry dated on its last day, source
 * `revenue_release`, under the system's key `release:<invoice event id>:<YYYY-MM>`, Dr each
 * schedule's liability account / Cr `released_revenue` with the client, the contract and the
 * schedule's current service, at its part of the month, carried; then its `released` movements. A
 * month already released, not ended, or with nothing to release posts nothing. With
 * `closedPeriods`, a month that is closed releases on the first day of the first open period after
 * it, at the same carried amounts, so no rate is read (owner, 2026-11-11: an invoice posted after
 * its month closed). The company's ledger head is locked first (ADR 0008), so the schedules are
 * read as the last posting left them. Answers the entry, or null.
 */
export async function releaseInvoiceMonth(
  tx: Transaction,
  issue: EventRow,
  month: string,
  today: string,
  actor: AuditActor,
  closedPeriods: readonly string[] = [],
): Promise<string | null> {
  const lastDay = lastDayOfMonth(`${month}-01`);
  if (lastDay >= today) return null;
  await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
  const entryDate = closedPeriods.includes(month)
    ? firstOpenDayAfter(lastDay, closedPeriods)
    : lastDay;
  const ledgers = await companyLedgers(tx);
  const states = (await scheduleStates(tx, issue, ledgers)).filter(
    (state) =>
      !state.voided &&
      state.parts.has(month) &&
      !state.movements.some(
        (movement) => movement.kind === 'released' && movement.month === `${month}-01`,
      ),
  );
  const releasing = states.filter(
    (state) => (state.parts.get(month) as CarriedAmounts).transaction.amountMinor !== 0n,
  );
  if (releasing.length === 0) return null;
  const revenue = await releasedRevenueAccount(tx);
  if ('refusal' in revenue) {
    throw new DomainError('MAPPING_ACCOUNT_INVALID', 'The released revenue slot is not usable', {
      detail: revenue.refusal,
    });
  }
  const lines: CarriedLineSpec[] = releasing.flatMap((state) => {
    const part = state.parts.get(month) as CarriedAmounts;
    const { clientValueId, contractValueId } = state.schedule;
    const parties = contractValueId === null ? [clientValueId] : [clientValueId, contractValueId];
    return [
      { accountId: state.schedule.liabilityAccountId, dimensionValueIds: parties, amounts: part },
      {
        accountId: revenue.id,
        dimensionValueIds: [...parties, state.serviceValueId],
        amounts: negate(part),
      },
    ];
  });
  const event = issueOf(issue);
  const hub: HubSource = {
    inboxId: issue.id,
    clientId: issue.apiClientId,
    document: {
      type: 'invoice',
      id: event.payload.invoice.id,
      number: event.payload.invoice.number,
    },
  };
  const entry = await post(tx, {
    client: 'system',
    idempotencyKey: `release:${issue.eventId}:${month}`,
    entryDate,
    description: `تحرير إيراد ${event.payload.invoice.number} عن ${month}`,
    reference: event.payload.invoice.number,
    draftId: null,
    preparedByUserId: null,
    approvedByUserId: null,
    actor,
    content: { kind: 'carried', source: 'revenue_release', lines, today, hub },
  });
  if (entry.replayed) return entry.id;
  for (const state of releasing) {
    const part = negate(state.parts.get(month) as CarriedAmounts);
    await tx.insert(recognitionMovements).values({
      companyId: issue.companyId,
      scheduleId: state.schedule.id,
      kind: 'released',
      month: `${month}-01`,
      entryId: entry.id,
      transactionMinor: part.transaction.amountMinor,
      bookMinor: part.bookMinor,
      parallelMinor: part.parallelMinor,
    });
  }
  return entry.id;
}

/**
 * The months of an invoice's schedules that ended before `today` and are not released, in order:
 * what an invoice posted after its months' jobs releases in its own transaction (S06 rule 5). A
 * closed month among them releases on the first day of the first open period after it (owner,
 * 2026-11-11), so an invoice moved out of a closed month (S05 rule 15) posts with its releases.
 */
export async function releaseEndedMonths(
  tx: Transaction,
  issue: EventRow,
  today: string,
  actor: AuditActor,
): Promise<string[]> {
  const closed = (
    await tx.select({ period: periods.period }).from(periods).where(sql`${periods.state} <> 'open'`)
  ).map((row) => row.period);
  const ledgers = await companyLedgers(tx);
  const months = new Set<string>();
  for (const state of await scheduleStates(tx, issue, ledgers)) {
    for (const month of state.parts.keys()) {
      if (lastDayOfMonth(`${month}-01`) < today) months.add(month);
    }
  }
  const posted: string[] = [];
  for (const month of [...months].sort()) {
    const entry = await releaseInvoiceMonth(tx, issue, month, today, actor, closed);
    if (entry !== null) posted.push(entry);
  }
  return posted;
}

/** What a month's job did in one company (S06 "Jobs"). */
export interface MonthRelease {
  readonly posted: number;
  readonly refused: readonly ReleaseRefusal[];
}

/**
 * The job `revenue.release-month` for `month` in the company in context (S06 rules 4–5): each
 * invoice whose over-time schedules touch the month, in the order the invoices posted, released in
 * its own savepoint, so one that cannot post (its revenue slot unmapped, its account blocked, its
 * period closed) leaves its release missing and the others post. Safe to run twice: a released
 * month posts nothing.
 */
export async function releaseMonth(
  tx: Transaction,
  month: string,
  today: string,
  actor: AuditActor,
): Promise<MonthRelease> {
  const first = `${month}-01`;
  const last = lastDayOfMonth(first);
  if (last >= today) return { posted: 0, refused: [] };
  const issues = await tx
    .select({ event: inboundEvents })
    .from(inboundEvents)
    .innerJoin(
      recognitionSchedules,
      and(
        eq(recognitionSchedules.companyId, inboundEvents.companyId),
        eq(recognitionSchedules.eventId, inboundEvents.id),
      ),
    )
    .where(
      and(
        eq(recognitionSchedules.pattern, 'over_time'),
        sql`${recognitionSchedules.serviceFrom} <= ${last}`,
        sql`${recognitionSchedules.serviceTo} >= ${first}`,
      ),
    )
    .groupBy(inboundEvents.id)
    .orderBy(
      sql`min(${recognitionSchedules.createdAt})`,
      sql`min(${recognitionSchedules.id}::text)`,
    );
  let posted = 0;
  const refused: ReleaseRefusal[] = [];
  for (const { event } of issues) {
    try {
      const entry = await tx.transaction((savepoint) =>
        releaseInvoiceMonth(savepoint, event, month, today, actor),
      );
      if (entry !== null) posted += 1;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      refused.push({
        invoiceNumber: event.documentNumber ?? event.documentId,
        code: error.code,
        detail: typeof error.details?.detail === 'string' ? error.details.detail : null,
      });
    }
  }
  return { posted, refused };
}

/** The invoice's Hub lines that have a schedule (S06; `HubReferences.scheduledLineIds`). */
export async function scheduledLineIdsOf(tx: Transaction, invoiceId: string): Promise<string[]> {
  const rows = await tx
    .select({ lineId: recognitionSchedules.lineId })
    .from(recognitionSchedules)
    .where(eq(recognitionSchedules.invoiceDocumentId, invoiceId));
  return rows.map((row) => row.lineId);
}

/**
 * A deferred line moved to another service (S06 rule 10), on the event's date: what its schedule
 * recognised by that date (its elapsed parts and the releases dated by it) moves from its current
 * service to the new one on `released_revenue`, at its carried amounts, in one entry under the
 * event's key; a release dated after the change and already posted on the old service (a change
 * processed late, held behind an earlier event) moves on that release's own date, under
 * `<key>:<YYYY-MM>`, so each month shows the service it would have had. A `reclassified` movement
 * records the new service for the later releases. With nothing recognised yet, only the movement is
 * written. Answers the entries, in date order.
 */
export async function reclassifyRecognised(
  tx: Transaction,
  row: EventRow,
  input: {
    readonly key: string;
    readonly lineId: string;
    readonly invoiceId: string;
    readonly toServiceValueId: string;
    readonly entryDate: string;
    readonly description: string;
    readonly today: string;
    readonly actor: AuditActor;
    readonly hub: HubSource;
  },
): Promise<string[]> {
  const [schedule] = await tx
    .select()
    .from(recognitionSchedules)
    .where(
      and(
        eq(recognitionSchedules.invoiceDocumentId, input.invoiceId),
        eq(recognitionSchedules.lineId, input.lineId),
      ),
    )
    .orderBy(asc(recognitionSchedules.id));
  if (!schedule) throw new Error('A scheduled line without its schedule');
  const [issue] = await tx
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.id, schedule.eventId));
  if (!issue) throw new Error('A schedule without its event');
  const ledgers = await companyLedgers(tx);
  const state = (await scheduleStates(tx, issue, ledgers)).find(
    (candidate) => candidate.schedule.id === schedule.id,
  );
  if (!state) throw new Error('A schedule without its state');
  const currency = schedule.currency as CurrencyCode;
  const parallel = ledgers.parallel !== null;
  // Each release's entry date: a release dated after the change moves on its own date.
  const releaseEntries = state.movements.flatMap((movement) =>
    movement.kind === 'released' && movement.entryId !== null ? [movement.entryId] : [],
  );
  const dates = new Map<string, string>();
  if (releaseEntries.length > 0) {
    const dated = await tx
      .select({ id: journalEntries.id, date: journalEntries.entryDate })
      .from(journalEntries)
      .where(inArray(journalEntries.id, releaseEntries));
    for (const entry of dated) dates.set(entry.id, entry.date);
  }
  const dateOf = (movement: MovementRow) =>
    movement.entryId === null ? null : (dates.get(movement.entryId) ?? null);
  const recognised = state.movements.filter(
    (movement) => movement.kind === 'released' || movement.kind === 'elapsed',
  );
  const later = recognised.filter((movement) => {
    const date = dateOf(movement);
    return movement.kind === 'released' && date !== null && date > input.entryDate;
  });
  const moves: { key: string; date: string; amounts: CarriedAmounts }[] = [];
  // As positive revenue amounts: what the movements took from what remained to recognise.
  const byChange = negate(
    sumCarried(
      recognised
        .filter((movement) => !later.includes(movement))
        .map((movement) => amountsOf(movement, currency)),
      currency,
      parallel,
    ),
  );
  if (byChange.transaction.amountMinor !== 0n) {
    moves.push({ key: input.key, date: input.entryDate, amounts: byChange });
  }
  for (const movement of later) {
    moves.push({
      key: `${input.key}:${(movement.month ?? '').slice(0, 7)}`,
      date: dateOf(movement) as string,
      amounts: negate(amountsOf(movement, currency)),
    });
  }
  const entries: string[] = [];
  if (moves.length > 0 && state.serviceValueId !== input.toServiceValueId) {
    const revenue = await releasedRevenueAccount(tx);
    if ('refusal' in revenue) {
      throw new DomainError('MAPPING_ACCOUNT_INVALID', 'The released revenue slot is not usable', {
        detail: revenue.refusal,
      });
    }
    const parties =
      schedule.contractValueId === null
        ? [schedule.clientValueId]
        : [schedule.clientValueId, schedule.contractValueId];
    for (const move of moves) {
      const entry = await post(tx, {
        client: input.hub.clientId,
        idempotencyKey: move.key,
        entryDate: move.date,
        description: input.description,
        reference: row.documentNumber,
        draftId: null,
        preparedByUserId: null,
        approvedByUserId: null,
        actor: input.actor,
        content: {
          kind: 'carried',
          source: 'hub_event',
          lines: [
            {
              accountId: revenue.id,
              dimensionValueIds: [...parties, state.serviceValueId],
              amounts: move.amounts,
            },
            {
              accountId: revenue.id,
              dimensionValueIds: [...parties, input.toServiceValueId],
              amounts: negate(move.amounts),
            },
          ],
          today: input.today,
          hub: input.hub,
        },
      });
      entries.push(entry.id);
    }
  }
  await tx.insert(recognitionMovements).values({
    companyId: row.companyId,
    scheduleId: schedule.id,
    kind: 'reclassified',
    month: null,
    entryId: entries[0] ?? null,
    transactionMinor: 0n,
    bookMinor: 0n,
    parallelMinor: parallel ? 0n : null,
    serviceValueId: input.toServiceValueId,
  });
  return entries;
}

/** S06's slots, appended to the template after companies were made (`mapAppendedTemplateSlots()`). */
export const RECOGNITION_SLOTS = [
  'contract_liability',
  'contract_asset',
  'released_revenue',
  'cancelled_project_refund',
] as const satisfies readonly PostingSlot[];

/** The month after `month` (`YYYY-MM`). */
function nextMonth(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

/**
 * Every month that has ended before `today` and that some over-time schedule of the company in
 * context touches, released by `releaseMonth()` in order (S06 rule 5: the job of the first day of
 * the next month, and again at the worker's start and each day for any past month still missing
 * its release). A month released already posts nothing, so this is safe to run any number of
 * times; a closed month's missing release is the period's (S07's checklist).
 */
export async function releaseMissingMonths(
  tx: Transaction,
  today: string,
  actor: AuditActor,
): Promise<MonthRelease> {
  const [span] = await tx
    .select({
      from: sql<string | null>`min(${recognitionSchedules.serviceFrom})::text`,
      to: sql<string | null>`max(${recognitionSchedules.serviceTo})::text`,
    })
    .from(recognitionSchedules)
    .where(eq(recognitionSchedules.pattern, 'over_time'));
  if (!span?.from || !span.to) return { posted: 0, refused: [] };
  const current = periodOf(today);
  const last = periodOf(span.to);
  let posted = 0;
  const refused: ReleaseRefusal[] = [];
  for (
    let month = periodOf(span.from);
    month < current && month <= last;
    month = nextMonth(month)
  ) {
    const result = await releaseMonth(tx, month, today, actor);
    posted += result.posted;
    refused.push(...result.refused);
  }
  return { posted, refused };
}
