import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ATTACHMENT_LIMIT,
  ATTACHMENT_MAX_BYTES,
  accountLinesQuerySchema,
  DRAFT_LINE_LIMIT,
  dealtRateSchema,
  draftInputSchema,
  draftLineInputSchema,
  entryQuerySchema,
  minorUnitsSchema,
  reverseEntrySchema,
  updateDraftSchema,
} from './entries.js';

const line = {
  accountId: '019a2b3c-0000-7000-8000-000000000001',
  dimensionValueIds: [],
  currency: 'USD',
  amountMinor: '10000',
  memo: null,
};

describe('minorUnitsSchema', () => {
  it('takes integers in minor units as strings, within the stored range', () => {
    for (const text of ['0', '1', '-1225000', '9223372036854775807', '-9223372036854775807']) {
      expect(minorUnitsSchema.safeParse(text).success).toBe(true);
    }
    for (const text of ['', '01', '-0', '1.5', '1e3', ' 1', '9223372036854775808', '+1']) {
      expect(minorUnitsSchema.safeParse(text).success).toBe(false);
    }
    expect(minorUnitsSchema.safeParse(100).success).toBe(false);
  });
});

describe('draftLineInputSchema', () => {
  it('saves an incomplete line as typed (S03 rule 4)', () => {
    expect(
      draftLineInputSchema.parse({ accountId: null, currency: null, amountMinor: null }),
    ).toEqual({
      accountId: null,
      dimensionValueIds: [],
      currency: null,
      amountMinor: null,
      memo: null,
    });
  });

  it('refuses a zero amount at save and takes a negative amount as a credit (edge case 3)', () => {
    expect(draftLineInputSchema.safeParse({ ...line, amountMinor: '0' }).success).toBe(false);
    expect(draftLineInputSchema.parse({ ...line, amountMinor: '-500' }).amountMinor).toBe('-500');
  });

  it('refuses a dimension value twice, and an empty memo', () => {
    const id = '019a2b3c-0000-7000-8000-000000000002';
    expect(draftLineInputSchema.safeParse({ ...line, dimensionValueIds: [id, id] }).success).toBe(
      false,
    );
    expect(draftLineInputSchema.safeParse({ ...line, memo: ' ' }).success).toBe(false);
  });
});

describe('draftInputSchema', () => {
  it('takes a date alone, the rest by default', () => {
    expect(draftInputSchema.parse({ entryDate: '2026-11-08' })).toEqual({
      entryDate: '2026-11-08',
      description: null,
      reference: null,
      dealtRates: [],
      lines: [],
    });
  });

  it(`takes ${DRAFT_LINE_LIMIT} lines and refuses one more (edge case 20)`, () => {
    const lines = Array.from({ length: DRAFT_LINE_LIMIT }, () => line);
    expect(draftInputSchema.safeParse({ entryDate: '2026-11-08', lines }).success).toBe(true);
    expect(
      draftInputSchema.safeParse({ entryDate: '2026-11-08', lines: [...lines, line] }).success,
    ).toBe(false);
  });

  it('takes one dealt rate per pair, either way round (S03 rule 13)', () => {
    const rate = { base: 'USD', quote: 'SYP', rate: '122.5000' };
    expect(
      draftInputSchema.safeParse({ entryDate: '2026-11-08', dealtRates: [rate] }).success,
    ).toBe(true);
    expect(
      draftInputSchema.safeParse({
        entryDate: '2026-11-08',
        dealtRates: [rate, { base: 'SYP', quote: 'USD', rate: '0.0082' }],
      }).success,
    ).toBe(false);
    expect(dealtRateSchema.safeParse({ ...rate, quote: 'USD' }).success).toBe(false);
    expect(dealtRateSchema.safeParse({ ...rate, rate: '0' }).success).toBe(false);
  });

  it('refuses a description over 500 characters and trims it', () => {
    expect(
      draftInputSchema.parse({ entryDate: '2026-11-08', description: ' شراء دولار ' }).description,
    ).toBe('شراء دولار');
    expect(
      draftInputSchema.safeParse({ entryDate: '2026-11-08', description: 'ب'.repeat(501) }).success,
    ).toBe(false);
  });

  it('needs the time the draft was read to update it (stale writes, S03 "API")', () => {
    expect(updateDraftSchema.safeParse({ entryDate: '2026-11-08' }).success).toBe(false);
    expect(
      updateDraftSchema.safeParse({ entryDate: '2026-11-08', updatedAt: '2026-11-08T09:00:00Z' })
        .success,
    ).toBe(true);
  });
});

describe('the queries', () => {
  it('reads dimension values as a comma list', () => {
    const a = '019a2b3c-0000-7000-8000-000000000003';
    const b = '019a2b3c-0000-7000-8000-000000000004';
    expect(accountLinesQuerySchema.parse({ dims: `${a},${b}` }).dims).toEqual([a, b]);
    expect(accountLinesQuerySchema.parse({}).dims).toEqual([]);
    expect(accountLinesQuerySchema.safeParse({ dims: 'x' }).success).toBe(false);
  });

  it('reads numbers from the query string', () => {
    expect(entryQuerySchema.parse({ number: '12', fiscalYear: '2026' })).toEqual({
      number: 12,
      fiscalYear: 2026,
    });
    expect(entryQuerySchema.safeParse({ number: '0' }).success).toBe(false);
  });

  it('needs a description to reverse', () => {
    expect(reverseEntrySchema.safeParse({ date: '2026-11-08' }).success).toBe(false);
  });
});

it('keeps the attachment limits of S03 rule 17', () => {
  expect(ATTACHMENT_MAX_BYTES).toBe(10_485_760);
  expect(ATTACHMENT_LIMIT).toBe(20);
});

it('converts every S03 schema to JSON Schema with its id', () => {
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    target: 'draft-2020-12',
    unrepresentable: 'throw',
    io: 'input',
  });
  expect(Object.keys(schemas)).toEqual(
    expect.arrayContaining([
      'MinorUnits',
      'MoneyAmount',
      'DraftInput',
      'UpdateDraft',
      'Draft',
      'DraftPage',
      'EntryPreview',
      'Entry',
      'EntryPage',
      'ReverseEntry',
      'ReversalResult',
      'PostedDraft',
      'AccountLinesPage',
      'AccountLinesQuery',
    ]),
  );
});
