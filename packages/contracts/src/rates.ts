import { z } from 'zod';
import { cursorSchema } from './audit.js';
import {
  currencyCodeSchema,
  exchangeRateSchema,
  rateSourceSchema,
  rateTypeSchema,
  rateValueSchema,
} from './money.js';

/**
 * The company rate table (S02 rules 14–18, ADR 0011): rate pairs with one orientation each, the
 * append-only rate rows with their corrections, and the bulletin publication calendar. The rate in
 * force is `packages/ledger`'s `rateInForce()`.
 */

/** A correction's reason (S02 rule 15). */
const rateReasonSchema = z.string().trim().min(1).max(500);

/**
 * `POST /api/rates`: a manual row of either type. A row for a pair, type and date that already has
 * one is a correction and needs `reason` (`RATE_REASON_REQUIRED`).
 */
export const recordRateSchema = exchangeRateSchema
  .and(z.object({ source: z.literal('manual'), reason: rateReasonSchema.optional() }))
  .meta({ id: 'RecordRate' });

export type RecordRate = z.infer<typeof recordRateSchema>;

/** Who recorded a row: a person (manual) or an API client (Hub, S05). */
export const rateRecorderSchema = z
  .object({ kind: z.enum(['person', 'api_client']), id: z.uuid(), name: z.string() })
  .meta({ id: 'RateRecorder' });

/** A row of the rate table as the API returns it. */
export const rateRowSchema = z
  .object({
    id: z.uuid(),
    effectiveOn: z.iso.date(),
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: rateValueSchema,
    type: rateTypeSchema,
    source: rateSourceSchema,
    supersedesRateId: z.uuid().nullable(),
    reason: z.string().nullable(),
    recordedBy: rateRecorderSchema,
    /** A newer row of the same pair, type and date corrects it. */
    superseded: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'RateRow' });

export type RateRow = z.infer<typeof rateRowSchema>;

/**
 * The answer of `POST /api/rates`: the row and, for a correction, the row it supersedes. The
 * entries that used the superseded row join it with S03, whose lines store their rate rows.
 */
export const recordedRateSchema = z
  .object({ rate: rateRowSchema, superseded: rateRowSchema.nullable() })
  .meta({ id: 'RecordedRate' });

export type RecordedRate = z.infer<typeof recordedRateSchema>;

/** `GET /api/rates`: rows of a pair, newest first. */
export const rateQuerySchema = z
  .object({
    base: currencyCodeSchema.optional(),
    quote: currencyCodeSchema.optional(),
    type: rateTypeSchema.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    cursor: cursorSchema.optional(),
  })
  .meta({ id: 'RateQuery' });

export type RateQuery = z.infer<typeof rateQuerySchema>;

export const ratePageSchema = z
  .object({ rates: z.array(rateRowSchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'RatePage' });

export type RatePage = z.infer<typeof ratePageSchema>;

/** `GET /api/rates/in-force`: the rate of a type converting `from` into `to` on a date. */
export const rateInForceQuerySchema = z
  .object({
    type: rateTypeSchema,
    from: currencyCodeSchema,
    to: currencyCodeSchema,
    on: z.iso.date(),
  })
  .meta({ id: 'RateInForceQuery' });

export type RateInForceQuery = z.infer<typeof rateInForceQuerySchema>;

/** The rate in force: one row, or the two rows of a cross through `via` (ADR 0007). */
export const rateInForceSchema = z
  .object({ rows: z.array(rateRowSchema).min(1).max(2), via: currencyCodeSchema.nullable() })
  .meta({ id: 'RateInForce' });

export type RateInForce = z.infer<typeof rateInForceSchema>;

/** A pair of currencies with the one orientation its rates use (ADR 0011). */
export const ratePairSchema = z
  .object({
    id: z.uuid(),
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'RatePair' });

export type RatePair = z.infer<typeof ratePairSchema>;

/** `POST /api/rate-pairs`. */
export const createRatePairSchema = z
  .object({ base: currencyCodeSchema, quote: currencyCodeSchema })
  .refine((pair) => pair.base !== pair.quote, {
    message: 'A pair has two currencies',
    path: ['quote'],
  })
  .meta({ id: 'CreateRatePair' });

export type CreateRatePair = z.infer<typeof createRatePairSchema>;

/** An ISO weekday, 1 Monday … 7 Sunday. */
export const isoWeekdaySchema = z.int().min(1).max(7).meta({ id: 'IsoWeekday' });

/**
 * The weekly days the bulletin is not published. Friday and Saturday by default, UNVERIFIED as
 * the Central Bank's publication days, so the accountant can change them; one weekday at least
 * stays a publication day.
 */
export const DEFAULT_BULLETIN_DAYS_OFF = [5, 6] as const;

const daysOffSchema = z
  .array(isoWeekdaySchema)
  .max(6)
  .refine((days) => new Set(days).size === days.length, 'Each weekday once');

export const bulletinHolidaySchema = z
  .object({
    id: z.uuid(),
    on: z.iso.date(),
    note: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'BulletinHoliday' });

export type BulletinHoliday = z.infer<typeof bulletinHolidaySchema>;

/** `GET /api/rate-calendar`: the days off and the holidays in force. */
export const rateCalendarSchema = z
  .object({ daysOff: z.array(isoWeekdaySchema), holidays: z.array(bulletinHolidaySchema) })
  .meta({ id: 'RateCalendar' });

export type RateCalendar = z.infer<typeof rateCalendarSchema>;

/** `PUT /api/rate-calendar`. */
export const updateRateCalendarSchema = z
  .object({ daysOff: daysOffSchema })
  .meta({ id: 'UpdateRateCalendar' });

export type UpdateRateCalendar = z.infer<typeof updateRateCalendarSchema>;

/** `POST /api/rate-calendar/holidays`. */
export const addBulletinHolidaySchema = z
  .object({ on: z.iso.date(), note: z.string().trim().min(1).max(200) })
  .meta({ id: 'AddBulletinHoliday' });

export type AddBulletinHoliday = z.infer<typeof addBulletinHolidaySchema>;
