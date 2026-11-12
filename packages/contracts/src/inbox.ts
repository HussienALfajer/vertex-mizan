import { z } from 'zod';
import { actorKindSchema } from './audit.js';
import { lineKindSchema } from './entries.js';
import {
  documentTypeSchema,
  type EventType,
  eventActionSchema,
  eventStateSchema,
  eventTypeSchema,
  HUB_CURRENCIES,
  holdReasonSchema,
  type PostingSlot,
  postingSlotSchema,
} from './events.js';
import { entryNumberSchema, minorUnitsSchema, moneyAmountSchema } from './wire.js';

// The internal API of the event inbox and the posting rules (S05 "API", "Screens"): what the
// accountant reads and does on `/api/inbox` and `/api/posting-rules`.

const instantSchema = z.iso.datetime({ offset: true });
const dateSchema = z.iso.date();

/** An entry an event posted, or the manual entry that resolved it. */
export const inboxEntrySchema = z
  .object({ id: z.uuid() })
  .extend(entryNumberSchema.shape)
  .meta({ id: 'InboxEntry' });

export type InboxEntry = z.infer<typeof inboxEntrySchema>;

/** An event as the inbox lists it: its state, its hold, its document and its entries. */
export const inboxEventSchema = z
  .object({
    id: z.uuid(),
    /** Hub's event ID. */
    eventId: z.uuid(),
    type: z.string(),
    version: z.int(),
    state: eventStateSchema,
    reason: holdReasonSchema.nullable(),
    detail: z.string().nullable(),
    documentType: documentTypeSchema,
    documentId: z.string(),
    documentNumber: z.string().nullable(),
    /**
     * The client by Hub's name: the payload's, or for an event that names none (a payment, a void)
     * the one its item's events name; none for a rate or before the item's first event arrives.
     */
    clientName: z.string().nullable(),
    accountingDate: dateSchema,
    occurredAt: instantSchema,
    receivedAt: instantSchema,
    /** The date it posted at when the accountant moved it to an open period (rule 15). */
    postedOn: dateSchema.nullable(),
    /** The held event of its item it waits behind (rule 11). */
    waitingForId: z.uuid().nullable(),
    attempts: z.int(),
    lastAttemptAt: instantSchema,
    entries: z.array(inboxEntrySchema),
    resolvedBy: inboxEntrySchema.nullable(),
  })
  .meta({ id: 'InboxEvent' });

export type InboxEvent = z.infer<typeof inboxEventSchema>;

/** An opaque position in the inbox's pages, newest received first. */
const cursorSchema = z.string().min(1).max(200);

/** `GET /api/inbox`: by state, reason, type, document and accounting dates, newest first. */
export const inboxQuerySchema = z
  .object({
    state: eventStateSchema.optional(),
    reason: holdReasonSchema.optional(),
    type: eventTypeSchema.optional(),
    /** Hub's document number: the events of one invoice, payment or expense. */
    document: z.string().trim().min(1).max(100).optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    cursor: cursorSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'The range ends before it starts',
  })
  .meta({ id: 'InboxQuery' });

export type InboxQuery = z.infer<typeof inboxQuerySchema>;

export const inboxPageSchema = z
  .object({ events: z.array(inboxEventSchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'InboxPage' });

export type InboxPage = z.infer<typeof inboxPageSchema>;

/** `GET /api/inbox/counts`: the held events, in all and per reason (the sidebar's count). */
export const inboxCountsSchema = z
  .object({
    held: z.int(),
    reasons: z.array(z.object({ reason: holdReasonSchema, count: z.int() })),
  })
  .meta({ id: 'InboxCounts' });

export type InboxCounts = z.infer<typeof inboxCountsSchema>;

/** One row of an event's history (rule 18). */
export const inboxActionSchema = z
  .object({
    id: z.uuid(),
    action: eventActionSchema,
    reason: holdReasonSchema.nullable(),
    detail: z.string().nullable(),
    entryIds: z.array(z.uuid()),
    actor: z.object({ kind: actorKindSchema, id: z.uuid().nullable(), name: z.string() }),
    /** The accountant's written reason for a move, a resolution or a dismissal. */
    note: z.string().nullable(),
    createdAt: instantSchema,
  })
  .meta({ id: 'InboxAction' });

export type InboxAction = z.infer<typeof inboxActionSchema>;

/** `GET /api/inbox/:id`: the event with its payload as Hub sent it and its history. */
export const inboxEventDetailSchema = inboxEventSchema
  .extend({
    payload: z.record(z.string(), z.unknown()),
    payloadHash: z.string(),
    requestId: z.string(),
    /** For an event held `PERIOD_CLOSED`: the day a move posts it on (rule 15). */
    moveOn: dateSchema.nullable(),
    actions: z.array(inboxActionSchema),
  })
  .meta({ id: 'InboxEventDetail' });

export type InboxEventDetail = z.infer<typeof inboxEventDetailSchema>;

/** The written reason of a move or a dismissal (rules 15, 17), kept with the action. */
export const inboxReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .meta({ id: 'InboxReason' });

export type InboxReason = z.infer<typeof inboxReasonSchema>;

/** `POST /api/inbox/:id/resolve` (rule 15): the posted manual entry made for the event. */
export const resolveEventSchema = z
  .object({ entryId: z.uuid(), reason: z.string().trim().min(1).max(500) })
  .meta({ id: 'ResolveEvent' });

export type ResolveEvent = z.infer<typeof resolveEventSchema>;

/**
 * `POST /api/inbox/:id/split-remainder` (S06 rules 15–16): the transaction amount of the remainder
 * to revenue, in the project's currency, from zero to the remainder; the rest is refunded.
 */
export const splitRemainderSchema = z
  .object({ revenueAmount: minorUnitsSchema, reason: z.string().trim().min(1).max(500) })
  .meta({ id: 'SplitRemainder' });

export type SplitRemainder = z.infer<typeof splitRemainderSchema>;

/** The accountant's actions of S06 rule 16 that `/inbox/:id` previews before they are taken. */
export const INBOX_PREVIEW_ACTIONS = ['recognise-in-open-period', 'split-remainder'] as const;

export type InboxPreviewAction = (typeof INBOX_PREVIEW_ACTIONS)[number];

/**
 * `GET /api/inbox/:id/preview` (S06 "Screens"): an action attempted as it would be taken and
 * rolled back; a split names its revenue part, as `POST /api/inbox/:id/split-remainder` does.
 */
export const inboxPreviewQuerySchema = z
  .object({
    action: z.enum(INBOX_PREVIEW_ACTIONS),
    revenueAmount: minorUnitsSchema.optional(),
  })
  .refine((query) => (query.action === 'split-remainder') === (query.revenueAmount !== undefined), {
    path: ['revenueAmount'],
    message: 'A split names its revenue part, and only a split',
  })
  .meta({ id: 'InboxPreviewQuery' });

export type InboxPreviewQuery = z.infer<typeof inboxPreviewQuerySchema>;

/** One line of a previewed entry: its account and its three amounts (ADR 0007). */
export const inboxPreviewLineSchema = z
  .object({
    accountCode: z.string(),
    accountName: z.string(),
    kind: lineKindSchema,
    /** The transaction amount, signed: positive is a debit. */
    amount: moneyAmountSchema,
    bookMinor: minorUnitsSchema,
    parallelMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'InboxPreviewLine' });

/** An entry the action would post, in posting order. */
export const inboxPreviewEntrySchema = z
  .object({
    date: dateSchema,
    /** `hub_event` for the event's own entries, `revenue_release` for a month's release. */
    source: z.enum(['hub_event', 'revenue_release']),
    /** For an elapsed month's part: the month's last day, which it is measured at (S06 rule 16). */
    servicePeriodOn: dateSchema.nullable(),
    lines: z.array(inboxPreviewLineSchema),
  })
  .meta({ id: 'InboxPreviewEntry' });

/** What the action would lead to: the event's state and hold, and the entries it would post. */
export const inboxActionPreviewSchema = z
  .object({
    state: eventStateSchema,
    reason: holdReasonSchema.nullable(),
    detail: z.string().nullable(),
    entries: z.array(inboxPreviewEntrySchema),
  })
  .meta({ id: 'InboxActionPreview' });

export type InboxActionPreview = z.infer<typeof inboxActionPreviewSchema>;

/**
 * The events whose rules read each slot (`packages/ledger`'s `hub.ts`), for the mapping screen:
 * a slot unmapped holds these events `NO_MAPPING`.
 */
export const SLOT_READERS: Readonly<Record<PostingSlot, readonly EventType[]>> = {
  receivable: ['invoice.issued'],
  revenue_at_issue: ['invoice.issued'],
  termination_fee_revenue: ['invoice.issued'],
  'payment_method.cash': ['payment.recorded', 'ad_wallet.deposited', 'ad_wallet.refunded'],
  'payment_method.bank_transfer': ['payment.recorded', 'ad_wallet.deposited', 'ad_wallet.refunded'],
  'payment_method.e_wallet': ['payment.recorded', 'ad_wallet.deposited', 'ad_wallet.refunded'],
  ad_funds: ['ad_wallet.deposited', 'ad_wallet.refunded', 'ad_spend.recorded', 'ad_spend.changed'],
  ad_platforms_payable: ['ad_spend.recorded', 'ad_spend.changed'],
  project_cost: ['project_expense.recorded', 'project_expense.changed'],
  project_expense_awaiting_payment: ['project_expense.recorded', 'project_expense.changed'],
  // S06: the deferral at issue and its releases; the milestones, the project's end and its refund.
  contract_liability: [
    'invoice.issued',
    'milestone.done',
    'project.completed',
    'project.cancelled',
  ],
  contract_asset: ['invoice.issued', 'milestone.done'],
  released_revenue: [
    'invoice.issued',
    'invoice.line_service_changed',
    'milestone.done',
    'project.completed',
    'project.cancelled',
  ],
  cancelled_project_refund: ['invoice.issued', 'project.cancelled'],
};

const mappingCurrencySchema = z.enum(HUB_CURRENCIES);

/** A slot with its account, the events that read it and the held events waiting for it. */
export const postingRuleSchema = z
  .object({
    slot: postingSlotSchema,
    /** SYP or USD for a payment method's slot, null otherwise. */
    currency: mappingCurrencySchema.nullable(),
    account: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
    events: z.array(eventTypeSchema),
    /** Events held `NO_MAPPING` for this slot (`slot_unmapped:<slot>`). */
    heldEvents: z.int(),
    updatedAt: instantSchema.nullable(),
  })
  .meta({ id: 'PostingRule' });

export type PostingRule = z.infer<typeof postingRuleSchema>;

/** `PUT /api/posting-rules/:slot`: the account, and the currency of a payment method's slot. */
export const mapPostingRuleSchema = z
  .object({ currency: mappingCurrencySchema.optional(), accountId: z.uuid() })
  .meta({ id: 'MapPostingRule' });

export type MapPostingRule = z.infer<typeof mapPostingRuleSchema>;

export const postingSlotParamSchema = z
  .object({ slot: postingSlotSchema })
  .meta({ id: 'PostingSlotParam' });

export type PostingSlotParam = z.infer<typeof postingSlotParamSchema>;

/** What frees held events (rule 10), as the API queues it for the worker after a commit. */
export const retryTriggerSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('item'), itemKey: z.string().min(1).max(200) }),
    // An invoice that opened schedules frees the credits waiting for their cycle (S06 rule 19).
    z.object({ kind: z.literal('cycle') }),
    z.object({ kind: z.literal('rate'), on: dateSchema }),
    z.object({ kind: z.literal('mapping') }),
    z.object({ kind: z.literal('deploy') }),
    // A reopened month frees its events held PERIOD_CLOSED and SERVICE_PERIOD_CLOSED (S07 rule 6).
    z.object({
      kind: z.literal('period'),
      period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month as YYYY-MM'),
    }),
    z.object({ kind: z.literal('sweep') }),
  ])
  .meta({ id: 'RetryTrigger' });

/** The worker's queue of the automatic retries (S05 "Jobs"). */
export const EVENTS_RETRY_QUEUE = 'events.retry';

/** A job of `events.retry`: the company and what freed its held events. */
export const eventsRetryJobSchema = z
  .object({ companyId: z.uuid(), triggers: z.array(retryTriggerSchema).min(1).max(100) })
  .meta({ id: 'EventsRetryJob' });

export type EventsRetryJob = z.infer<typeof eventsRetryJobSchema>;
