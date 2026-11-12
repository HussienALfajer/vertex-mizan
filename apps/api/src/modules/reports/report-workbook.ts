import {
  type CurrencyCode,
  currencies as currencyTable,
  spreadsheetAmount,
} from '@vertex-mizan/contracts';
import type { ReportSheet, SheetCell, SheetColumn } from '@vertex-mizan/ui/print/sheets';
import ExcelJS from 'exceljs';

/**
 * A report's sheet as an Excel workbook (S09 rule 35): one right-to-left sheet headed by the
 * company, the report's name, its parameters and marks; amounts as numbers in major units when 15
 * digits hold them and the exact text otherwise (`spreadsheetAmount()`), each formatted with every
 * decimal of its currency, the report's currency in its own last column ("الليرة السورية
 * الجديدة" for SYP); "—" where a comparative has no posted line or a margin no revenue.
 */
export async function reportWorkbook(
  sheet: ReportSheet,
  company: string,
  labels: { readonly currency: string; readonly none: string },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(sheet.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), {
    views: [{ rightToLeft: true }],
  });
  const columns = sheet.columns;
  const width = columns.length + 1;
  const titled = (value: string, bold: boolean) => {
    const row = ws.addRow([value]);
    row.font = { bold };
  };
  titled(company, true);
  titled(sheet.title, true);
  for (const parameter of sheet.parameters) ws.addRow([`${parameter.label}: ${parameter.value}`]);
  for (const mark of sheet.marks) titled(mark, true);
  ws.addRow([]);

  if (columns.some((column) => column.group !== undefined)) {
    const groups = ws.addRow(columns.map((column) => column.group ?? ''));
    groups.font = { bold: true };
  }
  const heading = ws.addRow([...columns.map((column) => column.label), labels.currency]);
  heading.font = { bold: true };
  ws.columns.forEach((column, index) => {
    column.width = Math.max(8, (columns[index]?.width ?? 24) + 2);
  });
  for (const [index, column] of columns.entries()) {
    if (column.kind === 'code' || column.kind === 'date') ws.getColumn(index + 1).numFmt = '@';
  }

  for (const row of sheet.rows) {
    let hasAmount = false;
    const values = columns.map((column) => {
      const value = cellValue(
        column,
        row.cells[column.key],
        row.cells,
        sheet.currency,
        labels.none,
      );
      // A ledger amount, as a number or as exact text: the row names the report's currency.
      if (
        column.kind === 'amount' &&
        column.currencyKey === undefined &&
        isText(row.cells[column.key])
      ) {
        hasAmount = true;
      }
      return value;
    });
    const added = ws.addRow([...values, hasAmount ? sheet.currencyLabel : '']);
    if (row.emphasis === 'section' || row.emphasis === 'subtotal' || row.emphasis === 'total') {
      added.font = { bold: true };
    }
    if (row.level) added.getCell(1).alignment = { indent: row.level, readingOrder: 'rtl' };
    for (const [index, column] of columns.entries()) {
      if (column.kind !== 'amount') continue;
      const code = currencyOf(column, row.cells, sheet.currency);
      added.getCell(index + 1).numFmt = amountFormat(code);
    }
  }
  ws.getColumn(width).width = 24;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const isText = (cell: SheetCell): cell is string => typeof cell === 'string';

function currencyOf(
  column: SheetColumn,
  cells: Readonly<Record<string, SheetCell>>,
  currency: CurrencyCode,
): CurrencyCode {
  const code = column.currencyKey === undefined ? undefined : cells[column.currencyKey];
  return (typeof code === 'string' && code in currencyTable ? code : currency) as CurrencyCode;
}

/** A cell's value: an amount as a number (or exact text), the rest as text. */
function cellValue(
  column: SheetColumn,
  cell: SheetCell,
  cells: Readonly<Record<string, SheetCell>>,
  currency: CurrencyCode,
  none: string,
): string | number {
  if (cell === undefined) return '';
  if (cell === null) return none;
  if (column.kind !== 'amount') return cell;
  return spreadsheetAmount(BigInt(cell), currencyOf(column, cells, currency));
}

/** Every decimal of the currency, grouped: a narrow column shows `####`, never a rounded figure. */
function amountFormat(currency: CurrencyCode): string {
  const { exponent } = currencyTable[currency];
  return exponent === 0 ? '#,##0' : `#,##0.${'0'.repeat(exponent)}`;
}
