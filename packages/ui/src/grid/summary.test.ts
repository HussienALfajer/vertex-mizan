import type { CurrencyCode } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AmountKind, GridColumn } from './cells';
import { summarizeSelection } from './summary';

/** A synthetic line: a transaction amount in its own currency, book in SYP and parallel in USD. */
interface Line {
  readonly memo: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint | null;
  readonly book: bigint | null;
  readonly parallel: bigint | null;
}

const columns: GridColumn<Line>[] = [
  { id: 'memo', type: 'text', value: (line) => line.memo },
  {
    id: 'amount',
    type: 'amount',
    kind: 'transaction',
    valueMinor: (line) => line.amount,
    currency: (line) => line.currency,
  },
  { id: 'book', type: 'amount', kind: 'book', valueMinor: (l) => l.book, currency: () => 'SYP' },
  {
    id: 'parallel',
    type: 'amount',
    kind: 'parallel',
    valueMinor: (line) => line.parallel,
    currency: () => 'USD',
  },
];

const all = (rowCount: number) => ({
  firstRow: 0,
  lastRow: rowCount - 1,
  firstColumn: 0,
  lastColumn: 3,
});

describe('summarizeSelection', () => {
  it('never adds a transaction USD amount to a parallel USD amount', () => {
    const lines: Line[] = [
      { memo: 'a', currency: 'USD', amount: 10000n, book: 1300000n, parallel: 10000n },
      { memo: 'b', currency: 'USD', amount: -2500n, book: -325000n, parallel: -2500n },
      { memo: 'c', currency: 'SYP', amount: 650000n, book: 650000n, parallel: 5000n },
      { memo: 'd', currency: 'USD', amount: null, book: null, parallel: null },
    ];
    expect(summarizeSelection(lines, columns, all(lines.length))).toEqual([
      {
        kind: 'transaction',
        summaries: [
          {
            currency: 'USD',
            count: 2,
            sumMinor: 7500n,
            averageMinor: 3750n,
            minMinor: -2500n,
            maxMinor: 10000n,
          },
          {
            currency: 'SYP',
            count: 1,
            sumMinor: 650000n,
            averageMinor: 650000n,
            minMinor: 650000n,
            maxMinor: 650000n,
          },
        ],
      },
      {
        kind: 'book',
        summaries: [
          {
            currency: 'SYP',
            count: 3,
            sumMinor: 1625000n,
            averageMinor: 541667n,
            minMinor: -325000n,
            maxMinor: 1300000n,
          },
        ],
      },
      {
        kind: 'parallel',
        summaries: [
          {
            currency: 'USD',
            count: 3,
            sumMinor: 12500n,
            averageMinor: 4167n,
            minMinor: -2500n,
            maxMinor: 10000n,
          },
        ],
      },
    ]);
  });

  it('is empty for text and empty cells', () => {
    const lines: Line[] = [{ memo: 'a', currency: 'USD', amount: null, book: null, parallel: 1n }];
    expect(
      summarizeSelection(lines, columns, {
        firstRow: 0,
        lastRow: 0,
        firstColumn: 0,
        lastColumn: 2,
      }),
    ).toEqual([]);
  });

  it('sums each kind and currency apart, and counts every amount once (property)', () => {
    const value = fc.option(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), { nil: null });
    const line = fc.record({
      memo: fc.constant(''),
      currency: fc.constantFrom<CurrencyCode>('USD', 'SYP', 'TRY', 'EUR'),
      amount: value,
      book: value,
      parallel: value,
    });
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 30 }), (lines) => {
        const expected = new Map<string, bigint[]>();
        const add = (kind: AmountKind, currency: CurrencyCode, amount: bigint | null) => {
          if (amount === null) return;
          const key = `${kind}:${currency}`;
          expected.set(key, [...(expected.get(key) ?? []), amount]);
        };
        for (const l of lines) {
          add('transaction', l.currency, l.amount);
          add('book', 'SYP', l.book);
          add('parallel', 'USD', l.parallel);
        }
        const actual = new Map<string, bigint[]>();
        for (const { kind, summaries } of summarizeSelection(lines, columns, all(lines.length))) {
          for (const s of summaries) {
            const amounts = expected.get(`${kind}:${s.currency}`) ?? [];
            const total = amounts.reduce((a, b) => a + b, 0n);
            expect(s.count).toBe(amounts.length);
            expect(s.sumMinor).toBe(total);
            expect(s.minMinor).toBe(amounts.reduce((a, b) => (b < a ? b : a)));
            expect(s.maxMinor).toBe(amounts.reduce((a, b) => (b > a ? b : a)));
            actual.set(`${kind}:${s.currency}`, amounts);
          }
        }
        expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
      }),
    );
  });
});
