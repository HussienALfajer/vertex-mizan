import { z } from 'zod';
import { cursorSchema } from './audit.js';
import {
  currencyCodeSchema,
  ledgerSchema,
  rateSourceSchema,
  rateTypeSchema,
  rateValueSchema,
} from './money.js';
import { MINOR_MAX, MINOR_MIN } from './money-arithmetic.js';

/**
 * Journal entries and their drafts (S03): the accountant's drafts with their lines and dealt
 * rates, the preview of a posting, posted entries with their lines, conversions and attachments,
 * an account's lines and the entries of a rate row. The posting function itself is
 * `packages/db`'s `post()`; these are the schemas of the internal `/api`.
 */

/** The sources of a posted entry (`ENTRY_SOURCES` of `packages/ledger`; a test keeps them equal). */
export const ENTRY_SOURCES = [
  'manual',
  'hub_event',
  'opening',
  'revaluation',
  'revenue_release',
] as const;

export const entrySourceSchema = z.enum(ENTRY_SOURCES).meta({ id: 'EntrySource' });

export type EntrySource = z.infer<typeof entrySourceSchema>;

/** The kinds of a posted line (`Line['kind']` of `packages/ledger`). */
export const LINE_KINDS = ['measured', 'carried', 'difference', 'rounding'] as const;

export const lineKindSchema = z.enum(LINE_KINDS).meta({ id: 'LineKind' });

export type LineKind = z.infer<typeof lineKindSchema>;

/** The states of a draft: being prepared, awaiting approval, posted (S03 rules 4–8). */
export const DRAFT_STATES = ['draft', 'submitted', 'posted'] as const;

export const draftStateSchema = z.enum(DRAFT_STATES).meta({ id: 'DraftState' });

export type DraftState = z.infer<typeof draftStateSchema>;

/** The most lines a draft or an entry holds (S03 edge case 20). */
export const DRAFT_LINE_LIMIT = 500;

/** The attachment types, checked from the file's first bytes (S03 rule 17). */
export const ATTACHMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const attachmentContentTypeSchema = z
  .enum(ATTACHMENT_CONTENT_TYPES)
  .meta({ id: 'AttachmentContentType' });

export type AttachmentContentType = z.infer<typeof attachmentContentTypeSchema>;

/** 10 MB a file, 20 unarchived files a draft or an entry (S03 rule 17). */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_LIMIT = 20;

const MINOR_UNITS_PATTERN = /^(0|-?[1-9]\d{0,18})$/;

/**
 * An amount in minor units on the wire: an integer string (`"-1225000"`), because a JSON number
 * loses digits beyond 2^53; within the stored `bigint` range (ADR 0007).
 */
export const minorUnitsSchema = z
  .string()
  .regex(MINOR_UNITS_PATTERN, 'Expected an integer in minor units')
  .refine((text) => {
    // Zod runs a refinement even after a failed pattern: that case is the pattern's issue.
    if (!MINOR_UNITS_PATTERN.test(text)) return true;
    const value = BigInt(text);
    return value >= MINOR_MIN && value <= MINOR_MAX;
  }, 'Outside the stored range')
  .meta({
    id: 'MinorUnits',
    description: 'An integer amount in minor units of its currency, as a decimal string',
  });

/** An amount with its currency (ADR 0007): never shown or read without it. */
export const moneyAmountSchema = z
  .object({ amountMinor: minorUnitsSchema, currency: currencyCodeSchema })
  .meta({ id: 'MoneyAmount' });

export type MoneyAmount = z.infer<typeof moneyAmountSchema>;

/** A person named on a draft or an entry: who prepared, submitted, approved or posted it. */
export const personRefSchema = z
  .object({ id: z.uuid(), name: z.string() })
  .meta({ id: 'PersonRef' });

export type PersonRef = z.infer<typeof personRefSchema>;

/** An entry's number as it is shown: fiscal year and number (`2026/123`, S03 "Periods"). */
export const entryNumberSchema = z
  .object({ fiscalYear: z.int().min(2000).max(9999), number: z.int().min(1) })
  .meta({ id: 'EntryNumber' });

export type EntryNumber = z.infer<typeof entryNumberSchema>;

/** البيان: 1–500 characters (S03 rule 5). */
const descriptionSchema = z.string().trim().min(1).max(500);

const referenceSchema = z.string().trim().min(1).max(100);

const memoSchema = z.string().trim().min(1).max(300);

/**
 * The rate a manual entry was dealt at for a pair (S03 rule 13), quoted in the company's
 * orientation of the pair; used only by a market ledger that accepts a transaction's rate.
 */
export const dealtRateSchema = z
  .object({ base: currencyCodeSchema, quote: currencyCodeSchema, rate: rateValueSchema })
  .refine((rate) => rate.base !== rate.quote, {
    message: 'A rate quotes one currency in another',
    path: ['quote'],
  })
  .meta({ id: 'DealtRate' });

export type DealtRate = z.infer<typeof dealtRateSchema>;

/**
 * A draft line as typed (S03 rule 4): incomplete while typing, so the account, the currency and
 * the amount may be missing; an amount given is never zero (edge case 3), positive a debit and
 * negative a credit. At most one value per dimension type, checked at posting.
 */
export const draftLineInputSchema = z
  .object({
    accountId: z.uuid().nullable(),
    dimensionValueIds: z
      .array(z.uuid())
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length, 'Each value once')
      .default([]),
    currency: currencyCodeSchema.nullable(),
    amountMinor: minorUnitsSchema
      .refine((text) => text !== '0', 'A line of zero amount')
      .nullable(),
    memo: memoSchema.nullable().default(null),
  })
  .meta({ id: 'DraftLineInput' });

export type DraftLineInput = z.infer<typeof draftLineInputSchema>;

/**
 * `POST /api/drafts` and the content of `PUT /api/drafts/:id`: the header and the lines as typed.
 * A reversal's draft has fixed lines: it takes no lines or dealt rates.
 */
export const draftInputSchema = z
  .object({
    entryDate: z.iso.date(),
    description: descriptionSchema.nullable().default(null),
    reference: referenceSchema.nullable().default(null),
    dealtRates: z
      .array(dealtRateSchema)
      .max(10)
      .refine(
        (rates) =>
          new Set(rates.map((rate) => [rate.base, rate.quote].sort().join('/'))).size ===
          rates.length,
        'One dealt rate per pair',
      )
      .default([]),
    lines: z.array(draftLineInputSchema).max(DRAFT_LINE_LIMIT).default([]),
  })
  .meta({ id: 'DraftInput' });

export type DraftInput = z.infer<typeof draftInputSchema>;

/** `PUT /api/drafts/:id`: the draft as last read (`updatedAt`), so a stale write is refused. */
export const updateDraftSchema = z
  .object({ ...draftInputSchema.shape, updatedAt: z.iso.datetime({ offset: true }) })
  .meta({ id: 'UpdateDraft' });

export type UpdateDraft = z.infer<typeof updateDraftSchema>;

/** A draft line as stored. */
export const draftLineSchema = z
  .object({
    lineNo: z.int().min(1),
    accountId: z.uuid().nullable(),
    dimensionValueIds: z.array(z.uuid()),
    currency: currencyCodeSchema.nullable(),
    amountMinor: minorUnitsSchema.nullable(),
    memo: z.string().nullable(),
  })
  .meta({ id: 'DraftLine' });

export type DraftLine = z.infer<typeof draftLineSchema>;

/** A file attached to a draft or an entry (S03 rule 17). */
export const attachmentSchema = z
  .object({
    id: z.uuid(),
    draftId: z.uuid().nullable(),
    entryId: z.uuid().nullable(),
    fileName: z.string(),
    contentType: attachmentContentTypeSchema,
    sizeBytes: z.int().min(1),
    sha256: z.string(),
    uploadedBy: personRefSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Attachment' });

export type Attachment = z.infer<typeof attachmentSchema>;

const happenedSchema = z.object({ by: personRefSchema, at: z.iso.datetime({ offset: true }) });

/** A draft as the API returns it, with its lines and attachments. */
export const draftSchema = z
  .object({
    id: z.uuid(),
    state: draftStateSchema,
    entryDate: z.iso.date(),
    description: z.string().nullable(),
    reference: z.string().nullable(),
    dealtRates: z.array(dealtRateSchema),
    /** A reversal waiting for approval: its lines are the original's, negated at posting. */
    reversesEntryId: z.uuid().nullable(),
    copiedFromEntryId: z.uuid().nullable(),
    lines: z.array(draftLineSchema),
    preparedBy: personRefSchema,
    submitted: happenedSchema.nullable(),
    /** The last rejection, shown until the draft is submitted again. */
    rejected: z.object({ ...happenedSchema.shape, reason: z.string() }).nullable(),
    postedEntryId: z.uuid().nullable(),
    archived: z
      .object({ at: z.iso.datetime({ offset: true }), reason: z.string().nullable() })
      .nullable(),
    attachments: z.array(attachmentSchema),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Draft' });

export type Draft = z.infer<typeof draftSchema>;

/** The tabs of `/drafts`: the person's own, every open draft, the approval queue. */
export const DRAFT_VIEWS = ['mine', 'all', 'awaiting'] as const;

/** `GET /api/drafts`: pages of 100, the most recently changed first. */
export const draftQuerySchema = z
  .object({ view: z.enum(DRAFT_VIEWS).default('all'), cursor: cursorSchema.optional() })
  .meta({ id: 'DraftQuery' });

export type DraftQuery = z.infer<typeof draftQuerySchema>;

/** A row of the drafts list. */
export const draftSummarySchema = z
  .object({
    id: z.uuid(),
    state: draftStateSchema,
    entryDate: z.iso.date(),
    description: z.string().nullable(),
    reference: z.string().nullable(),
    reversesEntryId: z.uuid().nullable(),
    lineCount: z.int().min(0),
    preparedBy: personRefSchema,
    submitted: happenedSchema.nullable(),
    rejected: z.boolean(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'DraftSummary' });

export type DraftSummary = z.infer<typeof draftSummarySchema>;

export const draftPageSchema = z
  .object({ drafts: z.array(draftSummarySchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'DraftPage' });

export type DraftPage = z.infer<typeof draftPageSchema>;

/** `POST /api/drafts/:id/discard`: an optional reason. */
export const discardDraftSchema = z
  .object({ reason: z.string().trim().min(1).max(1000).nullable().default(null) })
  .meta({ id: 'DiscardDraft' });

export type DiscardDraft = z.infer<typeof discardDraftSchema>;

/** The rate a ledger amount was converted at, as used and stored (`line_conversions`). */
export const lineConversionSchema = z
  .object({
    ledger: ledgerSchema,
    basis: z.enum(['policy', 'transaction']),
    /** 1, or 1 and 2 for the two quotes of a cross. */
    quoteNo: z.int().min(1).max(2),
    /** The rate row; null for a dealt rate, which is never written to the rate table. */
    rateId: z.uuid().nullable(),
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: rateValueSchema,
    rateType: rateTypeSchema,
    rateSource: rateSourceSchema,
    effectiveOn: z.iso.date(),
  })
  .meta({ id: 'LineConversion' });

export type LineConversion = z.infer<typeof lineConversionSchema>;

/** A line as posted, or as the preview would post it: the three amounts and how they came. */
export const entryLineSchema = z
  .object({
    lineNo: z.int().min(1),
    accountId: z.uuid(),
    accountCode: z.string(),
    accountName: z.string(),
    dimensionValueIds: z.array(z.uuid()),
    kind: lineKindSchema,
    /** The one ledger of a difference or rounding line. */
    ledger: ledgerSchema.nullable(),
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema,
    /** Null when the company keeps no parallel ledger. */
    parallelMinor: minorUnitsSchema.nullable(),
    memo: z.string().nullable(),
    conversions: z.array(lineConversionSchema),
  })
  .meta({ id: 'EntryLine' });

export type EntryLine = z.infer<typeof entryLineSchema>;

/** Why a draft cannot post now: a code, the line it names (if any) and its facts. */
export const postingRefusalSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    lineNo: z.int().min(1).nullable(),
    details: z.record(z.string(), z.string()),
  })
  .meta({ id: 'PostingRefusal' });

export type PostingRefusal = z.infer<typeof postingRefusalSchema>;

/**
 * `POST /api/drafts/:id/preview` (S03 rule 7): the lines as they would post now, rounding and
 * difference lines included, computed by the posting function's own code with no write; or the
 * refusals, and then no lines.
 */
export const entryPreviewSchema = z
  .object({
    entryDate: z.iso.date(),
    bookCurrency: currencyCodeSchema,
    parallelCurrency: currencyCodeSchema.nullable(),
    lines: z.array(entryLineSchema),
    refusals: z.array(postingRefusalSchema),
  })
  .meta({ id: 'EntryPreview' });

export type EntryPreview = z.infer<typeof entryPreviewSchema>;

/** A posted entry with its lines, attachments, reversal links and place in the chain. */
export const entrySchema = z
  .object({
    id: z.uuid(),
    ...entryNumberSchema.shape,
    /** Its place in the company's chain, as an integer string. */
    sequence: z.string().regex(/^[1-9]\d*$/),
    entryDate: z.iso.date(),
    postedAt: z.iso.datetime({ offset: true }),
    source: entrySourceSchema,
    sourceRef: z.string().nullable(),
    description: z.string(),
    reference: z.string().nullable(),
    reverses: entryNumberSchema.extend({ id: z.uuid() }).nullable(),
    reversedBy: entryNumberSchema.extend({ id: z.uuid() }).nullable(),
    draftId: z.uuid().nullable(),
    preparedBy: personRefSchema.nullable(),
    approvedBy: personRefSchema.nullable(),
    postedBy: personRefSchema.nullable(),
    bookCurrency: currencyCodeSchema,
    parallelCurrency: currencyCodeSchema.nullable(),
    lines: z.array(entryLineSchema),
    attachments: z.array(attachmentSchema),
    previousHash: z.string().nullable(),
    hash: z.string(),
  })
  .meta({ id: 'Entry' });

export type Entry = z.infer<typeof entrySchema>;

/** A row of the journal: the debit total of each ledger and the reversal links. */
export const entrySummarySchema = z
  .object({
    id: z.uuid(),
    ...entryNumberSchema.shape,
    entryDate: z.iso.date(),
    postedAt: z.iso.datetime({ offset: true }),
    source: entrySourceSchema,
    description: z.string(),
    reference: z.string().nullable(),
    bookDebit: moneyAmountSchema,
    parallelDebit: moneyAmountSchema.nullable(),
    reversesEntryId: z.uuid().nullable(),
    reversedByEntryId: z.uuid().nullable(),
  })
  .meta({ id: 'EntrySummary' });

export type EntrySummary = z.infer<typeof entrySummarySchema>;

/**
 * `GET /api/entries`: by entry date, newest first, pages of 100. `number` finds an entry by its
 * number (in `fiscalYear` when given); `text` searches the description and the reference.
 */
export const entryQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    fiscalYear: z.coerce.number().int().min(2000).max(9999).optional(),
    number: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
    source: entrySourceSchema.optional(),
    account: z.uuid().optional(),
    text: z.string().trim().min(1).max(100).optional(),
    cursor: cursorSchema.optional(),
  })
  .meta({ id: 'EntryQuery' });

export type EntryQuery = z.infer<typeof entryQuerySchema>;

export const entryPageSchema = z
  .object({ entries: z.array(entrySummarySchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'EntryPage' });

export type EntryPage = z.infer<typeof entryPageSchema>;

/**
 * `POST /api/entries/:id/reverse` (S03 rule 9): the reversal's date and description. Approval off,
 * it posts; approval on, it makes the reversal's draft, submitted and approved like any other.
 */
export const reverseEntrySchema = z
  .object({ date: z.iso.date(), description: descriptionSchema })
  .meta({ id: 'ReverseEntry' });

export type ReverseEntry = z.infer<typeof reverseEntrySchema>;

/** The answer of a reversal: the posted reversal, or its draft awaiting submission. */
export const reversalResultSchema = z
  .object({ entry: entrySchema.nullable(), draft: draftSchema.nullable() })
  .meta({ id: 'ReversalResult' });

export type ReversalResult = z.infer<typeof reversalResultSchema>;

/** The answer of posting or approving a draft: the posted entry and the draft now `posted`. */
export const postedDraftSchema = z
  .object({ entry: entrySchema, draft: draftSchema })
  .meta({ id: 'PostedDraft' });

export type PostedDraft = z.infer<typeof postedDraftSchema>;

/** `POST /api/drafts/:id/reject`: the reason the preparer reads. */
export const rejectDraftSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .meta({ id: 'RejectDraft' });

export type RejectDraft = z.infer<typeof rejectDraftSchema>;

/**
 * `GET /api/accounts/:id/lines`: a date range, the dimension values every line must carry, and a
 * currency; the transaction amounts run only within one currency.
 */
export const accountLinesQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    dims: z
      .string()
      .optional()
      .transform((text, context) => {
        const ids = text ? text.split(',').filter((id) => id !== '') : [];
        for (const id of ids) {
          if (!z.uuid().safeParse(id).success) {
            context.addIssue({ code: 'custom', message: 'Expected dimension value ids' });
            return z.NEVER;
          }
        }
        return ids;
      }),
    currency: currencyCodeSchema.optional(),
    cursor: cursorSchema.optional(),
  })
  .meta({ id: 'AccountLinesQuery' });

export type AccountLinesQuery = z.infer<typeof accountLinesQuerySchema>;

/** Running or opening balances: transaction (one currency only), book and parallel. */
export const lineBalancesSchema = z
  .object({
    transaction: moneyAmountSchema.nullable(),
    book: moneyAmountSchema,
    parallel: moneyAmountSchema.nullable(),
  })
  .meta({ id: 'LineBalances' });

export type LineBalances = z.infer<typeof lineBalancesSchema>;

/** A line of an account with the entry it belongs to and the balances after it. */
export const accountLineSchema = z
  .object({
    entryId: z.uuid(),
    ...entryNumberSchema.shape,
    entryDate: z.iso.date(),
    description: z.string(),
    lineNo: z.int().min(1),
    dimensionValueIds: z.array(z.uuid()),
    kind: lineKindSchema,
    ledger: ledgerSchema.nullable(),
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema,
    parallelMinor: minorUnitsSchema.nullable(),
    memo: z.string().nullable(),
    balance: lineBalancesSchema,
  })
  .meta({ id: 'AccountLine' });

export type AccountLine = z.infer<typeof accountLineSchema>;

/** An account's lines, oldest first, pages of 200, with the balance before the range. */
export const accountLinesPageSchema = z
  .object({
    accountId: z.uuid(),
    opening: lineBalancesSchema,
    lines: z.array(accountLineSchema),
    nextCursor: cursorSchema.nullable(),
  })
  .meta({ id: 'AccountLinesPage' });

export type AccountLinesPage = z.infer<typeof accountLinesPageSchema>;

/** `GET /api/attachments/:id` and the attachment routes of drafts. */
export const attachmentParamsSchema = z
  .object({ id: z.uuid(), attachmentId: z.uuid() })
  .meta({ id: 'AttachmentParams' });
