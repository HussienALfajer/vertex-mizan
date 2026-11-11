import type {
  InboxActionPreview,
  InboxEvent,
  OpenItem,
  RevenueMonth,
  RevenuePreview,
  RevenueSchedule,
  RevenueScheduleDetail,
} from '@vertex-mizan/contracts';
import { accountOf } from './chart-mocks';
import { hubClient, hubContract } from './dimension-mocks';
import { detailOf, inboxId } from './inbox-mocks';
import { receivablesReads } from './receivables-mocks';

/*
 * Synthetic answers of revenue recognition (S06), around the tests' today (2026-11-09), on the
 * spec's acceptance example: a retainer cycle of 900.00 USD from 15 November to 14 December
 * deferred at 121 (108,900.00 SYP), November's 16/30 to release (480.00 USD, 58,080.00 SYP); a
 * deposit of 300.00 USD deferred at 120; an older cycle wholly released; a cancelled project held
 * for the accountant's split; and a late invoice whose October part is in a closed month.
 */

const scheduleId = (n: number) => `01900000-0000-7000-800e-${String(n).padStart(12, '0')}`;
const movementId = (n: number) => `01900000-0000-7000-800f-${String(n).padStart(12, '0')}`;
const entryId = (n: number) => `01900000-0000-7000-8009-${String(n + 100).padStart(12, '0')}`;
const lineId = (n: number) => `01900000-0000-7000-9001-${String(n).padStart(12, '0')}`;

const client = { id: hubClient.id, code: null, name: hubClient.name };
const retainer = { id: hubContract.id, code: null, name: hubContract.name };
const project = { id: '01900000-0000-7000-8004-000000000005', code: null, name: 'مشروع تجريبي' };
const service = { id: '01900000-0000-7000-8004-000000000006', code: 'S-01', name: 'إدارة حسابات' };

const zero = { transactionMinor: '0', bookMinor: '0', parallelMinor: '0' };

const schedule = (
  n: number,
  fields: Partial<RevenueSchedule> &
    Pick<RevenueSchedule, 'invoiceNumber' | 'amountMinor' | 'released' | 'remaining'>,
): RevenueSchedule => ({
  id: scheduleId(n),
  inboxId: inboxId(20 + n),
  invoiceDocumentId: `01900000-0000-7000-9000-${String(200 + n).padStart(12, '0')}`,
  lineId: lineId(n),
  pattern: 'over_time',
  lineSource: 'retainer_charge',
  chargeKind: 'monthly',
  currency: 'USD',
  client,
  contract: retainer,
  service,
  serviceFrom: '2026-11-15',
  serviceTo: '2026-12-14',
  milestoneId: null,
  state: 'active',
  reissueOfId: null,
  createdAt: '2026-11-05T08:00:00.000Z',
  ...fields,
});

/** The acceptance's cycle: 900.00 USD at 121, nothing released yet. */
export const cycle = schedule(1, {
  invoiceNumber: 'INV-2026-101',
  amountMinor: '90000',
  released: zero,
  remaining: { transactionMinor: '90000', bookMinor: '10890000', parallelMinor: '90000' },
});

/** A deposit of 300.00 USD deferred at 120 to its milestone's done. */
export const deposit = schedule(2, {
  invoiceNumber: 'INV-2026-102',
  pattern: 'point_in_time',
  lineSource: 'deposit',
  chargeKind: null,
  contract: project,
  serviceFrom: null,
  serviceTo: null,
  milestoneId: '01900000-0000-7000-9002-000000000001',
  amountMinor: '30000',
  released: zero,
  remaining: { transactionMinor: '30000', bookMinor: '3600000', parallelMinor: '30000' },
});

/** An older cycle of 600.00 USD at 118, released in September and October. */
export const releasedCycle = schedule(3, {
  invoiceNumber: 'INV-2026-090',
  serviceFrom: '2026-09-15',
  serviceTo: '2026-10-14',
  amountMinor: '60000',
  state: 'completed',
  released: { transactionMinor: '60000', bookMinor: '7080000', parallelMinor: '60000' },
  remaining: zero,
  createdAt: '2026-09-15T08:00:00.000Z',
});

export const schedules = [cycle, deposit, releasedCycle];

/** The cycle's page: its deferral and its two months, neither released yet. */
export const cycleDetail: RevenueScheduleDetail = {
  ...cycle,
  movements: [
    {
      id: movementId(1),
      kind: 'deferred',
      month: null,
      entry: { id: entryId(1), date: '2026-11-05', fiscalYear: 2026, number: 31 },
      amounts: cycle.remaining,
      creditMinor: null,
      service: null,
      createdAt: cycle.createdAt,
    },
  ],
  months: [
    {
      month: '2026-11',
      days: 16,
      elapsed: false,
      part: { transactionMinor: '48000', bookMinor: '5808000', parallelMinor: '48000' },
      released: false,
    },
    {
      month: '2026-12',
      days: 14,
      elapsed: false,
      part: { transactionMinor: '42000', bookMinor: '5082000', parallelMinor: '42000' },
      released: false,
    },
  ],
};

/** The older cycle's page: deferred, then released over its two months. */
export const releasedDetail: RevenueScheduleDetail = {
  ...releasedCycle,
  movements: [
    {
      id: movementId(2),
      kind: 'deferred',
      month: null,
      entry: { id: entryId(2), date: '2026-09-15', fiscalYear: 2026, number: 11 },
      amounts: { transactionMinor: '60000', bookMinor: '7080000', parallelMinor: '60000' },
      creditMinor: null,
      service: null,
      createdAt: '2026-09-15T08:00:00.000Z',
    },
    {
      id: movementId(3),
      kind: 'released',
      month: '2026-09',
      entry: { id: entryId(3), date: '2026-09-30', fiscalYear: 2026, number: 15 },
      amounts: { transactionMinor: '-32000', bookMinor: '-3776000', parallelMinor: '-32000' },
      creditMinor: null,
      service: null,
      createdAt: '2026-10-01T22:00:00.000Z',
    },
    {
      id: movementId(4),
      kind: 'released',
      month: '2026-10',
      entry: { id: entryId(4), date: '2026-10-31', fiscalYear: 2026, number: 27 },
      amounts: { transactionMinor: '-28000', bookMinor: '-3304000', parallelMinor: '-28000' },
      creditMinor: null,
      service: null,
      createdAt: '2026-10-31T22:00:00.000Z',
    },
  ],
  months: [
    {
      month: '2026-09',
      days: 16,
      elapsed: false,
      part: { transactionMinor: '32000', bookMinor: '3776000', parallelMinor: '32000' },
      released: true,
    },
    {
      month: '2026-10',
      days: 14,
      elapsed: false,
      part: { transactionMinor: '28000', bookMinor: '3304000', parallelMinor: '28000' },
      released: true,
    },
  ],
};

/** The 24 months up to November 2026: September and October released, a release missing. */
export function revenueMonths(from: string, to: string): RevenueMonth[] {
  const months: RevenueMonth[] = [];
  let [year, month] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push({
      month: key,
      releasedBookMinor: key === '2026-09' ? '3776000' : key === '2026-10' ? '3304000' : '0',
      releasedParallelMinor: key === '2026-09' ? '32000' : key === '2026-10' ? '28000' : '0',
      entryCount: key === '2026-09' || key === '2026-10' ? 1 : 0,
      missing:
        key === '2026-10'
          ? [
              {
                scheduleId: scheduleId(4),
                invoiceNumber: 'INV-2026-095',
                reason: 'slot_unmapped:released_revenue',
              },
            ]
          : [],
      decisionCount: key === '2026-11' ? 2 : 0,
    });
    if (key === to) return months;
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
}

/** November's release of the cycle, posted on its last day. */
export const novemberPreview: RevenuePreview = {
  month: '2026-11',
  entries: [
    {
      inboxId: cycle.inboxId,
      invoiceNumber: cycle.invoiceNumber,
      date: '2026-11-30',
      lines: [
        {
          scheduleId: cycle.id,
          client,
          contract: retainer,
          service,
          amounts: { transactionMinor: '48000', bookMinor: '5808000', parallelMinor: '48000' },
        },
      ],
    },
  ],
};

const base = (
  n: number,
  type: InboxEvent['type'],
  fields: Partial<InboxEvent> & Pick<InboxEvent, 'reason' | 'documentType' | 'documentNumber'>,
): InboxEvent => ({
  id: inboxId(n),
  eventId: `01900000-0000-7000-a001-${String(n).padStart(12, '0')}`,
  type,
  version: 1,
  state: 'held',
  detail: null,
  documentId: `01900000-0000-7000-9000-${String(n + 100).padStart(12, '0')}`,
  clientName: hubClient.name,
  accountingDate: '2026-11-05',
  occurredAt: '2026-11-05T06:00:00.000Z',
  receivedAt: '2026-11-05T06:00:02.000Z',
  postedOn: null,
  waitingForId: null,
  attempts: 1,
  lastAttemptAt: '2026-11-05T06:00:02.000Z',
  entries: [],
  resolvedBy: null,
  ...fields,
});

/** A late invoice whose cycle started on 20 October, October closed. */
export const serviceClosed = base(11, 'invoice.issued', {
  reason: 'SERVICE_PERIOD_CLOSED',
  documentType: 'invoice',
  documentNumber: 'INV-2026-110',
});

/** A project cancelled on 5 November with its 300.00 USD deposit still deferred. */
export const cancelledProject = base(12, 'project.cancelled', {
  reason: 'NEEDS_DECISION',
  detail: 'cancelled_project_remainder',
  documentType: 'project',
  documentNumber: null,
});

const line = (
  code: string,
  currency: 'USD' | 'SYP',
  amount: string,
  book: string,
  parallel: string,
) => ({
  accountCode: code,
  accountName: accountOf(code).name,
  kind: 'measured' as const,
  amount: { amountMinor: amount, currency },
  bookMinor: book,
  parallelMinor: parallel,
});

/** October's part on 1 November at 119, then the invoice on 5 November at 120.5. */
export const recognisePreview: InboxActionPreview = {
  state: 'posted',
  reason: null,
  detail: null,
  entries: [
    {
      date: '2026-11-01',
      source: 'hub_event',
      servicePeriodOn: '2026-10-31',
      lines: [
        line('113001', 'USD', '24000', '2856000', '24000'),
        line('411001', 'USD', '-24000', '-2856000', '-24000'),
      ],
    },
    {
      date: '2026-11-05',
      source: 'hub_event',
      servicePeriodOn: null,
      lines: [
        line('112001', 'USD', '62000', '7471000', '62000'),
        line('113001', 'USD', '-24000', '-2856000', '-24000'),
        line('212001', 'USD', '-38000', '-4579000', '-38000'),
        { ...line('421001', 'SYP', '-36000', '-36000', '0'), kind: 'difference' as const },
      ],
    },
  ],
};

/** The split's entry: the deposit's liability at 120, revenue at its share, the refund at 120.5. */
export function splitPreview(revenueMinor: string): InboxActionPreview {
  const lines =
    revenueMinor === '10000'
      ? [
          line('212001', 'USD', '30000', '3600000', '30000'),
          line('411001', 'USD', '-10000', '-1200000', '-10000'),
          line('211003', 'USD', '-20000', '-2410000', '-20000'),
          { ...line('541001', 'SYP', '10000', '10000', '0'), kind: 'difference' as const },
        ]
      : [
          line('212001', 'USD', '30000', '3600000', '30000'),
          line('211003', 'USD', '-30000', '-3615000', '-30000'),
          { ...line('541001', 'SYP', '15000', '15000', '0'), kind: 'difference' as const },
        ];
  return {
    state: 'posted',
    reason: null,
    detail: null,
    entries: [{ date: '2026-11-05', source: 'hub_event', servicePeriodOn: null, lines }],
  };
}

/** A contract asset item: a milestone done before its invoice, 400.00 USD at 122. */
export const contractAssetItem: OpenItem = {
  id: '01900000-0000-7000-800c-000000000021',
  account: { id: accountOf('113001').id, code: '113001', name: accountOf('113001').name },
  kind: 'document',
  reference: 'MS-1',
  source: 'hub_event',
  client: { id: hubClient.id, code: null, name: hubClient.name },
  currency: 'USD',
  documentDate: '2026-11-01',
  dueOn: '2026-11-01',
  state: 'open',
  adjusted: false,
  amounts: { openMinor: '40000', bookMinor: '4880000', parallelMinor: '40000' },
  asOf: '2026-11-09',
  hubDocument: { type: 'milestone', id: '01900000-0000-7000-9002-000000000002', number: 'MS-1' },
  hubEventId: inboxId(13),
  openedByEntryId: entryId(5),
  bookCurrency: 'SYP',
  parallelCurrency: 'USD',
  movements: [],
  dueDates: [],
};

/** Every read of the revenue screens, with the receivables' and the inbox's. */
export const revenueReads = {
  ...receivablesReads,
  'GET /api/revenue/schedules': (request: { url(): string }) => {
    const params = new URL(request.url()).searchParams;
    const found = schedules.filter(
      (candidate) =>
        (!params.get('state') || candidate.state === params.get('state')) &&
        (!params.get('client') || candidate.client.id === params.get('client')) &&
        (!params.get('contract') || candidate.contract?.id === params.get('contract')),
    );
    return { status: 200, json: { schedules: found, nextCursor: null } };
  },
  [`GET /api/revenue/schedules/${cycle.id}`]: { status: 200, json: cycleDetail },
  [`GET /api/revenue/schedules/${releasedCycle.id}`]: { status: 200, json: releasedDetail },
  'GET /api/revenue/months': (request: { url(): string }) => {
    const params = new URL(request.url()).searchParams;
    return {
      status: 200,
      json: revenueMonths(params.get('from') ?? '2026-01', params.get('to') ?? '2026-11'),
    };
  },
  'GET /api/revenue/preview': { status: 200, json: novemberPreview },
  [`GET /api/inbox/${serviceClosed.id}`]: { status: 200, json: detailOf(serviceClosed) },
  [`GET /api/inbox/${cancelledProject.id}`]: { status: 200, json: detailOf(cancelledProject) },
  [`GET /api/inbox/${serviceClosed.id}/preview`]: { status: 200, json: recognisePreview },
  [`GET /api/inbox/${cancelledProject.id}/preview`]: (request: { url(): string }) => ({
    status: 200,
    json: splitPreview(new URL(request.url()).searchParams.get('revenueAmount') ?? '0'),
  }),
  [`GET /api/open-items/${contractAssetItem.id}`]: { status: 200, json: contractAssetItem },
};
