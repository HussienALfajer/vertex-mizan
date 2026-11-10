import {
  type Entry,
  type EventType,
  eventExamplesV1,
  type InboxAction,
  type InboxCounts,
  type InboxEvent,
  type InboxEventDetail,
  type InboxPage,
} from '@vertex-mizan/contracts';
import { hubClient } from './dimension-mocks';
import { journal, ownerRef, purchase } from './entry-mocks';

/*
 * Synthetic answers of the event inbox (S05), around the tests' today (2026-11-09): Hub's posted
 * invoice INV-2026-077 of the receivables mocks, held events of each kind the screens explain
 * (a missing rate, an overpayment for the accountant, a retainer invoice for S06, an unmapped
 * expense, a closed month, a payment waiting behind it), and a dismissed, a resolved and a
 * recorded event. Payloads come from the contract's examples, so they parse as Hub sends them.
 */

export const inboxId = (n: number) => `01900000-0000-7000-a000-${String(n).padStart(12, '0')}`;
const eventId = (n: number) => `01900000-0000-7000-a001-${String(n).padStart(12, '0')}`;
const actionId = (n: number, k: number) =>
  `01900000-0000-7000-a002-${String(n * 10 + k).padStart(12, '0')}`;

const payloads = new Map(eventExamplesV1('2026-11-05').map((event) => [event.type, event.payload]));
const payloadOf = (type: EventType): Record<string, unknown> => ({ ...payloads.get(type) });

/** The Hub entry of the posted invoice: entry 2026/21, linked back to its event. */
export const hubEntry: Entry = {
  ...purchase,
  id: '01900000-0000-7000-8009-000000000021',
  number: 21,
  sequence: '21',
  entryDate: '2026-09-20',
  source: 'hub_event',
  sourceRef: inboxId(1),
  hubDocument: {
    type: 'invoice',
    id: '01900000-0000-7000-9000-000000000077',
    number: 'INV-2026-077',
  },
  description: 'فاتورة INV-2026-077',
  reference: 'INV-2026-077',
  reverses: null,
  reversedBy: null,
  draftId: null,
  preparedBy: null,
  postedBy: null,
};

/** Entry 2026/14: the manual entry that resolved the overpayment (rule 15). */
const manualEntry = { id: '01900000-0000-7000-8009-000000000014', fiscalYear: 2026, number: 14 };

const base = (
  n: number,
  type: EventType,
  fields: Partial<InboxEvent> & Pick<InboxEvent, 'state' | 'documentType' | 'documentNumber'>,
): InboxEvent => ({
  id: inboxId(n),
  eventId: eventId(n),
  type,
  version: 1,
  reason: null,
  detail: null,
  documentId: `01900000-0000-7000-9000-${String(n + 100).padStart(12, '0')}`,
  clientName: hubClient.name,
  accountingDate: '2026-11-05',
  occurredAt: `2026-11-05T0${n % 10}:00:00.000Z`,
  receivedAt: `2026-11-05T0${n % 10}:00:02.000Z`,
  postedOn: null,
  waitingForId: null,
  attempts: 1,
  lastAttemptAt: `2026-11-05T0${n % 10}:00:02.000Z`,
  entries: [],
  resolvedBy: null,
  ...fields,
});

export const postedInvoice = base(1, 'invoice.issued', {
  state: 'posted',
  documentType: 'invoice',
  documentNumber: 'INV-2026-077',
  accountingDate: '2026-09-20',
  entries: [{ id: hubEntry.id, fiscalYear: 2026, number: 21 }],
});
export const rateMissing = base(2, 'payment.recorded', {
  state: 'held',
  reason: 'RATE_MISSING',
  documentType: 'payment',
  documentNumber: 'PAY-2026-031',
  attempts: 3,
});
export const overpayment = base(3, 'payment.recorded', {
  state: 'held',
  reason: 'NEEDS_DECISION',
  detail: 'amount_above_applied',
  documentType: 'payment',
  documentNumber: 'PAY-2026-032',
});
export const retainerInvoice = base(4, 'invoice.issued', {
  state: 'held',
  reason: 'NO_MAPPING',
  detail: 'deferred_revenue',
  documentType: 'invoice',
  documentNumber: 'INV-2026-078',
});
export const unmappedExpense = base(5, 'project_expense.recorded', {
  state: 'held',
  reason: 'NO_MAPPING',
  detail: 'slot_unmapped:project_cost',
  documentType: 'project_expense',
  documentNumber: 'EXP-2026-005',
});
export const closedMonth = base(6, 'invoice.issued', {
  state: 'held',
  reason: 'PERIOD_CLOSED',
  documentType: 'invoice',
  documentNumber: 'INV-2026-079',
  accountingDate: '2026-10-28',
});
export const waiting = base(7, 'payment.recorded', {
  state: 'held',
  reason: 'WAITING_FOR_EARLIER_EVENT',
  documentType: 'payment',
  documentNumber: 'PAY-2026-033',
  waitingForId: closedMonth.id,
});
export const dismissed = base(8, 'ad_wallet.deposited', {
  state: 'dismissed',
  documentType: 'ad_wallet_entry',
  documentNumber: 'WAL-2026-004',
});
export const resolved = base(9, 'payment.recorded', {
  state: 'resolved',
  documentType: 'payment',
  documentNumber: 'PAY-2026-020',
  resolvedBy: manualEntry,
});
export const recordedRate = base(10, 'rate.changed', {
  state: 'recorded',
  documentType: 'rate',
  documentNumber: null,
  clientName: null,
});

export const inboxEvents = [
  waiting,
  closedMonth,
  unmappedExpense,
  retainerInvoice,
  overpayment,
  rateMissing,
  recordedRate,
  resolved,
  dismissed,
  postedInvoice,
];

const held = inboxEvents.filter((event) => event.state === 'held');

export const inboxCounts: InboxCounts = {
  held: held.length,
  reasons: [...new Set(held.map((event) => event.reason))].map((reason) => ({
    reason: reason as NonNullable<InboxEvent['reason']>,
    count: held.filter((event) => event.reason === reason).length,
  })),
};

const action = (
  event: InboxEvent,
  k: number,
  fields: Partial<InboxAction> & Pick<InboxAction, 'action'>,
): InboxAction => ({
  id: actionId(Number(event.id.slice(-2)), k),
  reason: null,
  detail: null,
  entryIds: [],
  actor: { kind: 'api_client', id: '01900000-0000-7000-a003-000000000001', name: 'Vertex Hub' },
  note: null,
  createdAt: event.receivedAt,
  ...fields,
});

/** An event as `GET /api/inbox/:id` answers it, with its payload and history. */
export function detailOf(
  event: InboxEvent,
  extra: Partial<InboxEventDetail> = {},
): InboxEventDetail {
  return {
    ...event,
    payload: payloadOf(event.type as EventType),
    payloadHash: 'ab'.repeat(32),
    requestId: `req-${event.id.slice(-4)}`,
    moveOn: event.reason === 'PERIOD_CLOSED' ? '2026-11-01' : null,
    actions: [
      action(event, 1, { action: 'received' }),
      action(
        event,
        2,
        event.state === 'held'
          ? { action: 'held', reason: event.reason, detail: event.detail }
          : event.state === 'posted'
            ? { action: 'posted', entryIds: event.entries.map((entry) => entry.id) }
            : event.state === 'recorded'
              ? { action: 'recorded' }
              : { action: 'held', reason: 'NEEDS_DECISION', detail: 'amount_above_applied' },
      ),
      ...(event.state === 'resolved'
        ? [
            action(event, 3, {
              action: 'resolved',
              actor: { kind: 'person', id: ownerRef.id, name: ownerRef.name },
              entryIds: [manualEntry.id],
              note: 'سُجّلت الدفعة الزائدة أمانةً للعميل',
            }),
          ]
        : []),
      ...(event.state === 'dismissed'
        ? [
            action(event, 3, {
              action: 'dismissed',
              actor: { kind: 'person', id: ownerRef.id, name: ownerRef.name },
              note: 'إيداع تجريبي أُدخل خطأً في Hub',
            }),
          ]
        : []),
    ],
    ...extra,
  };
}

/** `GET /api/inbox` by its query: state, reason, type, document and accounting dates. */
export function inboxPageOf(url: URL): InboxPage {
  const params = url.searchParams;
  const events = inboxEvents.filter(
    (event) =>
      (!params.get('state') || event.state === params.get('state')) &&
      (!params.get('reason') || event.reason === params.get('reason')) &&
      (!params.get('type') || event.type === params.get('type')) &&
      (!params.get('document') || event.documentNumber === params.get('document')) &&
      (!params.get('from') || event.accountingDate >= (params.get('from') ?? '')) &&
      (!params.get('to') || event.accountingDate <= (params.get('to') ?? '')),
  );
  return { events, nextCursor: null };
}

/** The journal's posted manual entries, as the resolve dialog's picker finds them. */
const manualSummary = {
  ...journal[0],
  id: manualEntry.id,
  number: manualEntry.number,
  description: 'دفعة زائدة من عميل تجريبي',
  reference: 'PAY-2026-032',
  reversesEntryId: null,
  reversedByEntryId: null,
};

export const inboxReads = {
  'GET /api/inbox': (request: { url(): string }) => ({
    status: 200,
    json: inboxPageOf(new URL(request.url())),
  }),
  'GET /api/inbox/counts': { status: 200, json: inboxCounts },
  ...Object.fromEntries(
    inboxEvents.map((event) => [
      `GET /api/inbox/${event.id}`,
      { status: 200, json: detailOf(event) },
    ]),
  ),
  [`GET /api/entries/${hubEntry.id}`]: { status: 200, json: hubEntry },
  'GET /api/entries': (request: { url(): string }) => {
    const params = new URL(request.url()).searchParams;
    const text = params.get('text');
    const number = params.get('number');
    const entries = [manualSummary].filter(
      (entry) =>
        (!text || entry.description.includes(text)) && (!number || String(entry.number) === number),
    );
    return { status: 200, json: { entries, nextCursor: null } };
  },
};
