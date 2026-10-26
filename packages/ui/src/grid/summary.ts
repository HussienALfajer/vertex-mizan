import { type Money, type MoneySummary, money, summarizeAmounts } from '@vertex-mizan/contracts';
import { AMOUNT_KINDS, type AmountKind, type GridColumn } from './cells';
import { type CellRange, rangeCells } from './selection';

/** The summaries of one kind of amount, one per currency. */
export interface KindSummary {
  readonly kind: AmountKind;
  readonly summaries: readonly MoneySummary[];
}

/**
 * The selection summary bar (ADR 0010 §4): count, sum, average, minimum and maximum of the
 * selected amounts, per kind of amount and per currency, computed by the money module. A
 * transaction amount in USD and a parallel amount in USD are never added together. Empty cells and
 * text are not counted. Kinds come in the order transaction, book, parallel; a kind with no
 * amount selected is left out.
 */
export function summarizeSelection<Row>(
  rows: readonly Row[],
  columns: readonly GridColumn<Row>[],
  range: CellRange,
): KindSummary[] {
  const byKind = new Map<AmountKind, Money[]>();
  for (const { row, column } of rangeCells(range)) {
    const definition = columns[column] as GridColumn<Row>;
    if (definition.type !== 'amount') continue;
    const data = rows[row] as Row;
    const amountMinor = definition.valueMinor(data);
    if (amountMinor === null) continue;
    const amounts = byKind.get(definition.kind) ?? [];
    amounts.push(money(amountMinor, definition.currency(data)));
    byKind.set(definition.kind, amounts);
  }
  return AMOUNT_KINDS.flatMap((kind) => {
    const amounts = byKind.get(kind);
    return amounts ? [{ kind, summaries: summarizeAmounts(amounts) }] : [];
  });
}
