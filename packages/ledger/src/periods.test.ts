import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fiscalYearOf, lastDayOfMonth, periodOf } from './periods.js';

describe('periodOf', () => {
  it('is the calendar month of the date', () => {
    expect(periodOf('2026-11-08')).toBe('2026-11');
    expect(periodOf('2026-01-01')).toBe('2026-01');
  });

  it('refuses what is not a date', () => {
    expect(() => periodOf('2026-11')).toThrow(RangeError);
    expect(() => periodOf('2026-13-01')).toThrow(RangeError);
    expect(() => periodOf('2026-02-29')).toThrow(RangeError);
  });
});

describe('lastDayOfMonth', () => {
  it('knows month lengths and leap years (S03 edge case 21)', () => {
    expect(lastDayOfMonth('2026-10-28')).toBe('2026-10-31');
    expect(lastDayOfMonth('2026-11-01')).toBe('2026-11-30');
    expect(lastDayOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(lastDayOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(lastDayOfMonth('2100-02-10')).toBe('2100-02-28');
    expect(lastDayOfMonth('2000-02-10')).toBe('2000-02-29');
  });
});

describe('fiscalYearOf', () => {
  it('is the calendar year with a January start', () => {
    expect(fiscalYearOf('2026-01-01', 1)).toBe(2026);
    expect(fiscalYearOf('2026-12-31', 1)).toBe(2026);
  });

  it('restarts on the first day of the start month, named after the year it starts in (edge case 18)', () => {
    expect(fiscalYearOf('2027-06-30', 7)).toBe(2026);
    expect(fiscalYearOf('2027-07-01', 7)).toBe(2027);
    expect(fiscalYearOf('2026-12-31', 7)).toBe(2026);
  });

  it('refuses a start month outside 1–12', () => {
    expect(() => fiscalYearOf('2026-11-08', 0)).toThrow(RangeError);
    expect(() => fiscalYearOf('2026-11-08', 13)).toThrow(RangeError);
  });

  it('holds every day of a fiscal year in one year, whatever the start month', () => {
    const dates = fc
      .date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z') })
      .map((date) => date.toISOString().slice(0, 10));
    fc.assert(
      fc.property(dates, fc.integer({ min: 1, max: 12 }), (date, start) => {
        const year = fiscalYearOf(date, start);
        const first = `${year}-${String(start).padStart(2, '0')}-01`;
        const next = `${year + 1}-${String(start).padStart(2, '0')}-01`;
        expect(date >= first && date < next).toBe(true);
      }),
    );
  });
});
