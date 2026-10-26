import type { CurrencyCode } from '@vertex-mizan/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CellEdit,
  copyRange,
  type GridColumn,
  planClear,
  planFillDown,
  planPaste,
} from './cells';
import { type CellPosition, extendTo, rangeCells, selectCell, selectionRange } from './selection';

/** A synthetic journal line: a memo, the transaction amount and the book and parallel amounts. */
interface Line {
  readonly memo: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint | null;
  readonly book: bigint | null;
  readonly parallel: bigint | null;
  readonly posted?: boolean;
}

const columns: GridColumn<Line>[] = [
  {
    id: 'memo',
    type: 'text',
    value: (line) => line.memo,
    validate: (text) => (text.length > 20 ? 'TOO_LONG' : undefined),
    readOnly: (line) => Boolean(line.posted),
  },
  {
    id: 'amount',
    type: 'amount',
    kind: 'transaction',
    valueMinor: (line) => line.amount,
    currency: (line) => line.currency,
    allowNegative: false,
    readOnly: (line) => Boolean(line.posted),
  },
  {
    id: 'book',
    type: 'amount',
    kind: 'book',
    valueMinor: (line) => line.book,
    currency: () => 'SYP',
    readOnly: true,
  },
  {
    id: 'parallel',
    type: 'amount',
    kind: 'parallel',
    valueMinor: (line) => line.parallel,
    currency: () => 'USD',
  },
];

const lines: Line[] = [
  { memo: 'إيراد خدمات', currency: 'USD', amount: 125050n, book: 1625650n, parallel: 125050n },
  { memo: 'Hosting', currency: 'USD', amount: null, book: null, parallel: null },
  { memo: 'نقدية', currency: 'SYP', amount: 1300000n, book: 1300000n, parallel: -100000n },
  { memo: 'مرحّل', currency: 'USD', amount: 500n, book: 6500n, parallel: 500n, posted: true },
];

const at = (row: number, column: number): CellPosition => ({ row, column });
const range = (from: CellPosition, to: CellPosition) => extendTo(selectCell(from), to);

describe('copyRange', () => {
  it('copies amounts ungrouped with an ASCII minus, empty amounts as empty cells', () => {
    const { tsv, html } = copyRange(lines, columns, selectionRange(range(at(0, 0), at(2, 3))));
    expect(tsv).toBe(
      'إيراد خدمات\t1250.50\t16256.50\t1250.50\r\n' +
        'Hosting\t\t\t\r\n' +
        'نقدية\t13000.00\t13000.00\t-1000.00\r\n',
    );
    expect(html).toContain('<td>-1000.00</td>');
  });
});

describe('planPaste', () => {
  it('pastes a block from the selection’s first cell, amounts parsed in each row’s currency', () => {
    const plan = planPaste(lines, columns, selectCell(at(1, 0)), 'Rent\t1,250.5\r\nCash\t٧٥\r\n');
    expect(plan).toEqual({
      ok: true,
      range: { firstRow: 1, lastRow: 2, firstColumn: 0, lastColumn: 1 },
      edits: [
        { row: 1, column: 0, type: 'text', text: 'Rent' },
        { row: 1, column: 1, type: 'amount', amountMinor: 125050n },
        { row: 2, column: 0, type: 'text', text: 'Cash' },
        { row: 2, column: 1, type: 'amount', amountMinor: 7500n },
      ],
    });
  });

  it('fills the whole selection with a single value, and empties amounts with empty text', () => {
    const plan = planPaste(lines, columns, range(at(0, 3), at(2, 3)), '\r\n');
    expect(plan.ok && plan.edits).toEqual([
      { row: 0, column: 3, type: 'amount', amountMinor: null },
      { row: 1, column: 3, type: 'amount', amountMinor: null },
      { row: 2, column: 3, type: 'amount', amountMinor: null },
    ]);
  });

  it('refuses the whole paste and names every cell when any cell is refused', () => {
    const plan = planPaste(
      lines,
      columns,
      selectCell(at(0, 0)),
      'ok\t12.345\t1\t-5\r\nthis memo is far too long\t-3\t\t(4)\r\n',
    );
    expect(plan).toEqual({
      ok: false,
      problem: 'INVALID_CELLS',
      cells: [
        { row: 0, column: 1, reason: 'AMOUNT', error: 'TOO_MANY_DECIMALS' },
        { row: 0, column: 2, reason: 'READ_ONLY' },
        { row: 1, column: 0, reason: 'TEXT', error: 'TOO_LONG' },
        { row: 1, column: 1, reason: 'AMOUNT', error: 'NEGATIVE_NOT_ALLOWED' },
        { row: 1, column: 2, reason: 'READ_ONLY' },
        { row: 1, column: 3, reason: 'AMOUNT', error: 'INVALID' },
      ],
    });
  });

  it('refuses text that is empty, ragged or larger than the grid', () => {
    const one = selectCell(at(0, 0));
    expect(planPaste(lines, columns, one, '')).toEqual({ ok: false, problem: 'EMPTY' });
    expect(planPaste(lines, columns, one, 'a\tb\r\nc\r\n')).toEqual({
      ok: false,
      problem: 'NOT_RECTANGULAR',
    });
    expect(planPaste(lines, columns, selectCell(at(3, 3)), '1\r\n2\r\n')).toEqual({
      ok: false,
      problem: 'DOES_NOT_FIT',
    });
    expect(planPaste(lines, columns, selectCell(at(0, 3)), '1\t2\r\n')).toEqual({
      ok: false,
      problem: 'DOES_NOT_FIT',
    });
  });

  it('pastes a copy back onto its own cells as the same values (property)', () => {
    const editable = { firstRow: 0, lastRow: 2, firstColumn: 0, lastColumn: 3 };
    const cell = fc.record({
      row: fc.integer({ min: editable.firstRow, max: editable.lastRow }),
      column: fc.constantFrom(0, 1, 3),
    });
    const amount = fc.option(fc.bigInt({ min: 0n, max: 10n ** 15n }), { nil: null });
    const signed = fc.option(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), { nil: null });
    const line = fc.record({
      memo: fc.string({ maxLength: 20, unit: fc.constantFrom('a', 'ب', '\t', '\n', '"', ' ') }),
      currency: fc.constantFrom<CurrencyCode>('USD', 'SYP', 'EUR'),
      amount,
      book: fc.constant(null),
      parallel: signed,
    });
    fc.assert(
      fc.property(fc.array(line, { minLength: 3, maxLength: 3 }), cell, cell, (data, from, to) => {
        const selection = range(from, to);
        const { tsv } = copyRange(data, columns, selectionRange(selection));
        const plan = planPaste(data, columns, selection, tsv);
        if (
          selectionRange(selection).firstColumn <= 2 &&
          selectionRange(selection).lastColumn >= 2
        ) {
          expect(plan.ok).toBe(false);
          return;
        }
        expect(plan.ok).toBe(true);
        for (const edit of plan.ok ? plan.edits : []) {
          const source = data[edit.row] as Line;
          const expected =
            edit.column === 0 ? source.memo : edit.column === 1 ? source.amount : source.parallel;
          expect(edit.type === 'text' ? edit.text : edit.amountMinor).toEqual(expected);
        }
      }),
    );
  });

  it('either changes every target cell or none (property)', () => {
    const text = fc
      .array(
        fc.array(fc.constantFrom('', '1', '-2', '3.5', '4.567', 'x', 'نص', '=2*3', '1,000'), {
          minLength: 1,
          maxLength: 2,
        }),
        { minLength: 1, maxLength: 4 },
      )
      .filter((rows) => rows.every((row) => row.length === (rows[0] as string[]).length))
      .map((rows) => rows.map((row) => `${row.join('\t')}\r\n`).join(''));
    const start = fc.record({
      row: fc.integer({ min: 0, max: 3 }),
      column: fc.integer({ min: 0, max: 3 }),
    });
    fc.assert(
      fc.property(text, start, (clipboard, from) => {
        const plan = planPaste(lines, columns, selectCell(from), clipboard);
        if (!plan.ok) return;
        const targets = [...rangeCells(plan.range)];
        expect(plan.edits.map(({ row, column }) => ({ row, column }))).toEqual(targets);
      }),
    );
  });
});

describe('planFillDown', () => {
  it('copies the first selected row into the rows under it', () => {
    const plan = planFillDown(lines, columns, range(at(0, 0), at(1, 1)));
    expect(plan).toEqual({
      ok: true,
      range: { firstRow: 1, lastRow: 1, firstColumn: 0, lastColumn: 1 },
      edits: [
        { row: 1, column: 0, type: 'text', text: 'إيراد خدمات' },
        { row: 1, column: 1, type: 'amount', amountMinor: 125050n },
      ],
    });
  });

  it('copies the row above into a single selected row, and has nothing above the first', () => {
    const plan = planFillDown(lines, columns, selectCell(at(1, 3)));
    expect(plan.ok && plan.edits).toEqual([
      { row: 1, column: 3, type: 'amount', amountMinor: 125050n },
    ]);
    expect(planFillDown(lines, columns, selectCell(at(0, 0)))).toEqual({
      ok: false,
      problem: 'NOTHING_TO_FILL',
    });
  });

  it('never moves an amount into a row of another currency, nor into a locked cell', () => {
    expect(planFillDown(lines, columns, range(at(1, 1), at(2, 1)))).toEqual({
      ok: true,
      range: { firstRow: 2, lastRow: 2, firstColumn: 1, lastColumn: 1 },
      edits: [{ row: 2, column: 1, type: 'amount', amountMinor: null }],
    });
    expect(planFillDown(lines, columns, range(at(0, 1), at(2, 1)))).toEqual({
      ok: false,
      problem: 'INVALID_CELLS',
      cells: [{ row: 2, column: 1, reason: 'CURRENCY_MISMATCH' }],
    });
    expect(planFillDown(lines, columns, range(at(2, 0), at(3, 0)))).toEqual({
      ok: false,
      problem: 'INVALID_CELLS',
      cells: [{ row: 3, column: 0, reason: 'READ_ONLY' }],
    });
  });

  it('makes every filled cell equal to the cell it copies (property)', () => {
    // One editable column at a time: the memo or the parallel amount, rows without a locked line.
    const row = fc.integer({ min: 0, max: 2 });
    fc.assert(
      fc.property(fc.constantFrom(0, 3), row, row, (column, first, last) => {
        const plan = planFillDown(lines, columns, range(at(first, column), at(last, column)));
        if (!plan.ok) {
          expect(plan.problem).toBe('NOTHING_TO_FILL');
          return;
        }
        const source = lines[plan.range.firstRow - 1] as Line;
        for (const edit of plan.edits) {
          expect(edit.type === 'text' ? edit.text : edit.amountMinor).toEqual(
            edit.type === 'text' ? source.memo : source.parallel,
          );
        }
      }),
    );
  });
});

describe('planClear', () => {
  it('empties the selected cells, and refuses when any is locked', () => {
    expect(planClear(lines, columns, range(at(1, 0), at(1, 1)))).toEqual({
      ok: true,
      range: { firstRow: 1, lastRow: 1, firstColumn: 0, lastColumn: 1 },
      edits: [
        { row: 1, column: 0, type: 'text', text: '' },
        { row: 1, column: 1, type: 'amount', amountMinor: null },
      ] satisfies CellEdit[],
    });
    expect(planClear(lines, columns, range(at(0, 1), at(0, 2)))).toEqual({
      ok: false,
      problem: 'INVALID_CELLS',
      cells: [{ row: 0, column: 2, reason: 'READ_ONLY' }],
    });
  });
});
