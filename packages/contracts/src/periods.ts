import { z } from 'zod';
import { currencyCodeSchema, ledgerSchema, rateTypeSchema } from './money.js';
import { entryNumberSchema, minorUnitsSchema } from './wire.js';

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
