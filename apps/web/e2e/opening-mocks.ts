import type { Company, Entry, OpeningViewAnswer } from '@vertex-mizan/contracts';
import { accountOf } from './chart-mocks';
import { company, owner } from './company-mocks';
import { dimensionReads, manualClient } from './dimension-mocks';
import { ownerRef, purchase } from './entry-mocks';

/*
 * Synthetic answers of the opening (S10, without Hub: ADR 0021): the records' cash, capital and
 * year's result and the balancing figure on retained earnings, before its rates, ready to post,
 * posted, and reversed with a new draft. Every value is synthetic.
 */

export const booksStart = '2026-10-01';

/** The company with its books start and the opening's state. */
export const openingCompany = (openingState: Company['openingState']): Company => ({
  ...company,
  booksStart,
  openingState,
});

const openingId = (n: number) => `01900000-0000-7000-800a-${String(n).padStart(12, '0')}`;
const entryId = (n: number) => `01900000-0000-7000-8003-${String(900 + n).padStart(12, '0')}`;
/** A synthetic fingerprint, made at run time (the secret scan refuses long hex literals). */
export const fingerprint = 'f'.repeat(64);

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

/** The worked example's four lines, in rule 23's order. */
const lines: OpeningViewAnswer['lines'] = [
  previewLine(1, 'records', '111001', {
    currency: 'SYP',
    amountMinor: '200000000',
    bookMinor: '200000000',
    parallelMinor: '1694915',
    conversions: [conversion('parallel', '118.0000', '2026-09-30')],
  }),
  previewLine(2, 'records', '311001', {
    currency: 'SYP',
    kind: 'stated',
    amountMinor: '-100000000',
    bookMinor: '-100000000',
    parallelMinor: '-1000000',
  }),
  previewLine(3, 'records', '312002', {
    currency: 'SYP',
    kind: 'stated',
    amountMinor: '-30000000',
    bookMinor: '-30000000',
    parallelMinor: '-260000',
  }),
  previewLine(4, 'balancing', '312001', {
    currency: 'SYP',
    kind: 'stated',
    amountMinor: '-70000000',
    bookMinor: '-70000000',
    parallelMinor: '-434915',
  }),
];

const passing = (
  check: OpeningViewAnswer['checks'][number]['check'],
): OpeningViewAnswer['checks'][number] => ({ check, passed: true, failures: [] });

const allPassing: OpeningViewAnswer['checks'] = (['rates', 'mappings', 'lines'] as const).map(
  passing,
);

/** The first read (acceptance step 2): the rates fail. */
export const failingView: OpeningViewAnswer = {
  booksStart,
  asOf: '2026-09-30',
  state: null,
  version: 0,
  recordLines: [],
  lines: [],
  checks: [
    {
      check: 'rates',
      passed: false,
      failures: [
        { ledger: 'parallel', rateType: 'market', from: 'SYP', to: 'USD', on: '2026-09-30' },
      ],
    },
    passing('mappings'),
    passing('lines'),
  ],
  fingerprint,
  posted: null,
  reversed: null,
};

/** The draft saved with the records (acceptance step 4): every check passes. */
export const readyView: OpeningViewAnswer = {
  ...failingView,
  state: 'draft',
  version: 1,
  recordLines,
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
