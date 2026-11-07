import { createHash } from 'node:crypto';
import {
  type CurrencyCode,
  canonicalPayload,
  DomainError,
  documentOf,
  type EventEnvelope,
  type HoldReason,
  type HubContractRef,
  type HubCurrency,
  type HubValueRef,
  itemKeyOf,
  type PostingSlot,
  parseEventEnvelope,
} from '@vertex-mizan/contracts';
import {
  blockingEvent,
  firstOpenDayAfter,
  type Hold,
  type HubDimensions,
  type HubItem,
  type HubLine,
  type HubReferences,
  type HubRuleContext,
  hold,
  type KeyedEvent,
  type MappedAccount,
  type PlannedEntry,
  planEvent,
  type RulePlan,
  referencedDocuments,
} from '@vertex-mizan/ledger';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { type HubSource, type ManualLineSpec, type PostingContent, post } from '../posting/post.js';
import { chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import {
  inboundEventActions,
  inboundEventStates,
  inboundEvents,
  postingRuleAccounts,
} from '../schema/inbox.js';
import {
  dimensionSetValues,
  journalEntries,
  journalLines,
  ledgerHeads,
  periods,
} from '../schema/ledger.js';
import { openItemBalances, openItemDueDates, openItems } from '../schema/open-items.js';
import { ledgersOf } from './companies.js';
import { recordRate } from './rates.js';

// The event inbox (S05 rules 4–18, ADR 0014): every event Hub sends is kept with its payload, then
// attempted: held with a reason and a detail, posted through `post()` by its rule from
// `packages/ledger`, or recorded. The automatic retries (rule 10) and the accountant's actions
// (rules 15–17) attempt it again from what is kept. Everything runs in the caller's transaction,
// inside `withCompany` with the company of the API key or the session (ADR 0003), and posting is
// serialised per company on the ledger head (ADR 0008), so two events of one item never interleave.

type EventRow = typeof inboundEvents.$inferSelect;
type StateRow = typeof inboundEventStates.$inferSelect;

/** Who acts on an event: Hub's API client at receipt, a person for an action, the system's retries. */
export type InboxActor = AuditActor;

/** An entry an event posted, as `/v1` answers it. */
export interface InboxEntryRef {
  readonly id: string;
  readonly fiscalYear: number;
  readonly number: number;
}

/** An event's state as its answer and the inbox show it. */
export interface InboxEventView {
  readonly inboxId: string;
  readonly eventId: string;
  readonly type: string;
  readonly state: 'held' | 'posted' | 'recorded' | 'resolved' | 'dismissed';
  readonly reason: HoldReason | null;
  readonly detail: string | null;
  readonly waitingForInboxId: string | null;
  readonly postedOn: string | null;
  readonly entries: readonly InboxEntryRef[];
}

/**
 * What frees held events (rule 10), queued after the commit of the change that fixed their reason:
 * an event of an item key that left held or posted, a rate recorded or corrected for a date, a
 * mapping changed or an account unblocked or restored, a deploy, and the daily sweep.
 */
export type RetryTrigger =
  | { readonly kind: 'item'; readonly itemKey: string }
  | { readonly kind: 'rate'; readonly on: string }
  | { readonly kind: 'mapping' }
  | { readonly kind: 'deploy' }
  | { readonly kind: 'sweep' };

/** An event's answer and what its change frees, for the retries after the commit. */
export interface InboxResult {
  readonly event: InboxEventView;
  readonly replayed: boolean;
  readonly triggers: readonly RetryTrigger[];
}

/** What an attempt needs besides the event: who attempts it and the date in Damascus. */
export interface AttemptOptions {
  readonly actor: InboxActor;
  /** Today in Asia/Damascus, from the caller's clock (S03 rule 6). */
  readonly today: string;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function refuse(
  code: DomainError['code'],
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new DomainError(code, message, details);
}

/** The event as received, from its kept row: the envelope its rule reads. */
function envelopeOf(row: EventRow): EventEnvelope {
  return parseEventEnvelope({
    id: row.eventId,
    type: row.type,
    version: row.version,
    occurred_at: row.occurredAt.toISOString(),
    accounting_date: row.accountingDate,
    payload: row.payload,
  });
}

/**
 * The hash that tells a replay from a conflict (rule 4, ADR 0006): the canonical form (RFC 8785)
 * of everything Hub sent under the key, as it sent it, before any parsing trimmed or dropped a
 * field. The event's id is the key itself.
 */
function envelopeHash(raw: Readonly<Record<string, unknown>>): string {
  const { id: _key, ...sent } = raw;
  return sha256(canonicalPayload(sent));
}

/** The actor's columns of an action row. */
function actorColumns(actor: InboxActor) {
  return {
    actorKind: actor.kind,
    actorUserId: actor.kind === 'person' ? actor.userId : null,
    actorApiClientId: actor.kind === 'api_client' ? actor.clientId : null,
  };
}

async function writeAction(
  tx: Transaction,
  row: EventRow,
  actor: InboxActor,
  action: (typeof inboundEventActions.$inferInsert)['action'],
  fields: {
    holdReason?: string | null;
    holdDetail?: string | null;
    entryIds?: readonly string[];
    reason?: string | null;
  } = {},
): Promise<void> {
  await tx.insert(inboundEventActions).values({
    companyId: row.companyId,
    eventId: row.id,
    action,
    holdReason: fields.holdReason ?? null,
    holdDetail: fields.holdDetail ?? null,
    entryIds: [...(fields.entryIds ?? [])],
    reason: fields.reason ?? null,
    ...actorColumns(actor),
  });
}

/** The entries an event posted, in posting order. */
async function entriesOf(tx: Transaction, inboxId: string): Promise<InboxEntryRef[]> {
  const rows = await tx
    .select({
      id: journalEntries.id,
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
    })
    .from(journalEntries)
    .where(and(eq(journalEntries.source, 'hub_event'), eq(journalEntries.sourceRef, inboxId)))
    .orderBy(asc(journalEntries.sequence));
  return rows;
}

async function viewOf(tx: Transaction, row: EventRow): Promise<InboxEventView> {
  const [state] = await tx
    .select()
    .from(inboundEventStates)
    .where(eq(inboundEventStates.eventId, row.id));
  if (!state) throw new Error('An event without its state');
  return {
    inboxId: row.id,
    eventId: row.eventId,
    type: row.type,
    state: state.state as InboxEventView['state'],
    reason: state.holdReason as HoldReason | null,
    detail: state.holdDetail,
    waitingForInboxId: state.waitingForEventId,
    postedOn: state.postedOn,
    entries: await entriesOf(tx, row.id),
  };
}

/** What an attempt decided. */
type Outcome =
  | (Hold & { readonly waitingFor?: string })
  | { readonly kind: 'posted'; readonly entryIds: readonly string[] }
  | { readonly kind: 'recorded'; readonly triggers: readonly RetryTrigger[] };

/** The mapping of every slot, with each account's code and state (S05 "Mapping slots"). */
async function mappingOf(tx: Transaction): Promise<HubRuleContext['mapping']> {
  const rows = await tx
    .select({
      slot: postingRuleAccounts.slot,
      currency: postingRuleAccounts.currency,
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
    .where(isNull(postingRuleAccounts.archivedAt));
  return (slot: PostingSlot, currency: HubCurrency | null): MappedAccount | null => {
    const row = rows.find(
      (candidate) => candidate.slot === slot && candidate.currency === currency,
    );
    return row === undefined
      ? null
      : {
          id: row.id,
          code: row.code,
          blocked: row.blockedAt !== null,
          archived: row.archivedAt !== null,
        };
  };
}

/** The Hub document item of an invoice, with what remains open (S04 rule 2). */
async function invoiceItemOf(tx: Transaction, invoiceId: string): Promise<HubItem | null> {
  const [row] = await tx
    .select({
      id: openItems.id,
      accountId: openItems.accountId,
      currency: openItems.currency,
      openMinor: openItemBalances.openMinor,
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
        eq(openItems.source, 'hub_event'),
        sql`${openItems.hubDocument} ->> 'type' = 'invoice'`,
        sql`${openItems.hubDocument} ->> 'id' = ${invoiceId}`,
      ),
    );
  return row === undefined ? null : { ...row, currency: row.currency as CurrencyCode };
}

/** The entries still standing for a Hub document, latest first: neither reversals nor reversed. */
async function standingEntriesOf(
  tx: Transaction,
  document: { type: string; id: string },
): Promise<string[]> {
  const rows = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        sql`${journalEntries.hubDocument} ->> 'type' = ${document.type}`,
        sql`${journalEntries.hubDocument} ->> 'id' = ${document.id}`,
        isNull(journalEntries.reversesEntryId),
        sql`not exists (select 1 from ${journalEntries} r where r.company_id = ${journalEntries.companyId} and r.reverses_entry_id = ${journalEntries.id})`,
      ),
    )
    .orderBy(desc(journalEntries.sequence));
  return rows.map((row) => row.id);
}

/**
 * The issue entry's line of a Hub invoice line, for a service change: the entry that opened the
 * invoice's item, and its line of that Hub line. `invoiceIssuedPlan()` posts the item's line
 * first, then one line per Hub line in the invoice's order, so the line is at the line's place
 * plus one; its account and amount are checked against the issue event's payload.
 */
async function issueLineOf(
  tx: Transaction,
  invoiceId: string,
  lineId: string,
): Promise<HubReferences['issueLine']> {
  const [item] = await tx
    .select({ entryId: openItems.openedByEntryId })
    .from(openItems)
    .where(
      and(
        eq(openItems.source, 'hub_event'),
        sql`${openItems.hubDocument} ->> 'type' = 'invoice'`,
        sql`${openItems.hubDocument} ->> 'id' = ${invoiceId}`,
      ),
    );
  if (!item) return null;
  const [entry] = await tx
    .select({ sourceRef: journalEntries.sourceRef })
    .from(journalEntries)
    .where(eq(journalEntries.id, item.entryId));
  if (!entry?.sourceRef) return null;
  const [issued] = await tx
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.id, entry.sourceRef));
  if (!issued) return null;
  const envelope = envelopeOf(issued);
  if (envelope.type !== 'invoice.issued') return null;
  const index = envelope.payload.lines.findIndex((line) => line.id === lineId);
  if (index === -1) return null;
  const lineNo = index + 2;
  const [line] = await tx
    .select({ amountMinor: journalLines.amountMinor })
    .from(journalLines)
    .where(and(eq(journalLines.entryId, item.entryId), eq(journalLines.lineNo, lineNo)));
  const hubLine = envelope.payload.lines[index];
  if (!line || hubLine === undefined || line.amountMinor !== -BigInt(hubLine.amount)) {
    throw new Error('The issue entry does not hold its Hub line where its rule posts it');
  }
  return { entryId: item.entryId, lineNo };
}

/** What a rule reads of the books for its event (`HubReferences`). */
async function referencesOf(tx: Transaction, event: EventEnvelope): Promise<HubReferences> {
  const invoiceId = 'invoice' in event.payload ? event.payload.invoice.id : null;
  return {
    invoiceItem: invoiceId === null ? null : await invoiceItemOf(tx, invoiceId),
    standing: await standingEntriesOf(tx, documentOf(event)),
    issueLine:
      event.type === 'invoice.line_service_changed'
        ? await issueLineOf(tx, event.payload.invoice.id, event.payload.line_id)
        : null,
  };
}

/** The earlier events of the event's item key, in received order, with their states (rule 11). */
async function earlierOnKey(tx: Transaction, row: EventRow): Promise<KeyedEvent[]> {
  if (row.itemKey === null) return [];
  const rows = await tx
    .select({ event: inboundEvents, state: inboundEventStates })
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
        eq(inboundEvents.itemKey, row.itemKey),
        // Against the stored time itself, to the microsecond: a JavaScript Date keeps milliseconds.
        sql`(${inboundEvents.receivedAt}, ${inboundEvents.id}) < (select r.received_at, r.id from ${inboundEvents} r where r.id = ${row.id})`,
      ),
    )
    .orderBy(asc(inboundEvents.receivedAt), asc(inboundEvents.id));
  return rows.map(({ event, state }) => {
    const envelope = envelopeOf(event);
    return {
      id: event.id,
      type: envelope.type,
      state: state.state as KeyedEvent['state'],
      reason: state.holdReason as HoldReason | null,
      waitingFor: state.waitingForEventId,
      references: referencedDocuments(envelope),
    };
  });
}

/**
 * Whether the event's own document was resolved by a manual entry or dismissed in another event
 * (rule 16): Mizan's books no longer follow Hub's for it, so the event needs the accountant. It is
 * checked before the references, so the void of a payment that never posted is this hold, not an
 * unknown reference.
 */
async function documentLeftToHand(tx: Transaction, row: EventRow): Promise<boolean> {
  const [found] = await tx
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
        eq(inboundEvents.documentType, row.documentType),
        eq(inboundEvents.documentId, row.documentId),
        inArray(inboundEventStates.state, ['resolved', 'dismissed']),
        sql`${inboundEvents.id} <> ${row.id}`,
      ),
    )
    .limit(1);
  return found !== undefined;
}

/** A sentinel that rolls back an attempt's savepoint once it decided to hold. */
class HeldAttempt extends Error {
  constructor(readonly outcome: Hold) {
    super('held');
  }
}

/** The Arabic description of a Hub event's entries (S05 "Printing and legal books"). */
function descriptionOf(event: EventEnvelope): string {
  switch (event.type) {
    case 'invoice.issued':
      return `فاتورة ${event.payload.invoice.number} — ${event.payload.client.name}`;
    case 'invoice.voided':
      return `إلغاء فاتورة ${event.payload.invoice.number}`;
    case 'invoice.line_service_changed':
      return `تغيير خدمة سطر في فاتورة ${event.payload.invoice.number}`;
    case 'payment.recorded':
      return `دفعة ${event.payload.payment.number} على ${event.payload.invoice.number}`;
    case 'payment.voided':
      return `إلغاء دفعة ${event.payload.payment.number} على ${event.payload.invoice.number}`;
    default:
      return `حدث ${event.type} من Hub`;
  }
}

/** The code a generated value takes when Hub sends none (rule 23): `S-0001`, by type. */
function codePrefix(type: string, contract: HubContractRef | null): string {
  if (contract !== null) return contract.kind === 'project' ? 'P' : 'R';
  return { client: 'C', service: 'S', department: 'D' }[type] ?? 'V';
}

/**
 * The dimension values of Hub's references (S02 rule 10, S05 rule 23), found by
 * `(type, hub, external_id)`, made on first sight with Hub's code (or a generated one; a
 * department's Hub code is its external id) and renamed when Hub's name changed, audited with the
 * API client as actor. What needs the accountant is named, not refused: a value the accountant
 * archived (`dimension_value_archived`), a contract of another client (`contract_client_mismatch`).
 */
class HubValues {
  readonly #types = new Map<string, string>();
  readonly #ids = new Map<string, string>();
  decision: string | null = null;

  constructor(
    private readonly tx: Transaction,
    private readonly companyId: string,
    private readonly actor: InboxActor,
  ) {}

  async #type(code: string): Promise<string> {
    const known = this.#types.get(code);
    if (known !== undefined) return known;
    const [type] = await this.tx
      .select({ id: dimensionTypes.id })
      .from(dimensionTypes)
      .where(and(eq(dimensionTypes.code, code), eq(dimensionTypes.builtin, true)));
    if (!type) throw new Error(`The company has no ${code} type`);
    this.#types.set(code, type.id);
    return type.id;
  }

  #decide(detail: string): void {
    this.decision ??= detail;
  }

  async #freeCode(typeId: string, wanted: string | null, prefix: string): Promise<string> {
    const taken = async (code: string) =>
      (
        await this.tx
          .select({ id: dimensionValues.id })
          .from(dimensionValues)
          .where(and(eq(dimensionValues.typeId, typeId), eq(dimensionValues.code, code)))
      ).length > 0;
    if (wanted !== null && !(await taken(wanted))) return wanted;
    const [count] = await this.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(dimensionValues)
      .where(eq(dimensionValues.typeId, typeId));
    for (let n = (count?.n ?? 0) + 1; ; n += 1) {
      const code = `${prefix}-${String(n).padStart(4, '0')}`;
      if (!(await taken(code))) return code;
    }
  }

  /** The id of Hub's value of a type, made or renamed as rule 23 says. */
  async valueOf(
    type: string,
    ref: HubValueRef | HubContractRef,
    parentId: string | null,
  ): Promise<string> {
    const cacheKey = `${type}:${ref.external_id}`;
    const cached = this.#ids.get(cacheKey);
    if (cached !== undefined) return cached;
    const typeId = await this.#type(type);
    const contract = type === 'contract' ? (ref as HubContractRef) : null;
    const [found] = await this.tx
      .select()
      .from(dimensionValues)
      .where(
        and(
          eq(dimensionValues.typeId, typeId),
          eq(dimensionValues.externalSource, 'hub'),
          eq(dimensionValues.externalId, ref.external_id),
        ),
      );
    let id: string;
    if (found) {
      id = found.id;
      if (found.archivedAt !== null) this.#decide('dimension_value_archived');
      if (contract !== null && found.parentValueId !== parentId) {
        this.#decide('contract_client_mismatch');
      }
      if (found.name !== ref.name) {
        await this.tx
          .update(dimensionValues)
          .set({ name: ref.name })
          .where(eq(dimensionValues.id, found.id));
        await writeCompanyAudit(this.tx, this.companyId, this.actor, {
          action: 'dimension_value.updated',
          entityType: 'dimension_value',
          entityId: found.id,
          before: { name: found.name },
          after: { name: ref.name },
        });
      }
    } else {
      const wanted = ref.code ?? (type === 'department' ? ref.external_id.slice(0, 40) : null);
      const code = await this.#freeCode(typeId, wanted, codePrefix(type, contract));
      const [made] = await this.tx
        .insert(dimensionValues)
        .values({
          companyId: this.companyId,
          typeId,
          code,
          name: ref.name,
          contractKind: contract?.kind ?? null,
          parentValueId: contract === null ? null : parentId,
          externalSource: 'hub',
          externalId: ref.external_id,
        })
        .returning();
      if (!made) throw new Error('The value was not made');
      id = made.id;
      await writeCompanyAudit(this.tx, this.companyId, this.actor, {
        action: 'dimension_value.created',
        entityType: 'dimension_value',
        entityId: made.id,
        after: {
          typeId,
          code,
          name: ref.name,
          contractKind: made.contractKind,
          parentValueId: made.parentValueId,
          externalSource: 'hub',
          externalId: ref.external_id,
        },
      });
    }
    this.#ids.set(cacheKey, id);
    return id;
  }

  /** The value ids of a line's dimensions: the client first, a contract under it. */
  async idsOf(dimensions: HubDimensions): Promise<string[]> {
    const ids: string[] = [];
    let client: string | null = null;
    if (dimensions.client) {
      client = await this.valueOf('client', dimensions.client, null);
      ids.push(client);
    }
    if (dimensions.contract) {
      const owner =
        dimensions.client?.external_id === dimensions.contract.client_external_id
          ? client
          : await this.valueOf(
              'client',
              {
                external_id: dimensions.contract.client_external_id,
                name: dimensions.contract.client_external_id,
              },
              null,
            );
      ids.push(await this.valueOf('contract', dimensions.contract, owner));
    }
    if (dimensions.service) ids.push(await this.valueOf('service', dimensions.service, null));
    if (dimensions.department) {
      ids.push(await this.valueOf('department', dimensions.department, null));
    }
    return ids;
  }
}

/** A planned entry as a posting request's content. */
async function contentOf(
  tx: Transaction,
  planned: PlannedEntry,
  values: HubValues,
  measuredOn: string,
  today: string,
  hub: HubSource,
): Promise<PostingContent> {
  switch (planned.kind) {
    case 'lines': {
      const lines: ManualLineSpec[] = [];
      for (const line of planned.lines) lines.push(await lineSpecOf(line, values));
      return { kind: 'hub', lines, dealtRates: planned.dealtRates, measuredOn, today, hub };
    }
    case 'reversal':
      return { kind: 'hub_reversal', entryId: planned.entryId, today, hub };
    case 'reclassification': {
      // The line keeps every value but its service, which moves from the one it has in the books:
      // the issue line's, or the new service of the latest standing change of that line.
      const valuesOfLine = async (entryId: string, lineNo: number) => {
        const [line] = await tx
          .select({ setId: journalLines.dimensionSetId })
          .from(journalLines)
          .where(and(eq(journalLines.entryId, entryId), eq(journalLines.lineNo, lineNo)));
        if (!line) throw new Error('A Hub line vanished');
        return tx
          .select({ valueId: dimensionSetValues.valueId, typeCode: dimensionTypes.code })
          .from(dimensionSetValues)
          .innerJoin(
            dimensionTypes,
            and(
              eq(dimensionTypes.companyId, dimensionSetValues.companyId),
              eq(dimensionTypes.id, dimensionSetValues.typeId),
            ),
          )
          .where(eq(dimensionSetValues.setId, line.setId));
      };
      const kept = await valuesOfLine(planned.entryId, planned.lineNo);
      const [latest] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .innerJoin(
          inboundEvents,
          and(
            eq(inboundEvents.companyId, journalEntries.companyId),
            sql`${inboundEvents.id}::text = ${journalEntries.sourceRef}`,
          ),
        )
        .where(
          and(
            eq(journalEntries.source, 'hub_event'),
            eq(inboundEvents.documentType, hub.document.type),
            eq(inboundEvents.documentId, hub.document.id),
            eq(inboundEvents.type, 'invoice.line_service_changed'),
            sql`${inboundEvents.payload} ->> 'line_id' = ${planned.lineId}`,
            isNull(journalEntries.reversesEntryId),
            sql`not exists (select 1 from ${journalEntries} r where r.company_id = ${journalEntries.companyId} and r.reverses_entry_id = ${journalEntries.id})`,
          ),
        )
        .orderBy(desc(journalEntries.sequence))
        .limit(1);
      // A change's entry carries the line negated, then the line with its new service.
      const current = latest === undefined ? kept : await valuesOfLine(latest.id, 2);
      const serviceOf = (rows: typeof kept) =>
        rows.find((value) => value.typeCode === 'service')?.valueId;
      const from = serviceOf(current);
      if (from === undefined) throw new Error('A revenue line without its service');
      const others = kept
        .filter((value) => value.typeCode !== 'service')
        .map((value) => value.valueId);
      return {
        kind: 'hub_reclassification',
        entryId: planned.entryId,
        lineNo: planned.lineNo,
        fromValueIds: [...others, from],
        toValueIds: [...others, await values.valueOf('service', planned.to, null)],
        today,
        hub,
      };
    }
  }
}

async function lineSpecOf(line: HubLine, values: HubValues): Promise<ManualLineSpec> {
  return {
    accountId: line.account,
    dimensionValueIds: await values.idsOf(line.dimensions),
    currency: line.amount.currency,
    amountMinor: line.amount.amountMinor,
    memo: null,
    ...(line.item?.kind === 'existing' && { openItemId: line.item.id }),
    ...(line.item?.kind === 'open' && {
      newItem: { reference: line.item.reference, dueOn: line.item.dueOn },
    }),
  };
}

/** The holds a posting's refusal maps to (rule 8); any other refusal names its code. */
function holdOfRefusal(error: DomainError): Hold {
  switch (error.code) {
    case 'PERIOD_CLOSED':
    case 'RATE_MISSING':
    case 'OPEN_ITEM_HAS_SETTLEMENTS':
      return hold(error.code);
    default:
      return hold('NO_MAPPING', `posting_refused:${error.code}`);
  }
}

/**
 * One attempt of an event (rules 8–13), in rule 8's order: an earlier held event of its item that
 * it waits behind; its document left to the accountant (rule 16); its rule's own holds (an unknown
 * reference, no mapping); then its entries, posted in a savepoint, whose refusals are the period,
 * the rates and the settlements; then the accountant's decision, which rolls the savepoint back.
 * `postOn` is the date a moved event posts on (rule 15); it is measured at its own date still.
 */
async function decide(
  tx: Transaction,
  row: EventRow,
  options: AttemptOptions & { readonly postOn?: string },
): Promise<Outcome> {
  const event = envelopeOf(row);
  const blocking = blockingEvent(event, await earlierOnKey(tx, row));
  if (blocking !== null) {
    return { ...hold('WAITING_FOR_EARLIER_EVENT'), waitingFor: blocking.id };
  }
  if (await documentLeftToHand(tx, row))
    return hold('NEEDS_DECISION', 'document_resolved_manually');
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const context: HubRuleContext = {
    ledgers: ledgersOf(settings),
    mapping: await mappingOf(tx),
    tolerance: { SYP: settings.paymentToleranceSypMinor, USD: settings.paymentToleranceUsdMinor },
  };
  const plan: RulePlan = planEvent(event, await referencesOf(tx, event), context);
  if (plan.kind === 'hold') return plan;
  if (plan.kind === 'record') return record(tx, row, plan.record, options.actor);
  const hub: HubSource = {
    inboxId: row.id,
    clientId: row.apiClientId,
    document: { type: row.documentType, id: row.documentId, number: row.documentNumber },
  };
  try {
    const entryIds = await tx.transaction(async (savepoint) => {
      const values = new HubValues(savepoint, row.companyId, options.actor);
      const posted: string[] = [];
      try {
        for (const planned of plan.entries) {
          const content = await contentOf(
            savepoint,
            planned,
            values,
            row.accountingDate,
            options.today,
            hub,
          );
          const entry = await post(savepoint, {
            client: row.apiClientId,
            idempotencyKey: planned.key,
            entryDate: options.postOn ?? row.accountingDate,
            description: descriptionOf(event),
            reference: row.documentNumber,
            draftId: null,
            preparedByUserId: null,
            approvedByUserId: null,
            actor: options.actor,
            content,
          });
          posted.push(entry.id);
        }
      } catch (error) {
        // A refusal of the period, the rates or the settlements comes first in rule 8's order;
        // any other refusal of a decision's lines is the decision's own (a contract's client).
        if (error instanceof DomainError) {
          const refused = holdOfRefusal(error);
          const decision = plan.decision ?? values.decision;
          if (decision !== null && refused.reason === 'NO_MAPPING') {
            throw new HeldAttempt(hold('NEEDS_DECISION', decision));
          }
          throw new HeldAttempt(refused);
        }
        throw error;
      }
      const decision = plan.decision ?? values.decision;
      if (decision !== null) throw new HeldAttempt(hold('NEEDS_DECISION', decision));
      return posted;
    });
    return { kind: 'posted', entryIds };
  } catch (error) {
    if (error instanceof HeldAttempt) return error.outcome;
    throw error;
  }
}

/** An event that changes data without posting (ADR 0014 `recorded`). */
async function record(
  tx: Transaction,
  row: EventRow,
  change: Extract<RulePlan, { kind: 'record' }>['record'],
  actor: InboxActor,
): Promise<Outcome> {
  if (change.kind === 'due_date') {
    // The item's due date from the event's date on (S04 rule 15); a replay of the same date
    // changes nothing.
    await tx.insert(openItemDueDates).values({
      companyId: row.companyId,
      itemId: change.itemId,
      dueOn: change.dueOn,
      effectiveOn: row.accountingDate,
      setBy: 'hub_event',
    });
    return { kind: 'recorded', triggers: [] };
  }
  if (actor.kind !== 'api_client') {
    // A retried rate change is recorded by the client that sent it, as Hub's own row.
    throw new Error('A rate change is recorded at receipt');
  }
  // `rate.changed`: a market row USD/SYP from Hub (S02 rule 14, S05 rule 24); the rate in force
  // already is a no-op, a different rate of a date Hub recorded is a correction.
  const input = {
    effectiveOn: change.effectiveOn,
    base: 'USD' as const,
    quote: 'SYP' as const,
    rate: change.rate,
    type: 'market' as const,
    source: 'hub' as const,
  };
  try {
    await recordRate(tx, row.companyId, actor, input);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === 'RATE_UNCHANGED') return { kind: 'recorded', triggers: [] };
    if (error.code !== 'RATE_REASON_REQUIRED') throw error;
    await recordRate(tx, row.companyId, actor, { ...input, reason: 'تصحيح من Hub' });
  }
  return { kind: 'recorded', triggers: [{ kind: 'rate', on: change.effectiveOn }] };
}

/** Serialises the company's postings and attempts on its ledger head (ADR 0008). */
async function lockCompany(tx: Transaction): Promise<void> {
  await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
}

/**
 * Attempts an event and writes its state and actions (rule 10): a first attempt stores its state
 * and an action `held`, `posted` or `recorded`; a later one updates the state and writes an action
 * when it posts or records, or when its hold's reason or detail changed (`attempted`).
 */
async function attempt(
  tx: Transaction,
  row: EventRow,
  options: AttemptOptions & { readonly postOn?: string },
): Promise<{ outcome: Outcome; leftHeld: boolean }> {
  await lockCompany(tx);
  const [current] = await tx
    .select()
    .from(inboundEventStates)
    .where(eq(inboundEventStates.eventId, row.id))
    .for('update');
  if (current && current.state !== 'held') {
    return { outcome: { kind: 'posted', entryIds: [] }, leftHeld: false };
  }
  const outcome = await decide(tx, row, options);
  const fields =
    outcome.kind === 'hold'
      ? {
          state: 'held',
          holdReason: outcome.reason,
          holdDetail: outcome.detail,
          waitingForEventId: outcome.waitingFor ?? null,
          postedOn: null,
        }
      : {
          state: outcome.kind,
          holdReason: null,
          holdDetail: null,
          waitingForEventId: null,
          postedOn: outcome.kind === 'posted' ? (options.postOn ?? null) : null,
        };
  if (current === undefined) {
    await tx
      .insert(inboundEventStates)
      .values({ companyId: row.companyId, eventId: row.id, ...fields });
  } else {
    await tx
      .update(inboundEventStates)
      .set({ ...fields, attempts: current.attempts + 1, lastAttemptAt: sql`now()` })
      .where(eq(inboundEventStates.id, current.id));
  }
  if (outcome.kind === 'hold') {
    const changed =
      current === undefined ||
      current.holdReason !== outcome.reason ||
      current.holdDetail !== outcome.detail;
    if (changed) {
      await writeAction(tx, row, options.actor, current === undefined ? 'held' : 'attempted', {
        holdReason: outcome.reason,
        holdDetail: outcome.detail,
      });
    }
  } else if (options.postOn === undefined) {
    await writeAction(tx, row, options.actor, outcome.kind, {
      entryIds: outcome.kind === 'posted' ? outcome.entryIds : [],
    });
  }
  return { outcome, leftHeld: outcome.kind !== 'hold' && current !== undefined };
}

/** What an event's change frees: the events of its item key, and a rate's date. */
function triggersOf(row: EventRow, outcome: Outcome): RetryTrigger[] {
  if (outcome.kind === 'hold') return [];
  const triggers: RetryTrigger[] =
    row.itemKey === null ? [] : [{ kind: 'item', itemKey: row.itemKey }];
  return outcome.kind === 'recorded' ? [...triggers, ...outcome.triggers] : triggers;
}

/** An inbox event by its id, or `NOT_FOUND` (another company's id is not found either). */
async function eventRow(tx: Transaction, inboxId: string): Promise<EventRow> {
  const [row] = await tx.select().from(inboundEvents).where(eq(inboundEvents.id, inboxId));
  if (!row) refuse('NOT_FOUND', 'No such event', { inboxId });
  return row;
}

/**
 * `POST /v1/events` (rules 1–7): the event stored as received and attempted at once. The same
 * event ID with the same envelope stores nothing new, writes `replayed` and answers the event's
 * state; with another envelope it is `IDEMPOTENCY_CONFLICT`. Two requests at once serialise on the
 * unique key; the second answers as a replay. The caller validated the envelope and the company's
 * source for its document type, and runs the triggers' retries after the commit.
 */
export async function receiveEvent(
  tx: Transaction,
  companyId: string,
  input: {
    /** The request's JSON body as Hub sent it: kept and hashed as received. */
    readonly raw: Readonly<Record<string, unknown>>;
    /** The same body parsed by `eventEnvelopeSchema`, which the rules read. */
    readonly envelope: EventEnvelope;
    readonly apiClientId: string;
    readonly requestId: string;
  },
  options: AttemptOptions,
): Promise<InboxResult> {
  const { envelope, raw } = input;
  if (raw.id !== envelope.id || typeof raw.payload !== 'object' || raw.payload === null) {
    throw new TypeError('The raw body is the envelope that was parsed');
  }
  const payloadHash = envelopeHash(raw);
  const document = documentOf(envelope);
  const [inserted] = await tx
    .insert(inboundEvents)
    .values({
      companyId,
      apiClientId: input.apiClientId,
      eventId: envelope.id,
      type: envelope.type,
      version: envelope.version,
      occurredAt: new Date(envelope.occurred_at),
      accountingDate: envelope.accounting_date,
      payload: raw.payload,
      payloadHash,
      documentType: document.type,
      documentId: document.id,
      documentNumber: document.number,
      itemKey: itemKeyOf(envelope),
      requestId: input.requestId,
    })
    .onConflictDoNothing({
      target: [inboundEvents.companyId, inboundEvents.apiClientId, inboundEvents.eventId],
    })
    .returning();
  if (!inserted) {
    const [first] = await tx
      .select()
      .from(inboundEvents)
      .where(
        and(
          eq(inboundEvents.apiClientId, input.apiClientId),
          eq(inboundEvents.eventId, envelope.id),
        ),
      );
    if (!first) throw new Error('An event neither stored nor found');
    if (first.payloadHash !== payloadHash) {
      refuse('IDEMPOTENCY_CONFLICT', 'The event ID was sent with another payload', {
        eventId: envelope.id,
      });
    }
    await writeAction(tx, first, options.actor, 'replayed');
    return { event: await viewOf(tx, first), replayed: true, triggers: [] };
  }
  await writeAction(tx, inserted, options.actor, 'received');
  const { outcome } = await attempt(tx, inserted, options);
  return {
    event: await viewOf(tx, inserted),
    replayed: false,
    triggers: triggersOf(inserted, outcome),
  };
}

/** The held events a trigger frees, in received order (rule 10). */
async function heldFreedBy(tx: Transaction, trigger: RetryTrigger): Promise<EventRow[]> {
  const reasons: Record<RetryTrigger['kind'], readonly HoldReason[]> = {
    item: ['WAITING_FOR_EARLIER_EVENT', 'UNKNOWN_REFERENCE', 'OPEN_ITEM_HAS_SETTLEMENTS'],
    rate: ['RATE_MISSING'],
    mapping: ['NO_MAPPING'],
    deploy: ['NO_MAPPING'],
    sweep: [
      'WAITING_FOR_EARLIER_EVENT',
      'UNKNOWN_REFERENCE',
      'NO_MAPPING',
      'RATE_MISSING',
      'OPEN_ITEM_HAS_SETTLEMENTS',
      'SERVICE_PERIOD_CLOSED',
    ],
  };
  const rows = await tx
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
        eq(inboundEventStates.state, 'held'),
        inArray(inboundEventStates.holdReason, [...reasons[trigger.kind]]),
        trigger.kind === 'item' ? eq(inboundEvents.itemKey, trigger.itemKey) : undefined,
        // A bulletin of a date serves the days after it until the next publication (ADR 0011).
        trigger.kind === 'rate' ? sql`${inboundEvents.accountingDate} >= ${trigger.on}` : undefined,
      ),
    )
    .orderBy(asc(inboundEvents.receivedAt), asc(inboundEvents.id));
  return rows.map(({ event }) => event);
}

/**
 * The automatic retries (rule 10, ADR 0014), the `events.retry` job's work after the commit of the
 * change that fixed a reason: each freed event attempted again in received order, as the system;
 * an event that leaves held frees its item key's events in turn. Safe to run twice: a posted event
 * is not attempted again, and its entries post under their keys once (invariant 5).
 */
export async function retryFreed(
  tx: Transaction,
  triggers: readonly RetryTrigger[],
  options: AttemptOptions,
): Promise<number> {
  const queue = [...triggers];
  let posted = 0;
  while (queue.length > 0) {
    const trigger = queue.shift() as RetryTrigger;
    for (const row of await heldFreedBy(tx, trigger)) {
      const { outcome, leftHeld } = await attempt(tx, row, options);
      if (!leftHeld) continue;
      posted += 1;
      for (const freed of triggersOf(row, outcome)) {
        if (!queue.some((queued) => JSON.stringify(queued) === JSON.stringify(freed))) {
          queue.push(freed);
        }
      }
    }
  }
  return posted;
}

/** A held event's state, locked, or `EVENT_NOT_HELD`. */
async function heldState(tx: Transaction, row: EventRow): Promise<StateRow> {
  await lockCompany(tx);
  const [state] = await tx
    .select()
    .from(inboundEventStates)
    .where(eq(inboundEventStates.eventId, row.id))
    .for('update');
  if (state?.state !== 'held') {
    refuse('EVENT_NOT_HELD', 'The event is not held', { inboxId: row.id, state: state?.state });
  }
  return state;
}

async function auditAction(
  tx: Transaction,
  row: EventRow,
  actor: InboxActor,
  action: 'event.retried' | 'event.moved_to_open_period' | 'event.resolved' | 'event.dismissed',
  reason: string | null,
  after: Record<string, unknown>,
): Promise<void> {
  await writeCompanyAudit(tx, row.companyId, actor, {
    action,
    entityType: 'inbound_event',
    entityId: row.id,
    reason,
    after: {
      type: row.type,
      documentType: row.documentType,
      documentNumber: row.documentNumber,
      ...after,
    },
  });
}

/** Retry, for any reason (rule 15): the attempt runs now. */
export async function retryEvent(
  tx: Transaction,
  inboxId: string,
  options: AttemptOptions,
): Promise<InboxResult> {
  const row = await eventRow(tx, inboxId);
  const state = await heldState(tx, row);
  await writeAction(tx, row, options.actor, 'retried', {
    holdReason: state.holdReason,
    holdDetail: state.holdDetail,
  });
  const { outcome } = await attempt(tx, row, options);
  const event = await viewOf(tx, row);
  await auditAction(tx, row, options.actor, 'event.retried', null, {
    state: event.state,
    holdReason: event.reason,
  });
  return { event, replayed: false, triggers: triggersOf(row, outcome) };
}

/**
 * Post in the next open period (rule 15), for `PERIOD_CLOSED` only: posted on the first day of the
 * first open period after the event's accounting date, every line measured as on that date, with
 * a written reason; `posted_on` and the action keep both dates.
 */
export async function moveEvent(
  tx: Transaction,
  inboxId: string,
  reason: string,
  options: AttemptOptions,
): Promise<InboxResult> {
  const row = await eventRow(tx, inboxId);
  const state = await heldState(tx, row);
  if (state.holdReason !== 'PERIOD_CLOSED') {
    refuse('EVENT_ACTION_NOT_ALLOWED', 'Only an event held PERIOD_CLOSED moves', {
      reason: state.holdReason,
    });
  }
  const closed = await tx
    .select({ period: periods.period })
    .from(periods)
    .where(sql`${periods.state} <> 'open'`);
  const postOn = firstOpenDayAfter(
    row.accountingDate,
    closed.map((period) => period.period),
  );
  const { outcome } = await attempt(tx, row, { ...options, postOn });
  // The accountant's action is kept whatever it led to (rule 18): the entries it posted, or the
  // hold the event is still in.
  await writeAction(tx, row, options.actor, 'moved_to_open_period', {
    entryIds: outcome.kind === 'posted' ? outcome.entryIds : [],
    holdReason: outcome.kind === 'hold' ? outcome.reason : null,
    holdDetail: outcome.kind === 'hold' ? outcome.detail : null,
    reason,
  });
  const event = await viewOf(tx, row);
  await auditAction(tx, row, options.actor, 'event.moved_to_open_period', reason, {
    state: event.state,
    holdReason: event.reason,
    postedOn: event.postedOn,
  });
  return { event, replayed: false, triggers: triggersOf(row, outcome) };
}

/**
 * Resolve by a manual entry (rule 15), for `NEEDS_DECISION` only: the event linked to a posted
 * manual entry the accountant made for it, which resolves no other event (`ENTRY_ALREADY_LINKED`);
 * the event becomes `resolved` and never posts.
 */
export async function resolveEvent(
  tx: Transaction,
  inboxId: string,
  entryId: string,
  reason: string,
  options: AttemptOptions,
): Promise<InboxResult> {
  const row = await eventRow(tx, inboxId);
  const state = await heldState(tx, row);
  if (state.holdReason !== 'NEEDS_DECISION') {
    refuse('EVENT_ACTION_NOT_ALLOWED', 'Only an event held NEEDS_DECISION is resolved by hand', {
      reason: state.holdReason,
    });
  }
  const [entry] = await tx
    .select({ source: journalEntries.source })
    .from(journalEntries)
    .where(eq(journalEntries.id, entryId));
  if (!entry) refuse('NOT_FOUND', 'No such entry', { entryId });
  const [linked] = await tx
    .select({ id: inboundEventStates.id })
    .from(inboundEventStates)
    .where(eq(inboundEventStates.resolvedByEntryId, entryId));
  if (entry.source !== 'manual' || linked) {
    refuse('ENTRY_ALREADY_LINKED', 'The entry is not a manual entry free to resolve this event', {
      entryId,
    });
  }
  await tx
    .update(inboundEventStates)
    .set({
      state: 'resolved',
      holdReason: null,
      holdDetail: null,
      waitingForEventId: null,
      resolvedByEntryId: entryId,
    })
    .where(eq(inboundEventStates.id, state.id));
  await writeAction(tx, row, options.actor, 'resolved', { entryIds: [entryId], reason });
  await auditAction(tx, row, options.actor, 'event.resolved', reason, {
    state: 'resolved',
    entryId,
  });
  const event = await viewOf(tx, row);
  return {
    event,
    replayed: false,
    triggers: row.itemKey === null ? [] : [{ kind: 'item', itemKey: row.itemKey }],
  };
}

/** Dismiss, by the owner, for any held event (rule 17): it never posts; waiting events retry. */
export async function dismissEvent(
  tx: Transaction,
  inboxId: string,
  reason: string,
  options: AttemptOptions,
): Promise<InboxResult> {
  const row = await eventRow(tx, inboxId);
  const state = await heldState(tx, row);
  await tx
    .update(inboundEventStates)
    .set({ state: 'dismissed', holdReason: null, holdDetail: null, waitingForEventId: null })
    .where(eq(inboundEventStates.id, state.id));
  await writeAction(tx, row, options.actor, 'dismissed', { reason });
  await auditAction(tx, row, options.actor, 'event.dismissed', reason, {
    state: 'dismissed',
    holdReason: state.holdReason,
  });
  const event = await viewOf(tx, row);
  return {
    event,
    replayed: false,
    triggers: row.itemKey === null ? [] : [{ kind: 'item', itemKey: row.itemKey }],
  };
}

/** An event's state by its inbox id (`NOT_FOUND` for another company's). */
export async function readInboxEvent(tx: Transaction, inboxId: string): Promise<InboxEventView> {
  return viewOf(tx, await eventRow(tx, inboxId));
}
