import {
  type CurrencyCode,
  currencies as currencyTable,
  type OpeningExportQuery,
  type OpeningViewAnswer,
  spreadsheetAmount,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import ExcelJS from 'exceljs';

/** What the workbook names besides the view: accounts and dimension values by id. */
export interface OpeningWorkbookNames {
  readonly accounts: ReadonlyMap<string, { readonly code: string; readonly name: string }>;
  readonly values: ReadonlyMap<string, { readonly code: string | null; readonly name: string }>;
  readonly ledgers: { readonly book: CurrencyCode; readonly parallel: CurrencyCode | null };
}

const t = ar.opening;

const currencyName = (currency: CurrencyCode) =>
  currency === 'SYP' ? ar.accounting.sypPrintedName : ar.accounting.currencies[currency];

const cell = (amountMinor: string, currency: CurrencyCode) =>
  spreadsheetAmount(BigInt(amountMinor), currency);

/** Every decimal of the currency, grouped: a narrow column shows `####`, never a rounded figure. */
const amountFormat = (currency: CurrencyCode) => {
  const { exponent } = currencyTable[currency];
  return exponent === 0 ? '#,##0' : `#,##0.${'0'.repeat(exponent)}`;
};

function formatAmounts(row: ExcelJS.Row, columns: readonly (readonly [number, CurrencyCode])[]) {
  for (const [column, currency] of columns) row.getCell(column).numFmt = amountFormat(currency);
}

function heading(sheet: ExcelJS.Worksheet, view: OpeningViewAnswer) {
  sheet.addRow([t.export.booksStart, view.booksStart]);
  sheet.addRow([t.export.asOf, view.asOf]);
  sheet.addRow([t.export.state, view.state === null ? t.notStarted : t.states[view.state]]);
  sheet.addRow([]);
}

/**
 * The opening's preview as a right-to-left workbook (S10 "Screens", Export): headed by the books start, the eve and the state; amounts as numbers in major units
 * when 15 digits hold them (`spreadsheetAmount()`), formatted with every decimal of their
 * currency, SYP named "الليرة السورية الجديدة". A preview a check stops lists the failing checks.
 */
export async function openingWorkbook(
  view: OpeningViewAnswer,
  part: OpeningExportQuery['part'],
  names: OpeningWorkbookNames,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(t.export.sheets[part], { views: [{ rightToLeft: true }] });
  heading(sheet, view);
  previewRows(sheet, view, names);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function previewRows(
  sheet: ExcelJS.Worksheet,
  view: OpeningViewAnswer,
  names: OpeningWorkbookNames,
) {
  const c = t.review.columns;
  if (view.lines.length === 0) {
    sheet.addRow([t.export.previewEmpty]);
    for (const check of view.checks) {
      if (!check.passed) sheet.addRow([t.review.checkNames[check.check]]);
    }
    return;
  }
  const { book, parallel } = names.ledgers;
  const header = sheet.addRow([
    c.lineNo,
    t.review.columns.kind,
    c.account,
    t.records.account,
    c.dimensions,
    c.reference,
    c.currency,
    c.amount,
    `${c.book} (${currencyName(book)})`,
    ...(parallel === null ? [] : [`${c.parallel} (${currencyName(parallel)})`]),
    t.records.memo,
  ]);
  header.font = { bold: true };
  for (const line of view.lines) {
    const account = names.accounts.get(line.accountId);
    const row = sheet.addRow([
      line.lineNo,
      `${t.review.sources[line.source]} · ${t.review.kinds[line.kind] ?? line.kind}`,
      account?.code ?? '',
      account?.name ?? '',
      line.dimensionValueIds.map((id) => names.values.get(id)?.name ?? '').join('، '),
      line.itemReference ?? '',
      currencyName(line.currency),
      cell(line.amountMinor, line.currency),
      cell(line.bookMinor, book),
      ...(parallel === null ? [] : [cell(line.parallelMinor ?? '0', parallel)]),
      line.memo ?? '',
    ]);
    formatAmounts(row, [
      [8, line.currency],
      [9, book],
      ...(parallel === null ? [] : [[10, parallel] as const]),
    ]);
  }
  [6, 20, 12, 28, 28, 16, 24, 20, 20, 20, 28].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.getColumn(3).numFmt = '@';
  sheet.getColumn(6).numFmt = '@';
}
