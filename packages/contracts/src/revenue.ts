import { z } from 'zod';
import { HUB_CURRENCIES, PERIOD_STATUS_MONTHS } from './events.js';
import { entryNumberSchema, minorUnitsSchema } from './wire.js';

// The internal API of revenue recognition (S06 "API", "Screens"): the schedules, their movements and
// months, the month summary and the current month's preview, read on `/api/revenue` with
// `recognition.read`. Amounts are minor units as strings (ADR 0007), each in the schedule's
// currency for the transaction and in the ledger's own for the book and the parallel amounts.

const dateSchema = z.iso.date();
const instantSchema = z.iso.datetime({ offset: true });
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

/** A schedule's state, derived from its movements (S06 "Data"). */
export const RECOGNITION_STATES = ['active', 'completed', 'voided'] as const;

export const recognitionStateSchema = z.enum(RECOGNITION_STATES).meta({ id: 'RecognitionState' });

export type RecognitionState = z.infer<typeof recognitionStateSchema>;

/** Amounts a schedule carries: the transaction amount and each ledger's, the parallel's or none. */
export const recognitionAmountsSchema = z
  .object({
    transactionMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema,
    parallelMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'RecognitionAmounts' });

export type RecognitionAmounts = z.infer<typeof recognitionAmountsSchema>;

/** A dimension value a schedule names: its client, contract or service. */
export const recognitionValueSchema = z
  .object({ id: z.uuid(), code: z.string().nullable(), name: z.string() })
  .meta({ id: 'RecognitionValue' });

/** A schedule as `/revenue` lists it. */
export const revenueScheduleSchema = z
  .object({
    id: z.uuid(),
    /** The `invoice.issued` event that opened it, in the inbox. */
    inboxId: z.uuid(),
    invoiceDocumentId: z.uuid(),
    invoiceNumber: z.string(),
    lineId: z.uuid(),
    pattern: z.enum(['over_time', 'point_in_time']),
    lineSource: z.enum(['retainer_charge', 'manual', 'deposit', 'milestone']),
    chargeKind: z.enum(['monthly', 'addition']).nullable(),
    currency: z.enum(HUB_CURRENCIES),
    client: recognitionValueSchema,
    contract: recognitionValueSchema.nullable(),
    /** The service its revenue takes now: its latest reclassification's, else its own. */
    service: recognitionValueSchema,
    serviceFrom: dateSchema.nullable(),
    serviceTo: dateSchema.nullable(),
    milestoneId: z.uuid().nullable(),
    /** Its invoice line's amount, in its currency. */
    amountMinor: minorUnitsSchema,
    /** What it recognised from its liability: releases, elapsed parts, a cancellation's revenue. */
    released: recognitionAmountsSchema,
    /** What it still holds in contract liabilities. */
    remaining: recognitionAmountsSchema,
    state: recognitionStateSchema,
    /** The voided schedule it re-issues (S06 rule 9). */
    reissueOfId: z.uuid().nullable(),
    createdAt: instantSchema,
  })
  .meta({ id: 'RevenueSchedule' });

export type RevenueSchedule = z.infer<typeof revenueScheduleSchema>;

/** `GET /api/revenue/schedules`: by state, client, contract and a month it touches. */
export const revenueScheduleQuerySchema = z
  .object({
    state: recognitionStateSchema.optional(),
    client: z.uuid().optional(),
    contract: z.uuid().optional(),
    month: monthSchema.optional(),
    cursor: z.string().min(1).max(200).optional(),
  })
  .meta({ id: 'RevenueScheduleQuery' });

export type RevenueScheduleQuery = z.infer<typeof revenueScheduleQuerySchema>;

export const revenueSchedulePageSchema = z
  .object({ schedules: z.array(revenueScheduleSchema), nextCursor: z.string().nullable() })
  .meta({ id: 'RevenueSchedulePage' });

export type RevenueSchedulePage = z.infer<typeof revenueSchedulePageSchema>;

/** The kinds of a schedule's movements (S06 "Data"; `packages/db` checks the same list). */
export const REVENUE_MOVEMENT_KINDS = [
  'deferred',
  'elapsed',
  'released',
  'credited',
  'reclassified',
  'reversed',
  'remainder_released',
  'remainder_refunded',
] as const;

/** A movement with its entry: signed, positive adds to what is still to recognise. */
export const revenueMovementSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(REVENUE_MOVEMENT_KINDS),
    month: monthSchema.nullable(),
    entry: z.object({ id: z.uuid(), date: dateSchema }).extend(entryNumberSchema.shape).nullable(),
    amounts: recognitionAmountsSchema,
    /** A credit's part of the schedule (positive), or its void's (negative). */
    creditMinor: minorUnitsSchema.nullable(),
    /** The service a reclassification moved it to. */
    service: recognitionValueSchema.nullable(),
    createdAt: instantSchema,
  })
  .meta({ id: 'RevenueMovement' });

export type RevenueMovement = z.infer<typeof revenueMovementSchema>;

/** An over-time schedule's month: its days, its planned part and its release once posted. */
export const revenueScheduleMonthSchema = z
  .object({
    month: monthSchema,
    days: z.int().min(1),
    /** Recognised at issue as a contract asset (S06 rule 7), not released. */
    elapsed: z.boolean(),
    /** Its part: a released month's posted part, else what the job will release. */
    part: recognitionAmountsSchema,
    released: z.boolean(),
  })
  .meta({ id: 'RevenueScheduleMonth' });

/** `GET /api/revenue/schedules/:id`: the schedule, its movements and its months. */
export const revenueScheduleDetailSchema = revenueScheduleSchema
  .extend({
    movements: z.array(revenueMovementSchema),
    months: z.array(revenueScheduleMonthSchema),
  })
  .meta({ id: 'RevenueScheduleDetail' });

export type RevenueScheduleDetail = z.infer<typeof revenueScheduleDetailSchema>;

/** `GET /api/revenue/months?from=YYYY-MM&to=YYYY-MM`: from on or before to, at most 24 months. */
export const revenueMonthsQuerySchema = z
  .object({ from: monthSchema, to: monthSchema })
  .refine((range) => monthIndex(range.from) <= monthIndex(range.to), {
    path: ['to'],
    message: 'The range ends before it starts',
  })
  .refine((range) => monthIndex(range.to) - monthIndex(range.from) < PERIOD_STATUS_MONTHS, {
    path: ['to'],
    message: `At most ${PERIOD_STATUS_MONTHS} months`,
  })
  .meta({ id: 'RevenueMonthsQuery' });

export type RevenueMonthsQuery = z.infer<typeof revenueMonthsQuerySchema>;

/** A schedule whose release of a month is missing, with what stops it (S06 "Jobs"). */
export const missingReleaseSchema = z
  .object({
    scheduleId: z.uuid(),
    invoiceNumber: z.string(),
    /** `slot_unmapped:<slot>`, `account_blocked:<code>`, `PERIOD_CLOSED`; null for not run yet. */
    reason: z.string().nullable(),
  })
  .meta({ id: 'MissingRelease' });

/** A month's releases (S06 "Screens"): totals in each ledger, the entries, what is missing. */
export const revenueMonthSchema = z
  .object({
    month: monthSchema,
    /** Released in the book ledger, in its currency; and in the parallel, or none. */
    releasedBookMinor: minorUnitsSchema,
    releasedParallelMinor: minorUnitsSchema.nullable(),
    entryCount: z.int().min(0),
    /** Over-time schedules touching the month, ended, without their release. */
    missing: z.array(missingReleaseSchema),
    /** Recognition events held for the accountant, dated in the month. */
    decisionCount: z.int().min(0),
  })
  .meta({ id: 'RevenueMonth' });

export type RevenueMonth = z.infer<typeof revenueMonthSchema>;

/** `GET /api/revenue/preview?month=YYYY-MM`: the current or a past month. */
export const revenuePreviewQuerySchema = z
  .object({ month: monthSchema })
  .meta({ id: 'RevenuePreviewQuery' });

export type RevenuePreviewQuery = z.infer<typeof revenuePreviewQuerySchema>;

/** One invoice's release the job would post for a month, each schedule's part. */
export const revenuePreviewEntrySchema = z
  .object({
    inboxId: z.uuid(),
    invoiceNumber: z.string(),
    /** The entry's date: the month's last day. */
    date: dateSchema,
    lines: z.array(
      z.object({
        scheduleId: z.uuid(),
        client: recognitionValueSchema,
        contract: recognitionValueSchema.nullable(),
        service: recognitionValueSchema,
        amounts: recognitionAmountsSchema,
      }),
    ),
  })
  .meta({ id: 'RevenuePreviewEntry' });

export const revenuePreviewSchema = z
  .object({ month: monthSchema, entries: z.array(revenuePreviewEntrySchema) })
  .meta({ id: 'RevenuePreview' });

export type RevenuePreview = z.infer<typeof revenuePreviewSchema>;
