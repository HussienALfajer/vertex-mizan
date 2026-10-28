import { DomainError } from '@vertex-mizan/contracts';
import { describe, expect, it } from 'vitest';
import { checkManualEntryDate } from './manual.js';

function refusal(on: string, today: string): string {
  try {
    checkManualEntryDate(on, today);
    return 'accepted';
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
}

describe('checkManualEntryDate (S03 rule 6)', () => {
  it('accepts any date up to the last day of the current month', () => {
    expect(refusal('2026-10-28', '2026-10-28')).toBe('accepted');
    expect(refusal('2026-10-31', '2026-10-01')).toBe('accepted');
    expect(refusal('2026-01-15', '2026-10-28')).toBe('accepted');
  });

  it('refuses a date after the current month', () => {
    expect(refusal('2026-11-01', '2026-10-31')).toBe('ENTRY_DATE_OUT_OF_RANGE');
    expect(refusal('2027-01-01', '2026-12-31')).toBe('ENTRY_DATE_OUT_OF_RANGE');
  });

  it('takes the month at posting: a December date posted on 2 January is a back-date (edge case 17)', () => {
    expect(refusal('2026-12-31', '2027-01-02')).toBe('accepted');
  });

  it('accepts the last day of February in a leap year', () => {
    expect(refusal('2028-02-29', '2028-02-01')).toBe('accepted');
  });

  it('refuses what is not a date', () => {
    expect(() => checkManualEntryDate('2026-11', '2026-10-28')).toThrow(RangeError);
  });
});
