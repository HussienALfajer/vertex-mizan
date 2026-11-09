import { Inject, Injectable } from '@nestjs/common';
import type {
  HoldReason,
  InboxAction,
  InboxCounts,
  InboxEntry,
  InboxEvent,
  InboxEventDetail,
  InboxPage,
  InboxQuery,
} from '@vertex-mizan/contracts';
import {
  apiClients,
  type Database,
  dismissEvent,
  type InboxResult,
  inboundEventActions,
  inboundEventStates,
  inboundEvents,
  journalEntries,
  moveEvent,
  resolveEvent,
  retryEvent,
  SYSTEM_NAME,
  type Transaction,
  users,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { afterCursor, decodeCursor, pageOf } from '../../core/http/cursor.js';
import { RetryQueue } from '../../core/jobs/retry-queue.js';

const PAGE_SIZE = 50;

const columns = {
  event: inboundEvents,
  state: {
    state: inboundEventStates.state,
    reason: inboundEventStates.holdReason,
    detail: inboundEventStates.holdDetail,
    postedOn: inboundEventStates.postedOn,
    waitingForId: inboundEventStates.waitingForEventId,
    attempts: inboundEventStates.attempts,
    lastAttemptAt: inboundEventStates.lastAttemptAt,
    resolvedByEntryId: inboundEventStates.resolvedByEntryId,
  },
};

type Row = {
  event: typeof inboundEvents.$inferSelect;
  state: {
    state: string;
    reason: string | null;
    detail: string | null;
    postedOn: string | null;
    waitingForId: string | null;
    attempts: number;
    lastAttemptAt: Date;
    resolvedByEntryId: string | null;
  };
};

const withState = (tx: Transaction) =>
  tx
    .select(columns)
    .from(inboundEvents)
    .innerJoin(
      inboundEventStates,
      and(
        eq(inboundEventStates.companyId, inboundEvents.companyId),
        eq(inboundEventStates.eventId, inboundEvents.id),
      ),
    );

/**
 * The event inbox (S05 rules 15–18, "API"): the events Hub sent with their states, the held
 * counts, an event with its payload and history, and the accountant's four actions through
 * `packages/db`'s inbox service, each in the company's transaction with the company row locked
 * first; the retries an action frees are queued after its commit.
 */
@Injectable()
export class InboxService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(RetryQueue) private readonly retries: RetryQueue,
  ) {}

  /** `GET /api/inbox`: newest received first, 50 a page. */
  async list(access: CompanyRouteAccess, query: InboxQuery): Promise<InboxPage> {
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    return withCompany(this.db, access.company.id, async (tx) => {
      const rows = await withState(tx)
        .where(
          and(
            query.state ? eq(inboundEventStates.state, query.state) : undefined,
            query.reason ? eq(inboundEventStates.holdReason, query.reason) : undefined,
            query.type ? eq(inboundEvents.type, query.type) : undefined,
            query.from ? gte(inboundEvents.accountingDate, query.from) : undefined,
            query.to ? lte(inboundEvents.accountingDate, query.to) : undefined,
            after ? afterCursor(inboundEvents.createdAt, inboundEvents.id, after) : undefined,
          ),
        )
        .orderBy(desc(inboundEvents.createdAt), desc(inboundEvents.id))
        .limit(PAGE_SIZE + 1);
      const shaped = await this.shape(tx, rows);
      const page = pageOf(
        rows.map((row, index) => ({
          ...row,
          createdAt: row.event.createdAt,
          id: row.event.id,
          index,
        })),
        PAGE_SIZE,
        (row) => shaped[row.index] as InboxEvent,
      );
      return { events: page.entries, nextCursor: page.nextCursor };
    });
  }

  /** `GET /api/inbox/counts`: the held events, in all and per reason. */
  async counts(access: CompanyRouteAccess): Promise<InboxCounts> {
    const rows = await withCompany(this.db, access.company.id, (tx) =>
      tx
        .select({ reason: inboundEventStates.holdReason, count: sql<number>`count(*)::int` })
        .from(inboundEventStates)
        .where(eq(inboundEventStates.state, 'held'))
        .groupBy(inboundEventStates.holdReason)
        .orderBy(asc(inboundEventStates.holdReason)),
    );
    return {
      held: rows.reduce((total, row) => total + row.count, 0),
      reasons: rows.map((row) => ({ reason: row.reason as HoldReason, count: row.count })),
    };
  }

  /** `GET /api/inbox/:id`: the event, its payload as received and its history. */
  async get(access: CompanyRouteAccess, id: string): Promise<InboxEventDetail> {
    return withCompany(this.db, access.company.id, (tx) => this.detail(tx, id));
  }

  /** `POST /api/inbox/:id/retry` (rule 15): the attempt runs now, for any reason. */
  retry(access: CompanyRouteAccess, id: string): Promise<InboxEventDetail> {
    return this.act(access, id, (tx, options) => retryEvent(tx, id, options));
  }

  /** `POST /api/inbox/:id/post-in-open-period` (rule 15): `PERIOD_CLOSED` only. */
  move(access: CompanyRouteAccess, id: string, reason: string): Promise<InboxEventDetail> {
    return this.act(access, id, (tx, options) => moveEvent(tx, id, reason, options));
  }

  /** `POST /api/inbox/:id/resolve` (rule 15): `NEEDS_DECISION` only, by a posted manual entry. */
  resolve(
    access: CompanyRouteAccess,
    id: string,
    entryId: string,
    reason: string,
  ): Promise<InboxEventDetail> {
    return this.act(access, id, (tx, options) => resolveEvent(tx, id, entryId, reason, options));
  }

  /** `POST /api/inbox/:id/dismiss` (rule 17): the owner's, for any held event. */
  dismiss(access: CompanyRouteAccess, id: string, reason: string): Promise<InboxEventDetail> {
    return this.act(access, id, (tx, options) => dismissEvent(tx, id, reason, options));
  }

  private async act(
    access: CompanyRouteAccess,
    id: string,
    action: (
      tx: Transaction,
      options: { actor: ReturnType<typeof actorOf>; today: string },
    ) => Promise<InboxResult>,
  ): Promise<InboxEventDetail> {
    const companyId = access.company.id;
    const result = await withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      return action(tx, { actor: actorOf(access), today: todayInDamascus() });
    });
    await this.retries.afterCommit(companyId, result.triggers);
    return this.get(access, id);
  }

  private async detail(tx: Transaction, id: string): Promise<InboxEventDetail> {
    const [row] = await withState(tx).where(eq(inboundEvents.id, id));
    if (!row) throw new CodedException('NOT_FOUND', 'No such event');
    const [event] = await this.shape(tx, [row]);
    if (!event) throw new Error('The event was not shaped');
    const actions = await tx
      .select({
        action: inboundEventActions,
        personName: users.name,
        clientName: apiClients.name,
      })
      .from(inboundEventActions)
      .leftJoin(users, eq(users.id, inboundEventActions.actorUserId))
      .leftJoin(apiClients, eq(apiClients.id, inboundEventActions.actorApiClientId))
      .where(eq(inboundEventActions.eventId, id))
      .orderBy(asc(inboundEventActions.createdAt), asc(inboundEventActions.id));
    return {
      ...event,
      payload: row.event.payload as Record<string, unknown>,
      payloadHash: row.event.payloadHash,
      requestId: row.event.requestId,
      actions: actions.map(({ action, personName, clientName }): InboxAction => {
        const kind = action.actorKind as InboxAction['actor']['kind'];
        return {
          id: action.id,
          action: action.action as InboxAction['action'],
          reason: action.holdReason as HoldReason | null,
          detail: action.holdDetail,
          entryIds: action.entryIds,
          actor: {
            kind,
            id: action.actorUserId ?? action.actorApiClientId,
            name:
              (kind === 'person' ? personName : kind === 'api_client' ? clientName : null) ??
              SYSTEM_NAME,
          },
          note: action.reason,
          createdAt: action.createdAt.toISOString(),
        };
      }),
    };
  }

  /** Events as the inbox answers them, with the entries they posted or were resolved by. */
  private async shape(tx: Transaction, rows: readonly Row[]): Promise<InboxEvent[]> {
    if (rows.length === 0) return [];
    const entryColumns = {
      id: journalEntries.id,
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
    };
    const posted = await tx
      .select({ ...entryColumns, sourceRef: journalEntries.sourceRef })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.source, 'hub_event'),
          inArray(
            journalEntries.sourceRef,
            rows.map((row) => row.event.id),
          ),
        ),
      )
      .orderBy(asc(journalEntries.sequence));
    const resolvedIds = rows.flatMap((row) =>
      row.state.resolvedByEntryId ? [row.state.resolvedByEntryId] : [],
    );
    const resolved =
      resolvedIds.length === 0
        ? []
        : await tx
            .select(entryColumns)
            .from(journalEntries)
            .where(inArray(journalEntries.id, resolvedIds));
    const ref = (entry: InboxEntry): InboxEntry => ({
      id: entry.id,
      fiscalYear: entry.fiscalYear,
      number: entry.number,
    });
    return rows.map(({ event, state }) => {
      const resolvedBy = resolved.find((entry) => entry.id === state.resolvedByEntryId);
      return {
        id: event.id,
        eventId: event.eventId,
        type: event.type,
        version: event.version,
        state: state.state as InboxEvent['state'],
        reason: state.reason as HoldReason | null,
        detail: state.detail,
        documentType: event.documentType as InboxEvent['documentType'],
        documentId: event.documentId,
        documentNumber: event.documentNumber,
        accountingDate: event.accountingDate,
        occurredAt: event.occurredAt.toISOString(),
        receivedAt: event.receivedAt.toISOString(),
        postedOn: state.postedOn,
        waitingForId: state.waitingForId,
        attempts: state.attempts,
        lastAttemptAt: state.lastAttemptAt.toISOString(),
        entries: posted.filter((entry) => entry.sourceRef === event.id).map(ref),
        resolvedBy: resolvedBy ? ref(resolvedBy) : null,
      };
    });
  }
}
