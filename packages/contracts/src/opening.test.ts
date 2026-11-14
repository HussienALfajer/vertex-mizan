import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OPENING_CHECKS, saveOpeningSchema } from './opening.js';
import {
  openingEntryResultSchema,
  openingExportQuerySchema,
  openingViewSchema,
  reverseOpeningSchema,
} from './opening-view.js';

// Synthetic ids and amounts only (AGENTS.md: public repository).
const id = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('saveOpeningSchema (S10 rule 16)', () => {
  it('reads lines with their defaults and refuses a zero amount', () => {
    const parsed = saveOpeningSchema.parse({
      version: 0,
      lines: [{ accountId: id(2), currency: 'SYP', amount: '-100' }],
    });
    expect(parsed.lines[0]).toMatchObject({
      book: null,
      parallel: null,
      itemReference: null,
      dimensionValueIds: [],
    });
    expect(
      saveOpeningSchema.safeParse({
        version: 1,
        lines: [{ accountId: id(2), currency: 'SYP', amount: '0' }],
      }).success,
    ).toBe(false);
  });

  it('lists the checks in the order a refusal names them', () => {
    expect(OPENING_CHECKS).toEqual(['rates', 'mappings', 'lines']);
  });
});

describe('the view of GET /api/opening (S10 rule 20)', () => {
  it('converts to JSON Schema with its ids', () => {
    for (const schema of [openingViewSchema, openingEntryResultSchema, reverseOpeningSchema]) {
      expect(() =>
        z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' }),
      ).not.toThrow();
    }
    expect(reverseOpeningSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(reverseOpeningSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it("takes the export's part, the preview only", () => {
    expect(openingExportQuerySchema.parse({ part: 'preview' })).toEqual({ part: 'preview' });
    expect(openingExportQuerySchema.safeParse({ part: 'agreement' }).success).toBe(false);
    expect(openingExportQuerySchema.safeParse({}).success).toBe(false);
  });
});
