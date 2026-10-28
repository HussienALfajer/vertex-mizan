import type {
  AccountLinesPage,
  Attachment,
  Draft,
  DraftInput,
  DraftSummary,
  Entry,
  EntryLine,
  EntryPreview,
  EntrySummary,
  PersonRef,
} from '@vertex-mizan/contracts';
import { accountOf } from './chart-mocks';
import { company, members, owner } from './company-mocks';
import { dimensionReads } from './dimension-mocks';
import { rateReads, usdSyp } from './rate-mocks';

/** Synthetic answers of the entries and drafts API (S03), shared by the screen and flow specs. */

const entryId = (n: number) => `01900000-0000-7000-8009-${String(n).padStart(12, '0')}`;
const draftId = (n: number) => `01900000-0000-7000-800a-${String(n).padStart(12, '0')}`;
const hash = (digit: string) => digit.repeat(64);

export const ownerRef: PersonRef = { id: owner.person.id, name: owner.person.name };
export const accountantRef: PersonRef = {
  id: members[1]?.userId ?? '',
  name: members[1]?.name ?? '',
};

const usdBank = accountOf('111004');
const sypBank = accountOf('111003');
const loss = accountOf('541001');

const bulletin = {
  ledger: 'book',
  basis: 'policy',
  quoteNo: 1,
  rateId: '01900000-0000-7000-8007-000000000099',
  base: 'USD',
  quote: 'SYP',
  rate: '121.5',
  rateType: 'bulletin',
  rateSource: 'manual',
  effectiveOn: '2026-11-08',
} as const;

/**
 * The spec's example (S03 "Accounting treatment"): 100.00 USD bought for 12,250.00 SYP, dealt at
 * 122.5; the book ledger posts a 100.00 SYP realised loss.
 */
export const purchaseLines: EntryLine[] = [
  {
    lineNo: 1,
    accountId: usdBank.id,
    accountCode: usdBank.code,
    accountName: usdBank.name,
    dimensionValueIds: [],
    kind: 'measured',
    ledger: null,
    currency: 'USD',
    amountMinor: '10000',
    bookMinor: '1215000',
    parallelMinor: '10000',
    memo: null,
    conversions: [bulletin],
  },
  {
    lineNo: 2,
    accountId: sypBank.id,
    accountCode: sypBank.code,
    accountName: sypBank.name,
    dimensionValueIds: [],
    kind: 'measured',
    ledger: null,
    currency: 'SYP',
    amountMinor: '-1225000',
    bookMinor: '-1225000',
    parallelMinor: '-10000',
    memo: null,
    conversions: [
      {
        ...bulletin,
        ledger: 'parallel',
        basis: 'transaction',
        rateId: null,
        rate: '122.5',
        rateType: 'market',
      },
    ],
  },
  {
    lineNo: 3,
    accountId: loss.id,
    accountCode: loss.code,
    accountName: loss.name,
    dimensionValueIds: [],
    kind: 'difference',
    ledger: 'book',
    currency: 'SYP',
    amountMinor: '10000',
    bookMinor: '10000',
    parallelMinor: '0',
    memo: null,
    conversions: [],
  },
];

const negated = (value: string) =>
  value.startsWith('-') ? value.slice(1) : value === '0' ? '0' : `-${value}`;

export const invoice: Attachment = {
  id: '01900000-0000-7000-800b-000000000001',
  draftId: null,
  entryId: entryId(1),
  fileName: 'إيصال الصرافة.pdf',
  contentType: 'application/pdf',
  sizeBytes: 48_213,
  sha256: hash('c'),
  uploadedBy: ownerRef,
  createdAt: '2026-11-08T10:05:00.000Z',
};

/** Entry 2026/1, the purchase, posted from a draft without approval. */
export const purchase: Entry = {
  id: entryId(1),
  fiscalYear: 2026,
  number: 1,
  sequence: '1',
  entryDate: '2026-11-08',
  postedAt: '2026-11-08T10:00:00.000Z',
  source: 'manual',
  sourceRef: null,
  description: 'شراء دولار',
  reference: 'ص-12',
  reverses: null,
  reversedBy: null,
  draftId: draftId(1),
  preparedBy: ownerRef,
  approvedBy: null,
  postedBy: ownerRef,
  bookCurrency: 'SYP',
  parallelCurrency: 'USD',
  lines: purchaseLines,
  attachments: [invoice],
  previousHash: null,
  hash: hash('a'),
};

/** Entry 2026/2, the reversal of 2026/1: every line negated, the loss included. */
export const reversal: Entry = {
  ...purchase,
  id: entryId(2),
  number: 2,
  sequence: '2',
  entryDate: '2026-11-09',
  postedAt: '2026-11-09T09:30:00.000Z',
  description: 'عكس القيد 2026/1: سعر صفقة خاطئ',
  reference: null,
  draftId: null,
  reverses: { id: purchase.id, fiscalYear: 2026, number: 1 },
  attachments: [],
  lines: purchaseLines.map((line) => ({
    ...line,
    amountMinor: negated(line.amountMinor),
    bookMinor: negated(line.bookMinor),
    parallelMinor: line.parallelMinor === null ? null : negated(line.parallelMinor),
  })),
  previousHash: purchase.hash,
  hash: hash('b'),
};

export const reversedPurchase: Entry = {
  ...purchase,
  reversedBy: { id: reversal.id, fiscalYear: 2026, number: 2 },
};

const summaryOf = (entry: Entry, bookDebit: string, parallelDebit: string): EntrySummary => ({
  id: entry.id,
  fiscalYear: entry.fiscalYear,
  number: entry.number,
  entryDate: entry.entryDate,
  postedAt: entry.postedAt,
  source: entry.source,
  description: entry.description,
  reference: entry.reference,
  bookDebit: { amountMinor: bookDebit, currency: 'SYP' },
  parallelDebit: { amountMinor: parallelDebit, currency: 'USD' },
  reversesEntryId: entry.reverses?.id ?? null,
  reversedByEntryId: entry.reversedBy?.id ?? null,
});

export const journal: EntrySummary[] = [
  summaryOf(reversal, '1225000', '10000'),
  summaryOf(reversedPurchase, '1225000', '10000'),
];

/** A draft as the API returns it, from typed input. */
export function draftOf(input: DraftInput, fields: Partial<Draft> & Pick<Draft, 'id'>): Draft {
  return {
    state: 'draft',
    entryDate: input.entryDate,
    description: input.description,
    reference: input.reference,
    dealtRates: input.dealtRates,
    reversesEntryId: null,
    copiedFromEntryId: null,
    lines: input.lines.map((line, index) => ({
      lineNo: index + 1,
      accountId: line.accountId,
      dimensionValueIds: line.dimensionValueIds,
      currency: line.currency,
      amountMinor: line.amountMinor,
      memo: line.memo,
    })),
    preparedBy: ownerRef,
    submitted: null,
    rejected: null,
    postedEntryId: null,
    archived: null,
    attachments: [],
    createdAt: '2026-11-09T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
    ...fields,
  };
}

/** The purchase as typed, before posting: the dealt rate given. */
export const purchaseInput: DraftInput = {
  entryDate: '2026-11-08',
  description: 'شراء دولار',
  reference: 'ص-12',
  dealtRates: [{ base: 'USD', quote: 'SYP', rate: '122.5' }],
  lines: [
    {
      accountId: usdBank.id,
      dimensionValueIds: [],
      currency: 'USD',
      amountMinor: '10000',
      memo: null,
    },
    {
      accountId: sypBank.id,
      dimensionValueIds: [],
      currency: 'SYP',
      amountMinor: '-1225000',
      memo: null,
    },
  ],
};

/** An open draft of the owner. */
export const ownDraft = draftOf(purchaseInput, { id: draftId(1) });

/** A draft the accountant prepared and submitted for approval. */
export const submittedDraft = draftOf(
  { ...purchaseInput, description: 'شراء دولار للمصاريف', reference: null },
  {
    id: draftId(2),
    state: 'submitted',
    preparedBy: accountantRef,
    submitted: { by: accountantRef, at: '2026-11-09T08:30:00.000Z' },
    updatedAt: '2026-11-09T08:30:00.000Z',
  },
);

/** A draft the owner prepared, rejected by an approver with a reason. */
export const rejectedDraft = draftOf(
  { ...purchaseInput, description: 'دفعة مقدمة لمورد', dealtRates: [] },
  {
    id: draftId(3),
    rejected: {
      by: accountantRef,
      at: '2026-11-09T07:45:00.000Z',
      reason: 'أرفق إيصال الصرافة قبل الاعتماد (مثال)',
    },
  },
);

const draftSummaryOf = (draft: Draft): DraftSummary => ({
  id: draft.id,
  state: draft.state,
  entryDate: draft.entryDate,
  description: draft.description,
  reference: draft.reference,
  reversesEntryId: draft.reversesEntryId,
  lineCount: draft.lines.length,
  preparedBy: draft.preparedBy,
  submitted: draft.submitted,
  rejected: draft.rejected !== null,
  updatedAt: draft.updatedAt,
});

export const draftSummaries = [ownDraft, submittedDraft, rejectedDraft].map(draftSummaryOf);

/** What the preview of the purchase answers: its lines with the loss line. */
export const purchasePreview: EntryPreview = {
  entryDate: purchase.entryDate,
  bookCurrency: 'SYP',
  parallelCurrency: 'USD',
  lines: purchaseLines,
  refusals: [],
};

export const accountLines: AccountLinesPage = {
  accountId: usdBank.id,
  opening: {
    transaction: null,
    book: { amountMinor: '0', currency: 'SYP' },
    parallel: { amountMinor: '0', currency: 'USD' },
  },
  lines: [purchase, reversal].map((entry, index) => {
    const line = entry.lines[0] as EntryLine;
    return {
      entryId: entry.id,
      fiscalYear: entry.fiscalYear,
      number: entry.number,
      entryDate: entry.entryDate,
      description: entry.description,
      lineNo: 1,
      dimensionValueIds: [],
      kind: line.kind,
      ledger: line.ledger,
      currency: line.currency,
      amountMinor: line.amountMinor,
      bookMinor: line.bookMinor,
      parallelMinor: line.parallelMinor,
      memo: null,
      balance: {
        transaction: null,
        book: { amountMinor: index === 0 ? '1215000' : '0', currency: 'SYP' },
        parallel: { amountMinor: index === 0 ? '10000' : '0', currency: 'USD' },
      },
    };
  }),
  nextCursor: null,
};

/** Every read of the entry screens, answered (with the chart's, dimensions', rates' and S01's). */
export const entryReads = {
  ...dimensionReads,
  ...rateReads,
  'GET /api/accounts': dimensionReads['GET /api/accounts'],
  'GET /api/rate-pairs': { status: 200, json: [usdSyp] },
  'GET /api/entries': { status: 200, json: { entries: journal, nextCursor: null } },
  [`GET /api/entries/${purchase.id}`]: { status: 200, json: reversedPurchase },
  [`GET /api/entries/${reversal.id}`]: { status: 200, json: reversal },
  'GET /api/drafts': (request: { url(): string }) => {
    const view = new URL(request.url()).searchParams.get('view');
    const drafts =
      view === 'awaiting'
        ? draftSummaries.filter((draft) => draft.state === 'submitted')
        : view === 'mine'
          ? draftSummaries.filter((draft) => draft.preparedBy.id === owner.person.id)
          : draftSummaries;
    return { status: 200, json: { drafts, nextCursor: null } };
  },
  [`GET /api/drafts/${ownDraft.id}`]: { status: 200, json: ownDraft },
  [`GET /api/drafts/${submittedDraft.id}`]: { status: 200, json: submittedDraft },
  [`GET /api/drafts/${rejectedDraft.id}`]: { status: 200, json: rejectedDraft },
  [`GET /api/accounts/${usdBank.id}/lines`]: { status: 200, json: accountLines },
};

/** The same company with approval of manual entries switched on. */
export const approvalCompany = { ...company, manualEntryApproval: true };
