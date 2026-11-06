import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { draftLineInputSchema } from './entries.js';
import {
  AGEING_BUCKETS,
  ageingBucketOf,
  ageingQuerySchema,
  changeDueDateSchema,
  clientStatementQuerySchema,
  openItemQuerySchema,
} from './open-items.js';

const ACCOUNT = '01890000-0000-7000-8000-000000000001';
const OTHER = '01890000-0000-7000-8000-000000000002';
const ITEM = '01890000-0000-7000-8000-000000000003';

describe('ageingBucketOf (S04 rule 16)', () => {
  it('puts each boundary in its bucket', () => {
    const cases: [number, (typeof AGEING_BUCKETS)[number]][] = [
      [-10, 'not_due'],
      [0, 'not_due'],
      [1, 'days_1_30'],
      [30, 'days_1_30'],
      [31, 'days_31_60'],
      [60, 'days_31_60'],
      [61, 'days_61_90'],
      [90, 'days_61_90'],
      [91, 'days_91_180'],
      [180, 'days_91_180'],
      [181, 'over_180'],
      [10_000, 'over_180'],
    ];
    for (const [days, bucket] of cases) expect(ageingBucketOf(days)).toBe(bucket);
  });

  it('never moves an item to an earlier bucket as it ages (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -400, max: 400 }), fc.nat({ max: 400 }), (days, more) => {
        const before = AGEING_BUCKETS.indexOf(ageingBucketOf(days));
        expect(AGEING_BUCKETS.indexOf(ageingBucketOf(days + more))).toBeGreaterThanOrEqual(before);
      }),
    );
  });

  it('refuses a fraction of a day', () => {
    expect(() => ageingBucketOf(1.5)).toThrow(RangeError);
  });
});

describe('the receivables queries', () => {
  it('lists open items by default', () => {
    expect(openItemQuerySchema.parse({})).toEqual({ state: 'open' });
    expect(openItemQuerySchema.safeParse({ state: 'closed' }).success).toBe(false);
  });

  it('reads the ageing accounts as a list of ids, in the book ledger by default', () => {
    expect(ageingQuerySchema.parse({ accounts: `${ACCOUNT},${OTHER},${ACCOUNT}` })).toEqual({
      ledger: 'book',
      accounts: [ACCOUNT, OTHER],
    });
    expect(ageingQuerySchema.parse({})).toEqual({ ledger: 'book', accounts: [] });
    expect(ageingQuerySchema.safeParse({ accounts: 'not-an-id' }).success).toBe(false);
    expect(ageingQuerySchema.safeParse({ ledger: 'tax' }).success).toBe(false);
  });

  it('refuses a statement range that ends before it starts', () => {
    expect(
      clientStatementQuerySchema.safeParse({ from: '2026-11-30', to: '2026-11-01' }).success,
    ).toBe(false);
    expect(clientStatementQuerySchema.parse({ from: '2026-11-01', to: '2026-11-01' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-01',
      ledger: 'book',
    });
  });

  it('changes a due date only with a reason (rule 15)', () => {
    expect(changeDueDateSchema.safeParse({ dueOn: '2026-12-03', reason: ' ' }).success).toBe(false);
    expect(changeDueDateSchema.parse({ dueOn: '2026-12-03', reason: ' agreed ' })).toEqual({
      dueOn: '2026-12-03',
      reason: 'agreed',
    });
  });
});

describe('a draft line on a control account (S04 rules 6–7)', () => {
  const line = {
    accountId: ACCOUNT,
    currency: 'USD',
    amountMinor: '-40000',
  };

  it('names no item by default', () => {
    expect(draftLineInputSchema.parse(line)).toMatchObject({ openItemId: null, newItem: null });
  });

  it('opens an item with a reference and an optional due date', () => {
    expect(draftLineInputSchema.parse({ ...line, newItem: { reference: ' M-1 ' } })).toMatchObject({
      newItem: { reference: 'M-1', dueOn: null },
    });
    expect(draftLineInputSchema.safeParse({ ...line, newItem: { reference: '' } }).success).toBe(
      false,
    );
    expect(
      draftLineInputSchema.safeParse({ ...line, newItem: { reference: 'x'.repeat(101) } }).success,
    ).toBe(false);
  });

  it('moves an item or opens one, never both', () => {
    expect(draftLineInputSchema.parse({ ...line, openItemId: ITEM })).toMatchObject({
      openItemId: ITEM,
    });
    expect(
      draftLineInputSchema.safeParse({
        ...line,
        openItemId: ITEM,
        newItem: { reference: 'M-1' },
      }).success,
    ).toBe(false);
  });
});

it('converts every S04 schema to JSON Schema with its id', () => {
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    target: 'draft-2020-12',
    unrepresentable: 'throw',
    io: 'input',
  });
  expect(Object.keys(schemas)).toEqual(
    expect.arrayContaining([
      'OpenItemQuery',
      'OpenItemPage',
      'OpenItem',
      'OpenItemAsOfQuery',
      'ChangeDueDate',
      'AgeingQuery',
      'AgeingReport',
      'ClientFundsQuery',
      'ClientFunds',
      'ClientStatementQuery',
      'ClientStatement',
      'NewItem',
      'EntryLineItem',
      'PreviewItem',
    ]),
  );
});
