import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CellPosition,
  clampSelection,
  type GridMove,
  type GridSelection,
  type GridShape,
  movePosition,
  navigate,
  rangeCells,
  rangeContains,
  selectAll,
  selectCell,
  selectColumns,
  selectionRange,
  selectRows,
} from './selection';

const shape: GridShape = { rowCount: 5, columnCount: 4 };
const at = (row: number, column: number): CellPosition => ({ row, column });

const MOVES: GridMove[] = [
  'up',
  'down',
  'forward',
  'backward',
  'next',
  'previous',
  'rowStart',
  'rowEnd',
  'gridStart',
  'gridEnd',
  'pageUp',
  'pageDown',
];

/** A shape, and a position inside it. */
const shapeAndCell = fc
  .record({
    rowCount: fc.integer({ min: 1, max: 40 }),
    columnCount: fc.integer({ min: 1, max: 12 }),
  })
  .chain((s) =>
    fc.record({
      shape: fc.constant(s),
      cell: fc.record({
        row: fc.integer({ min: 0, max: s.rowCount - 1 }),
        column: fc.integer({ min: 0, max: s.columnCount - 1 }),
      }),
      pageRows: fc.integer({ min: 0, max: 50 }),
    }),
  );

const inside = ({ row, column }: CellPosition, s: GridShape) =>
  row >= 0 && row < s.rowCount && column >= 0 && column < s.columnCount;

describe('movePosition', () => {
  it('moves one cell, stops at the edges, and jumps with Home, End and Ctrl', () => {
    expect(movePosition(at(0, 0), 'up', shape, 3)).toEqual(at(0, 0));
    expect(movePosition(at(0, 0), 'backward', shape, 3)).toEqual(at(0, 0));
    expect(movePosition(at(4, 3), 'down', shape, 3)).toEqual(at(4, 3));
    expect(movePosition(at(2, 1), 'forward', shape, 3)).toEqual(at(2, 2));
    expect(movePosition(at(2, 1), 'rowStart', shape, 3)).toEqual(at(2, 0));
    expect(movePosition(at(2, 1), 'rowEnd', shape, 3)).toEqual(at(2, 3));
    expect(movePosition(at(2, 1), 'gridStart', shape, 3)).toEqual(at(0, 0));
    expect(movePosition(at(2, 1), 'gridEnd', shape, 3)).toEqual(at(4, 3));
    expect(movePosition(at(1, 1), 'pageDown', shape, 3)).toEqual(at(4, 1));
    expect(movePosition(at(4, 1), 'pageDown', shape, 3)).toEqual(at(4, 1));
    expect(movePosition(at(2, 1), 'pageUp', shape, 3)).toEqual(at(0, 1));
  });

  it('wraps Tab and Shift+Tab across rows and leaves the grid at either end', () => {
    expect(movePosition(at(1, 3), 'next', shape, 3)).toEqual(at(2, 0));
    expect(movePosition(at(2, 0), 'previous', shape, 3)).toEqual(at(1, 3));
    expect(movePosition(at(4, 3), 'next', shape, 3)).toBeUndefined();
    expect(movePosition(at(0, 0), 'previous', shape, 3)).toBeUndefined();
  });

  it('never leaves the grid except by Tab, whatever the move (property)', () => {
    fc.assert(
      fc.property(shapeAndCell, fc.constantFrom(...MOVES), ({ shape: s, cell, pageRows }, move) => {
        const target = movePosition(cell, move, s, pageRows);
        if (target === undefined) expect(['next', 'previous']).toContain(move);
        else expect(inside(target, s)).toBe(true);
      }),
    );
  });

  it('visits every cell once in reading order with Tab, and Shift+Tab undoes it (property)', () => {
    fc.assert(
      fc.property(shapeAndCell, ({ shape: s }) => {
        const seen: CellPosition[] = [];
        for (let cell: CellPosition | undefined = at(0, 0); cell; ) {
          seen.push(cell);
          cell = movePosition(cell, 'next', s, 1);
        }
        expect(seen).toEqual([
          ...rangeCells({
            firstRow: 0,
            lastRow: s.rowCount - 1,
            firstColumn: 0,
            lastColumn: s.columnCount - 1,
          }),
        ]);
        for (let i = 1; i < seen.length; i++) {
          expect(movePosition(seen[i] as CellPosition, 'previous', s, 1)).toEqual(seen[i - 1]);
        }
      }),
    );
  });
});

describe('navigate and range selection', () => {
  it('collapses on a plain move and extends with Shift, the active cell staying put', () => {
    const start = selectCell(at(1, 1));
    const extended = navigate(start, 'down', { shape, pageRows: 3, extend: true });
    const wider = extended && navigate(extended, 'forward', { shape, pageRows: 3, extend: true });
    expect(wider).toEqual({ active: at(1, 1), anchor: at(1, 1), extent: at(2, 2) });
    expect(wider && selectionRange(wider)).toEqual({
      firstRow: 1,
      lastRow: 2,
      firstColumn: 1,
      lastColumn: 2,
    });
    expect(wider && navigate(wider, 'down', { shape, pageRows: 3 })).toEqual(selectCell(at(2, 1)));
  });

  it('never extends with Tab', () => {
    expect(navigate(selectCell(at(0, 0)), 'next', { shape, pageRows: 3, extend: true })).toEqual(
      selectCell(at(0, 1)),
    );
  });

  it('selects everything, whole rows and whole columns around the active cell', () => {
    const range = navigate(selectCell(at(1, 1)), 'down', { shape, pageRows: 3, extend: true });
    if (!range) throw new Error('no selection');
    expect(selectionRange(selectAll(range, shape))).toEqual({
      firstRow: 0,
      lastRow: 4,
      firstColumn: 0,
      lastColumn: 3,
    });
    expect(selectionRange(selectRows(range, shape))).toEqual({
      firstRow: 1,
      lastRow: 2,
      firstColumn: 0,
      lastColumn: 3,
    });
    expect(selectionRange(selectColumns(range, shape))).toEqual({
      firstRow: 0,
      lastRow: 4,
      firstColumn: 1,
      lastColumn: 1,
    });
    // After selecting rows, Shift+Down adds a row and keeps the full width.
    const more = navigate(selectRows(range, shape), 'down', { shape, pageRows: 3, extend: true });
    expect(more && selectionRange(more)).toEqual({
      firstRow: 1,
      lastRow: 3,
      firstColumn: 0,
      lastColumn: 3,
    });
  });

  it('keeps the active cell inside the selection through any keys, in bounds (property)', () => {
    const step = fc.oneof(
      fc.record({ move: fc.constantFrom(...MOVES), extend: fc.boolean() }),
      fc.constantFrom('all', 'rows', 'columns', 'shrink'),
    );
    fc.assert(
      fc.property(
        shapeAndCell,
        fc.array(step, { maxLength: 30 }),
        ({ shape: s, cell, pageRows }, steps) => {
          let grid = s;
          let selection: GridSelection = selectCell(cell);
          for (const next of steps) {
            if (next === 'all') selection = selectAll(selection, grid);
            else if (next === 'rows') selection = selectRows(selection, grid);
            else if (next === 'columns') selection = selectColumns(selection, grid);
            else if (next === 'shrink') {
              grid = { rowCount: Math.max(1, grid.rowCount - 3), columnCount: grid.columnCount };
              selection = clampSelection(selection, grid);
            } else {
              selection =
                navigate(selection, next.move, { shape: grid, pageRows, extend: next.extend }) ??
                selection;
            }
            const range = selectionRange(selection);
            expect(rangeContains(range, selection.active)).toBe(true);
            expect(inside(selection.anchor, grid) && inside(selection.extent, grid)).toBe(true);
          }
        },
      ),
    );
  });
});
