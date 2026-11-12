import type {
  ChecklistItem,
  Entry,
  PeriodDetail,
  PeriodEvent,
  PeriodSummary,
  PostedRevaluation,
  RevaluationBalance,
  RevaluationPreview,
} from '@vertex-mizan/contracts';
import { CHECKLIST_ITEMS } from '@vertex-mizan/contracts';
import { accountOf } from './chart-mocks';
import { hubClient } from './dimension-mocks';
import { accountantRef, ownerRef, purchase } from './entry-mocks';
import { receivablesReads } from './receivables-mocks';

/*
 * Synthetic answers of periods and the revaluation (S07), around the tests' today (2026-11-09):
 * September closed, October ended and open with its checklist failing, November not ended. October's
 * book revaluation is the acceptance's shape a month earlier: an item M-1 of 1,000.00 USD carried at
 * 120 (120,000.00 SYP) and revalued at the bulletin 125 (gain 5,000.00), and a blocked clearing
 * account of 100.00 USD at 120 (gain 500.00); its parallel ledger misses October's closing market
 * rate.
 */

const id = (group: string, n: number) =>
  `01900000-0000-7000-${group}-${String(n).padStart(12, '0')}`;

export const closedEvent: PeriodEvent = {
  id: id('8a01', 1),
  kind: 'closed',
  reason: 'إقفال أيلول بعد المراجعة',
  user: ownerRef,
  createdAt: '2026-10-05T09:00:00.000Z',
};

export const periodsList: PeriodSummary[] = [
  { period: '2026-09', state: 'closed', ended: true, lastEvent: closedEvent, failingItems: null },
  { period: '2026-10', state: 'open', ended: true, lastEvent: null, failingItems: 3 },
  { period: '2026-11', state: 'open', ended: false, lastEvent: null, failingItems: null },
];

/** The list once October is closed: the latest closed month, which may be reopened. */
export const octoberClosedList: PeriodSummary[] = periodsList.map((month) =>
  month.period === '2026-10' ? { ...month, state: 'closed', failingItems: null } : month,
);

const item = (name: ChecklistItem['item'], fields: Partial<ChecklistItem> = {}): ChecklistItem => ({
  item: name,
  result: 'passed',
  count: 0,
  ledgers: [],
  ...fields,
});

/** October's checklist: a draft dated in it, two held events and the book revaluation to post. */
export const failingChecklist: ChecklistItem[] = CHECKLIST_ITEMS.map((name) =>
  name === 'no_drafts'
    ? item(name, { result: 'failed', count: 1 })
    : name === 'no_held_events'
      ? item(name, { result: 'failed', count: 2 })
      : name === 'revaluation_current'
        ? item(name, { result: 'failed', count: 1, ledgers: ['book'] })
        : name === 'releases_posted'
          ? item(name, { result: 'not_applicable' })
          : item(name),
);

export const passingChecklist: ChecklistItem[] = CHECKLIST_ITEMS.map((name) =>
  name === 'releases_posted' ? item(name, { result: 'not_applicable' }) : item(name),
);

export const october: PeriodDetail = {
  period: '2026-10',
  state: 'open',
  ended: true,
  firstPeriod: '2026-09',
  history: [],
  checklist: failingChecklist,
};

export const passingOctober: PeriodDetail = { ...october, checklist: passingChecklist };

export const closedOctober: PeriodDetail = {
  ...passingOctober,
  state: 'closed',
  history: [
    {
      id: id('8a01', 2),
      kind: 'closed',
      reason: 'إقفال تشرين الأول',
      user: ownerRef,
      createdAt: '2026-11-09T06:30:00.000Z',
    },
  ],
};

export const reopenedOctober: PeriodDetail = {
  ...closedOctober,
  state: 'reopened',
  history: [
    ...closedOctober.history,
    {
      id: id('8a01', 3),
      kind: 'reopened',
      reason: 'دفعة متأخرة من عميل',
      user: accountantRef,
      createdAt: '2026-11-09T07:00:00.000Z',
    },
  ],
};

export const september: PeriodDetail = {
  period: '2026-09',
  state: 'closed',
  ended: true,
  firstPeriod: '2026-09',
  history: [closedEvent],
  checklist: passingChecklist,
};

export const november: PeriodDetail = {
  period: '2026-11',
  state: 'open',
  ended: false,
  firstPeriod: '2026-09',
  history: [],
  checklist: passingChecklist,
};

const receivable = accountOf('112001');
const clearing = accountOf('211002');
const sypBank = accountOf('111003');

const bulletinRow = {
  rateId: id('8a02', 1),
  base: 'USD',
  quote: 'SYP',
  rate: '125.0000',
  effectiveOn: '2026-10-29',
} as const;

const itemBalance: RevaluationBalance = {
  accountId: receivable.id,
  accountCode: receivable.code,
  accountName: receivable.name,
  blocked: false,
  item: { id: id('8a03', 1), reference: 'M-1' },
  values: [
    { typeCode: 'client', id: hubClient.id, code: null, name: hubClient.name, archived: false },
  ],
  currency: 'USD',
  transactionMinor: '100000',
  carryingMinor: '12000000',
  targetMinor: '12500000',
  revaluedMinor: '0',
  differenceMinor: '500000',
};

const clearingBalance: RevaluationBalance = {
  accountId: clearing.id,
  accountCode: clearing.code,
  accountName: clearing.name,
  blocked: true,
  item: null,
  values: [],
  currency: 'USD',
  transactionMinor: '10000',
  carryingMinor: '1200000',
  targetMinor: '1250000',
  revaluedMinor: '0',
  differenceMinor: '50000',
};

const fingerprint = (c: string) => c.repeat(64);

export const bookPreview: RevaluationPreview = {
  period: '2026-10',
  ledger: 'book',
  ledgerCurrency: 'SYP',
  lastDay: '2026-10-31',
  ended: true,
  state: 'to_post',
  fingerprint: fingerprint('a'),
  closingRates: [{ currency: 'USD', rateType: 'bulletin', rows: [bulletinRow] }],
  missingRates: [],
  balances: [itemBalance, clearingBalance],
  gainMinor: '550000',
  lossMinor: '0',
  posted: [],
};

export const revaluationEntryId = id('8a04', 1);
export const revaluationReversalId = id('8a04', 2);

export const postedRevaluation: PostedRevaluation = {
  id: id('8a05', 1),
  period: '2026-10',
  ledger: 'book',
  adjusting: false,
  fingerprint: fingerprint('a'),
  entry: { id: revaluationEntryId, date: '2026-10-31', fiscalYear: 2026, number: 40 },
  reversal: { id: revaluationReversalId, date: '2026-11-01', fiscalYear: 2026, number: 41 },
  userId: ownerRef.id,
  createdAt: '2026-11-09T06:00:00.000Z',
};

/** The book after its posting: every difference zero, current. */
export const currentBookPreview: RevaluationPreview = {
  ...bookPreview,
  state: 'current',
  fingerprint: fingerprint('b'),
  balances: [
    { ...itemBalance, revaluedMinor: '500000', differenceMinor: '0' },
    { ...clearingBalance, revaluedMinor: '50000', differenceMinor: '0' },
  ],
  gainMinor: '0',
  posted: [postedRevaluation],
};

/** The book after a back-dated receipt: stale, with an adjustment to post. */
export const staleBookPreview: RevaluationPreview = {
  ...currentBookPreview,
  state: 'to_post',
  fingerprint: fingerprint('c'),
  balances: [
    {
      ...itemBalance,
      transactionMinor: '90000',
      carryingMinor: '10800000',
      targetMinor: '11250000',
      revaluedMinor: '500000',
      differenceMinor: '-50000',
    },
    { ...clearingBalance, revaluedMinor: '50000', differenceMinor: '0' },
  ],
  gainMinor: '0',
  lossMinor: '50000',
};

/** The parallel ledger: October's closing market rate is missing. */
export const parallelPreview: RevaluationPreview = {
  period: '2026-10',
  ledger: 'parallel',
  ledgerCurrency: 'USD',
  lastDay: '2026-10-31',
  ended: true,
  state: 'rate_missing',
  fingerprint: fingerprint('d'),
  closingRates: [],
  missingRates: [{ currency: 'SYP', to: 'USD', rateType: 'market', on: '2026-10-31' }],
  balances: [
    {
      accountId: sypBank.id,
      accountCode: sypBank.code,
      accountName: sypBank.name,
      blocked: false,
      item: null,
      values: [],
      currency: 'SYP',
      transactionMinor: '125000000',
      carryingMinor: '1000000',
      targetMinor: null,
      revaluedMinor: '0',
      differenceMinor: null,
    },
  ],
  gainMinor: '0',
  lossMinor: '0',
  posted: [],
};

/** November: not ended, nothing to revalue yet. */
export const novemberPreview: RevaluationPreview = {
  ...bookPreview,
  period: '2026-11',
  lastDay: '2026-11-30',
  ended: false,
  state: 'current',
  fingerprint: fingerprint('e'),
  closingRates: [],
  balances: [],
  gainMinor: '0',
};

/** October's book revaluation entry, dated on the last day: the item's line and the gain. */
export const revaluationEntry: Entry = {
  ...purchase,
  id: revaluationEntryId,
  number: 40,
  sequence: '40',
  entryDate: '2026-10-31',
  postedAt: '2026-11-09T06:00:00.000Z',
  source: 'revaluation',
  description: 'إعادة تقييم آخر الشهر 2026-10 — الدفتر الأساسي',
  reference: null,
  draftId: null,
  preparedBy: null,
  postedBy: ownerRef,
  reversedBy: { id: revaluationReversalId, fiscalYear: 2026, number: 41 },
  attachments: [],
  lines: [
    {
      lineNo: 1,
      accountId: receivable.id,
      accountCode: receivable.code,
      accountName: receivable.name,
      dimensionValueIds: [hubClient.id],
      kind: 'difference',
      ledger: 'book',
      currency: 'USD',
      amountMinor: '0',
      bookMinor: '500000',
      parallelMinor: '0',
      memo: null,
      conversions: [],
      item: null,
    },
    {
      lineNo: 2,
      accountId: accountOf('421002').id,
      accountCode: '421002',
      accountName: accountOf('421002').name,
      dimensionValueIds: [],
      kind: 'difference',
      ledger: 'book',
      currency: 'SYP',
      amountMinor: '-500000',
      bookMinor: '-500000',
      parallelMinor: '0',
      memo: null,
      conversions: [],
      item: null,
    },
  ],
};

/** Every read of the period screens, with the entries' and the receivables'. */
export const periodsReads = {
  ...receivablesReads,
  'GET /api/periods': { status: 200, json: periodsList },
  'GET /api/periods/2026-09': { status: 200, json: september },
  'GET /api/periods/2026-10': { status: 200, json: october },
  'GET /api/periods/2026-11': { status: 200, json: november },
  'GET /api/revaluation/2026-10': (request: { url(): string }) => ({
    status: 200,
    json:
      new URL(request.url()).searchParams.get('ledger') === 'parallel'
        ? parallelPreview
        : bookPreview,
  }),
  'GET /api/revaluation/2026-11': { status: 200, json: novemberPreview },
  [`GET /api/entries/${revaluationEntryId}`]: { status: 200, json: revaluationEntry },
};
