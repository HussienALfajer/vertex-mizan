/*
 * The clipboard text of a grid (ADR 0010 §4, R§4.1): tab-separated values, one row per line, as
 * Excel writes them. Excel quotes a cell holding a tab or a line break "often but not always", so
 * the reader accepts both; the writer always quotes, so its text reads back exactly.
 */

/** A cell that must be quoted to read back as itself. */
const NEEDS_QUOTES = /[\t\r\n]|^"/;

const quote = (cell: string) =>
  NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;

/** Rows of cells as TSV: `\r\n` after every row, as Excel writes. */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((cells) => `${cells.map(quote).join('\t')}\r\n`).join('');
}

/**
 * A quoted cell at `at` (just after its opening quote): its text and where it ends, or `undefined`
 * when the quotes do not close a whole cell (`"5" inches`, `"abc`), which is then plain text.
 */
function readQuoted(text: string, at: number): { cell: string; end: number } | undefined {
  let cell = '';
  let i = at;
  while (i < text.length) {
    const close = text.indexOf('"', i);
    if (close < 0) return undefined;
    cell += text.slice(i, close);
    if (text[close + 1] === '"') {
      cell += '"';
      i = close + 2;
      continue;
    }
    const after = text[close + 1];
    return after === undefined || after === '\t' || after === '\r' || after === '\n'
      ? { cell, end: close + 1 }
      : undefined;
  }
  return undefined;
}

/**
 * TSV to rows of cells. Line breaks may be `\r\n`, `\n` or `\r`; one final line break ends the last
 * row and adds none. Empty text has no rows. Rows may differ in length: the caller decides.
 */
export function parseTsv(text: string): string[][] {
  if (text === '') return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  for (;;) {
    let cell: string;
    const quoted = text[i] === '"' ? readQuoted(text, i + 1) : undefined;
    if (quoted) {
      cell = quoted.cell;
      i = quoted.end;
    } else {
      let end = i;
      while (end < text.length && !'\t\r\n'.includes(text.charAt(end))) end++;
      cell = text.slice(i, end);
      i = end;
    }
    row.push(cell);
    if (text[i] === '\t') {
      i++;
      continue;
    }
    rows.push(row);
    row = [];
    if (i >= text.length) break;
    i += text.startsWith('\r\n', i) ? 2 : 1;
    if (i >= text.length) break;
  }
  return rows;
}

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replace(/\r\n|\r|\n/g, '<br>');

/** The same rows as an HTML table, the clipboard's second format for Excel and documents. */
export function toHtmlTable(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table>${body}</table>`;
}
