import type { CurrencyCode, Report } from '@vertex-mizan/contracts';

/**
 * A report as a table (S09 rules 4, 35, 36): what the Excel export writes and the PDF prints, one
 * model for both so they never disagree. Amounts stay `MinorUnits` strings with their currency;
 * each writer formats them (Excel through `spreadsheetAmount()`, the PDF through `formatMinor()`).
 * No arithmetic happens here: every figure is the report's own.
 */

/** How a column's cells read: text, an LTR code or number, an amount, a percentage, a date. */
export type SheetCellKind = 'text' | 'code' | 'amount' | 'percent' | 'date';

export interface SheetColumn {
  readonly key: string;
  readonly label: string;
  readonly kind: SheetCellKind;
  /** A heading over several columns ("رصيد أول المدة" over its debit and credit). */
  readonly group?: string;
  /** Relative width, in characters (Excel) and fractions of the page (PDF). */
  readonly width: number;
  /**
   * For an amount column in another currency than the report's (a transaction amount): the key of
   * the row's cell holding its currency code.
   */
  readonly currencyKey?: string;
}

/**
 * A cell: text, an amount as `MinorUnits`, a percentage with one decimal; `null` prints "—" (a
 * comparative without lines, a margin without revenue); absent prints nothing.
 */
export type SheetCell = string | null | undefined;

export type SheetEmphasis = 'section' | 'subtotal' | 'total' | 'note';

export interface SheetRow {
  readonly cells: Readonly<Record<string, SheetCell>>;
  /** Indentation, from 0. */
  readonly level?: number;
  readonly emphasis?: SheetEmphasis;
}

export interface SheetParameter {
  readonly label: string;
  readonly value: string;
}

export interface ReportSheet {
  readonly report: Report;
  readonly title: string;
  /** What was asked: the period or date, the ledger and its currency, the filters. */
  readonly parameters: readonly SheetParameter[];
  /** Rule 4's marks, as text, and the draft mark of rule 30. */
  readonly marks: readonly string[];
  /** The report's ledger currency, and its printed name ("الليرة السورية الجديدة" for SYP). */
  readonly currency: CurrencyCode;
  readonly currencyLabel: string;
  readonly columns: readonly SheetColumn[];
  readonly rows: readonly SheetRow[];
}
