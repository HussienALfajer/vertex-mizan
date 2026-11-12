import { z } from 'zod';
import { lineKindSchema } from './entries.js';
import { currencyCodeSchema } from './money.js';
import {
  openingCheckSchema,
  openingFigureSlotSchema,
  openingSnapshotResultSchema,
} from './opening.js';
import { openingStateSchema } from './opening-states.js';
import { entryNumberSchema, minorUnitsSchema } from './wire.js';

// Apart from `opening.ts`, so Hub's snapshot and its examples read none of the internal `/api`'s
// schemas (`entries.ts`), whose transforms JSON Schema cannot hold.

// The view of `GET /api/opening` (S10 rule 20); amounts as `MinorUnits` (S03).

const viewDateSchema = z.iso.date();
const instantSchema = z.iso.datetime({ offset: true });
const ledgerAmountsSchema = z.object({
  transactionMinor: minorUnitsSchema,
  bookMinor: minorUnitsSchema,
  parallelMinor: minorUnitsSchema.nullable(),
});
const hubPartySchema = z.object({
  externalId: z.string(),
  code: z.string().nullable(),
  name: z.string(),
});
/** A check's failing item: what fails it, as plain values (a rate, a client, a line, a slot). */
const checkFailureSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

/** The slots of Hub's part, in the opening entry's order (rule 23). */
export const OPENING_HUB_SLOTS = ['receivable', 'contract_asset', 'ad_funds'] as const;

/** Where a line of the preview comes from (rule 20). */
export const OPENING_LINE_SOURCES = ['hub', 'schedule', 'records', 'balancing'] as const;

/** An item of Hub's part (rule 11), measured at the eve. */
export const openingHubItemSchema = z
  .object({
    slot: z.enum(OPENING_HUB_SLOTS),
    /** Hub's invoice or milestone number, or the client's code (an ad funds item). */
    reference: z.string(),
    document: z
      .object({ type: z.enum(['invoice', 'milestone']), id: z.string(), number: z.string() })
      .nullable(),
    client: hubPartySchema,
    contract: hubPartySchema.nullable(),
    dueOn: viewDateSchema.nullable(),
    documentDate: viewDateSchema,
    amounts: ledgerAmountsSchema,
    currency: currencyCodeSchema,
  })
  .meta({ id: 'OpeningHubItem' });

/** A schedule of Hub's part (rule 13): what it deferred, what S06 took off it, what remains. */
export const openingScheduleSchema = z
  .object({
    invoice: z.object({ id: z.string(), number: z.string() }),
    issuedOn: viewDateSchema,
    lineId: z.string(),
    /** The line's place on its invoice, from 1. */
    position: z.int().min(1),
    pattern: z.enum(['over_time', 'point_in_time']),
    serviceFrom: viewDateSchema.nullable(),
    serviceTo: viewDateSchema.nullable(),
    milestoneId: z.string().nullable(),
    client: hubPartySchema,
    contract: hubPartySchema.nullable(),
    service: hubPartySchema,
    currency: currencyCodeSchema,
    deferred: ledgerAmountsSchema,
    beforeOpening: ledgerAmountsSchema,
    remaining: ledgerAmountsSchema,
    releasedMonths: z.array(z.string()),
  })
  .meta({ id: 'OpeningSchedule' });

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

/** A records' figure as saved (rule 15). */
export const openingRecordFigureSchema = z
  .object({
    slot: openingFigureSlotSchema,
    clientValueId: z.uuid(),
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
  })
  .meta({ id: 'OpeningRecordFigure' });

/**
 * A client and currency whose records and Hub disagree (check `records_agree`): Hub's items and
 * the records' figure (null when not entered). `client` is the client's value id, or
 * `hub:<external id>` for a Hub client not yet linked.
 */
export const openingDifferenceSchema = z
  .object({
    slot: openingFigureSlotSchema,
    client: z.string(),
    currency: currencyCodeSchema,
    hubMinor: minorUnitsSchema,
    recordsMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'OpeningDifference' });

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
 * `GET /api/opening` (S10 rule 20): the opening's state, the books start and its eve, the latest
 * snapshot's summary (or the one the posted opening used), Hub's items and schedules, the
 * accountant's lines and figures, the records' comparison, the entry it would post with the
 * balancing line, the checks, the fingerprint to post with, the posted entry, and the latest
 * reversed opening.
 */
export const openingViewSchema = z
  .object({
    booksStart: viewDateSchema,
    asOf: viewDateSchema,
    /** Whether the company has a Hub client, so a snapshot is needed (rule 10). */
    hubClient: z.boolean(),
    /** The live opening's state, or null before its first save. */
    state: openingStateSchema.nullable(),
    /** The draft's version to save against: 0 before the first save (rule 16). */
    version: z.int().min(0),
    snapshot: z
      .object({ id: z.uuid(), receivedAt: instantSchema, result: openingSnapshotResultSchema })
      .nullable(),
    hubItems: z.array(openingHubItemSchema),
    schedules: z.array(openingScheduleSchema),
    /** The draft's lines and figures; before a new draft's first save, the reversed one's. */
    recordLines: z.array(openingRecordLineSchema),
    recordFigures: z.array(openingRecordFigureSchema),
    differences: z.array(openingDifferenceSchema),
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
