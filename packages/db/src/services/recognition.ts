import {
  type CompanyLedgers,
  type CurrencyCode,
  DomainError,
  type EventOf,
  hubMinor,
  type InvoiceIssuedV1,
  invoiceIssuedV1Schema,
  money,
  openingSnapshotSchema,
  type PostingSlot,
  parseEventEnvelope,
} from '@vertex-mizan/contracts';
import {
  type CarriedAmounts,
  type CreditableSchedule,
  type CycleReferences,
  firstOpenDayAfter,
  type HubDimensions,
  lastDayOfMonth,
  type MilestoneReferences,
  negate,
  netOfCredits,
  type OverTimeMonth,
  overTimeMonths,
  type PlannedMovement,
  type PlannedSchedule,
  type PointInTimeSchedule,
  periodOf,
  type RecognitionAmount,
  recutReleases,
  reissueKey,
  reissueParts,
  releaseParts,
  remainingReleaseParts,
  reversedMovement,
  sumCarried,
  type VoidedOverTime,
  voidedCreditParts,
} from '@vertex-mizan/ledger';
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { AuditActor } from '../audit.js';
import type { Transaction } from '../client.js';
import { closedPeriodList } from '../posting/periods.js';
import { type CarriedLineSpec, type HubSource, post } from '../posting/post.js';
import { chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { dimensionValues } from '../schema/dimensions.js';
import { inboundEventStates, inboundEvents, postingRuleAccounts } from '../schema/inbox.js';
import { journalEntries, journalLines, ledgerHeads, postingRequests } from '../schema/ledger.js';
import { openItemBalances, openItems } from '../schema/open-items.js';
import { openingSnapshots, openings } from '../schema/opening.js';
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
 * The schedules of an invoice's deferred lines (ADR 0015), after its entries posted: one row per
 * over-time or point-in-time line, then its `deferred` movement (what it adds to recognise: its contract liability line and its
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
        pattern: schedule.pattern,
        lineSource: schedule.lineSource,
        chargeKind: schedule.chargeKind,
        serviceFrom: schedule.serviceFrom,
        serviceTo: schedule.serviceTo,
        milestoneId: schedule.milestoneId,
        cycleKey: schedule.cycleKey,
        clientValueId,
        contractValueId: contractValueId ?? null,
        serviceValueId,
        liabilityAccountId: schedule.liabilityAccountId,
        currency: event.payload.currency,
        reissueOfScheduleId: schedule.reissueOfScheduleId ?? null,
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
export function amountsOf(movement: MovementRow, currency: CurrencyCode): CarriedAmounts {
  return {
    transaction: money(movement.transactionMinor, currency),
    bookMinor: movement.bookMinor,
    parallelMinor: movement.parallelMinor,
  };
}

/** The ledgers of the company in context. */
export async function companyLedgers(tx: Transaction): Promise<CompanyLedgers> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  return ledgersOf(settings);
}

/** A schedule's current service: its latest reclassification's, else its own (S06 rule 10). */
export function currentService(schedule: ScheduleRow, movements: readonly MovementRow[]): string {
  const reclassified = movements.filter((movement) => movement.kind === 'reclassified').at(-1);
  return reclassified?.serviceValueId ?? schedule.serviceValueId;
}

/**
 * The point-in-time schedules that stand (no `reversed` movement), in the order they were made,
 * with what each still holds (S06 rules 11, 14, 15).
 */
async function standingPointInTime(
  tx: Transaction,
  where: ReturnType<typeof eq>,
  parallel: boolean,
): Promise<PointInTimeSchedule[]> {
  const schedules = await tx
    .select()
    .from(recognitionSchedules)
    .where(and(eq(recognitionSchedules.pattern, 'point_in_time'), where))
    .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id));
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
  // The milestones whose events the accountant resolved by a manual entry (S05 rule 16).
  const milestoneIds = [...new Set(schedules.flatMap((schedule) => schedule.milestoneId ?? []))];
  const resolved =
    milestoneIds.length === 0
      ? []
      : await tx
          .select({ milestoneId: inboundEvents.documentId })
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
              eq(inboundEvents.documentType, 'milestone'),
              inArray(inboundEvents.documentId, milestoneIds),
              eq(inboundEventStates.state, 'resolved'),
            ),
          );
  const resolvedMilestones = new Set(resolved.map((row) => row.milestoneId));
  return schedules.flatMap((schedule) => {
    const own = movements.filter((movement) => movement.scheduleId === schedule.id);
    if (own.some((movement) => movement.kind === 'reversed')) return [];
    const currency = schedule.currency as CurrencyCode;
    return [
      {
        id: schedule.id,
        liabilityAccountId: schedule.liabilityAccountId,
        parties:
          schedule.contractValueId === null
            ? [schedule.clientValueId]
            : [schedule.clientValueId, schedule.contractValueId],
        serviceValueId: currentService(schedule, own),
        resolvedByHand:
          schedule.milestoneId !== null && resolvedMilestones.has(schedule.milestoneId),
        remaining: sumCarried(
          own.map((movement) => amountsOf(movement, currency)),
          currency,
          parallel,
        ),
      },
    ];
  });
}

/** The project's standing point-in-time schedules, by Hub's project id (S06 rules 14–15). */
export async function projectSchedulesOf(
  tx: Transaction,
  projectId: string,
): Promise<PointInTimeSchedule[]> {
  const ledgers = await companyLedgers(tx);
  const contracts = tx
    .select({ id: dimensionValues.id })
    .from(dimensionValues)
    .where(
      and(eq(dimensionValues.externalSource, 'hub'), eq(dimensionValues.externalId, projectId)),
    );
  return standingPointInTime(
    tx,
    inArray(recognitionSchedules.contractValueId, contracts),
    ledgers.parallel !== null,
  );
}

/**
 * What the books hold for a milestone (`MilestoneReferences`; S06 rules 11–13): `standing`, the
 * entries of its `milestone` document still standing (its done), latest first; `projectId`, Hub's
 * id of its project, when the event names one.
 */
export async function milestoneFactsOf(
  tx: Transaction,
  milestoneId: string,
  projectId: string | null,
  standing: readonly string[],
): Promise<MilestoneReferences> {
  const ledgers = await companyLedgers(tx);
  const parallel = ledgers.parallel !== null;
  const [doneEntry] = standing;
  let item: MilestoneReferences['item'] = null;
  let doneRelease: MilestoneReferences['doneRelease'] = null;
  if (doneEntry !== undefined) {
    const [opened] = await tx
      .select({
        id: openItems.id,
        accountId: openItems.accountId,
        currency: openItems.currency,
        openMinor: openItemBalances.openMinor,
        bookMinor: openItemBalances.bookMinor,
        parallelMinor: openItemBalances.parallelMinor,
      })
      .from(openItems)
      .innerJoin(
        openItemBalances,
        and(
          eq(openItemBalances.companyId, openItems.companyId),
          eq(openItemBalances.itemId, openItems.id),
        ),
      )
      .where(and(eq(openItems.openedByEntryId, doneEntry), eq(openItems.kind, 'document')));
    if (opened) {
      const currency = opened.currency as CurrencyCode;
      item = {
        id: opened.id,
        accountId: opened.accountId,
        currency,
        openMinor: opened.openMinor,
        carried: {
          transaction: money(opened.openMinor, currency),
          bookMinor: opened.bookMinor,
          parallelMinor: opened.parallelMinor,
        },
      };
    }
    const [release] = await tx
      .select()
      .from(recognitionMovements)
      .where(
        and(eq(recognitionMovements.entryId, doneEntry), eq(recognitionMovements.kind, 'released')),
      );
    if (release) {
      const [schedule] = await tx
        .select({ currency: recognitionSchedules.currency })
        .from(recognitionSchedules)
        .where(eq(recognitionSchedules.id, release.scheduleId));
      if (!schedule) throw new Error('A movement without its schedule');
      doneRelease = {
        entryId: doneEntry,
        scheduleId: release.scheduleId,
        amounts: negate(amountsOf(release, schedule.currency as CurrencyCode)),
      };
    }
  }
  // A milestone done before the books start and not invoiced is the opening's contract asset
  // (S10 rules 11, 30): its done stands, and its invoice clears that item.
  let openedByOpening = false;
  if (doneEntry === undefined) {
    const [opened] = await tx
      .select({
        id: openItems.id,
        accountId: openItems.accountId,
        currency: openItems.currency,
        openMinor: openItemBalances.openMinor,
        bookMinor: openItemBalances.bookMinor,
        parallelMinor: openItemBalances.parallelMinor,
      })
      .from(openItems)
      .innerJoin(
        openItemBalances,
        and(
          eq(openItemBalances.companyId, openItems.companyId),
          eq(openItemBalances.itemId, openItems.id),
        ),
      )
      .where(
        and(
          eq(openItems.source, 'opening'),
          eq(openItems.kind, 'document'),
          sql`${openItems.hubDocument} ->> 'type' = 'milestone'`,
          sql`${openItems.hubDocument} ->> 'id' = ${milestoneId}`,
          sql`not exists (select 1 from ${journalEntries} r where r.company_id = ${openItems.companyId} and r.reverses_entry_id = ${openItems.openedByEntryId})`,
        ),
      );
    if (opened) {
      const currency = opened.currency as CurrencyCode;
      openedByOpening = true;
      item = {
        id: opened.id,
        accountId: opened.accountId,
        currency,
        openMinor: opened.openMinor,
        carried: {
          transaction: money(opened.openMinor, currency),
          bookMinor: opened.bookMinor,
          parallelMinor: opened.parallelMinor,
        },
      };
    }
  }
  const schedules = await standingPointInTime(
    tx,
    eq(recognitionSchedules.milestoneId, milestoneId),
    parallel,
  );
  const [items] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(openItems)
    .where(
      and(
        sql`${openItems.hubDocument} ->> 'type' = 'milestone'`,
        sql`${openItems.hubDocument} ->> 'id' = ${milestoneId}`,
      ),
    );
  let projectCancelled = false;
  if (projectId !== null) {
    const [cancelled] = await tx
      .select({ id: inboundEvents.id })
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
          eq(inboundEvents.type, 'project.cancelled'),
          eq(inboundEvents.documentType, 'project'),
          eq(inboundEvents.documentId, projectId),
          inArray(inboundEventStates.state, ['posted', 'recorded', 'resolved']),
        ),
      )
      .limit(1);
    projectCancelled = cancelled !== undefined;
  }
  return {
    doneStanding: doneEntry !== undefined || openedByOpening,
    item,
    doneRelease,
    schedule: schedules.at(-1) ?? null,
    items: items?.n ?? 0,
    projectCancelled,
    ...(await milestoneHistoryOf(tx, milestoneId)),
  };
}

/** Whether a schedule of the invoice was cleared by its project's split (S06 rule 8). */
export async function splitAtCancellation(tx: Transaction, invoiceId: string): Promise<boolean> {
  const [found] = await tx
    .select({ id: recognitionMovements.id })
    .from(recognitionMovements)
    .innerJoin(
      recognitionSchedules,
      and(
        eq(recognitionSchedules.companyId, recognitionMovements.companyId),
        eq(recognitionSchedules.id, recognitionMovements.scheduleId),
      ),
    )
    .where(
      and(
        eq(recognitionSchedules.invoiceDocumentId, invoiceId),
        inArray(recognitionMovements.kind, ['remainder_released', 'remainder_refunded']),
      ),
    )
    .limit(1);
  return found !== undefined;
}

/**
 * The movements a plan's entries make on standing schedules (S06 rules 11, 13–15), after they
 * posted, each describing its entry by the plan's key.
 */
export async function writeMovements(
  tx: Transaction,
  companyId: string,
  movements: readonly PlannedMovement[],
  posted: ReadonlyMap<string, string>,
): Promise<void> {
  for (const movement of movements) {
    const entryId = posted.get(movement.key);
    if (entryId === undefined) throw new Error(`The plan's entry ${movement.key} did not post`);
    await tx.insert(recognitionMovements).values({
      companyId,
      scheduleId: movement.scheduleId,
      kind: movement.kind,
      month: null,
      entryId,
      transactionMinor: movement.amounts.transaction.amountMinor,
      bookMinor: movement.amounts.bookMinor,
      parallelMinor: movement.amounts.parallelMinor,
      creditMinor: movement.creditMinor ?? null,
    });
  }
}

/** What stops a month's release of an invoice, for `/revenue` and the checklist (S06 "Jobs"). */
export interface ReleaseRefusal {
  readonly invoiceNumber: string;
  readonly code: DomainError['code'] | 'NO_MAPPING';
  readonly detail: string | null;
}

/** The mapped `released_revenue` account, or what holds it (S06 "Jobs": the reason shown). */
export async function releasedRevenueAccount(
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
export function issueOf(row: EventRow): EventOf<'invoice.issued'> {
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

/**
 * What an invoice's schedules come from (S06; S10 rule 13): its `invoice.issued` event, or, for the
 * schedules an opening opened, its invoice in the snapshot the opening posted with, read as that
 * event's payload. `key` names the invoice's releases (`release:<key>:<YYYY-MM>`): Hub's event id,
 * or `opening:<opening id>:<invoice id>`; `hub` is the releases' Hub source, whose inbox id is the
 * entry's `source_ref` (the opening's `opening:<opening id>`).
 */
export interface ScheduleIssue {
  readonly companyId: string;
  readonly key: string;
  readonly hub: HubSource;
  readonly payload: InvoiceIssuedV1;
  /** Its schedules, as a condition on `recognition_schedules`. */
  readonly schedules: SQL;
  /** The invoice's number or Hub id, for a refusal's report. */
  readonly label: string;
}

/** An invoice's issue event as its schedules' issue. */
export function eventIssue(row: EventRow): ScheduleIssue {
  const event = issueOf(row);
  return {
    companyId: row.companyId,
    key: row.eventId,
    hub: {
      inboxId: row.id,
      clientId: row.apiClientId,
      document: {
        type: 'invoice',
        id: event.payload.invoice.id,
        number: event.payload.invoice.number,
      },
    },
    payload: event.payload,
    schedules: eq(recognitionSchedules.eventId, row.id) as SQL,
    label: row.documentNumber ?? row.documentId,
  };
}

/** The snapshot invoices of the openings of `openingIds`, by opening and invoice id. */
async function openingInvoices(
  tx: Transaction,
  openingIds: readonly string[],
): Promise<
  Map<string, { opening: typeof openings.$inferSelect; payload: InvoiceIssuedV1; clientId: string }>
> {
  const found = new Map<
    string,
    { opening: typeof openings.$inferSelect; payload: InvoiceIssuedV1; clientId: string }
  >();
  const ids = [...new Set(openingIds)];
  if (ids.length === 0) return found;
  const rows = await tx
    .select({ opening: openings, snapshot: openingSnapshots })
    .from(openings)
    .innerJoin(
      openingSnapshots,
      and(
        eq(openingSnapshots.companyId, openings.companyId),
        eq(openingSnapshots.id, openings.snapshotId),
      ),
    )
    .where(inArray(openings.id, ids));
  for (const { opening, snapshot } of rows) {
    const parsed = openingSnapshotSchema.parse(snapshot.payload);
    for (const invoice of parsed.invoices) {
      found.set(`${opening.id}:${invoice.invoice.id}`, {
        opening,
        payload: invoiceIssuedV1Schema.parse(invoice),
        clientId: snapshot.apiClientId,
      });
    }
  }
  return found;
}

/** Whether an issue is an opening's invoice (S10), not an `invoice.issued` event. */
function isOpeningIssue(issue: ScheduleIssue): boolean {
  return issue.hub.inboxId.startsWith('opening:');
}

/** The posted opening's invoice of a Hub invoice id as its schedules' issue, or null (S10). */
async function postedOpeningIssue(
  tx: Transaction,
  invoiceId: string,
): Promise<ScheduleIssue | null> {
  const [posted] = await tx
    .select({ id: openings.id })
    .from(openings)
    .where(eq(openings.state, 'posted'));
  if (!posted) return null;
  const invoice = (await openingInvoices(tx, [posted.id])).get(`${posted.id}:${invoiceId}`);
  return invoice === undefined ? null : openingIssue(posted.id, invoice);
}

/**
 * The posted opening's snapshot invoice of a Hub invoice id, read as its `invoice.issued` payload:
 * what a void of an invoice the opening carries orders behind (S06 rule 17, S10 rule 28).
 */
export async function openingInvoicePayload(
  tx: Transaction,
  invoiceId: string,
): Promise<InvoiceIssuedV1 | null> {
  return (await postedOpeningIssue(tx, invoiceId))?.payload ?? null;
}

/** The held `invoice.voided` of a Hub invoice, its inbox id, or null (S10 rule 28). */
export async function heldVoidOf(tx: Transaction, invoiceId: string): Promise<string | null> {
  const [held] = await tx
    .select({ id: inboundEvents.id })
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
        eq(inboundEvents.type, 'invoice.voided'),
        eq(inboundEvents.documentType, 'invoice'),
        eq(inboundEvents.documentId, invoiceId),
        eq(inboundEventStates.state, 'held'),
      ),
    )
    .limit(1);
  return held?.id ?? null;
}

/**
 * Once an invoice's held void leaves held (dismissed, or resolved by an entry that leaves a
 * schedule standing; S10 rule 28, owner 2026-11-12): every ended month the opening's schedules of
 * the invoice did not release is released at once, each dated on its own month's last day (a held
 * event kept the month open, S07), in the caller's transaction. A schedule the resolving entry
 * cleared releases nothing. Answers the entries posted.
 */
export async function releaseAfterHeldVoid(
  tx: Transaction,
  invoiceId: string,
  today: string,
  actor: AuditActor,
): Promise<string[]> {
  const issue = await postedOpeningIssue(tx, invoiceId);
  if (issue === null) return [];
  // In its own savepoint, as the month's job releases each invoice: a release that cannot post (its
  // slot unmapped, its account blocked) never refuses the accountant's action, and the daily
  // catch-up of missing months (`releaseMissingMonths()`) posts it once fixed.
  try {
    return await tx.transaction((savepoint) => releaseEndedMonths(savepoint, issue, today, actor));
  } catch (error) {
    if (error instanceof DomainError) return [];
    throw error;
  }
}

/**
 * The item keys a credit waits behind (S10 rule 28; owner, 2026-11-12): `invoice:<id>` of each
 * opening invoice whose schedule of a cycle the invoice credits has its void held, so the credit is
 * held `WAITING_FOR_EARLIER_EVENT` until that void leaves held, and its release retries it.
 */
export async function heldVoidCreditKeys(
  tx: Transaction,
  event: EventOf<'invoice.issued'>,
): Promise<string[]> {
  const keys = creditCycles(event);
  if (keys.length === 0) return [];
  const rows = await tx
    .selectDistinct({ invoiceId: recognitionSchedules.invoiceDocumentId })
    .from(recognitionSchedules)
    .where(
      and(
        inArray(recognitionSchedules.cycleKey, keys),
        sql`${recognitionSchedules.openingId} is not null`,
      ),
    );
  const waiting: string[] = [];
  for (const { invoiceId } of rows) {
    if ((await heldVoidOf(tx, invoiceId)) !== null) waiting.push(`invoice:${invoiceId}`);
  }
  return waiting.sort();
}

/** An opening's invoice as its schedules' issue (S10 rule 24). */
function openingIssue(
  openingId: string,
  invoice: { opening: typeof openings.$inferSelect; payload: InvoiceIssuedV1; clientId: string },
): ScheduleIssue {
  const { payload } = invoice;
  return {
    companyId: invoice.opening.companyId,
    key: `opening:${openingId}:${payload.invoice.id}`,
    hub: {
      inboxId: `opening:${openingId}`,
      clientId: invoice.clientId,
      document: { type: 'invoice', id: payload.invoice.id, number: payload.invoice.number },
    },
    payload,
    schedules: and(
      eq(recognitionSchedules.openingId, openingId),
      eq(recognitionSchedules.invoiceDocumentId, payload.invoice.id),
    ) as SQL,
    label: payload.invoice.number,
  };
}

/**
 * The issue of each schedule (an event's, or an opening's invoice), by schedule id: what its
 * months, its line and its releases read.
 */
export async function scheduleIssuesOf(
  tx: Transaction,
  schedules: readonly ScheduleRow[],
): Promise<Map<string, ScheduleIssue>> {
  const issues = new Map<string, ScheduleIssue>();
  const eventIds = [...new Set(schedules.flatMap((schedule) => schedule.eventId ?? []))];
  const events =
    eventIds.length === 0
      ? []
      : await tx.select().from(inboundEvents).where(inArray(inboundEvents.id, eventIds));
  const byEvent = new Map(events.map((row) => [row.id, eventIssue(row)]));
  const fromOpenings = await openingInvoices(
    tx,
    schedules.flatMap((schedule) => schedule.openingId ?? []),
  );
  for (const schedule of schedules) {
    const issue =
      schedule.eventId !== null
        ? byEvent.get(schedule.eventId)
        : schedule.openingId === null
          ? undefined
          : (() => {
              const invoice = fromOpenings.get(
                `${schedule.openingId}:${schedule.invoiceDocumentId}`,
              );
              return invoice === undefined
                ? undefined
                : openingIssue(schedule.openingId as string, invoice);
            })();
    if (issue === undefined) throw new Error('A schedule without its issue');
    issues.set(schedule.id, issue);
  }
  return issues;
}

/** Whether a movement releases a month: S06's `released`, or one released before the books start. */
function releasesMonth(movement: MovementRow): boolean {
  return (
    (movement.kind === 'released' || movement.kind === 'before_opening') && movement.month !== null
  );
}

/** A schedule with its movements and the release part of each of its months not elapsed. */
export interface ScheduleState {
  readonly schedule: ScheduleRow;
  readonly movements: readonly MovementRow[];
  /** Its months as the line cuts them, less those its re-issue recognised at issue (rule 9). */
  readonly months: readonly OverTimeMonth[];
  /**
   * Each month the schedule releases (`YYYY-MM`) with its part, carried: a released month's
   * posted part, and a month not released yet its planned one.
   */
  readonly parts: ReadonlyMap<string, CarriedAmounts>;
  /** What it still holds in contract liabilities, positive amounts. */
  readonly remaining: CarriedAmounts;
  /** Its line's transaction amount net of the credits it took (*N*, rule 6). */
  readonly netMinor: bigint;
  /** Each released month's release with its adjustments, positive amounts. */
  readonly released: ReadonlyMap<string, CarriedAmounts>;
  /** The service its releases take: the latest reclassification's, else its own. */
  readonly serviceValueId: string;
  readonly voided: boolean;
}

/** Each schedule's movements, in the order they were written. */
export async function movementsOf(
  tx: Transaction,
  scheduleIds: readonly string[],
): Promise<Map<string, MovementRow[]>> {
  const byId = new Map<string, MovementRow[]>(scheduleIds.map((id) => [id, []]));
  if (scheduleIds.length === 0) return byId;
  const rows = await tx
    .select()
    .from(recognitionMovements)
    .where(inArray(recognitionMovements.scheduleId, [...scheduleIds]))
    .orderBy(asc(recognitionMovements.createdAt), asc(recognitionMovements.id));
  for (const row of rows) byId.get(row.scheduleId)?.push(row);
  return byId;
}

/**
 * The months a voided schedule's void took back (rule 9): those it released or recognised as
 * elapsed, and those its own issue recognised as a re-issue, through its chain of re-issues.
 */
async function takenBackOf(tx: Transaction, scheduleId: string): Promise<Set<string>> {
  const months = new Set<string>();
  let id: string | null = scheduleId;
  while (id !== null) {
    const [row]: ScheduleRow[] = await tx
      .select()
      .from(recognitionSchedules)
      .where(eq(recognitionSchedules.id, id));
    if (!row) throw new Error('A re-issue of a schedule that is not there');
    const recognised = await tx
      .select({ month: recognitionMovements.month })
      .from(recognitionMovements)
      .where(
        and(
          eq(recognitionMovements.scheduleId, id),
          inArray(recognitionMovements.kind, ['released', 'elapsed']),
          sql`${recognitionMovements.month} is not null`,
        ),
      );
    for (const movement of recognised) {
      if (movement.month !== null) months.add(movement.month.slice(0, 7));
    }
    id = row.reissueOfScheduleId;
  }
  return months;
}

/**
 * The state of over-time schedules (S06 rules 3–9; ADR 0015), from their movements. A schedule's
 * months are its line's day split (`overTimeMonths()`), less, for a re-issue, the months its issue
 * recognised (`reissueParts()`). A schedule never credited releases each month at `releaseParts()`
 * of what it deferred at issue; once a credit or a credit's void changed what remains, its months
 * not released cut what remains now by their days (`remainingReleaseParts()`; owner, 2026-11-10).
 */
export async function overTimeStates(
  tx: Transaction,
  schedules: readonly ScheduleRow[],
  ledgers: CompanyLedgers,
): Promise<ScheduleState[]> {
  if (schedules.length === 0) return [];
  const movements = await movementsOf(
    tx,
    schedules.map((schedule) => schedule.id),
  );
  const issues = await scheduleIssuesOf(tx, schedules);
  const parallel = ledgers.parallel !== null;
  const states: ScheduleState[] = [];
  for (const schedule of schedules) {
    const own = movements.get(schedule.id) ?? [];
    const payload = issues.get(schedule.id)?.payload;
    const line = payload?.lines.find((candidate) => candidate.id === schedule.lineId);
    if (!payload || !line || schedule.serviceFrom === null || schedule.serviceTo === null) {
      throw new Error('A schedule without its line or its period');
    }
    const currency = schedule.currency as CurrencyCode;
    const amounts = (kinds: readonly MovementRow['kind'][]) =>
      sumCarried(
        own
          .filter((movement) => kinds.includes(movement.kind))
          .map((movement) => amountsOf(movement, currency)),
        currency,
        parallel,
      );
    const lineMonths = overTimeMonths(
      hubMinor(line.amount),
      schedule.serviceFrom,
      schedule.serviceTo,
      payload.issued_on,
    );
    let months = lineMonths;
    if (schedule.reissueOfScheduleId !== null) {
      const parts = reissueParts(lineMonths, await takenBackOf(tx, schedule.reissueOfScheduleId));
      if (parts.kind === 'decision') throw new Error('A re-issue posted not covering its months');
      months = parts.months;
    }
    const releasing = months.filter((month) => !month.elapsed);
    // Each released month's release with its adjustments (owner, 2026-11-11), positive amounts.
    const releasedRows = new Map<string, CarriedAmounts[]>();
    for (const movement of own) {
      // A month an opening released before the books start is released (S10 rule 13).
      if (
        (movement.kind === 'released' ||
          movement.kind === 'adjusted' ||
          movement.kind === 'before_opening') &&
        movement.month !== null
      ) {
        const month = movement.month.slice(0, 7);
        releasedRows.set(month, [
          ...(releasedRows.get(month) ?? []),
          amountsOf(movement, currency),
        ]);
      }
    }
    const released = new Map(
      [...releasedRows.entries()]
        .filter(([month]) =>
          own.some((movement) => releasesMonth(movement) && movement.month?.slice(0, 7) === month),
        )
        .map(([month, rows]) => [month, negate(sumCarried(rows, currency, parallel))] as const),
    );
    const remaining = sumCarried(
      own.map((movement) => amountsOf(movement, currency)),
      currency,
      parallel,
    );
    // The credits through the eve of an opening schedule are a credit (S10 rule 13).
    const credited = own.some(
      (movement) =>
        movement.kind === 'credited' ||
        movement.kind === 'adjusted' ||
        (movement.kind === 'released' && movement.month === null) ||
        (movement.kind === 'before_opening' &&
          movement.month === null &&
          movement.creditMinor !== null),
    );
    const voided = own.some((movement) => movement.kind === 'reversed');
    const parts = new Map<string, CarriedAmounts>();
    if (!credited) {
      // What the line deferred at issue: its deferral less its elapsed parts (ADR 0015).
      const atIssue = amounts(['deferred', 'elapsed']);
      const cut = releaseParts(atIssue, months, ledgers);
      for (const [k, month] of releasing.entries()) {
        parts.set(month.month, released.get(month.month) ?? (cut[k] as CarriedAmounts));
      }
    } else {
      const open = releasing.filter((month) => !released.has(month.month));
      const planned =
        open.length === 0 || voided ? [] : remainingReleaseParts(remaining, open, ledgers);
      for (const month of releasing) {
        const posted = released.get(month.month);
        if (posted !== undefined) parts.set(month.month, posted);
      }
      for (const [k, month] of open.entries()) {
        const part = planned[k];
        if (part !== undefined) parts.set(month.month, part);
      }
    }
    states.push({
      schedule,
      movements: own,
      months,
      parts,
      remaining,
      released,
      netMinor: netOfCredits(
        hubMinor(line.amount),
        own.map((movement) => movement.creditMinor),
      ),
      serviceValueId: currentService(schedule, own),
      voided,
    });
  }
  return states;
}

/** The over-time schedules of an invoice's issue, in the order they were made. */
async function scheduleStates(
  tx: Transaction,
  issue: ScheduleIssue,
  ledgers: CompanyLedgers,
): Promise<ScheduleState[]> {
  const schedules = await tx
    .select()
    .from(recognitionSchedules)
    .where(and(issue.schedules, eq(recognitionSchedules.pattern, 'over_time')))
    .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id));
  return overTimeStates(tx, schedules, ledgers);
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
  issue: ScheduleIssue,
  month: string,
  today: string,
  actor: AuditActor,
  closedPeriods: readonly string[] = [],
): Promise<string | null> {
  const lastDay = lastDayOfMonth(`${month}-01`);
  if (lastDay >= today) return null;
  await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
  // An opening invoice's schedules release nothing while its void is held (S10 rule 28).
  if (isOpeningIssue(issue) && (await heldVoidOf(tx, issue.payload.invoice.id)) !== null) {
    return null;
  }
  const entryDate = closedPeriods.includes(month)
    ? firstOpenDayAfter(lastDay, closedPeriods)
    : lastDay;
  const ledgers = await companyLedgers(tx);
  const states = (await scheduleStates(tx, issue, ledgers)).filter(
    (state) =>
      !state.voided &&
      state.parts.has(month) &&
      !state.movements.some(
        (movement) => releasesMonth(movement) && movement.month === `${month}-01`,
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
  const { hub, payload } = issue;
  const entry = await post(tx, {
    client: 'system',
    idempotencyKey: `release:${issue.key}:${month}`,
    entryDate,
    description: `تحرير إيراد ${payload.invoice.number} عن ${month}`,
    reference: payload.invoice.number,
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
  issue: ScheduleIssue,
  today: string,
  actor: AuditActor,
): Promise<string[]> {
  const closed = await closedPeriodList(tx);
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
  // Each invoice's schedules, an event's or an opening's (S10 rule 24), in the order they were made.
  const groups = await tx
    .select({
      eventId: recognitionSchedules.eventId,
      openingId: recognitionSchedules.openingId,
      invoiceId: recognitionSchedules.invoiceDocumentId,
    })
    .from(recognitionSchedules)
    .where(
      and(
        eq(recognitionSchedules.pattern, 'over_time'),
        sql`${recognitionSchedules.serviceFrom} <= ${last}`,
        sql`${recognitionSchedules.serviceTo} >= ${first}`,
      ),
    )
    .groupBy(
      recognitionSchedules.eventId,
      recognitionSchedules.openingId,
      recognitionSchedules.invoiceDocumentId,
    )
    .orderBy(
      sql`min(${recognitionSchedules.createdAt})`,
      sql`min(${recognitionSchedules.id}::text)`,
    );
  const eventIds = groups.flatMap((group) => group.eventId ?? []);
  const events =
    eventIds.length === 0
      ? []
      : await tx.select().from(inboundEvents).where(inArray(inboundEvents.id, eventIds));
  const fromOpenings = await openingInvoices(
    tx,
    groups.flatMap((group) => group.openingId ?? []),
  );
  const issues = groups.map((group) => {
    if (group.eventId !== null) {
      const row = events.find((event) => event.id === group.eventId);
      if (row === undefined) throw new Error('A schedule without its event');
      return eventIssue(row);
    }
    const invoice = fromOpenings.get(`${group.openingId}:${group.invoiceId}`);
    if (invoice === undefined || group.openingId === null) {
      throw new Error('A schedule without its opening invoice');
    }
    return openingIssue(group.openingId, invoice);
  });
  let posted = 0;
  const refused: ReleaseRefusal[] = [];
  for (const issue of issues) {
    try {
      const entry = await tx.transaction((savepoint) =>
        releaseInvoiceMonth(savepoint, issue, month, today, actor),
      );
      if (entry !== null) posted += 1;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      refused.push({
        invoiceNumber: issue.label,
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
  // The line's schedule; after a whole reversal of the opening and a new one, the new opening's
  // (S10 rules 25, 29): a reversed opening's schedule no longer stands.
  const [schedule] = await tx
    .select()
    .from(recognitionSchedules)
    .where(
      and(
        eq(recognitionSchedules.invoiceDocumentId, input.invoiceId),
        eq(recognitionSchedules.lineId, input.lineId),
        sql`not exists (select 1 from ${openings} o where o.company_id = ${recognitionSchedules.companyId} and o.id = ${recognitionSchedules.openingId} and o.state = 'reversed')`,
      ),
    )
    .orderBy(asc(recognitionSchedules.id));
  if (!schedule) throw new Error('A scheduled line without its schedule');
  const issue = (await scheduleIssuesOf(tx, [schedule])).get(schedule.id);
  if (!issue) throw new Error('A schedule without its issue');
  const ledgers = await companyLedgers(tx);
  // A point-in-time schedule recognises by its done or its project's end, not by months: what its
  // movements released is what moves (rule 10).
  const own =
    schedule.pattern === 'point_in_time'
      ? await tx
          .select()
          .from(recognitionMovements)
          .where(eq(recognitionMovements.scheduleId, schedule.id))
          .orderBy(asc(recognitionMovements.createdAt), asc(recognitionMovements.id))
      : null;
  const state =
    own === null
      ? (await scheduleStates(tx, issue, ledgers)).find(
          (candidate) => candidate.schedule.id === schedule.id,
        )
      : {
          schedule,
          movements: own,
          serviceValueId: currentService(schedule, own),
        };
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
    (movement) =>
      movement.kind === 'released' ||
      movement.kind === 'elapsed' ||
      movement.kind === 'remainder_released',
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
      // A point-in-time release has no month: its movement names its entry (a done, a reopen).
      key: `${input.key}:${movement.month?.slice(0, 7) ?? movement.id}`,
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

/**
 * A schedule as of a date (S06 rules 6, 8; owner, 2026-11-11): what it held then, its movements but
 * the releases and adjustments of months that ended on or after the date, which a change of that
 * date would have cut; its months not released as of then, in order; and the releases posted since
 * for those months.
 */
function asOf(
  state: ScheduleState,
  date: string,
  parallel: boolean,
): {
  readonly remaining: CarriedAmounts;
  readonly open: OverTimeMonth[];
  readonly posted: Map<string, CarriedAmounts>;
} {
  const currency = state.schedule.currency as CurrencyCode;
  const ended = (month: string) => lastDayOfMonth(`${month}-01`) < date;
  const kept = state.movements.filter(
    (movement) =>
      !(
        (movement.kind === 'released' || movement.kind === 'adjusted') &&
        movement.month !== null &&
        !ended(movement.month.slice(0, 7))
      ),
  );
  const open = state.months.filter((month) => !month.elapsed && !ended(month.month));
  return {
    remaining: sumCarried(
      kept.map((movement) => amountsOf(movement, currency)),
      currency,
      parallel,
    ),
    open,
    posted: new Map(
      open.flatMap((month) => {
        const posted = state.released.get(month.month);
        return posted === undefined ? [] : [[month.month, posted] as const];
      }),
    ),
  };
}

/**
 * The recut of schedules a credit or a credit's void changed, as of its date (S06 rules 6, 8;
 * `revenue/retainer-credit.md`, owner 2026-11-11), after its own movements are written: each month
 * released since that date is cut again from what the schedule held then (`recutReleases()`), and
 * the difference posts as an adjustment at the carried amounts on the month's last day, or on the
 * first day of the first open period when the month is closed: Dr `released_revenue` with the
 * schedule's service / Cr its liability for what the release took too much, the other way for what
 * it took too little; under `<event id>:recut:<schedule id>:<YYYY-MM>`, each with its `adjusted`
 * movement. Answers the entries.
 */
export async function recutSince(
  tx: Transaction,
  row: EventRow,
  input: {
    readonly scheduleIds: readonly string[];
    readonly asOf: string;
    readonly description: string;
    readonly today: string;
    readonly actor: AuditActor;
    readonly hub: HubSource;
  },
): Promise<string[]> {
  const ids = [...new Set(input.scheduleIds)];
  if (ids.length === 0) return [];
  const ledgers = await companyLedgers(tx);
  const parallel = ledgers.parallel !== null;
  const schedules = await tx
    .select()
    .from(recognitionSchedules)
    .where(
      and(inArray(recognitionSchedules.id, ids), eq(recognitionSchedules.pattern, 'over_time')),
    )
    .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id));
  const closed = await closedPeriodList(tx);
  const posted: string[] = [];
  for (const state of await overTimeStates(tx, schedules, ledgers)) {
    if (state.voided) continue;
    const at = asOf(state, input.asOf, parallel);
    const recut = recutReleases(at.remaining, at.open, at.posted, ledgers);
    if (recut.length === 0) continue;
    const revenue = await releasedRevenueAccount(tx);
    if ('refusal' in revenue) {
      throw new DomainError('MAPPING_ACCOUNT_INVALID', 'The released revenue slot is not usable', {
        detail: revenue.refusal,
      });
    }
    const parties = partiesOf(state.schedule);
    for (const { month, adjustment } of recut) {
      const lastDay = lastDayOfMonth(`${month}-01`);
      const entry = await post(tx, {
        client: input.hub.clientId,
        idempotencyKey: `${row.eventId}:recut:${state.schedule.id}:${month}`,
        entryDate: closed.includes(month) ? firstOpenDayAfter(lastDay, closed) : lastDay,
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
              amounts: adjustment,
            },
            {
              accountId: state.schedule.liabilityAccountId,
              dimensionValueIds: parties,
              amounts: negate(adjustment),
            },
          ],
          today: input.today,
          hub: input.hub,
        },
      });
      posted.push(entry.id);
      if (entry.replayed) continue;
      await tx.insert(recognitionMovements).values({
        companyId: row.companyId,
        scheduleId: state.schedule.id,
        kind: 'adjusted',
        month: `${month}-01`,
        entryId: entry.id,
        transactionMinor: adjustment.transaction.amountMinor,
        bookMinor: adjustment.bookMinor,
        parallelMinor: adjustment.parallelMinor,
      });
    }
  }
  return posted;
}

/**
 * Whether a change of the schedules dated after `date` stands (owner, 2026-11-11): a credit
 * (`credited`) or a credit's void releasing on its date (`released` with no month), dated by its
 * event's own accounting date, so a change moved to a later open period keeps its date; a credit
 * its void reversed no longer stands, so Hub can void the later change and send it again after
 * (`retainer-credit.md`); the entries of one invoice, a void's own credit, are left out.
 */
async function changedAfter(
  tx: Transaction,
  scheduleIds: readonly string[],
  date: string,
  exceptInvoiceId: string | null = null,
): Promise<boolean> {
  if (scheduleIds.length === 0) return false;
  const [found] = await tx
    .select({ id: recognitionMovements.id })
    .from(recognitionMovements)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.companyId, recognitionMovements.companyId),
        eq(journalEntries.id, recognitionMovements.entryId),
      ),
    )
    .innerJoin(
      inboundEvents,
      and(
        eq(inboundEvents.companyId, journalEntries.companyId),
        sql`${inboundEvents.id}::text = ${journalEntries.sourceRef}`,
      ),
    )
    .where(
      and(
        inArray(recognitionMovements.scheduleId, [...scheduleIds]),
        sql`(${recognitionMovements.kind} = 'credited' or (${recognitionMovements.kind} = 'released' and ${recognitionMovements.month} is null))`,
        isNull(journalEntries.reversesEntryId),
        sql`not exists (select 1 from ${journalEntries} r where r.company_id = ${journalEntries.companyId} and r.reverses_entry_id = ${journalEntries.id})`,
        sql`${inboundEvents.accountingDate} > ${date}`,
        exceptInvoiceId === null
          ? undefined
          : sql`coalesce(${journalEntries.hubDocument} ->> 'id', '') <> ${exceptInvoiceId}`,
      ),
    )
    .limit(1);
  return found !== undefined;
}

/**
 * For a void of a credit invoice (`HubReferences.creditChangedLater`; owner, 2026-11-11): whether a
 * schedule the invoice credited has a change dated after the void's date already posted.
 */
export async function creditChangedLaterOf(
  tx: Transaction,
  invoiceId: string,
  voidDate: string,
): Promise<boolean> {
  const credited = await tx
    .select({ scheduleId: recognitionMovements.scheduleId })
    .from(recognitionMovements)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.companyId, recognitionMovements.companyId),
        eq(journalEntries.id, recognitionMovements.entryId),
      ),
    )
    .where(
      and(
        eq(recognitionMovements.kind, 'credited'),
        sql`${journalEntries.hubDocument} ->> 'type' = 'invoice'`,
        sql`${journalEntries.hubDocument} ->> 'id' = ${invoiceId}`,
      ),
    );
  return changedAfter(
    tx,
    credited.map((row) => row.scheduleId),
    voidDate,
    invoiceId,
  );
}

/** A schedule's client and, when named, contract values. */
const partiesOf = (schedule: ScheduleRow) =>
  schedule.contractValueId === null
    ? [schedule.clientValueId]
    : [schedule.clientValueId, schedule.contractValueId];

/** The `cycle_key` of each credit line of an invoice (S06 rule 6). */
function creditCycles(event: EventOf<'invoice.issued'>): string[] {
  const { contract, lines } = event.payload;
  if (contract?.kind !== 'retainer') return [];
  return [
    ...new Set(
      lines.flatMap((line) =>
        line.source === 'retainer_charge' &&
        line.charge_kind === 'credit' &&
        line.cycle_start !== undefined
          ? [`${contract.external_id}:${line.cycle_start}`]
          : [],
      ),
    ),
  ];
}

/** The over-time schedules of retainer cycles, in the order they were made. */
async function cycleSchedules(tx: Transaction, cycleKeys: readonly string[]) {
  if (cycleKeys.length === 0) return [];
  return tx
    .select()
    .from(recognitionSchedules)
    .where(
      and(
        eq(recognitionSchedules.pattern, 'over_time'),
        inArray(recognitionSchedules.cycleKey, [...cycleKeys]),
      ),
    )
    .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id));
}

/**
 * What the books hold for the cycles an invoice's credit lines name (`HubReferences.cycles`; S06
 * rule 6): each cycle's standing `monthly` and `addition` schedules, in the order they were made,
 * with their amount net of earlier credits and what they still hold, and whether they are all
 * voided.
 */
export async function cyclesOf(
  tx: Transaction,
  event: EventOf<'invoice.issued'>,
): Promise<Map<string, CycleReferences>> {
  const keys = creditCycles(event);
  const cycles = new Map<string, CycleReferences>();
  if (keys.length === 0) return cycles;
  const ledgers = await companyLedgers(tx);
  const states = await overTimeStates(tx, await cycleSchedules(tx, keys), ledgers);
  for (const key of keys) {
    const ofCycle = states.filter((state) => state.schedule.cycleKey === key);
    const standing = ofCycle.filter((state) => !state.voided);
    cycles.set(key, {
      standing: standing.map(
        (state): CreditableSchedule => ({
          id: state.schedule.id,
          liabilityAccountId: state.schedule.liabilityAccountId,
          parties: partiesOf(state.schedule),
          serviceValueId: state.serviceValueId,
          netMinor: state.netMinor,
          // As of the credit's date: a month released since counts as not recognised yet.
          remaining: asOf(state, event.accounting_date, ledgers.parallel !== null).remaining,
        }),
      ),
      voided: ofCycle.length > 0 && standing.length === 0,
      changedLater: await changedAfter(
        tx,
        standing.map((state) => state.schedule.id),
        event.accounting_date,
      ),
    });
  }
  return cycles;
}

/**
 * The voided over-time schedules an invoice's retainer lines can re-issue (`HubReferences.reissues`;
 * S06 rule 9): by cycle and charge kind, those no schedule re-issued yet, in the order they were
 * made, with the months each void took back.
 */
export async function reissuesOf(
  tx: Transaction,
  event: EventOf<'invoice.issued'>,
): Promise<Map<string, VoidedOverTime[]>> {
  const { contract, lines } = event.payload;
  const reissues = new Map<string, VoidedOverTime[]>();
  if (contract === undefined) return reissues;
  const wanted = new Map<string, { cycleKey: string; chargeKind: 'monthly' | 'addition' }>();
  for (const line of lines) {
    if (
      line.source !== 'retainer_charge' ||
      line.cycle_start === undefined ||
      (line.charge_kind !== 'monthly' && line.charge_kind !== 'addition')
    ) {
      continue;
    }
    const cycleKey = `${contract.external_id}:${line.cycle_start}`;
    wanted.set(reissueKey(cycleKey, line.charge_kind), { cycleKey, chargeKind: line.charge_kind });
  }
  if (wanted.size === 0) return reissues;
  const schedules = await cycleSchedules(
    tx,
    [...wanted.values()].map((value) => value.cycleKey),
  );
  const reissued = new Set(schedules.flatMap((schedule) => schedule.reissueOfScheduleId ?? []));
  const movements = await movementsOf(
    tx,
    schedules.map((schedule) => schedule.id),
  );
  for (const [key, { cycleKey, chargeKind }] of wanted) {
    const voided: VoidedOverTime[] = [];
    for (const schedule of schedules) {
      if (schedule.cycleKey !== cycleKey || schedule.chargeKind !== chargeKind) continue;
      if (reissued.has(schedule.id)) continue;
      if (!(movements.get(schedule.id) ?? []).some((movement) => movement.kind === 'reversed')) {
        continue;
      }
      voided.push({
        scheduleId: schedule.id,
        takenBack: [...(await takenBackOf(tx, schedule.id))].sort(),
      });
    }
    if (voided.length > 0) reissues.set(key, voided);
  }
  return reissues;
}

/** The entry of an event's posting request (its main entry), when it posted. */
async function mainEntryOf(tx: Transaction, row: EventRow): Promise<string | null> {
  const [entry] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .innerJoin(
      postingRequests,
      and(
        eq(postingRequests.companyId, journalEntries.companyId),
        eq(postingRequests.id, journalEntries.requestId),
      ),
    )
    .where(
      and(
        eq(postingRequests.client, row.apiClientId),
        eq(postingRequests.idempotencyKey, row.eventId),
      ),
    );
  return entry?.id ?? null;
}

/** The entry that reverses an entry, with the inbox event that posted it; null when none. */
async function reversalOf(
  tx: Transaction,
  entryId: string,
): Promise<{ readonly entryId: string; readonly event: EventRow | null } | null> {
  const [reversal] = await tx
    .select({ id: journalEntries.id, sourceRef: journalEntries.sourceRef })
    .from(journalEntries)
    .where(eq(journalEntries.reversesEntryId, entryId));
  if (!reversal) return null;
  const [event] =
    reversal.sourceRef === null
      ? []
      : await tx
          .select()
          .from(inboundEvents)
          .where(sql`${inboundEvents.id}::text = ${reversal.sourceRef}`);
  return { entryId: reversal.id, event: event ?? null };
}

/**
 * A milestone's history as its re-issue, its done and its reopen read it (S06 rules 9, 11, 13):
 * whether its latest done's release was reversed by a void with no reopen since; whether a void
 * took back its schedule's release at the project's completion, with no done or reopen since;
 * whether a re-issue's revenue at issue stands (a standing schedule of its that deferred nothing);
 * and its latest voided schedule no line re-issued yet.
 */
async function milestoneHistoryOf(
  tx: Transaction,
  milestoneId: string,
): Promise<
  Pick<
    MilestoneReferences,
    'doneTakenBackByVoid' | 'completionTakenBackByVoid' | 'recognisedAtIssue' | 'voidedScheduleId'
  >
> {
  const events = await tx
    .select({ event: inboundEvents })
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
        eq(inboundEvents.documentType, 'milestone'),
        eq(inboundEvents.documentId, milestoneId),
        inArray(inboundEvents.type, ['milestone.done', 'milestone.reopened']),
        inArray(inboundEventStates.state, ['posted', 'recorded']),
      ),
    )
    .orderBy(asc(inboundEvents.receivedAt), asc(inboundEvents.id));
  const latest = events.at(-1)?.event;
  let doneTakenBackByVoid = false;
  if (latest?.type === 'milestone.done') {
    const entry = await mainEntryOf(tx, latest);
    const reversal = entry === null ? null : await reversalOf(tx, entry);
    doneTakenBackByVoid = reversal?.event?.type === 'invoice.voided';
  }
  const all = await tx
    .select()
    .from(recognitionSchedules)
    .where(
      and(
        eq(recognitionSchedules.pattern, 'point_in_time'),
        eq(recognitionSchedules.milestoneId, milestoneId),
      ),
    )
    .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id));
  const allMovements = await movementsOf(
    tx,
    all.map((schedule) => schedule.id),
  );
  // The completion's releases a void took back, after which no done or reopen came.
  let completionTakenBackByVoid = false;
  for (const schedule of all) {
    for (const movement of allMovements.get(schedule.id) ?? []) {
      if (movement.kind !== 'released' || movement.entryId === null) continue;
      const [entry] = await tx
        .select({ sourceRef: journalEntries.sourceRef })
        .from(journalEntries)
        .where(eq(journalEntries.id, movement.entryId));
      const [poster] =
        entry?.sourceRef == null
          ? []
          : await tx
              .select({ type: inboundEvents.type })
              .from(inboundEvents)
              .where(sql`${inboundEvents.id}::text = ${entry.sourceRef}`);
      if (poster?.type !== 'project.completed') continue;
      const reversal = await reversalOf(tx, movement.entryId);
      const voidEvent = reversal?.event;
      if (voidEvent?.type !== 'invoice.voided') continue;
      const after = events.some(
        ({ event }) =>
          event.receivedAt > voidEvent.receivedAt ||
          (event.receivedAt.getTime() === voidEvent.receivedAt.getTime() &&
            event.id > voidEvent.id),
      );
      if (!after) completionTakenBackByVoid = true;
    }
  }
  const voidedOf = (schedule: ScheduleRow) =>
    (allMovements.get(schedule.id) ?? []).some((movement) => movement.kind === 'reversed');
  const recognisedAtIssue = all.some((schedule) => {
    if (schedule.reissueOfScheduleId === null || voidedOf(schedule)) return false;
    const deferred = (allMovements.get(schedule.id) ?? []).find(
      (movement) => movement.kind === 'deferred',
    );
    return deferred !== undefined && deferred.transactionMinor === 0n;
  });
  const reissued = new Set(all.flatMap((schedule) => schedule.reissueOfScheduleId ?? []));
  const voided = all.filter((schedule) => !reissued.has(schedule.id) && voidedOf(schedule));
  return {
    doneTakenBackByVoid,
    completionTakenBackByVoid,
    recognisedAtIssue,
    voidedScheduleId: voided.at(-1)?.id ?? null,
  };
}

/** The entries of an invoice's schedules' movements, and the credits standing on them. */
async function invoiceMovementEntries(tx: Transaction, invoiceId: string) {
  const schedules = await tx
    .select({ id: recognitionSchedules.id })
    .from(recognitionSchedules)
    .where(eq(recognitionSchedules.invoiceDocumentId, invoiceId));
  const movements = await movementsOf(
    tx,
    schedules.map((schedule) => schedule.id),
  );
  return [...movements.values()].flat();
}

/** Whether an entry stands: neither reversed nor itself a reversal. */
async function standingEntryIds(
  tx: Transaction,
  entryIds: readonly string[],
): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        inArray(journalEntries.id, [...entryIds]),
        isNull(journalEntries.reversesEntryId),
        sql`not exists (select 1 from ${journalEntries} r where r.company_id = ${journalEntries.companyId} and r.reverses_entry_id = ${journalEntries.id})`,
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/**
 * What a void of an invoice reads of its recognition (S06 rule 8): `standing`, the invoice's
 * standing entries and those of its schedules' movements (a done's or a completion's release, a
 * credit's void releasing on them), latest first, never another invoice's credit; and whether a
 * credit of another invoice still stands on one of its schedules (`schedule_credited`).
 */
export async function voidStandingOf(
  tx: Transaction,
  invoiceId: string,
  documentStanding: readonly string[],
): Promise<{ readonly standing: string[]; readonly scheduleCredited: boolean }> {
  const movements = await invoiceMovementEntries(tx, invoiceId);
  if (movements.length === 0) return { standing: [...documentStanding], scheduleCredited: false };
  const own = new Set(documentStanding);
  const credits = movements.filter(
    (movement) =>
      movement.kind === 'credited' &&
      movement.entryId !== null &&
      !own.has(movement.entryId) &&
      (movement.creditMinor ?? 0n) > 0n,
  );
  const candidates = [
    ...new Set(
      movements.flatMap((movement) =>
        movement.entryId === null || movement.kind === 'credited' ? [] : [movement.entryId],
      ),
    ),
  ];
  const standingIds = await standingEntryIds(tx, [
    ...candidates,
    ...credits.flatMap((movement) => movement.entryId ?? []),
  ]);
  const ids = [
    ...new Set([...documentStanding, ...candidates.filter((id) => standingIds.has(id))]),
  ];
  const ordered =
    ids.length === 0
      ? []
      : await tx
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(inArray(journalEntries.id, ids))
          .orderBy(desc(journalEntries.sequence));
  return {
    standing: ordered.map((row) => row.id),
    scheduleCredited: credits.some(
      (movement) => movement.entryId !== null && standingIds.has(movement.entryId),
    ),
  };
}

/**
 * The months of schedules that ended before `before` and are not released yet, released in their
 * own savepoints as the month's job would (S06 rules 5, 6, 8): a credit and a void first post
 * them, so what they split never depends on when the job ran. A release that cannot post (its
 * period closed, its slot unmapped) is left for the job and the checklist.
 */
async function releaseEndedBefore(
  tx: Transaction,
  scheduleIds: readonly string[],
  before: string,
  today: string,
  actor: AuditActor,
): Promise<void> {
  if (scheduleIds.length === 0) return;
  const schedules = await tx
    .select()
    .from(recognitionSchedules)
    .where(inArray(recognitionSchedules.id, [...new Set(scheduleIds)]))
    .orderBy(asc(recognitionSchedules.createdAt), asc(recognitionSchedules.id));
  const byKey = new Map<string, ScheduleIssue>();
  for (const issue of (await scheduleIssuesOf(tx, schedules)).values()) {
    if (!byKey.has(issue.key)) byKey.set(issue.key, issue);
  }
  const ledgers = await companyLedgers(tx);
  for (const issue of byKey.values()) {
    const months = new Set<string>();
    for (const state of await scheduleStates(tx, issue, ledgers)) {
      if (state.voided) continue;
      for (const month of state.parts.keys()) {
        const lastDay = lastDayOfMonth(`${month}-01`);
        if (lastDay < before && lastDay < today) months.add(month);
      }
    }
    for (const month of [...months].sort()) {
      try {
        await tx.transaction((savepoint) =>
          releaseInvoiceMonth(savepoint, issue, month, today, actor),
        );
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
      }
    }
  }
}

/**
 * Before a credit or a void (S06 rules 6, 8): the releases of the months ended before its date of
 * the schedules it changes: a credit's cycles, a void's own schedules and those its credits
 * reduced.
 */
export async function releaseBeforeChange(
  tx: Transaction,
  event: EventOf<'invoice.issued'> | EventOf<'invoice.voided'>,
  today: string,
  actor: AuditActor,
): Promise<void> {
  if (event.type === 'invoice.issued') {
    const schedules = await cycleSchedules(tx, creditCycles(event));
    await releaseEndedBefore(
      tx,
      schedules.map((schedule) => schedule.id),
      event.accounting_date,
      today,
      actor,
    );
    return;
  }
  const invoiceId = event.payload.invoice.id;
  const own = await tx
    .select({ id: recognitionSchedules.id })
    .from(recognitionSchedules)
    .where(eq(recognitionSchedules.invoiceDocumentId, invoiceId));
  // The schedules of other invoices this invoice's entries credited.
  const credited = await tx
    .select({ id: recognitionSchedules.id })
    .from(recognitionMovements)
    .innerJoin(
      recognitionSchedules,
      and(
        eq(recognitionSchedules.companyId, recognitionMovements.companyId),
        eq(recognitionSchedules.id, recognitionMovements.scheduleId),
      ),
    )
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.companyId, recognitionMovements.companyId),
        eq(journalEntries.id, recognitionMovements.entryId),
      ),
    )
    .where(
      and(
        eq(recognitionMovements.kind, 'credited'),
        sql`${journalEntries.hubDocument} ->> 'type' = 'invoice'`,
        sql`${journalEntries.hubDocument} ->> 'id' = ${invoiceId}`,
      ),
    );
  await releaseEndedBefore(
    tx,
    [...own, ...credited].map((row) => row.id),
    event.accounting_date,
    today,
    actor,
  );
}

/**
 * The movements of a void's reversals (S06 rule 8), after they posted: each reversed entry's
 * movements negated on the reversal, a schedule of the invoice `reversed`, and a `credited` one of
 * another invoice's schedule given back (its credit part negated). Then each schedule a reversed
 * credit gave its liability part back releases, on the void's date and at its carried amounts,
 * the share of the months released since the credit, by their days, out of the days not released
 * when the credit posted (`voidedCreditParts()`; owner, 2026-11-10), each its own entry under
 * `<event id>:credit:<schedule id>`, so a later void of that schedule's invoice reverses it alone;
 * the rest joins what the later months release. Answers the entries it posted.
 */
export async function voidMovements(
  tx: Transaction,
  row: EventRow,
  input: {
    /** Each planned reversal: the entry it reversed and the reversal's entry. */
    readonly reversals: readonly { readonly reversed: string; readonly reversal: string }[];
    readonly entryDate: string;
    /** The void's own date, which it is measured as of, even when moved (S05 rule 15). */
    readonly asOf: string;
    readonly description: string;
    readonly today: string;
    readonly actor: AuditActor;
    readonly hub: HubSource;
  },
): Promise<string[]> {
  const ledgers = await companyLedgers(tx);
  const givenBack: { readonly scheduleId: string; readonly credit: MovementRow }[] = [];
  for (const { reversed, reversal } of input.reversals) {
    const movements = await tx
      .select()
      .from(recognitionMovements)
      .where(eq(recognitionMovements.entryId, reversed))
      .orderBy(asc(recognitionMovements.createdAt), asc(recognitionMovements.id));
    for (const movement of movements) {
      if (movement.kind === 'reclassified') continue;
      const credit = movement.kind === 'credited';
      const [schedule] = await tx
        .select({ currency: recognitionSchedules.currency })
        .from(recognitionSchedules)
        .where(eq(recognitionSchedules.id, movement.scheduleId));
      if (!schedule) throw new Error('A movement without its schedule');
      const back = reversedMovement(
        amountsOf(movement, schedule.currency as CurrencyCode),
        credit ? movement.creditMinor : null,
      );
      await tx.insert(recognitionMovements).values({
        companyId: row.companyId,
        scheduleId: movement.scheduleId,
        kind: credit ? 'credited' : 'reversed',
        month: null,
        entryId: reversal,
        transactionMinor: back.amounts.transaction.amountMinor,
        bookMinor: back.amounts.bookMinor,
        parallelMinor: back.amounts.parallelMinor,
        creditMinor: back.creditMinor,
      });
      if (credit && movement.transactionMinor < 0n) {
        givenBack.push({ scheduleId: movement.scheduleId, credit: movement });
      }
    }
  }
  const posted: string[] = [];
  if (givenBack.length === 0) return posted;
  const revenue = await releasedRevenueAccount(tx);
  if ('refusal' in revenue) {
    throw new DomainError('MAPPING_ACCOUNT_INVALID', 'The released revenue slot is not usable', {
      detail: revenue.refusal,
    });
  }
  for (const { scheduleId, credit } of givenBack) {
    const [schedule] = await tx
      .select()
      .from(recognitionSchedules)
      .where(eq(recognitionSchedules.id, scheduleId));
    if (!schedule) throw new Error('A movement without its schedule');
    const [state] = await overTimeStates(tx, [schedule], ledgers);
    if (!state) throw new Error('A schedule without its state');
    // As of the void's date (owner, 2026-11-11): the days not released when the credit posted, and
    // the released months that ended between the credit and the void.
    if (credit.entryId === null) throw new Error('A credit without its entry');
    const [creditEntry] = await tx
      .select({ date: journalEntries.entryDate })
      .from(journalEntries)
      .where(eq(journalEntries.id, credit.entryId));
    if (!creditEntry) throw new Error('A credit without its entry');
    const lastDayOf = (month: string) => lastDayOfMonth(`${month}-01`);
    const releasedBefore = new Set(
      [...state.released.keys()].filter((month) => lastDayOf(month) < creditEntry.date),
    );
    const releasedSince = new Set(
      [...state.released.keys()].filter(
        (month) => lastDayOf(month) >= creditEntry.date && lastDayOf(month) < input.asOf,
      ),
    );
    const releasing = state.months.filter((month) => !month.elapsed);
    const daysAtCredit = releasing
      .filter((month) => !releasedBefore.has(month.month))
      .reduce((total, month) => total + month.days, 0n);
    const releasedDays = releasing
      .filter((month) => releasedSince.has(month.month))
      .reduce((total, month) => total + month.days, 0n);
    const currency = schedule.currency as CurrencyCode;
    const split = voidedCreditParts(
      negate(amountsOf(credit, currency)),
      releasedDays,
      daysAtCredit,
    );
    if (split.released === null) continue;
    const parties = partiesOf(schedule);
    const entry = await post(tx, {
      client: input.hub.clientId,
      idempotencyKey: `${row.eventId}:credit:${scheduleId}`,
      entryDate: input.entryDate,
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
            accountId: schedule.liabilityAccountId,
            dimensionValueIds: parties,
            amounts: split.released,
          },
          {
            accountId: revenue.id,
            dimensionValueIds: [...parties, state.serviceValueId],
            amounts: negate(split.released),
          },
        ],
        today: input.today,
        hub: input.hub,
      },
    });
    posted.push(entry.id);
    if (entry.replayed) continue;
    const released = negate(split.released);
    await tx.insert(recognitionMovements).values({
      companyId: row.companyId,
      scheduleId,
      kind: 'released',
      month: null,
      entryId: entry.id,
      transactionMinor: released.transaction.amountMinor,
      bookMinor: released.bookMinor,
      parallelMinor: released.parallelMinor,
    });
  }
  // The months released since the void's date, recut as of it (owner, 2026-11-11).
  posted.push(
    ...(await recutSince(tx, row, {
      scheduleIds: givenBack.map((item) => item.scheduleId),
      asOf: input.asOf,
      description: input.description,
      today: input.today,
      actor: input.actor,
      hub: input.hub,
    })),
  );
  return posted;
}

/**
 * What the integrity check's recognition proof reads (S06 "Data"; `recognitionProblems()`): every
 * movement with its schedule's contract and currency, and the contract liability lines of the
 * entries those movements describe, on the schedules' liability accounts, with each line's
 * contract value. Amounts as `bigint`.
 */
export async function readRecognitionState(tx: Transaction): Promise<{
  movements: RecognitionAmount[];
  liabilityLines: RecognitionAmount[];
}> {
  const parse = (value: unknown) => (value === null ? null : BigInt(value as string));
  const { rows: movements } = await tx.execute<Record<string, unknown>>(sql`
    select s.contract_value_id, s.currency, m.transaction_minor, m.book_minor, m.parallel_minor
    from ${recognitionMovements} m
    join ${recognitionSchedules} s on s.company_id = m.company_id and s.id = m.schedule_id
  `);
  const { rows: lines } = await tx.execute<Record<string, unknown>>(sql`
    select (
        select v.value_id from dimension_set_values v
        join dimension_types t on t.company_id = v.company_id and t.id = v.type_id
        where v.company_id = l.company_id and v.set_id = l.dimension_set_id and t.code = 'contract'
      ) as contract_value_id,
      l.currency, l.amount_minor, l.book_minor, l.parallel_minor
    from ${journalLines} l
    where l.entry_id in (select m.entry_id from ${recognitionMovements} m where m.entry_id is not null)
      and l.account_id in (select s.liability_account_id from ${recognitionSchedules} s)
  `);
  return {
    movements: movements.map((row) => ({
      contractValueId: (row.contract_value_id as string | null) ?? null,
      currency: row.currency as CurrencyCode,
      amountMinor: BigInt(row.transaction_minor as string),
      bookMinor: BigInt(row.book_minor as string),
      parallelMinor: parse(row.parallel_minor),
    })),
    liabilityLines: lines.map((row) => ({
      contractValueId: (row.contract_value_id as string | null) ?? null,
      currency: row.currency as CurrencyCode,
      amountMinor: BigInt(row.amount_minor as string),
      bookMinor: BigInt(row.book_minor as string),
      parallelMinor: parse(row.parallel_minor),
    })),
  };
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
