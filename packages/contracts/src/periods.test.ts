import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MOVEMENT_KINDS } from './open-items.js';
import {
  periodSchema,
  REVALUATION_STATES,
  revaluationPostSchema,
  revaluationPreviewSchema,
  revaluationQuerySchema,
} from './periods.js';

const FINGERPRINT = 'a'.repeat(64);

describe('the revaluation schemas (S07 "API")', () => {
  it('read a month as YYYY-MM only', () => {
    expect(periodSchema.safeParse('2026-11').success).toBe(true);
    for (const text of ['2026-13', '2026-1', '2026-11-30', '26-11']) {
      expect(periodSchema.safeParse(text).success).toBe(false);
    }
  });

  it('preview the book ledger unless the parallel is asked for', () => {
    expect(revaluationQuerySchema.parse({})).toEqual({ ledger: 'book' });
    expect(revaluationQuerySchema.parse({ ledger: 'parallel' })).toEqual({ ledger: 'parallel' });
    expect(revaluationQuerySchema.safeParse({ ledger: 'both' }).success).toBe(false);
  });

  it('post a ledger with the fingerprint of its preview (rule 17)', () => {
    expect(revaluationPostSchema.parse({ ledger: 'book', fingerprint: FINGERPRINT })).toEqual({
      ledger: 'book',
      fingerprint: FINGERPRINT,
    });
    for (const fingerprint of ['', 'A'.repeat(64), 'a'.repeat(63)]) {
      expect(revaluationPostSchema.safeParse({ ledger: 'book', fingerprint }).success).toBe(false);
    }
  });

  it('keep the states and the movement kind S07 appends', () => {
    expect(REVALUATION_STATES).toEqual(['current', 'to_post', 'rate_missing']);
    expect(MOVEMENT_KINDS.at(-1)).toBe('revaluation');
  });

  it('carry a preview with null amounts while a closing rate is missing', () => {
    const preview = revaluationPreviewSchema.parse({
      period: '2026-11',
      ledger: 'book',
      ledgerCurrency: 'SYP',
      lastDay: '2026-11-30',
      ended: true,
      state: 'rate_missing',
      fingerprint: FINGERPRINT,
      closingRates: [],
      missingRates: [{ currency: 'USD', to: 'SYP', rateType: 'bulletin', on: '2026-11-30' }],
      balances: [
        {
          accountId: '01890000-0000-7000-8000-000000000001',
          accountCode: '112001',
          accountName: 'الذمم المدينة',
          blocked: false,
          item: { id: '01890000-0000-7000-8000-000000000002', reference: 'M-1' },
          values: [],
          currency: 'USD',
          transactionMinor: '100000',
          carryingMinor: '12000000',
          targetMinor: null,
          revaluedMinor: '0',
          differenceMinor: null,
        },
      ],
      gainMinor: '0',
      lossMinor: '0',
      posted: [],
    });
    expect(preview.balances[0]?.targetMinor).toBeNull();
  });

  it('convert to JSON Schema with their ids', () => {
    const schema = z.toJSONSchema(revaluationPreviewSchema, { io: 'input' }) as {
      $defs?: Record<string, unknown>;
    };
    expect(Object.keys(schema.$defs ?? {})).toEqual(
      expect.arrayContaining(['RevaluationBalance', 'ClosingRate', 'PostedRevaluation']),
    );
  });
});
