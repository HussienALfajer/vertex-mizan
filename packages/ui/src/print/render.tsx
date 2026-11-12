import { renderToStaticMarkup } from 'react-dom/server';
import {
  JournalBookPrint,
  type JournalBookPrintProps,
  ReportPrint,
  type ReportPrintProps,
} from './document.js';
import type { SheetColumn } from './sheet.js';
import { printStyles } from './styles.js';

/**
 * A printed report as a whole HTML document (S09 rule 36): right to left, the print stylesheet,
 * the column widths as rules of their own and the brand's faces (`fontFaces`, from
 * `printFontFaces()` in the worker), so Chromium needs nothing beyond the page.
 */
function documentOf(title: string, css: string, body: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeText(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

const escapeText = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Each column's share of the page's inline size, from its width in characters. */
export function columnWidthRules(selector: string, widths: readonly number[]): string {
  const total = widths.reduce((sum, width) => sum + width, 0);
  return widths
    .map(
      (width, index) =>
        `${selector} col:nth-child(${index + 1}) { inline-size: ${((width / total) * 100).toFixed(2)}%; }`,
    )
    .join('\n');
}

/** The journal book's six columns (rule 27), sized to `JOURNAL_BOOK_COLUMNS`. */
export const JOURNAL_BOOK_WIDTHS = [11, 10, 9, 46, 12, 12] as const;

export function renderReportHtml(props: ReportPrintProps & { readonly fontFaces: string }): string {
  const { fontFaces, ...print } = props;
  const widths = print.sheet.columns.map((column: SheetColumn) => column.width);
  return documentOf(
    print.sheet.title,
    `${fontFaces}\n${printStyles()}\n${columnWidthRules('main', widths)}`,
    renderToStaticMarkup(<ReportPrint {...print} />),
  );
}

export function renderJournalBookHtml(
  props: JournalBookPrintProps & { readonly fontFaces: string },
): string {
  const { fontFaces, ...print } = props;
  return documentOf(
    print.text.title,
    `${fontFaces}\n${printStyles()}\n${columnWidthRules('.book-rows', JOURNAL_BOOK_WIDTHS)}`,
    renderToStaticMarkup(<JournalBookPrint {...print} />),
  );
}
