import { z } from 'zod';
import { currencyCodeSchema, ledgerSchema, rateTypeSchema } from './money.js';
import { entryNumberSchema, minorUnitsSchema, personRefSchema } from './wire.js';

// Periods and the month-end revaluation (S07 "API", ADR 0016): the revaluation's preview per
// ledger and its posting, read on `/api/revaluation/:period` with `periods.read` and posted with
// `revaluation.post`. Amounts are minor units as strings (ADR 0007): a balance's transaction
// amount in its own currency, every other amount in the ledger's currency.

const dateSchema = z.iso.date();
const instantSchema = z.iso.datetime({ offset: true });

/** A month, `YYYY-MM`. */
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month as YYYY-MM')
  .meta({ id: 'Period' });

/** A route's month (`/api/revaluation/:period`). */
export const periodParamSchema = z.object({ period: periodSchema }).meta({ id: 'PeriodParam' });

export type PeriodParam = z.infer<typeof periodParamSchema>;

/** A ledger's revaluation of a month (S07 rule 15, "API"). */
export const REVALUATION_STATES = ['current', 'to_post', 'rate_missing'] as const;

export const revaluationStateSchema = z.enum(REVALUATION_STATES).meta({ id: 'RevaluationState' });

export type RevaluationState = z.infer<typeof revaluationStateSchema>;

/** `GET /api/revaluation/:period?ledger=`: the book ledger unless the parallel is asked for. */
export const revaluationQuerySchema = z
  .object({ ledger: ledgerSchema.default('book') })
  .meta({ id: 'RevaluationQuery' });

export type RevaluationQuery = z.infer<typeof revaluationQuerySchema>;

/** One rate row a closing rate uses, as quoted (ADR 0007: never inverted). */
export const revaluationRateRowSchema = z
  .object({
    rateId: z.uuid(),
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: z.string(),
    effectiveOn: dateSchema,
  })
  .meta({ id: 'RevaluationRateRow' });

/**
 * The closing rate of a currency in the ledger (S07 rule 11): the policy's rate type in force on
 * the month's last day, one row, or two for a cross through the other ledger's currency.
 */
export const closingRateSchema = z
  .object({
    currency: currencyCodeSchema,
    rateType: rateTypeSchema,
    rows: z.array(revaluationRateRowSchema).min(1).max(2),
  })
  .meta({ id: 'ClosingRate' });

export type ClosingRate = z.infer<typeof closingRateSchema>;

/** A closing rate the rate table lacks (`RATE_MISSING`, S07 rule 11), with the day it needs. */
export const missingClosingRateSchema = z
  .object({
    currency: currencyCodeSchema,
    to: currencyCodeSchema,
    rateType: rateTypeSchema,
    on: dateSchema,
  })
  .meta({ id: 'MissingClosingRate' });

export type MissingClosingRate = z.infer<typeof missingClosingRateSchema>;

/** A dimension value a balance carries. */
export const revaluationValueSchema = z
  .object({
    typeCode: z.string(),
    id: z.uuid(),
    code: z.string().nullable(),
    name: z.string(),
    archived: z.boolean(),
  })
  .meta({ id: 'RevaluationValue' });

/**
 * One balance of the preview (S07 rules 10–12): an open item of a monetary control account, or
 * an account, dimension set and currency otherwise. `targetMinor` and `differenceMinor` are null
 * while its currency's closing rate is missing.
 */
export const revaluationBalanceSchema = z
  .object({
    accountId: z.uuid(),
    accountCode: z.string(),
    accountName: z.string(),
    /** A blocked account is revalued, and marked (owner, 2026-11-11). */
    blocked: z.boolean(),
    item: z.object({ id: z.uuid(), reference: z.string() }).nullable(),
    values: z.array(revaluationValueSchema),
    currency: currencyCodeSchema,
    /** Its open transaction balance at the month's end, in `currency`. */
    transactionMinor: minorUnitsSchema,
    /** What it carries in the ledger, without revaluations. */
    carryingMinor: minorUnitsSchema,
    /** Its transaction balance at the closing rate. */
    targetMinor: minorUnitsSchema.nullable(),
    /** What revaluations dated on the month's last day already posted on it. */
    revaluedMinor: minorUnitsSchema,
    /** `target − carrying − revalued`: what a posting adds now. */
    differenceMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'RevaluationBalance' });

export type RevaluationBalance = z.infer<typeof revaluationBalanceSchema>;

/** An entry a revaluation posted: the revaluation on the last day, or its reversal. */
export const revaluationEntryRefSchema = z
  .object({ id: z.uuid(), date: dateSchema })
  .extend(entryNumberSchema.shape)
  .meta({ id: 'RevaluationEntryRef' });

/** A posted revaluation (S07 "Data"): its entry and reversal, whether it adjusted an earlier one. */
export const postedRevaluationSchema = z
  .object({
    id: z.uuid(),
    period: periodSchema,
    ledger: ledgerSchema,
    adjusting: z.boolean(),
    fingerprint: z.string(),
    entry: revaluationEntryRefSchema,
    reversal: revaluationEntryRefSchema,
    userId: z.uuid(),
    createdAt: instantSchema,
  })
  .meta({ id: 'PostedRevaluation' });

export type PostedRevaluation = z.infer<typeof postedRevaluationSchema>;

/** `GET /api/revaluation/:period`: one ledger's preview of the month (S07 "API"). */
export const revaluationPreviewSchema = z
  .object({
    period: periodSchema,
    ledger: ledgerSchema,
    ledgerCurrency: currencyCodeSchema,
    /** The month's last day: the revaluation's date. */
    lastDay: dateSchema,
    /** Whether the month has ended in Asia/Damascus: a posting waits for it (rule 16). */
    ended: z.boolean(),
    state: revaluationStateSchema,
    /** The hash of the balances, amounts and rate rows, which a posting repeats (rule 17). */
    fingerprint: z.string(),
    closingRates: z.array(closingRateSchema),
    missingRates: z.array(missingClosingRateSchema),
    balances: z.array(revaluationBalanceSchema),
    /** The gains and the losses a posting adds now, each positive, never netted. */
    gainMinor: minorUnitsSchema,
    lossMinor: minorUnitsSchema,
    posted: z.array(postedRevaluationSchema),
  })
  .meta({ id: 'RevaluationPreview' });

export type RevaluationPreview = z.infer<typeof revaluationPreviewSchema>;

const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected the preview fingerprint');

/** `POST /api/revaluation/:period`: the ledger and the preview it posts (rule 17). */
export const revaluationPostSchema = z
  .object({ ledger: ledgerSchema, fingerprint: fingerprintSchema })
  .meta({ id: 'RevaluationPost' });

export type RevaluationPost = z.infer<typeof revaluationPostSchema>;

/** The posting's answer: `posted: false` when every difference was zero (rule 17). */
export const revaluationPostResultSchema = z
  .object({
    posted: z.boolean(),
    revaluation: postedRevaluationSchema.nullable(),
    entryId: z.uuid().nullable(),
    reversalEntryId: z.uuid().nullable(),
  })
  .meta({ id: 'RevaluationPostResult' });

export type RevaluationPostResult = z.infer<typeof revaluationPostResultSchema>;

// Periods and the close (S07 rules 1–9, "API"): a month's state, its history of closes and reopens
// and its pre-close checklist, read with `periods.read`; closed and reopened with `periods.close`.

/** A period's state (S07 rule 1); Hub reads `reopened` as `open` (no `/v1` change). */
export const PERIOD_STATES = ['open', 'closed', 'reopened'] as const;

export const periodStateSchema = z.enum(PERIOD_STATES).meta({ id: 'PeriodState' });

export type PeriodState = z.infer<typeof periodStateSchema>;

/** A row of a period's history (S07 "Data", `period_events`). */
export const PERIOD_EVENT_KINDS = ['closed', 'reopened'] as const;

export const periodEventKindSchema = z.enum(PERIOD_EVENT_KINDS).meta({ id: 'PeriodEventKind' });

export type PeriodEventKind = z.infer<typeof periodEventKindSchema>;

/**
 * The pre-close checklist (S07 rule 8), in its order: a failed close names its failing items in
 * this order. Append-only: S08 appended `reconciliation_clean` (S08 rule 12, no override).
 */
export const CHECKLIST_ITEMS = [
  'bulletins_recorded',
  'closing_rates_recorded',
  'no_drafts',
  'open_items_agree',
  'no_held_events',
  'releases_posted',
  'revaluation_current',
  'reconciliation_clean',
] as const;

export const checklistItemNameSchema = z.enum(CHECKLIST_ITEMS).meta({ id: 'ChecklistItemName' });

export type ChecklistItemName = z.infer<typeof checklistItemNameSchema>;

/**
 * The items of features removed with Hub (ADR 0021): held events (S05), the revenue releases
 * (S06) and the daily reconciliation (S08). A close's stored checklist may name them; a new
 * checklist does not.
 */
export const RETIRED_CHECKLIST_ITEMS = [
  'no_held_events',
  'releases_posted',
  'reconciliation_clean',
] as const satisfies readonly ChecklistItemName[];

/** What an item answers (S07 rule 8). */
export const CHECKLIST_RESULTS = ['passed', 'failed', 'not_applicable'] as const;

export const checklistResultSchema = z.enum(CHECKLIST_RESULTS).meta({ id: 'ChecklistResult' });

export type ChecklistResult = z.infer<typeof checklistResultSchema>;

/**
 * One item of a month's checklist: its result and, when it fails, how many things fail it (missing
 * publication days, missing closing rates, drafts, control accounts that differ, held events,
 * missing releases, stale revaluations) and the ledgers it fails in, where the item reads a
 * ledger. The screen links each item to the page that fixes it (S07 "Screens").
 */
export const checklistItemSchema = z
  .object({
    item: checklistItemNameSchema,
    result: checklistResultSchema,
    count: z.int().min(0),
    ledgers: z.array(ledgerSchema),
  })
  .meta({ id: 'ChecklistItem' });

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

/** The failing items of a checklist, in its order (`CHECKLIST_FAILED`'s detail). */
export function failingItems(checklist: readonly ChecklistItem[]): ChecklistItemName[] {
  return CHECKLIST_ITEMS.filter((name) =>
    checklist.some((item) => item.item === name && item.result === 'failed'),
  );
}

/** A close's or a reopen's reason (S07 "Data": text of 1 to 500 characters). */
export const periodReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .meta({ id: 'PeriodReason' });

export type PeriodReason = z.infer<typeof periodReasonSchema>;

/** A close or a reopen as the history shows it. */
export const periodEventSchema = z
  .object({
    id: z.uuid(),
    kind: periodEventKindSchema,
    reason: z.string(),
    user: personRefSchema,
    createdAt: instantSchema,
  })
  .meta({ id: 'PeriodEvent' });

export type PeriodEvent = z.infer<typeof periodEventSchema>;

/** `GET /api/periods?from=&to=`: at most 24 months; the first period to this month by default. */
export const periodsQuerySchema = z
  .object({ from: periodSchema.optional(), to: periodSchema.optional() })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'from comes before to',
    path: ['to'],
  })
  .meta({ id: 'PeriodsQuery' });

export type PeriodsQuery = z.infer<typeof periodsQuerySchema>;

/** The longest range `GET /api/periods` answers. */
export const PERIODS_RANGE_LIMIT = 24;

/**
 * A month of the list: its state (`open` for a month with no row yet), whether it has ended in
 * Asia/Damascus, its last event, and for an ended month not closed the count of failing checklist
 * items (zero when every item passes).
 */
export const periodSummarySchema = z
  .object({
    period: periodSchema,
    state: periodStateSchema,
    ended: z.boolean(),
    lastEvent: periodEventSchema.nullable(),
    failingItems: z.int().min(0).nullable(),
  })
  .meta({ id: 'PeriodSummary' });

export type PeriodSummary = z.infer<typeof periodSummarySchema>;

/** `GET /api/periods/:period`: the month, its history (oldest first) and its checklist. */
export const periodDetailSchema = z
  .object({
    period: periodSchema,
    state: periodStateSchema,
    ended: z.boolean(),
    /** The company's first period: months close in order from it (rule 2); null before any. */
    firstPeriod: periodSchema.nullable(),
    history: z.array(periodEventSchema),
    checklist: z.array(checklistItemSchema),
  })
  .meta({ id: 'PeriodDetail' });

export type PeriodDetail = z.infer<typeof periodDetailSchema>;

/** `POST /api/periods/:period/reopen`'s answer: the month reopened. */
export const periodReopenResultSchema = z
  .object({ period: periodDetailSchema })
  .meta({ id: 'PeriodReopenResult' });

export type PeriodReopenResult = z.infer<typeof periodReopenResultSchema>;

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

/** The months of a range in order, `YYYY-MM` (from `events.ts`, which left with Hub, ADR 0021). */
export function monthsOf(range: { readonly from: string; readonly to: string }): string[] {
  const months: string[] = [];
  for (let index = monthIndex(range.from); index <= monthIndex(range.to); index += 1) {
    const year = Math.floor((index - 1) / 12);
    const month = index - year * 12;
    months.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}
