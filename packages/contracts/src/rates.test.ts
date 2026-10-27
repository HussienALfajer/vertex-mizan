import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  addBulletinHolidaySchema,
  createRatePairSchema,
  DEFAULT_BULLETIN_DAYS_OFF,
  recordRateSchema,
  updateRateCalendarSchema,
} from './rates.js';

const bulletin = {
  effectiveOn: '2026-11-04',
  base: 'USD',
  quote: 'SYP',
  rate: '120.0000',
  type: 'bulletin',
  source: 'manual',
};

/** The `params.code` of a schema's custom issues. */
function issueCodes(result: z.ZodSafeParseResult<unknown>): unknown[] {
  return result.success
    ? []
    : result.error.issues.map((issue) => (issue as { params?: { code?: unknown } }).params?.code);
}

describe('recordRateSchema', () => {
  it('accepts a manual rate as quoted, with an optional reason', () => {
    expect(recordRateSchema.parse(bulletin)).toEqual(bulletin);
    expect(recordRateSchema.parse({ ...bulletin, reason: ' تصحيح ' }).reason).toBe('تصحيح');
  });

  it('refuses a source other than manual', () => {
    expect(recordRateSchema.safeParse({ ...bulletin, source: 'hub' }).success).toBe(false);
  });

  it('refuses a zero rate, eleven decimals and an empty reason', () => {
    for (const rate of ['0', '0.0000', '-1', '1.12345678901']) {
      expect(recordRateSchema.safeParse({ ...bulletin, rate }).success).toBe(false);
    }
    expect(recordRateSchema.safeParse({ ...bulletin, reason: ' ' }).success).toBe(false);
  });

  it('keeps the money module codes on a pair of one currency and an SYP rate before 2026', () => {
    expect(issueCodes(recordRateSchema.safeParse({ ...bulletin, quote: 'USD' }))).toContain(
      'INVALID_RATE',
    );
    expect(
      issueCodes(recordRateSchema.safeParse({ ...bulletin, effectiveOn: '2025-12-31' })),
    ).toContain('SYP_BEFORE_REDENOMINATION');
  });
});

describe('the pair and calendar schemas', () => {
  it('refuse a pair of one currency', () => {
    expect(createRatePairSchema.safeParse({ base: 'USD', quote: 'USD' }).success).toBe(false);
    expect(createRatePairSchema.safeParse({ base: 'USD', quote: 'SYP' }).success).toBe(true);
  });

  it('default to Friday and Saturday off, and keep one publication day at least', () => {
    expect(DEFAULT_BULLETIN_DAYS_OFF).toEqual([5, 6]);
    expect(updateRateCalendarSchema.safeParse({ daysOff: [] }).success).toBe(true);
    expect(updateRateCalendarSchema.safeParse({ daysOff: [5] }).success).toBe(true);
    expect(updateRateCalendarSchema.safeParse({ daysOff: [5, 5] }).success).toBe(false);
    expect(updateRateCalendarSchema.safeParse({ daysOff: [0] }).success).toBe(false);
    expect(updateRateCalendarSchema.safeParse({ daysOff: [1, 2, 3, 4, 5, 6, 7] }).success).toBe(
      false,
    );
  });

  it('take a holiday as a date with a note', () => {
    expect(addBulletinHolidaySchema.safeParse({ on: '2028-02-29', note: 'عطلة' }).success).toBe(
      true,
    );
    expect(addBulletinHolidaySchema.safeParse({ on: '2027-02-29', note: 'عطلة' }).success).toBe(
      false,
    );
    expect(addBulletinHolidaySchema.safeParse({ on: '2026-11-05', note: '' }).success).toBe(false);
  });

  it('convert to JSON Schema with their ids', () => {
    const { schemas } = z.toJSONSchema(z.globalRegistry, {
      target: 'draft-2020-12',
      unrepresentable: 'throw',
    });
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'RecordRate',
        'RateRow',
        'RecordedRate',
        'RateQuery',
        'RatePage',
        'RateInForceQuery',
        'RateInForce',
        'RatePair',
        'CreateRatePair',
        'RateCalendar',
        'UpdateRateCalendar',
        'AddBulletinHoliday',
        'BulletinHoliday',
      ]),
    );
  });
});
