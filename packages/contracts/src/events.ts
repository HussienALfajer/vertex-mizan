import { z } from 'zod';
import { contractKindSchema, externalIdSchema } from './dimensions.js';

/**
 * The Hub event contracts (ADR 0006, ADR 0008, ADR 0014; S05 rules 1–3): the envelope of
 * `POST /v1/events`, the catalogue of version 1 as one schema per type, the outcomes, the hold
 * reasons and their details, the item key that orders an item's events (rule 11) and the posting
 * slots a rule reads (S05 "Mapping slots"). Every list here is append-only within `/v1`: a value
 * is never renamed or removed, and clients accept a value they do not know (ADR 0006).
 *
 * Hub's names are snake_case on the wire, as Hub sends them. Amounts are JSON integers in minor
 * units (Hub's `*_minor`, within 2^53): the posting rules read them as `bigint` through
 * `hubMinor()`, never as numbers.
 */

/** Hub's currencies (Hub `packages/contracts/src/money.ts`, read 2026-11-07): SYP and USD only. */
export const HUB_CURRENCIES = ['SYP', 'USD'] as const;

export const hubCurrencySchema = z.enum(HUB_CURRENCIES).meta({ id: 'HubCurrency' });

export type HubCurrency = z.infer<typeof hubCurrencySchema>;

/** A date as Hub sends it, `YYYY-MM-DD`. */
const hubDateSchema = z.iso.date();

/**
 * Hub's `syp_per_usd`: SYP per one USD as Hub stores it, up to 8 integer and 4 decimal digits,
 * positive. It quotes the pair USD/SYP and is never inverted (ADR 0007).
 */
export const sypPerUsdSchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Expected SYP per USD with up to 4 decimals')
  .refine((text) => /[1-9]/.test(text), 'Expected a positive rate')
  .meta({ id: 'SypPerUsd', description: 'SYP per one USD, as a decimal string' });

/** A positive amount in minor units, as Hub sends it: a JSON integer. */
const positiveMinorSchema = z.int().min(1).max(Number.MAX_SAFE_INTEGER);

/** A tax amount or base: zero or more, in minor units. */
const nonNegativeMinorSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** An amount on the wire as the `bigint` the ledger works in (ADR 0007): never a float. */
export function hubMinor(amount: number): bigint {
  if (!Number.isSafeInteger(amount)) throw new RangeError('A Hub amount is a safe integer');
  return BigInt(amount);
}

/** A Hub document by its id and its human number (`INV-2026-0012`). */
export const hubDocumentIdSchema = z
  .object({ id: z.uuid(), number: z.string().trim().min(1).max(100) })
  .meta({ id: 'HubDocumentId' });

export type HubDocumentId = z.infer<typeof hubDocumentIdSchema>;

const nameSchema = z.string().trim().min(1).max(200);
const codeSchema = z.string().trim().min(1).max(40);

/** A dimension value as Hub sends it (rule 2): its Hub ID, its code when Hub has one, its name. */
export const hubValueRefSchema = z
  .object({ external_id: externalIdSchema, code: codeSchema.optional(), name: nameSchema })
  .meta({ id: 'HubValueRef' });

export type HubValueRef = z.infer<typeof hubValueRefSchema>;

/** A contract (a project or a retainer) with its kind and its client's Hub ID (rule 2, rule 23). */
export const hubContractRefSchema = z
  .object({
    external_id: externalIdSchema,
    code: codeSchema.optional(),
    name: nameSchema,
    kind: contractKindSchema,
    client_external_id: externalIdSchema,
  })
  .meta({ id: 'HubContractRef' });

export type HubContractRef = z.infer<typeof hubContractRefSchema>;

/** How Hub received a payment or a wallet entry; each maps to an account per currency (Q6). */
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'e_wallet'] as const;

export const paymentMethodSchema = z.enum(PAYMENT_METHODS).meta({ id: 'PaymentMethod' });

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * Where an invoice line comes from in Hub (ADR 0006): a retainer cycle's charge, a deposit, a
 * milestone, extra work or a manual line. The kinds of a retainer charge.
 */
export const INVOICE_LINE_SOURCES = [
  'retainer_charge',
  'deposit',
  'milestone',
  'extra_work',
  'manual',
] as const;

export const invoiceLineSourceSchema = z
  .enum(INVOICE_LINE_SOURCES)
  .meta({ id: 'InvoiceLineSource' });

export const RETAINER_CHARGE_KINDS = ['monthly', 'addition', 'credit', 'termination_fee'] as const;

export const retainerChargeKindSchema = z
  .enum(RETAINER_CHARGE_KINDS)
  .meta({ id: 'RetainerChargeKind' });

/** A tax on a line: stored, never posted in phase 1 (S05 "Out"; phase 1 scope §4). */
export const invoiceTaxSchema = z
  .object({
    code: codeSchema,
    base: nonNegativeMinorSchema,
    rate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'Expected a percentage'),
    amount: nonNegativeMinorSchema,
  })
  .meta({ id: 'InvoiceTax' });

/**
 * A line of an invoice. Its amount is positive, but a retainer `credit` line's, which is negative
 * (rule 2). A retainer charge names its kind; a monthly or added charge its cycle; a manual line
 * whether its revenue is deferred (S06).
 */
export const invoiceLineSchema = z
  .object({
    id: z.uuid(),
    amount: z.int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    description: z.string().trim().min(1).max(500).optional(),
    service: hubValueRefSchema,
    source: invoiceLineSourceSchema,
    charge_kind: retainerChargeKindSchema.optional(),
    cycle_start: hubDateSchema.optional(),
    cycle_end: hubDateSchema.optional(),
    deferred: z.boolean().optional(),
    milestone_id: z.uuid().optional(),
    taxes: z.array(invoiceTaxSchema).max(10).optional(),
  })
  .superRefine((line, context) => {
    const credit = line.source === 'retainer_charge' && line.charge_kind === 'credit';
    if (credit ? line.amount >= 0 : line.amount <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: credit ? 'A retainer credit is negative' : 'An amount is positive',
      });
    }
    if ((line.source === 'retainer_charge') !== (line.charge_kind !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['charge_kind'],
        message: 'A retainer charge, and only one, names its kind',
      });
    }
    if (line.deferred !== undefined && line.source !== 'manual') {
      context.addIssue({
        code: 'custom',
        path: ['deferred'],
        message: 'Only a manual line is marked deferred',
      });
    }
  })
  .meta({ id: 'InvoiceLine' });

export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

/** At most this many lines on one invoice (rule 22). */
export const INVOICE_LINE_LIMIT = 200;

export const invoiceIssuedV1Schema = z
  .object({
    invoice: hubDocumentIdSchema,
    client: hubValueRefSchema,
    contract: hubContractRefSchema.optional(),
    currency: hubCurrencySchema,
    syp_per_usd: sypPerUsdSchema,
    issued_on: hubDateSchema,
    due_on: hubDateSchema,
    lines: z.array(invoiceLineSchema).min(1).max(INVOICE_LINE_LIMIT),
    /** The project's installments other than its deposit (ADR 0006; S06's milestones). */
    installment_total: positiveMinorSchema.optional(),
  })
  .superRefine((invoice, context) => {
    if (invoice.due_on < invoice.issued_on) {
      context.addIssue({ code: 'custom', path: ['due_on'], message: 'Due before its issue' });
    }
    // A contract of another client is held for the accountant (rule 9), not refused here.
    const ids = new Set(invoice.lines.map((line) => line.id));
    if (ids.size !== invoice.lines.length) {
      context.addIssue({ code: 'custom', path: ['lines'], message: 'Two lines with one id' });
    }
  })
  .meta({ id: 'InvoiceIssuedV1' });

export type InvoiceIssuedV1 = z.infer<typeof invoiceIssuedV1Schema>;

export const invoiceVoidedV1Schema = z
  .object({
    invoice: hubDocumentIdSchema,
    voided_on: hubDateSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .meta({ id: 'InvoiceVoidedV1' });

export type InvoiceVoidedV1 = z.infer<typeof invoiceVoidedV1Schema>;

export const invoiceLineServiceChangedV1Schema = z
  .object({
    invoice: hubDocumentIdSchema,
    line_id: z.uuid(),
    old_service: hubValueRefSchema,
    new_service: hubValueRefSchema,
    changed_on: hubDateSchema,
  })
  .meta({ id: 'InvoiceLineServiceChangedV1' });

export type InvoiceLineServiceChangedV1 = z.infer<typeof invoiceLineServiceChangedV1Schema>;

export const invoiceDueDateChangedV1Schema = z
  .object({ invoice: hubDocumentIdSchema, due_on: hubDateSchema })
  .meta({ id: 'InvoiceDueDateChangedV1' });

export type InvoiceDueDateChangedV1 = z.infer<typeof invoiceDueDateChangedV1Schema>;

/**
 * A payment applied to one invoice. `applied_amount` is in `invoice_currency` (Hub's
 * `applied_minor`). In the invoice's currency an applied amount above the amount is refused here:
 * a gap in one currency is never an exchange difference (rule 3; owner, 2026-11-06).
 */
export const paymentRecordedV1Schema = z
  .object({
    payment: hubDocumentIdSchema,
    invoice: hubDocumentIdSchema,
    paid_on: hubDateSchema,
    method: paymentMethodSchema,
    currency: hubCurrencySchema,
    amount: positiveMinorSchema,
    syp_per_usd: sypPerUsdSchema,
    applied_amount: positiveMinorSchema,
    invoice_currency: hubCurrencySchema,
  })
  .superRefine((payment, context) => {
    if (payment.currency === payment.invoice_currency && payment.applied_amount > payment.amount) {
      context.addIssue({
        code: 'custom',
        path: ['applied_amount'],
        message: 'In the invoice currency, more is applied than was received',
      });
    }
  })
  .meta({ id: 'PaymentRecordedV1' });

export type PaymentRecordedV1 = z.infer<typeof paymentRecordedV1Schema>;

export const paymentVoidedV1Schema = z
  .object({
    payment: hubDocumentIdSchema,
    invoice: hubDocumentIdSchema,
    voided_on: hubDateSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .meta({ id: 'PaymentVoidedV1' });

export type PaymentVoidedV1 = z.infer<typeof paymentVoidedV1Schema>;

/**
 * A milestone reported done in Hub (S06 rule 11). `service` is the milestone's service, which a
 * milestone not invoiced recognises on (optional in `/v1`, ADR 0006; a done without it is held for
 * the accountant, `milestone_service_missing`).
 */
export const milestoneDoneV1Schema = z
  .object({
    milestone: hubDocumentIdSchema,
    client: hubValueRefSchema,
    project: hubContractRefSchema,
    currency: hubCurrencySchema,
    amount: positiveMinorSchema,
    done_on: hubDateSchema,
    service: hubValueRefSchema.optional(),
  })
  .meta({ id: 'MilestoneDoneV1' });

/** A done milestone reopened in Hub: the reversal of its done (S06 rule 13; ADR 0015). */
export const milestoneReopenedV1Schema = z
  .object({
    milestone: hubDocumentIdSchema,
    client: hubValueRefSchema,
    project: hubContractRefSchema,
    reopened_on: hubDateSchema,
  })
  .meta({ id: 'MilestoneReopenedV1' });

export const projectEndedV1Schema = z
  .object({
    project: hubContractRefSchema,
    client: hubValueRefSchema,
    on: hubDateSchema,
  })
  .meta({ id: 'ProjectEndedV1' });

/** A project expense's full state (`.recorded`, `.changed`; ADR 0006 "A `.changed` event"). */
export const projectExpenseV1Schema = z
  .object({
    expense: hubDocumentIdSchema,
    client: hubValueRefSchema,
    contract: hubContractRefSchema.optional(),
    department: hubValueRefSchema,
    spent_on: hubDateSchema,
    currency: hubCurrencySchema,
    amount: positiveMinorSchema,
    syp_per_usd: sypPerUsdSchema,
    description: z.string().trim().min(1).max(500),
    /** The date of the change, on `.changed` (rule 13). */
    changed_on: hubDateSchema.optional(),
  })
  .meta({ id: 'ProjectExpenseV1' });

export type ProjectExpenseV1 = z.infer<typeof projectExpenseV1Schema>;

export const projectExpenseArchivedV1Schema = z
  .object({ expense: hubDocumentIdSchema, archived_on: hubDateSchema })
  .meta({ id: 'ProjectExpenseArchivedV1' });

/**
 * A deposit or refund of a client's ad wallet. Hub credits the wallet by `usd_amount`; a USD
 * entry whose `usd_amount` differs from its amount is refused, since a gap in one currency is
 * never an exchange difference (rule 3; ADR 0007).
 */
export const adWalletEntryV1Schema = z
  .object({
    entry: hubDocumentIdSchema,
    client: hubValueRefSchema,
    entered_on: hubDateSchema,
    method: paymentMethodSchema,
    currency: hubCurrencySchema,
    amount: positiveMinorSchema,
    syp_per_usd: sypPerUsdSchema,
    usd_amount: positiveMinorSchema,
  })
  .superRefine((entry, context) => {
    if (entry.currency === 'USD' && entry.usd_amount !== entry.amount) {
      context.addIssue({
        code: 'custom',
        path: ['usd_amount'],
        message: 'A USD entry credits its own amount',
      });
    }
  })
  .meta({ id: 'AdWalletEntryV1' });

export type AdWalletEntryV1 = z.infer<typeof adWalletEntryV1Schema>;

export const adWalletEntryVoidedV1Schema = z
  .object({ entry: hubDocumentIdSchema, client: hubValueRefSchema, voided_on: hubDateSchema })
  .meta({ id: 'AdWalletEntryVoidedV1' });

/** A campaign update's spend for a period, in USD; wallet-funded campaigns only (ADR 0006). */
export const adSpendV1Schema = z
  .object({
    update: hubDocumentIdSchema,
    campaign: hubDocumentIdSchema,
    client: hubValueRefSchema,
    period_from: hubDateSchema,
    period_to: hubDateSchema,
    usd_spend: positiveMinorSchema,
    changed_on: hubDateSchema.optional(),
  })
  .superRefine((spend, context) => {
    if (spend.period_to < spend.period_from) {
      context.addIssue({ code: 'custom', path: ['period_to'], message: 'Ends before it starts' });
    }
  })
  .meta({ id: 'AdSpendV1' });

export type AdSpendV1 = z.infer<typeof adSpendV1Schema>;

export const adSpendArchivedV1Schema = z
  .object({
    update: hubDocumentIdSchema,
    campaign: hubDocumentIdSchema,
    client: hubValueRefSchema,
    archived_on: hubDateSchema,
  })
  .meta({ id: 'AdSpendArchivedV1' });

export const rateChangedV1Schema = z
  .object({ effective_on: hubDateSchema, syp_per_usd: sypPerUsdSchema })
  .meta({ id: 'RateChangedV1' });

export type RateChangedV1 = z.infer<typeof rateChangedV1Schema>;

/** Each event type of the catalogue with its version 1 payload (ADR 0006). */
export const EVENT_PAYLOADS_V1 = {
  'invoice.issued': invoiceIssuedV1Schema,
  'invoice.voided': invoiceVoidedV1Schema,
  'invoice.line_service_changed': invoiceLineServiceChangedV1Schema,
  'invoice.due_date_changed': invoiceDueDateChangedV1Schema,
  'payment.recorded': paymentRecordedV1Schema,
  'payment.voided': paymentVoidedV1Schema,
  'milestone.done': milestoneDoneV1Schema,
  'project.completed': projectEndedV1Schema,
  'project.cancelled': projectEndedV1Schema,
  'project_expense.recorded': projectExpenseV1Schema,
  'project_expense.changed': projectExpenseV1Schema,
  'project_expense.archived': projectExpenseArchivedV1Schema,
  'ad_wallet.deposited': adWalletEntryV1Schema,
  'ad_wallet.refunded': adWalletEntryV1Schema,
  'ad_wallet.entry_voided': adWalletEntryVoidedV1Schema,
  'ad_spend.recorded': adSpendV1Schema,
  'ad_spend.changed': adSpendV1Schema,
  'ad_spend.archived': adSpendArchivedV1Schema,
  'rate.changed': rateChangedV1Schema,
  'milestone.reopened': milestoneReopenedV1Schema,
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS_V1;

/** The event types, in the catalogue's order; appended, never renamed (ADR 0006). */
export const EVENT_TYPES = Object.keys(EVENT_PAYLOADS_V1) as [EventType, ...EventType[]];

export const eventTypeSchema = z.enum(EVENT_TYPES).meta({ id: 'EventType' });

type PayloadOf<T extends EventType> = z.infer<(typeof EVENT_PAYLOADS_V1)[T]>;

const envelopeFields = {
  /** Hub's event ID (UUIDv7), also the `Idempotency-Key` header (rule 1). */
  id: z.uuid(),
  occurred_at: z.iso.datetime({ offset: true }),
  /** The date the entries take (rule 13). */
  accounting_date: hubDateSchema,
};

function envelopeOf<T extends EventType>(type: T) {
  return z.object({
    ...envelopeFields,
    type: z.literal(type),
    version: z.literal(1),
    payload: EVENT_PAYLOADS_V1[type] as (typeof EVENT_PAYLOADS_V1)[T],
  });
}

/**
 * `POST /v1/events`: one event, its payload chosen by `type` and `version` (rule 1). An unknown
 * type or version fails with field errors (`422 VALIDATION_FAILED`).
 */
export const eventEnvelopeSchema = z
  .discriminatedUnion(
    'type',
    EVENT_TYPES.map((type) => envelopeOf(type)) as unknown as [
      ReturnType<typeof envelopeOf<EventType>>,
      ...ReturnType<typeof envelopeOf<EventType>>[],
    ],
  )
  .meta({ id: 'EventEnvelope' });

/** An event as received, its payload typed by its type. */
export type EventEnvelope = {
  [T in EventType]: {
    id: string;
    type: T;
    version: 1;
    occurred_at: string;
    accounting_date: string;
    payload: PayloadOf<T>;
  };
}[EventType];

export type EventOf<T extends EventType> = Extract<EventEnvelope, { type: T }>;

/** Parses an envelope with its payload's schema; throws Zod's error on any field. */
export function parseEventEnvelope(input: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(input) as EventEnvelope;
}

/** The document types a company assigns to a source (ADR 0001, ADR 0003; S05 "Data"). */
export const DOCUMENT_TYPES = [
  'invoice',
  'payment',
  'project_expense',
  'ad_wallet_entry',
  'ad_spend',
  'milestone',
  'project',
  'rate',
] as const;

export const documentTypeSchema = z.enum(DOCUMENT_TYPES).meta({ id: 'DocumentType' });

export type DocumentType = z.infer<typeof documentTypeSchema>;

/** The Hub document an event is about: the one a resolution or a dismissal marks (rule 16). */
export interface EventDocument {
  readonly type: DocumentType;
  /** Hub's id; a rate's is its effective date. */
  readonly id: string;
  readonly number: string | null;
}

/** The document of an event: the payment for `payment.*`, the invoice for `invoice.*` (rule 16). */
export function documentOf(event: EventEnvelope): EventDocument {
  const ref = (type: DocumentType, doc: HubDocumentId): EventDocument => ({
    type,
    id: doc.id,
    number: doc.number,
  });
  switch (event.type) {
    case 'invoice.issued':
    case 'invoice.voided':
    case 'invoice.line_service_changed':
    case 'invoice.due_date_changed':
      return ref('invoice', event.payload.invoice);
    case 'payment.recorded':
    case 'payment.voided':
      return ref('payment', event.payload.payment);
    case 'milestone.done':
    case 'milestone.reopened':
      return ref('milestone', event.payload.milestone);
    case 'project.completed':
    case 'project.cancelled':
      return { type: 'project', id: event.payload.project.external_id, number: null };
    case 'project_expense.recorded':
    case 'project_expense.changed':
    case 'project_expense.archived':
      return ref('project_expense', event.payload.expense);
    case 'ad_wallet.deposited':
    case 'ad_wallet.refunded':
    case 'ad_wallet.entry_voided':
      return ref('ad_wallet_entry', event.payload.entry);
    case 'ad_spend.recorded':
    case 'ad_spend.changed':
    case 'ad_spend.archived':
      return ref('ad_spend', event.payload.update);
    case 'rate.changed':
      return { type: 'rate', id: event.payload.effective_on, number: null };
  }
}

/**
 * The key that orders an item's events (rule 11): the invoice for invoice and payment events, the
 * client's ad funds for wallet and spend events, the document otherwise, none for a rate.
 */
export function itemKeyOf(event: EventEnvelope): string | null {
  switch (event.type) {
    case 'invoice.issued':
    case 'invoice.voided':
    case 'invoice.line_service_changed':
    case 'invoice.due_date_changed':
    case 'payment.recorded':
    case 'payment.voided':
      return `invoice:${event.payload.invoice.id}`;
    case 'ad_wallet.deposited':
    case 'ad_wallet.refunded':
    case 'ad_wallet.entry_voided':
    case 'ad_spend.recorded':
    case 'ad_spend.changed':
    case 'ad_spend.archived':
      return `ad_funds:${event.payload.client.external_id}`;
    case 'project_expense.recorded':
    case 'project_expense.changed':
    case 'project_expense.archived':
      return `project_expense:${event.payload.expense.id}`;
    case 'milestone.done':
    case 'milestone.reopened':
      return `milestone:${event.payload.milestone.id}`;
    case 'project.completed':
    case 'project.cancelled':
      return `project:${event.payload.project.external_id}`;
    case 'rate.changed':
      return null;
  }
}

/**
 * The further item keys an event takes part in besides its own (S06 rule 17), so it waits behind a
 * held event of any of them and frees them when it leaves held: an invoice with a deposit or
 * milestone line, `milestone:<id>` of each and `project:<id>` of its project; a milestone's done or
 * reopen, `project:<id>`; the void of such an invoice, `project:<id>`, read from its issue
 * (`issued`, the invoice's `invoice.issued` as received, or null when it has not arrived).
 */
export function orderKeysOf(event: EventEnvelope, issued: InvoiceIssuedV1 | null = null): string[] {
  const ofInvoice = (invoice: InvoiceIssuedV1, milestones: boolean): string[] => {
    const lines = invoice.lines.filter(
      (line) =>
        (line.source === 'deposit' || line.source === 'milestone') &&
        line.milestone_id !== undefined,
    );
    if (lines.length === 0) return [];
    const keys = milestones
      ? [...new Set(lines.map((line) => `milestone:${line.milestone_id as string}`))]
      : [];
    if (invoice.contract?.kind === 'project') keys.push(`project:${invoice.contract.external_id}`);
    return keys;
  };
  switch (event.type) {
    case 'invoice.issued':
      return ofInvoice(event.payload, true);
    case 'invoice.voided':
      return issued === null ? [] : ofInvoice(issued, false);
    case 'milestone.done':
    case 'milestone.reopened':
      return [`project:${event.payload.project.external_id}`];
    default:
      return [];
  }
}

/**
 * The payload's canonical form (RFC 8785): object keys sorted by UTF-16 code units, no
 * whitespace, strings and integers as JSON writes them. Its SHA-256 is the payload hash that
 * tells a replay from a conflict (rule 4). A payload holds no float (amounts are integers).
 */
export function canonicalPayload(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('A payload number is finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalPayload(item)}`).join(',')}}`;
  }
  throw new TypeError(`A payload holds no ${typeof value}`);
}

/** An event's state in the inbox (ADR 0014). */
export const EVENT_STATES = ['held', 'posted', 'recorded', 'resolved', 'dismissed'] as const;

export const eventStateSchema = z.enum(EVENT_STATES).meta({ id: 'EventState' });

export type EventState = z.infer<typeof eventStateSchema>;

/**
 * Why an event is held (ADR 0008, ADR 0014), append-only like the error codes and checked by the
 * same guard (`pnpm check:error-codes`). The order of checking is `HOLD_CHECK_ORDER` (rule 8).
 */
export const HOLD_REASONS = [
  'PERIOD_CLOSED',
  'SERVICE_PERIOD_CLOSED',
  'UNKNOWN_REFERENCE',
  'NO_MAPPING',
  'RATE_MISSING',
  'NEEDS_DECISION',
  'OPEN_ITEM_HAS_SETTLEMENTS',
  'WAITING_FOR_EARLIER_EVENT',
] as const;

export const holdReasonSchema = z.enum(HOLD_REASONS).meta({ id: 'HoldReason' });

export type HoldReason = z.infer<typeof holdReasonSchema>;

/** The order the reasons are checked in (rule 8; S06 rule 18: an elapsed month after the date). */
export const HOLD_CHECK_ORDER = [
  'WAITING_FOR_EARLIER_EVENT',
  'UNKNOWN_REFERENCE',
  'NO_MAPPING',
  'PERIOD_CLOSED',
  'SERVICE_PERIOD_CLOSED',
  'RATE_MISSING',
  'OPEN_ITEM_HAS_SETTLEMENTS',
  'NEEDS_DECISION',
] as const satisfies readonly HoldReason[];

/**
 * The details of a hold (rules 8–9): a fixed code, or `slot_unmapped:<slot>` and
 * `account_blocked:<code>` naming what to fix. Clients accept a detail they do not know.
 */
export const HOLD_DETAILS = [
  'deferred_revenue',
  'tax_lines',
  'payment_exceeds_open',
  'amount_above_applied',
  'payment_gap_beyond_tolerance',
  'wallet_gap_beyond_tolerance',
  'contract_client_mismatch',
  'dimension_value_archived',
  'document_resolved_manually',
  'invoice_currency_mismatch',
  // S06 rule 18: recognition's holds; `recognition_pattern_unclear:<line position>`.
  'recognition_pattern_unclear',
  'credit_cycle',
  'credit_cycle_voided',
  'credit_exceeds_cycle',
  'schedule_credited',
  'milestone_amount_differs',
  'milestone_already_done',
  'milestone_service_missing',
  'milestone_released_at_completion',
  'reissue_period_differs',
  'cancelled_project_remainder',
  'schedule_split_at_cancellation',
  'invoiced_after_cancellation',
  // A credit or a credit's void after a change of its cycle dated later (owner, 2026-11-11).
  'credit_after_later_change',
] as const;

export type HoldDetailCode = (typeof HOLD_DETAILS)[number];

export const holdDetailSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(:[A-Za-z0-9_.-]{1,60})?$/)
  .meta({ id: 'HoldDetail', description: 'What the hold waits for: a code, or code:<what>' });

/**
 * The slots a posting rule reads its accounts from (S05 "Mapping slots"), stored in the
 * `posting_slot` enum and never renamed. A payment method's slot has an account per currency.
 */
export const POSTING_SLOTS = [
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
  // S06 "Data": revenue recognition.
  'contract_liability',
  'contract_asset',
  'released_revenue',
  'cancelled_project_refund',
] as const;

export const postingSlotSchema = z.enum(POSTING_SLOTS).meta({ id: 'PostingSlot' });

export type PostingSlot = z.infer<typeof postingSlotSchema>;

/** Whether a slot holds one account per currency (the payment methods, SYP and USD). */
export function slotIsPerCurrency(slot: PostingSlot): boolean {
  return slot.startsWith('payment_method.');
}

/** The slot of a payment method. */
export function paymentMethodSlot(method: PaymentMethod): PostingSlot {
  return `payment_method.${method}`;
}

/** An entry an event posted, as `/v1` answers it. */
export const postedEntryRefSchema = z
  .object({ id: z.uuid(), fiscal_year: z.int(), number: z.int() })
  .meta({ id: 'PostedEntryRef' });

/**
 * The answer of `POST /v1/events` (rules 4–7, ADR 0014): `201` posted or recorded with the
 * entries, `202` held with its reason and detail. A replay answers the event's current state.
 */
export const eventOutcomeSchema = z
  .discriminatedUnion('status', [
    z.object({
      status: z.enum(['posted', 'recorded', 'resolved', 'dismissed']),
      inbox_id: z.uuid(),
      entries: z.array(postedEntryRefSchema),
    }),
    z.object({
      status: z.literal('held'),
      inbox_id: z.uuid(),
      reason: holdReasonSchema,
      detail: holdDetailSchema.nullable(),
    }),
  ])
  .meta({ id: 'EventOutcome' });

export type EventOutcome = z.infer<typeof eventOutcomeSchema>;

/** What the inbox records of an event, in order (`inbound_event_actions`). */
export const EVENT_ACTIONS = [
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
  // S06 rule 16: the accountant's recognition actions.
  'recognised_in_open_period',
  'remainder_split',
] as const;

export const eventActionSchema = z.enum(EVENT_ACTIONS).meta({ id: 'EventAction' });

export type EventAction = z.infer<typeof eventActionSchema>;

/** An account as a slot's check reads it (S05 "Mapping slots", `MAPPING_ACCOUNT_INVALID`). */
export interface SlotAccount {
  readonly kind: 'header' | 'postable';
  readonly class: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  readonly isControl: boolean;
  readonly itemKind: 'document' | 'running' | null;
  readonly currency: string | null;
  readonly isMonetary: boolean;
}

/**
 * Whether an account fits a slot (S05 "Mapping slots", "Must be"): the receivable a `document`
 * control asset; revenue postable; a payment method a monetary asset restricted to its currency;
 * the ad funds a `running` control liability restricted to USD; the payables liabilities and the
 * project cost an expense, all postable.
 */
export function slotAccountFits(
  slot: PostingSlot,
  currency: HubCurrency | null,
  account: SlotAccount,
): boolean {
  if (account.kind !== 'postable') return false;
  switch (slot) {
    case 'receivable':
      return account.class === 'asset' && account.isControl && account.itemKind === 'document';
    case 'revenue_at_issue':
    case 'termination_fee_revenue':
      return account.class === 'revenue' && !account.isControl;
    case 'payment_method.cash':
    case 'payment_method.bank_transfer':
    case 'payment_method.e_wallet':
      return (
        account.class === 'asset' &&
        account.isMonetary &&
        !account.isControl &&
        currency !== null &&
        account.currency === currency
      );
    case 'ad_funds':
      return (
        account.class === 'liability' &&
        account.isControl &&
        account.itemKind === 'running' &&
        account.currency === 'USD'
      );
    case 'ad_platforms_payable':
    case 'project_expense_awaiting_payment':
      return account.class === 'liability' && !account.isControl;
    case 'project_cost':
      return account.class === 'expense' && !account.isControl;
    // S06 "Data": a contract liability is non-monetary (IAS 21.16), a contract asset a monetary
    // `document` control account, the refund payable a monetary liability (IAS 21.23(a)).
    case 'contract_liability':
      return account.class === 'liability' && !account.isControl && !account.isMonetary;
    case 'contract_asset':
      return (
        account.class === 'asset' &&
        account.isControl &&
        account.itemKind === 'document' &&
        account.isMonetary
      );
    case 'released_revenue':
      return account.class === 'revenue' && !account.isControl;
    case 'cancelled_project_refund':
      return account.class === 'liability' && !account.isControl && account.isMonetary;
  }
}

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

/** At most this many months in one `GET /v1/periods/status` (S05 "Periods"). */
export const PERIOD_STATUS_MONTHS = 24;

/** `GET /v1/periods/status?from=YYYY-MM&to=YYYY-MM`: from on or before to, at most 24 months. */
export const periodStatusQuerySchema = z
  .object({ from: monthSchema, to: monthSchema })
  .refine((range) => monthIndex(range.from) <= monthIndex(range.to), {
    path: ['to'],
    message: 'The range ends before it starts',
  })
  .refine((range) => monthIndex(range.to) - monthIndex(range.from) < PERIOD_STATUS_MONTHS, {
    path: ['to'],
    message: `At most ${PERIOD_STATUS_MONTHS} months`,
  })
  .meta({ id: 'PeriodStatusQuery' });

export type PeriodStatusQuery = z.infer<typeof periodStatusQuerySchema>;

/** A month's state for Hub: a month with no period row yet is open (S05 "Periods"). */
export const periodStatusSchema = z
  .object({ period: monthSchema, state: z.enum(['open', 'closed']) })
  .meta({ id: 'PeriodStatus' });

export type PeriodStatus = z.infer<typeof periodStatusSchema>;

/** The months of a range in order, `YYYY-MM`. */
export function monthsOf(range: PeriodStatusQuery): string[] {
  const months: string[] = [];
  for (let index = monthIndex(range.from); index <= monthIndex(range.to); index += 1) {
    const year = Math.floor((index - 1) / 12);
    const month = index - year * 12;
    months.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}
