/*
 * The data grid's positions, navigation and range selection (ADR 0010 §4, R§4.1–§4.2): pure
 * functions over a grid's shape, with no DOM. Columns are counted in reading order, so column 0 is
 * the start column (the right edge in RTL); the keys decide which way is visual (`grid-keys.ts`).
 * A grid has at least one row and one column: an empty grid shows its empty state instead.
 */

/** A cell, both indexes from 0; `column` in reading order. */
export interface CellPosition {
  readonly row: number;
  readonly column: number;
}

export interface GridShape {
  readonly rowCount: number;
  readonly columnCount: number;
}

/** A rectangle of cells, every bound inclusive. */
export interface CellRange {
  readonly firstRow: number;
  readonly lastRow: number;
  readonly firstColumn: number;
  readonly lastColumn: number;
}

/**
 * The selection as in a spreadsheet: the range from `anchor` to `extent`, and the active cell,
 * the one with focus, always inside it. Shift+arrows and Shift+click move `extent`; the active
 * cell stays where it was.
 */
export interface GridSelection {
  readonly active: CellPosition;
  readonly anchor: CellPosition;
  readonly extent: CellPosition;
}

/**
 * A move in reading order: `forward` is the next column (towards the end of the line), `next` and
 * `previous` are Tab and Shift+Tab (wrapping rows), `rowStart`/`rowEnd` Home and End,
 * `gridStart`/`gridEnd` Ctrl+Home and Ctrl+End, `pageUp`/`pageDown` one page of rows.
 */
export type GridMove =
  | 'up'
  | 'down'
  | 'forward'
  | 'backward'
  | 'next'
  | 'previous'
  | 'rowStart'
  | 'rowEnd'
  | 'gridStart'
  | 'gridEnd'
  | 'pageUp'
  | 'pageDown';

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

/** A position inside the grid: the nearest cell to one that may be outside. */
export function clampPosition({ row, column }: CellPosition, shape: GridShape): CellPosition {
  return { row: clamp(row, shape.rowCount - 1), column: clamp(column, shape.columnCount - 1) };
}

/** A single selected cell. */
export function selectCell(position: CellPosition): GridSelection {
  return { active: position, anchor: position, extent: position };
}

export function selectionRange({ anchor, extent }: GridSelection): CellRange {
  return {
    firstRow: Math.min(anchor.row, extent.row),
    lastRow: Math.max(anchor.row, extent.row),
    firstColumn: Math.min(anchor.column, extent.column),
    lastColumn: Math.max(anchor.column, extent.column),
  };
}

export function rangeContains(range: CellRange, { row, column }: CellPosition): boolean {
  return (
    row >= range.firstRow &&
    row <= range.lastRow &&
    column >= range.firstColumn &&
    column <= range.lastColumn
  );
}

/** Every cell of a range, row by row, each row in reading order. */
export function* rangeCells(range: CellRange): Generator<CellPosition> {
  for (let row = range.firstRow; row <= range.lastRow; row++) {
    for (let column = range.firstColumn; column <= range.lastColumn; column++) {
      yield { row, column };
    }
  }
}

/**
 * The cell one move away. `next` past the last cell and `previous` before the first return
 * `undefined`: Tab leaves the grid there (APG). Every other move stops at the edge.
 */
export function movePosition(
  { row, column }: CellPosition,
  move: GridMove,
  shape: GridShape,
  pageRows: number,
): CellPosition | undefined {
  const lastRow = shape.rowCount - 1;
  const lastColumn = shape.columnCount - 1;
  const page = Math.max(1, pageRows);
  switch (move) {
    case 'up':
      return { row: clamp(row - 1, lastRow), column };
    case 'down':
      return { row: clamp(row + 1, lastRow), column };
    case 'forward':
      return { row, column: clamp(column + 1, lastColumn) };
    case 'backward':
      return { row, column: clamp(column - 1, lastColumn) };
    case 'next':
      if (column < lastColumn) return { row, column: column + 1 };
      return row < lastRow ? { row: row + 1, column: 0 } : undefined;
    case 'previous':
      if (column > 0) return { row, column: column - 1 };
      return row > 0 ? { row: row - 1, column: lastColumn } : undefined;
    case 'rowStart':
      return { row, column: 0 };
    case 'rowEnd':
      return { row, column: lastColumn };
    case 'gridStart':
      return { row: 0, column: 0 };
    case 'gridEnd':
      return { row: lastRow, column: lastColumn };
    case 'pageUp':
      return { row: clamp(row - page, lastRow), column };
    case 'pageDown':
      return { row: clamp(row + page, lastRow), column };
  }
}

/**
 * The selection after a move. Without `extend` the active cell moves and the selection collapses
 * onto it; with `extend` (Shift) the extent moves and the active cell stays. Tab never extends.
 * `undefined` when Tab or Shift+Tab leaves the grid.
 */
export function navigate(
  selection: GridSelection,
  move: GridMove,
  { shape, pageRows, extend = false }: { shape: GridShape; pageRows: number; extend?: boolean },
): GridSelection | undefined {
  if (!extend || move === 'next' || move === 'previous') {
    const target = movePosition(selection.active, move, shape, pageRows);
    return target && selectCell(target);
  }
  const extent = movePosition(selection.extent, move, shape, pageRows);
  return extent && extendTo(selection, extent);
}

/**
 * The range from the anchor to a cell (Shift+click, Shift+arrows). When the active cell would fall
 * outside it (after Ctrl+A, say), the range restarts from the active cell.
 */
export function extendTo(selection: GridSelection, extent: CellPosition): GridSelection {
  const extended = { ...selection, extent };
  return rangeContains(selectionRange(extended), selection.active)
    ? extended
    : { active: selection.active, anchor: selection.active, extent };
}

/** Every cell (Ctrl+A); the active cell stays. */
export function selectAll(selection: GridSelection, shape: GridShape): GridSelection {
  return {
    active: selection.active,
    anchor: { row: 0, column: 0 },
    extent: { row: shape.rowCount - 1, column: shape.columnCount - 1 },
  };
}

/** The whole rows of the selection (Shift+Space); Shift+Up and Down then add or drop rows. */
export function selectRows(selection: GridSelection, shape: GridShape): GridSelection {
  return {
    active: selection.active,
    anchor: { row: selection.anchor.row, column: 0 },
    extent: { row: selection.extent.row, column: shape.columnCount - 1 },
  };
}

/** The whole columns of the selection (Ctrl+Space). */
export function selectColumns(selection: GridSelection, shape: GridShape): GridSelection {
  return {
    active: selection.active,
    anchor: { row: 0, column: selection.anchor.column },
    extent: { row: shape.rowCount - 1, column: selection.extent.column },
  };
}

/**
 * The selection kept inside a grid whose rows or columns changed (a line inserted or deleted, data
 * reloaded): every corner moves to its nearest cell, so the active cell stays inside the range.
 */
export function clampSelection(selection: GridSelection, shape: GridShape): GridSelection {
  return {
    active: clampPosition(selection.active, shape),
    anchor: clampPosition(selection.anchor, shape),
    extent: clampPosition(selection.extent, shape),
  };
}
