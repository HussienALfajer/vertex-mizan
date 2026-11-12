import type {
  ReconciliationClient,
  ReconciliationClientDay,
  ReconciliationClientDayDetail,
  ReconciliationDay,
  ReconciliationDayState,
  ReconciliationMonth,
} from '@vertex-mizan/contracts';
import { periodsReads } from './periods-mocks';

/*
 * Synthetic answers of the daily reconciliation (S08), around the tests' today (2026-11-09): the
 * client "Vertex Hub" reconciles from 2026-11-01. The 1st to 3rd are matched (the 3rd as the
 * acceptance's step 1), the 4th misses an invoice in Mizan (step 2), the 5th has no report (step
 * 3), the 6th is matched with an annotation of each kind, the 7th differs in amount (step 4), the
 * 8th awaits its report until 08:00 today, and the rest of the month is awaited too. October is
 * before the start date.
 */

const id = (group: string, n: number) =>
  `01900000-0000-7000-${group}-${String(n).padStart(12, '0')}`;

export const vertexHub: ReconciliationClient = {
  id: id('8c01', 1),
  name: 'Vertex Hub',
  reconcileFrom: '2026-11-01',
  archivedAt: null,
};

/** A second client, for the client filter (edge case 9). */
export const secondHub: ReconciliationClient = {
  id: id('8c01', 2),
  name: 'Vertex Hub 2',
  reconcileFrom: '2026-11-05',
  archivedAt: null,
};

const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;

const clientDay = (
  state: ReconciliationDayState,
  fields: Partial<ReconciliationClientDay> = {},
): ReconciliationClientDay => ({
  clientId: vertexHub.id,
  state,
  hubCount: state === 'missing' || state === 'pending' ? null : 0,
  receivedCount: 0,
  postedCount: 0,
  gaps: 0,
  annotations: 0,
  ...fields,
});

const novemberDays: ReconciliationClientDay[] = [
  clientDay('matched'),
  clientDay('matched'),
  clientDay('matched', { hubCount: 3, receivedCount: 3, postedCount: 3 }),
  clientDay('differences', { hubCount: 1, gaps: 1 }),
  clientDay('missing', { receivedCount: 1, postedCount: 1 }),
  clientDay('matched', { hubCount: 4, receivedCount: 4, postedCount: 1, annotations: 4 }),
  clientDay('differences', { hubCount: 1, receivedCount: 1, postedCount: 1, gaps: 1 }),
  ...Array.from({ length: 23 }, () => clientDay('pending')),
];

export const november: ReconciliationMonth = {
  month: '2026-11',
  closed: false,
  clients: [vertexHub],
  days: novemberDays.map((client, index) => ({
    date: day(index + 1),
    state: client.state,
    clients: [client],
  })),
  matchedStreak: 0,
};

/** November with the second client too: each day is the worse of the two (rule 10). */
export const novemberTwoClients: ReconciliationMonth = {
  ...november,
  clients: [vertexHub, secondHub],
  days: november.days.map((month, index) => {
    const second: ReconciliationClientDay = {
      ...clientDay(index + 1 < 5 ? 'not_required' : 'pending'),
      clientId: secondHub.id,
      hubCount: null,
    };
    return { ...month, clients: [...month.clients, second] };
  }),
};

/** November once closed: its unclean days are marked "بعد الإقفال" (rule 15). */
export const novemberClosed: ReconciliationMonth = { ...november, closed: true };

/** October: before the start date, nothing to reconcile. */
export const october: ReconciliationMonth = {
  month: '2026-10',
  closed: false,
  clients: [vertexHub],
  days: Array.from({ length: 31 }, (_, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    state: 'not_required' as const,
    clients: [clientDay('not_required', { hubCount: null })],
  })),
  matchedStreak: 0,
};

/** A company without a client that reports. */
export const noClients: ReconciliationMonth = {
  month: '2026-11',
  closed: false,
  clients: [],
  days: november.days.map((month) => ({ ...month, state: 'not_required', clients: [] })),
  matchedStreak: 0,
};

const report = (n: number, generatedAt: string, eventCount: number, latest: boolean) => ({
  reportId: id('8c02', n),
  generatedAt,
  receivedAt: generatedAt.replace(':00.000Z', ':05.000Z'),
  eventCount,
  latest,
});

const detail = (
  fields: Partial<ReconciliationClientDayDetail> & Pick<ReconciliationClientDayDetail, 'state'>,
): ReconciliationClientDayDetail => ({
  client: vertexHub,
  totals: [],
  differences: [],
  annotations: [],
  reports: [],
  ...fields,
});

const dayOf = (date: string, client: ReconciliationClientDayDetail): ReconciliationDay => ({
  date,
  state: client.state,
  closed: false,
  clients: [client],
});

const invoiceTotal = {
  type: 'invoice.issued' as const,
  currency: 'USD' as const,
  posted: 0,
  recorded: 0,
  held: 0,
  resolved: 0,
  dismissed: 0,
};

/** The 3rd: Hub's examples, every one received and posted (acceptance step 1). */
export const matchedDay = dayOf(
  day(3),
  detail({
    state: 'matched',
    totals: [
      {
        ...invoiceTotal,
        hubCount: 1,
        hubAmountMinor: '120000',
        receivedCount: 1,
        receivedAmountMinor: '120000',
        posted: 1,
      },
      {
        ...invoiceTotal,
        type: 'payment.recorded',
        currency: 'SYP',
        hubCount: 1,
        hubAmountMinor: '1500000',
        receivedCount: 1,
        receivedAmountMinor: '1500000',
        posted: 1,
      },
      {
        ...invoiceTotal,
        type: 'project.completed',
        currency: null,
        hubCount: 1,
        hubAmountMinor: null,
        receivedCount: 1,
        receivedAmountMinor: null,
        recorded: 1,
      },
    ],
    reports: [report(1, '2026-11-04T06:00:00.000Z', 3, true)],
  }),
);

export const missingEventId = id('8c03', 1);

/** The 4th: an invoice Hub reported that Mizan never received (acceptance step 2). */
export const differencesDay = dayOf(
  day(4),
  detail({
    state: 'differences',
    totals: [
      {
        ...invoiceTotal,
        hubCount: 1,
        hubAmountMinor: '40000',
        receivedCount: 0,
        receivedAmountMinor: '0',
      },
    ],
    differences: [
      {
        kind: 'missing_in_mizan',
        eventId: missingEventId,
        hub: {
          type: 'invoice.issued',
          accountingDate: day(4),
          amount: { currency: 'USD', amountMinor: '40000' },
          delivery: 'refused',
          refusalCode: 'VALIDATION_FAILED',
        },
        mizan: null,
      },
    ],
    reports: [
      report(2, '2026-11-05T06:00:00.000Z', 1, true),
      report(3, '2026-11-04T21:00:00.000Z', 0, false),
    ],
  }),
);

export const amountInboxId = id('8c04', 1);

/** The 7th: a lower amount in Hub's report than Mizan received (acceptance step 4). */
export const amountDay = dayOf(
  day(7),
  detail({
    state: 'differences',
    totals: [
      {
        ...invoiceTotal,
        hubCount: 1,
        hubAmountMinor: '35000',
        receivedCount: 1,
        receivedAmountMinor: '40000',
        posted: 1,
      },
    ],
    differences: [
      {
        kind: 'amount_differs',
        eventId: id('8c03', 2),
        hub: {
          type: 'invoice.issued',
          accountingDate: day(7),
          amount: { currency: 'USD', amountMinor: '35000' },
          delivery: 'delivered',
          refusalCode: null,
        },
        mizan: {
          type: 'invoice.issued',
          accountingDate: day(7),
          amount: { currency: 'USD', amountMinor: '40000' },
          state: 'posted',
          holdReason: null,
          inboxId: amountInboxId,
        },
      },
    ],
    reports: [report(4, '2026-11-08T06:00:00.000Z', 1, true)],
  }),
);

/** The 5th: no report, past 08:00 of the 6th (acceptance step 3). */
export const missingDay = dayOf(day(5), detail({ state: 'missing' }));

export const heldInboxId = id('8c04', 2);
export const resolvedEntryId = id('8c05', 1);
export const adjustedItemId = id('8c06', 1);

/** The 6th: matched, each event explained by a decision in Mizan (rule 9). */
export const annotatedDay = dayOf(
  day(6),
  detail({
    state: 'matched',
    totals: [
      {
        ...invoiceTotal,
        hubCount: 3,
        hubAmountMinor: '90000',
        receivedCount: 3,
        receivedAmountMinor: '90000',
        held: 1,
        resolved: 1,
        dismissed: 1,
      },
      {
        ...invoiceTotal,
        // A retainer credit: an invoice with a negative amount (edge case 7).
        currency: 'SYP',
        hubCount: 1,
        hubAmountMinor: '-2500',
        receivedCount: 1,
        receivedAmountMinor: '-2500',
        posted: 1,
      },
    ],
    annotations: [
      {
        kind: 'held',
        eventId: id('8c03', 3),
        inboxId: heldInboxId,
        type: 'invoice.issued',
        holdReason: 'RATE_MISSING',
        reason: null,
        entry: null,
        openItemId: null,
      },
      {
        kind: 'resolved',
        eventId: id('8c03', 4),
        inboxId: id('8c04', 3),
        type: 'invoice.issued',
        holdReason: null,
        reason: null,
        entry: { id: resolvedEntryId, number: { fiscalYear: 2026, number: 31 } },
        openItemId: null,
      },
      {
        kind: 'dismissed',
        eventId: id('8c03', 5),
        inboxId: id('8c04', 4),
        type: 'invoice.issued',
        holdReason: null,
        reason: 'فاتورة مكررة في Hub (مثال)',
        entry: null,
        openItemId: null,
      },
      {
        kind: 'adjusted',
        eventId: null,
        inboxId: null,
        type: null,
        holdReason: null,
        reason: null,
        entry: { id: id('8c05', 2), number: { fiscalYear: 2026, number: 32 } },
        openItemId: adjustedItemId,
      },
    ],
    reports: [report(5, '2026-11-07T06:00:00.000Z', 4, true)],
  }),
);

/** The 8th: awaited until 08:00 today. */
export const pendingDay = dayOf(day(8), detail({ state: 'pending' }));

export const reconciliationReads = {
  ...periodsReads,
  'GET /api/reconciliation/days': (request: { url(): string }) => ({
    status: 200,
    json: new URL(request.url()).searchParams.get('month') === '2026-10' ? october : november,
  }),
  [`GET /api/reconciliation/days/${day(3)}`]: { status: 200, json: matchedDay },
  [`GET /api/reconciliation/days/${day(4)}`]: { status: 200, json: differencesDay },
  [`GET /api/reconciliation/days/${day(5)}`]: { status: 200, json: missingDay },
  [`GET /api/reconciliation/days/${day(6)}`]: { status: 200, json: annotatedDay },
  [`GET /api/reconciliation/days/${day(7)}`]: { status: 200, json: amountDay },
  [`GET /api/reconciliation/days/${day(8)}`]: { status: 200, json: pendingDay },
};
