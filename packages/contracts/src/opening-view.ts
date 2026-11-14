import { z } from 'zod';
import { lineKindSchema } from './entries.js';
import { currencyCodeSchema } from './money.js';
import { openingCheckSchema } from './opening.js';
import { openingStateSchema } from './opening-states.js';
import { entryNumberSchema, minorUnitsSchema } from './wire.js';

// The view of `GET /api/opening` (S10 rule 20); amounts as `MinorUnits` (S03).

const viewDateSchema = z.iso.date();
const instantSchema = z.iso.datetime({ offset: true });
/** A check's failing item: what fails it, as plain values (a rate, a client, a line, a slot). */
const checkFailureSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

/** Where a line of the preview comes from (rule 20). */
export const OPENING_LINE_SOURCES = ['records', 'balancing'] as const;

/** A line of the accountant as saved (rule 14). */
export const openingRecordLineSchema = z
  .object({
    lineNo: z.int().min(1),
    accountId: z.uuid(),
    dimensionValueIds: z.array(z.uuid()),
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema.nullable(),
    parallelMinor: minorUnitsSchema.nullable(),
    itemReference: z.string().nullable(),
    itemDueOn: viewDateSchema.nullable(),
    memo: z.string().nullable(),
  })
  .meta({ id: 'OpeningRecordLine' });

/** A line of the entry the draft would post now (rule 20), with its source. */
export const openingPreviewLineSchema = z
  .object({
    lineNo: z.int().min(1),
    source: z.enum(OPENING_LINE_SOURCES),
    accountId: z.uuid(),
    dimensionValueIds: z.array(z.uuid()),
    kind: lineKindSchema,
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema,
    parallelMinor: minorUnitsSchema.nullable(),
    memo: z.string().nullable(),
    /** The rates each ledger measured it at, as quoted; none on a stated line. */
    conversions: z.array(
      z.object({
        ledger: z.enum(['book', 'parallel']),
        base: currencyCodeSchema,
        quote: currencyCodeSchema,
        rate: z.string(),
        effectiveOn: viewDateSchema,
      }),
    ),
    /** The reference of the item it opens, or null. */
    itemReference: z.string().nullable(),
  })
  .meta({ id: 'OpeningPreviewLine' });

/** A check with whether it passes and what fails it (rule 21). */
export const openingCheckResultSchema = z
  .object({
    check: openingCheckSchema,
    passed: z.boolean(),
    failures: z.array(checkFailureSchema),
  })
  .meta({ id: 'OpeningCheckResult' });

const openingEntryRefSchema = z
  .object({ id: z.uuid(), date: viewDateSchema })
  .extend(entryNumberSchema.shape)
  .meta({ id: 'OpeningEntryRef' });

/**
 * `GET /api/opening` (S10 rule 20): the opening's state, the books start and its eve, the
 * accountant's lines, the entry it would post with the balancing line, the checks, the fingerprint
 * to post with, the posted entry, and the latest reversed opening.
 */
export const openingViewSchema = z
  .object({
    booksStart: viewDateSchema,
    asOf: viewDateSchema,
    /** The live opening's state, or null before its first save. */
    state: openingStateSchema.nullable(),
    /** The draft's version to save against: 0 before the first save (rule 16). */
    version: z.int().min(0),
    /** The draft's lines; before a new draft's first save, the reversed one's. */
    recordLines: z.array(openingRecordLineSchema),
    /** The entry the draft would post now, in rule 23's order; empty while a check stops it. */
    lines: z.array(openingPreviewLineSchema),
    checks: z.array(openingCheckResultSchema),
    /** What `POST /api/opening/post` sends (rule 23). */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    /** The posted opening entry, with who posted it and when. */
    posted: z.object({ entry: openingEntryRefSchema, by: z.uuid(), at: instantSchema }).nullable(),
    /** The latest reversed opening: its entry, its reversal and the reason (rule 25). */
    reversed: z
      .object({
        entry: openingEntryRefSchema,
        reversalEntry: openingEntryRefSchema,
        reason: z.string(),
        at: instantSchema,
      })
      .nullable(),
  })
  .meta({ id: 'OpeningView' });

export type OpeningViewAnswer = z.infer<typeof openingViewSchema>;

/** `POST /api/opening/reverse` (rule 25): the reason, 1–500 characters. */
export const reverseOpeningSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .meta({ id: 'ReverseOpening' });

export type ReverseOpening = z.infer<typeof reverseOpeningSchema>;

/** The answer of posting or reversing the opening: the entry it posted. */
export const openingEntryResultSchema = z
  .object({ openingId: z.uuid(), entry: openingEntryRefSchema })
  .meta({ id: 'OpeningEntryResult' });

export type OpeningEntryResult = z.infer<typeof openingEntryResultSchema>;

/**
 * What `GET /api/opening/export` writes (S10 "Screens"): the entry's preview. The agreement with
 * Hub left with Hub (ADR 0021).
 */
export const OPENING_EXPORT_PARTS = ['preview'] as const;

/** `GET /api/opening/export?part=preview`: the opening's preview as an Excel workbook. */
export const openingExportQuerySchema = z
  .object({ part: z.enum(OPENING_EXPORT_PARTS) })
  .meta({ id: 'OpeningExportQuery' });

export type OpeningExportQuery = z.infer<typeof openingExportQuerySchema>;
