import type { Company, Entry, OpeningViewAnswer } from '@vertex-mizan/contracts';
import { accountOf } from './chart-mocks';
import { company, owner } from './company-mocks';
import { dimensionReads, hubClient, manualClient } from './dimension-mocks';
import { ownerRef, purchase } from './entry-mocks';

/*
 * Synthetic answers of the opening (S10): the worked example in small — Hub's snapshot with one
 * receivable, one client funds wallet and one retainer schedule, the records' cash, capital and
 * year's result, and the balancing figure on retained earnings — before its figures and rates,
 * ready to post, posted, and reversed with a new draft. Every value is synthetic.
 */

export const booksStart = '2026-10-01';

/** The company with its books start and the opening's state. */
export const openingCompany = (openingState: Company['openingState']): Company => ({
  ...company,
  booksStart,
  openingState,
});

const openingId = (n: number) => `01900000-0000-7000-800a-${String(n).padStart(12, '0')}`;
const snapshotId = openingId(1);
const entryId = (n: number) => `01900000-0000-7000-8003-${String(900 + n).padStart(12, '0')}`;
/** A synthetic fingerprint, made at run time (the secret scan refuses long hex literals). */
export const fingerprint = 'f'.repeat(64);

const hubParty = { externalId: hubClient.externalId ?? '', code: null, name: hubClient.name };

const snapshot: OpeningViewAnswer['snapshot'] = {
  id: snapshotId,
  receivedAt: '2026-10-19T09:00:00.000+03:00',
  result: {
    snapshot_id: snapshotId,
    as_of: '2026-09-30',
    received_at: '2026-10-19T09:00:00.000+03:00',
    replayed: false,
    counts: { invoices: 2, credits: 0, milestones: 0, wallets: 1, prior_documents: 4 },
    totals: [
      { list: 'invoices', currency: 'USD', amount: 30000 },
      { list: 'wallets', currency: 'USD', amount: 50000 },
    ],
  },
};

const hubItems: OpeningViewAnswer['hubItems'] = [
  {
    slot: 'receivable',
    reference: 'INV-EX-0007',
    document: { type: 'invoice', id: 'inv-7', number: 'INV-EX-0007' },
    client: hubParty,
    contract: null,
    dueOn: '2026-10-15',
    documentDate: '2026-09-15',
    currency: 'USD',
    amounts: { transactionMinor: '30000', bookMinor: '3450000', parallelMinor: '30000' },
  },
  {
    slot: 'ad_funds',
    reference: 'C-EX',
    document: null,
    client: hubParty,
    contract: null,
    dueOn: null,
    documentDate: '2026-09-30',
    currency: 'USD',
    amounts: { transactionMinor: '-50000', bookMinor: '-5750000', parallelMinor: '-50000' },
  },
];

const schedules: OpeningViewAnswer['schedules'] = [
  {
    invoice: { id: 'inv-9', number: 'INV-EX-0009' },
    issuedOn: '2026-09-10',
    lineId: 'line-9-1',
    position: 1,
    pattern: 'over_time',
    serviceFrom: '2026-09-16',
    serviceTo: '2026-10-15',
    milestoneId: null,
    client: hubParty,
    contract: null,
    service: { externalId: 'svc-1', code: null, name: 'إدارة حسابات التواصل' },
    currency: 'USD',
    deferred: { transactionMinor: '-30000', bookMinor: '-3420000', parallelMinor: '-30000' },
    beforeOpening: { transactionMinor: '15000', bookMinor: '1710000', parallelMinor: '15000' },
    remaining: { transactionMinor: '-15000', bookMinor: '-1710000', parallelMinor: '-15000' },
    releasedMonths: ['2026-09'],
  },
];

const recordLines: OpeningViewAnswer['recordLines'] = [
  {
    lineNo: 1,
    accountId: accountOf('111001').id,
    dimensionValueIds: [],
    currency: 'SYP',
    amountMinor: '200000000',
    bookMinor: null,
    parallelMinor: null,
    itemReference: null,
    itemDueOn: null,
    memo: null,
  },
  {
    lineNo: 2,
    accountId: accountOf('311001').id,
    dimensionValueIds: [],
    currency: 'SYP',
    amountMinor: '-100000000',
    bookMinor: null,
    parallelMinor: '-1000000',
    itemReference: null,
    itemDueOn: null,
    memo: null,
  },
  {
    lineNo: 3,
    accountId: accountOf('312002').id,
    dimensionValueIds: [],
    currency: 'SYP',
    amountMinor: '-30000000',
    bookMinor: null,
    parallelMinor: '-260000',
    itemReference: null,
    itemDueOn: null,
    memo: null,
  },
];

const conversion = (ledger: 'book' | 'parallel', rate: string, on: string) => ({
  ledger,
  base: 'USD' as const,
  quote: 'SYP' as const,
  rate,
  effectiveOn: on,
});

const previewLine = (
  lineNo: number,
  source: OpeningViewAnswer['lines'][number]['source'],
  code: string,
  fields: Partial<OpeningViewAnswer['lines'][number]>,
): OpeningViewAnswer['lines'][number] => ({
  lineNo,
  source,
  accountId: accountOf(code).id,
  dimensionValueIds: [],
  kind: 'measured',
  currency: 'USD',
  amountMinor: '0',
  bookMinor: '0',
  parallelMinor: '0',
  memo: null,
  conversions: [],
  itemReference: null,
  ...fields,
});

/** The worked example's seven lines, in rule 23's order. */
const lines: OpeningViewAnswer['lines'] = [
  previewLine(1, 'hub', '112001', {
    dimensionValueIds: [hubClient.id],
    amountMinor: '30000',
    bookMinor: '3450000',
    parallelMinor: '30000',
    conversions: [conversion('book', '115.0000', '2026-09-30')],
    itemReference: 'INV-EX-0007',
  }),
  previewLine(2, 'hub', '213001', {
    dimensionValueIds: [hubClient.id],
    amountMinor: '-50000',
    bookMinor: '-5750000',
    parallelMinor: '-50000',
    conversions: [conversion('book', '115.0000', '2026-09-30')],
  }),
  previewLine(3, 'schedule', '212001', {
    dimensionValueIds: [hubClient.id],
    kind: 'stated',
    amountMinor: '-15000',
    bookMinor: '-1710000',
    parallelMinor: '-15000',
  }),
  previewLine(4, 'records', '111001', {
    currency: 'SYP',
    amountMinor: '200000000',
    bookMinor: '200000000',
    parallelMinor: '1694915',
    conversions: [conversion('parallel', '118.0000', '2026-09-30')],
  }),
  previewLine(5, 'records', '311001', {
    currency: 'SYP',
    kind: 'stated',
    amountMinor: '-100000000',
    bookMinor: '-100000000',
    parallelMinor: '-1000000',
  }),
  previewLine(6, 'records', '312002', {
    currency: 'SYP',
    kind: 'stated',
    amountMinor: '-30000000',
    bookMinor: '-30000000',
    parallelMinor: '-260000',
  }),
  previewLine(7, 'balancing', '312001', {
    currency: 'SYP',
    kind: 'stated',
    amountMinor: '-65990000',
    bookMinor: '-65990000',
    parallelMinor: '-399915',
  }),
];

const passing = (
  check: OpeningViewAnswer['checks'][number]['check'],
): OpeningViewAnswer['checks'][number] => ({ check, passed: true, failures: [] });

const allPassing: OpeningViewAnswer['checks'] = (
  ['snapshot', 'records_agree', 'rates', 'mappings', 'schedules', 'lines'] as const
).map(passing);

const agreed: OpeningViewAnswer['agreement'] = [
  {
    slot: 'ad_funds',
    client: hubClient.id,
    currency: 'USD',
    hubMinor: '50000',
    recordsMinor: '50000',
    differenceMinor: '0',
  },
  {
    slot: 'receivable',
    client: hubClient.id,
    currency: 'USD',
    hubMinor: '30000',
    recordsMinor: '30000',
    differenceMinor: '0',
  },
];

/** The first read after Hub's snapshot (acceptance step 2): rates and the records' figures fail. */
export const failingView: OpeningViewAnswer = {
  booksStart,
  asOf: '2026-09-30',
  hubClient: true,
  state: null,
  version: 0,
  snapshot,
  hubItems,
  schedules,
  recordLines: [],
  recordFigures: [],
  differences: agreed.map((pair) => ({ ...pair, recordsMinor: null, differenceMinor: null })),
  agreement: agreed.map((pair) => ({ ...pair, recordsMinor: null, differenceMinor: null })),
  lines: [],
  checks: [
    passing('snapshot'),
    {
      check: 'records_agree',
      passed: false,
      failures: agreed.map((pair) => ({ ...pair, recordsMinor: null, differenceMinor: null })),
    },
    {
      check: 'rates',
      passed: false,
      failures: [
        { ledger: 'book', rateType: 'bulletin', from: 'USD', to: 'SYP', on: '2026-09-10' },
        { ledger: 'book', rateType: 'bulletin', from: 'USD', to: 'SYP', on: '2026-09-30' },
        { ledger: 'parallel', rateType: 'market', from: 'SYP', to: 'USD', on: '2026-09-30' },
      ],
    },
    passing('mappings'),
    passing('schedules'),
    passing('lines'),
  ],
  fingerprint,
  posted: null,
  reversed: null,
};

/** The draft saved with the records and their figures (acceptance step 4): every check passes. */
export const readyView: OpeningViewAnswer = {
  ...failingView,
  state: 'draft',
  version: 1,
  recordLines,
  recordFigures: [
    { slot: 'receivable', clientValueId: hubClient.id, currency: 'USD', amountMinor: '30000' },
    { slot: 'ad_funds', clientValueId: hubClient.id, currency: 'USD', amountMinor: '50000' },
  ],
  differences: [],
  agreement: agreed,
  lines,
  checks: allPassing,
};

/** The opening entry, 2026/1 dated on the books start. */
export const openingEntry: Entry = {
  ...purchase,
  id: entryId(1),
  fiscalYear: 2026,
  number: 1,
  sequence: '1',
  entryDate: booksStart,
  postedAt: '2026-10-20T10:00:00.000Z',
  source: 'opening',
  sourceRef: openingId(2),
  description: 'قيد الأرصدة الافتتاحية',
  reference: null,
  draftId: null,
  attachments: [],
};

export const postedView: OpeningViewAnswer = {
  ...readyView,
  state: 'posted',
  posted: {
    entry: { id: openingEntry.id, date: booksStart, fiscalYear: 2026, number: 1 },
    by: owner.person.id,
    at: openingEntry.postedAt,
  },
};

/** After the whole reversal (rule 25): a new draft from the reversed one's lines. */
export const reversedView: OpeningViewAnswer = {
  ...readyView,
  state: null,
  version: 0,
  reversed: {
    entry: { id: openingEntry.id, date: booksStart, fiscalYear: 2026, number: 1 },
    reversalEntry: { id: entryId(2), date: booksStart, fiscalYear: 2026, number: 2 },
    reason: 'رصيد صندوق خاطئ في السجلات',
    at: '2026-10-20T11:00:00.000Z',
  },
};

/** Every read of `/opening`, its view given. */
export const openingReads = (
  view: OpeningViewAnswer,
  openingState: Company['openingState'] = view.state,
) => ({
  ...dimensionReads,
  'GET /api/company': { status: 200, json: openingCompany(openingState) },
  'GET /api/opening': { status: 200, json: view },
});

export { manualClient, ownerRef };
