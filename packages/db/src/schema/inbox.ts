import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { chartAccounts } from './chart.js';
import {
  archivedAt,
  companyId,
  createdAt,
  id,
  idIsUuidV7,
  timestamptz,
  updatedAt,
} from './columns.js';
import { companies } from './companies.js';
import { journalEntries } from './ledger.js';

// The integration layer's company tables (S05, ADR 0014): the account each posting rule reads
// (`posting-rules`), and the event inbox (`inbox`): every event Hub sent with its payload as
// received, append-only; its current state, a queue the attempts and the accountant's actions
// move; and every attempt and action, append-only. API clients and their keys are platform tables
// (S05 PR 3).

/** The slots of the posting rules; `POSTING_SLOTS` in `@vertex-mizan/contracts` (a test keeps them equal). */
export const postingSlot = pgEnum('posting_slot', [
  'receivable',
  'revenue_at_issue',
  'termination_fee_revenue',
  'payment_method.cash',
  'payment_method.bank_transfer',
  'payment_method.e_wallet',
  'ad_funds',
  'ad_platforms_payable',
  'project_cost',
  'project_expense_awaiting_payment',
]);

/** Hub's currencies (`HUB_CURRENCIES`), the only ones a payment method's slot is mapped in. */
export const MAPPING_CURRENCIES = ['SYP', 'USD'] as const;

/** `EVENT_STATES`, `HOLD_REASONS`, `EVENT_ACTIONS` and `ACTOR_KINDS` of contracts (a test keeps them equal). */
export const INBOUND_EVENT_STATES = [
  'held',
  'posted',
  'recorded',
  'resolved',
  'dismissed',
] as const;
export const INBOUND_HOLD_REASONS = [
  'PERIOD_CLOSED',
  'SERVICE_PERIOD_CLOSED',
  'UNKNOWN_REFERENCE',
  'NO_MAPPING',
  'RATE_MISSING',
  'NEEDS_DECISION',
  'OPEN_ITEM_HAS_SETTLEMENTS',
  'WAITING_FOR_EARLIER_EVENT',
] as const;
export const INBOUND_EVENT_ACTIONS = [
  'received',
  'replayed',
  'attempted',
  'held',
  'posted',
  'recorded',
  'retried',
  'moved_to_open_period',
  'resolved',
  'dismissed',
] as const;
export const INBOUND_ACTOR_KINDS = ['person', 'api_client', 'system'] as const;

const listOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * The account a posting rule's slot reads (S05 "Mapping slots"): one per slot, and per currency
 * for a payment method's slot (SYP and USD). Set from the service-agency template at company
 * creation and changed by the owner or an accountant (`posting_rule.mapped`, audited before and
 * after); an unmapped slot holds its events `NO_MAPPING`.
 */
export const postingRuleAccounts = pgTable(
  'posting_rule_accounts',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    slot: postingSlot().notNull(),
    currency: text(),
    accountId: uuid().notNull(),
    /** Who mapped it last; null for the template's default. A platform id, kept without a key. */
    updatedByUserId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('posting_rule_accounts', t.id),
    unique('posting_rule_accounts_slot_key').on(t.companyId, t.slot, t.currency).nullsNotDistinct(),
    foreignKey({
      name: 'posting_rule_accounts_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    index('posting_rule_accounts_company_account_idx').on(t.companyId, t.accountId),
    check(
      'posting_rule_accounts_currency',
      sql`(${t.slot}::text like 'payment_method.%') = (${t.currency} is not null)
        and (${t.currency} is null or ${t.currency} in (${listOf(MAPPING_CURRENCIES)}))`,
    ),
  ],
);

/**
 * An event as Hub sent it (S05 rules 1–5): its envelope, its payload as received with the SHA-256
 * of its canonical form (RFC 8785), the Hub document it is about, the key that orders its item's
 * events (rule 11), and when and in which request it arrived. Append-only: a held event posts
 * later from what is kept here, and a stored payload is never migrated.
 */
export const inboundEvents = pgTable(
  'inbound_events',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    /** The API client that sent it: a platform id, kept without a key. */
    apiClientId: uuid().notNull(),
    /** Hub's event ID, the idempotency key. */
    eventId: uuid().notNull(),
    type: text().notNull(),
    version: smallint().notNull(),
    occurredAt: timestamptz().notNull(),
    accountingDate: date().notNull(),
    payload: jsonb().notNull(),
    payloadHash: text().notNull(),
    documentType: text().notNull(),
    /** Hub's document id; a rate's is its date, a project's its external id. */
    documentId: text().notNull(),
    documentNumber: text(),
    itemKey: text(),
    receivedAt: timestamptz().notNull().defaultNow(),
    requestId: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('inbound_events', t.id),
    unique('inbound_events_company_id_id_key').on(t.companyId, t.id),
    unique('inbound_events_event_key').on(t.companyId, t.apiClientId, t.eventId),
    // Hub's event ID is one event of the company whichever client sent it: a replay under the
    // client a document type moved to answers the first event (S05 rule 21).
    unique('inbound_events_company_event_key').on(t.companyId, t.eventId),
    index('inbound_events_company_item_idx').on(t.companyId, t.itemKey, t.receivedAt),
    index('inbound_events_company_document_idx').on(t.companyId, t.documentType, t.documentId),
    index('inbound_events_company_date_idx').on(t.companyId, t.accountingDate),
    check('inbound_events_version', sql`${t.version} >= 1`),
    check('inbound_events_type', sql`${t.type} ~ '^[a-z][a-z_]*\\.[a-z][a-z_]*$'`),
    check('inbound_events_payload_hash', sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check('inbound_events_payload', sql`jsonb_typeof(${t.payload}) = 'object'`),
    check(
      'inbound_events_document',
      sql`char_length(${t.documentType}) between 1 and 40
        and char_length(${t.documentId}) between 1 and 100
        and (${t.documentNumber} is null or char_length(${t.documentNumber}) between 1 and 100)
        and (${t.itemKey} is null or char_length(${t.itemKey}) between 1 and 200)`,
    ),
    check('inbound_events_request_id', sql`char_length(${t.requestId}) between 1 and 200`),
  ],
);

/**
 * An event's state in the inbox (ADR 0014): held with its reason and detail (and the event it
 * waits behind), posted (with the date it posted at when the accountant moved it), recorded,
 * resolved by a manual entry, or dismissed. Only a held event changes (a guard), so a posted,
 * resolved or dismissed event never returns to held; a manual entry resolves one event.
 */
export const inboundEventStates = pgTable(
  'inbound_event_states',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    eventId: uuid().notNull(),
    state: text().notNull(),
    holdReason: text(),
    holdDetail: text(),
    waitingForEventId: uuid(),
    postedOn: date(),
    resolvedByEntryId: uuid(),
    attempts: integer().notNull().default(1),
    lastAttemptAt: timestamptz().notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('inbound_event_states', t.id),
    unique('inbound_event_states_event_key').on(t.companyId, t.eventId),
    foreignKey({
      name: 'inbound_event_states_event_fk',
      columns: [t.companyId, t.eventId],
      foreignColumns: [inboundEvents.companyId, inboundEvents.id],
    }),
    foreignKey({
      name: 'inbound_event_states_waiting_fk',
      columns: [t.companyId, t.waitingForEventId],
      foreignColumns: [inboundEvents.companyId, inboundEvents.id],
    }),
    index('inbound_event_states_company_waiting_idx').on(t.companyId, t.waitingForEventId),
    foreignKey({
      name: 'inbound_event_states_resolved_by_fk',
      columns: [t.companyId, t.resolvedByEntryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    uniqueIndex('inbound_event_states_resolved_by_key')
      .on(t.companyId, t.resolvedByEntryId)
      .where(sql`${t.resolvedByEntryId} is not null`),
    index('inbound_event_states_company_resolved_by_idx').on(t.companyId, t.resolvedByEntryId),
    index('inbound_event_states_company_state_idx').on(t.companyId, t.state, t.holdReason),
    check('inbound_event_states_state', sql`${t.state} in (${listOf(INBOUND_EVENT_STATES)})`),
    check(
      'inbound_event_states_hold',
      sql`(${t.state} = 'held') = (${t.holdReason} is not null)
        and (${t.holdReason} is null or ${t.holdReason} in (${listOf(INBOUND_HOLD_REASONS)}))
        and (${t.holdDetail} is null or (${t.holdReason} is not null
          and ${t.holdDetail} ~ '^[a-z][a-z0-9_]*(:[A-Za-z0-9_.-]{1,60})?$'))
        and (${t.holdReason} = 'WAITING_FOR_EARLIER_EVENT') = (${t.waitingForEventId} is not null)
        and (${t.waitingForEventId} is null or ${t.waitingForEventId} <> ${t.eventId})`,
    ),
    check(
      'inbound_event_states_outcome',
      sql`(${t.state} = 'resolved') = (${t.resolvedByEntryId} is not null)
        and (${t.postedOn} is null or ${t.state} = 'posted')`,
    ),
    check('inbound_event_states_attempts', sql`${t.attempts} >= 1`),
  ],
);

/**
 * Every attempt and action on an event (S05 rule 18): its receipt and replays, each attempt whose
 * hold differs from the last, its posting or record with the entries, and the accountant's
 * retries, moves, resolutions and dismissals with their reasons. Append-only.
 */
export const inboundEventActions = pgTable(
  'inbound_event_actions',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    eventId: uuid().notNull(),
    action: text().notNull(),
    holdReason: text(),
    holdDetail: text(),
    entryIds: uuid().array().notNull().default(sql`'{}'`),
    actorKind: text().notNull(),
    /** A person's or an API client's platform id, kept without a key, as the audit log keeps it. */
    actorUserId: uuid(),
    actorApiClientId: uuid(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('inbound_event_actions', t.id),
    foreignKey({
      name: 'inbound_event_actions_event_fk',
      columns: [t.companyId, t.eventId],
      foreignColumns: [inboundEvents.companyId, inboundEvents.id],
    }),
    index('inbound_event_actions_company_event_idx').on(t.companyId, t.eventId, t.createdAt),
    check('inbound_event_actions_action', sql`${t.action} in (${listOf(INBOUND_EVENT_ACTIONS)})`),
    check(
      'inbound_event_actions_hold',
      sql`(${t.holdReason} is null or ${t.holdReason} in (${listOf(INBOUND_HOLD_REASONS)}))
        and (${t.holdDetail} is null or ${t.holdReason} is not null)`,
    ),
    check(
      'inbound_event_actions_actor',
      sql`(${t.actorKind} = 'person' and ${t.actorUserId} is not null and ${t.actorApiClientId} is null)
        or (${t.actorKind} = 'api_client' and ${t.actorApiClientId} is not null and ${t.actorUserId} is null)
        or (${t.actorKind} = 'system' and ${t.actorUserId} is null and ${t.actorApiClientId} is null)`,
    ),
    check(
      'inbound_event_actions_reason',
      sql`(${t.reason} is null or char_length(${t.reason}) between 1 and 500)
        and (${t.action} not in ('moved_to_open_period', 'resolved', 'dismissed') or ${t.reason} is not null)`,
    ),
    check('inbound_event_actions_entries', sql`array_position(${t.entryIds}, null) is null`),
  ],
);
