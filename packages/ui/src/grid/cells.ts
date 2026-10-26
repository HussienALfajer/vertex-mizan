import {
  type AmountTextError,
  type CurrencyCode,
  formatMinor,
  type Ledger,
  parseAmount,
} from '@vertex-mizan/contracts';
import { type CellRange, type GridSelection, rangeCells, selectionRange } from './selection';
import { parseTsv, toHtmlTable, toTsv } from './tsv';

/*
 * What a grid's cells hold, and the edits that copy, paste, fill down and clear propose (ADR 0010
 * §4). Nothing here changes the rows: each function returns every edit, or every problem and no
 * edit, so a paste is never partial. The app applies the edits to its own data. Amounts are read
 * and written only through the money module.
 */

/** Which amount of a line a column shows: summaries never add amounts of two kinds (ADR 0010 §4). */
export type AmountKind = 'transaction' | Ledger;

export const AMOUNT_KINDS: readonly AmountKind[] = ['transaction', 'book', 'parallel'];

interface ColumnBase<Row> {
  readonly id: string;
  /** A computed or locked column, or locked rows of it (a posted line): never edited. */
  readonly readOnly?: boolean | ((row: Row) => boolean);
}

export interface TextColumn<Row> extends ColumnBase<Row> {
  readonly type: 'text';
  value(row: Row): string;
  /** Why text cannot go into this cell (a code the app translates); `undefined` accepts it. */
  validate?(text: string, row: Row): string | undefined;
}

export interface AmountColumn<Row> extends ColumnBase<Row> {
  readonly type: 'amount';
  readonly kind: AmountKind;
  /** The amount in minor units of `currency(row)`; `null` for an empty cell. */
  valueMinor(row: Row): bigint | null;
  currency(row: Row): CurrencyCode;
  /** `false` for magnitudes such as debit and credit columns (ADR 0009). */
  readonly allowNegative?: boolean;
}

export type GridColumn<Row> = TextColumn<Row> | AmountColumn<Row>;

export type CellEdit =
  | { readonly row: number; readonly column: number; readonly type: 'text'; readonly text: string }
  | {
      readonly row: number;
      readonly column: number;
      readonly type: 'amount';
      readonly amountMinor: bigint | null;
    };

/** Why one cell refuses its edit. */
export type CellProblem = { readonly row: number; readonly column: number } & (
  | { readonly reason: 'READ_ONLY' }
  /** Text refused by the column's `validate`, with its code. */
  | { readonly reason: 'TEXT'; readonly error: string }
  | { readonly reason: 'AMOUNT'; readonly error: AmountTextError }
  /** Filling an amount into a row of another currency would change what it means. */
  | { readonly reason: 'CURRENCY_MISMATCH' }
);

/**
 * Every edit and the range it covers, or why nothing changes: no clipboard text, rows of different
 * lengths, a block that does not fit the grid, no row above to fill from, or problems in cells.
 */
export type EditPlan =
  | { readonly ok: true; readonly edits: readonly CellEdit[]; readonly range: CellRange }
  | {
      readonly ok: false;
      readonly problem: 'EMPTY' | 'NOT_RECTANGULAR' | 'DOES_NOT_FIT' | 'NOTHING_TO_FILL';
    }
  | {
      readonly ok: false;
      readonly problem: 'INVALID_CELLS';
      readonly cells: readonly CellProblem[];
    };

type Rows<Row> = readonly Row[];
type Columns<Row> = readonly GridColumn<Row>[];

function isReadOnly<Row>(column: GridColumn<Row>, row: Row): boolean {
  return typeof column.readOnly === 'function' ? column.readOnly(row) : Boolean(column.readOnly);
}

/**
 * A cell as clipboard text: amounts without grouping (`-1250.50`), Latin digits and an ASCII minus,
 * so Excel reads a number whatever its locale's thousands separator; empty for an empty amount.
 */
export function cellText<Row>(column: GridColumn<Row>, row: Row): string {
  if (column.type === 'text') return column.value(row);
  const amountMinor = column.valueMinor(row);
  return amountMinor === null
    ? ''
    : formatMinor(amountMinor, column.currency(row), { grouping: false });
}

/** The selection as TSV and as an HTML table (Ctrl+C). */
export function copyRange<Row>(
  rows: Rows<Row>,
  columns: Columns<Row>,
  range: CellRange,
): { tsv: string; html: string } {
  const cells: string[][] = [];
  for (let r = range.firstRow; r <= range.lastRow; r++) {
    const line: string[] = [];
    for (let c = range.firstColumn; c <= range.lastColumn; c++) {
      line.push(cellText(columns[c] as GridColumn<Row>, rows[r] as Row));
    }
    cells.push(line);
  }
  return { tsv: toTsv(cells), html: toHtmlTable(cells) };
}

/** The edit text makes in one cell, or why it cannot. Empty text empties an amount. */
function editFromText<Row>(
  rows: Rows<Row>,
  columns: Columns<Row>,
  row: number,
  column: number,
  text: string,
): CellEdit | CellProblem {
  const definition = columns[column] as GridColumn<Row>;
  const data = rows[row] as Row;
  if (isReadOnly(definition, data)) return { row, column, reason: 'READ_ONLY' };
  if (definition.type === 'text') {
    const error = definition.validate?.(text, data);
    return error === undefined
      ? { row, column, type: 'text', text }
      : { row, column, reason: 'TEXT', error };
  }
  if (text.trim() === '') return { row, column, type: 'amount', amountMinor: null };
  const parsed = parseAmount(text, definition.currency(data), {
    allowNegative: definition.allowNegative ?? true,
  });
  return parsed.ok
    ? { row, column, type: 'amount', amountMinor: parsed.amountMinor }
    : { row, column, reason: 'AMOUNT', error: parsed.error };
}

/** All the edits, or all the problems and no edit. */
function plan(results: readonly (CellEdit | CellProblem)[], range: CellRange): EditPlan {
  const cells = results.filter((result): result is CellProblem => 'reason' in result);
  if (cells.length > 0) return { ok: false, problem: 'INVALID_CELLS', cells };
  return { ok: true, edits: results as readonly CellEdit[], range };
}

/**
 * Clipboard text pasted at the selection (Ctrl+V), every cell checked before anything changes. A
 * single value fills the whole selection; a block starts at the selection's first cell and must
 * fit inside the grid.
 */
export function planPaste<Row>(
  rows: Rows<Row>,
  columns: Columns<Row>,
  selection: GridSelection,
  text: string,
): EditPlan {
  const block = parseTsv(text);
  const first = block[0];
  if (!first) return { ok: false, problem: 'EMPTY' };
  if (block.some((line) => line.length !== first.length)) {
    return { ok: false, problem: 'NOT_RECTANGULAR' };
  }
  const selected = selectionRange(selection);
  const single = block.length === 1 && first.length === 1;
  const range: CellRange = single
    ? selected
    : {
        firstRow: selected.firstRow,
        lastRow: selected.firstRow + block.length - 1,
        firstColumn: selected.firstColumn,
        lastColumn: selected.firstColumn + first.length - 1,
      };
  if (range.lastRow >= rows.length || range.lastColumn >= columns.length) {
    return { ok: false, problem: 'DOES_NOT_FIT' };
  }
  const results = [...rangeCells(range)].map(({ row, column }) => {
    const value = single ? first[0] : block[row - range.firstRow]?.[column - range.firstColumn];
    return editFromText(rows, columns, row, column, value ?? '');
  });
  return plan(results, range);
}

/**
 * Fill down (Ctrl+D): the selection's first row copied into the rows under it; with one row
 * selected, the row above copied into it. Amounts are copied only within one currency.
 */
export function planFillDown<Row>(
  rows: Rows<Row>,
  columns: Columns<Row>,
  selection: GridSelection,
): EditPlan {
  const selected = selectionRange(selection);
  const oneRow = selected.firstRow === selected.lastRow;
  const source = oneRow ? selected.firstRow - 1 : selected.firstRow;
  if (source < 0) return { ok: false, problem: 'NOTHING_TO_FILL' };
  const range: CellRange = { ...selected, firstRow: source + 1 };
  const from = rows[source] as Row;
  const results = [...rangeCells(range)].map(({ row, column }): CellEdit | CellProblem => {
    const definition = columns[column] as GridColumn<Row>;
    const data = rows[row] as Row;
    if (definition.type === 'text' || isReadOnly(definition, data)) {
      return editFromText(rows, columns, row, column, cellText(definition, from));
    }
    const amountMinor = definition.valueMinor(from);
    if (amountMinor !== null && definition.currency(from) !== definition.currency(data)) {
      return { row, column, reason: 'CURRENCY_MISMATCH' };
    }
    return { row, column, type: 'amount', amountMinor };
  });
  return plan(results, range);
}

/** Delete: every selected cell emptied, each checked as an edit. */
export function planClear<Row>(
  rows: Rows<Row>,
  columns: Columns<Row>,
  selection: GridSelection,
): EditPlan {
  const range = selectionRange(selection);
  return plan(
    [...rangeCells(range)].map(({ row, column }) => editFromText(rows, columns, row, column, '')),
    range,
  );
}
