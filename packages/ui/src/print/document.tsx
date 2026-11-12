import { formatMinor, type JournalBookPage, type JournalBookRow } from '@vertex-mizan/contracts';
import type { ReactNode } from 'react';
import type { ReportSheet, SheetCell, SheetColumn } from './sheet.js';

/**
 * The print layout (S09 rules 26, 27, 36): static markup the worker renders to HTML and prints
 * with Chromium. A report's table flows over A4 pages with its header row repeated, numbered
 * "صفحة n من m" by the printer's footer; the journal book is paginated by Mizan, one fixed page per
 * `JournalBookPage`, never reflowed. Text arrives as props (no literal text here).
 */

/** The text of a cell, amounts through the money module, "—" for a missing comparative. */
export function cellText(
  column: SheetColumn,
  cell: SheetCell,
  row: Readonly<Record<string, SheetCell>>,
  currency: ReportSheet['currency'],
  none: string,
): string {
  if (cell === undefined) return '';
  if (cell === null) return none;
  if (column.kind !== 'amount') return cell;
  const code = column.currencyKey === undefined ? currency : row[column.currencyKey];
  return formatMinor(BigInt(cell), (code ?? currency) as ReportSheet['currency']);
}

const cellClass = (column: SheetColumn, value: string) =>
  [
    column.kind === 'amount' || column.kind === 'percent' ? 'num' : null,
    column.kind === 'code' || column.kind === 'date' ? 'code' : null,
    (column.kind === 'amount' || column.kind === 'percent') && value.startsWith('-') ? 'neg' : null,
  ]
    .filter((name) => name !== null)
    .join(' ') || undefined;

export interface PrintHeadProps {
  readonly company: string;
  readonly title: string;
  readonly parameters: ReportSheet['parameters'];
  readonly marks: readonly string[];
}

export function PrintHead({ company, title, parameters, marks }: PrintHeadProps) {
  return (
    <header className="report-head" data-slot="print-head">
      <div className="report-company">
        <bdi>{company}</bdi>
      </div>
      <h1 className="report-title">{title}</h1>
      <div className="report-parameters">
        {parameters.map((parameter) => (
          <span key={parameter.label}>
            {parameter.label}: <b>{parameter.value}</b>
          </span>
        ))}
      </div>
      {marks.length > 0 ? (
        <div className="report-marks">
          {marks.map((mark) => (
            <span className="report-mark" key={mark}>
              {mark}
            </span>
          ))}
        </div>
      ) : null}
    </header>
  );
}

export interface ReportPrintProps {
  readonly company: string;
  readonly sheet: ReportSheet;
  /** "—". */
  readonly none: string;
  /** The draft mark of rule 30 over every page, when given. */
  readonly draft?: string;
}

/** A report's printed table (rule 36). */
export function ReportPrint({ company, sheet, none, draft }: ReportPrintProps) {
  const groups = groupsOf(sheet.columns);
  return (
    <main data-slot="report-print" data-report={sheet.report}>
      {draft === undefined ? null : <div className="draft">{draft}</div>}
      <PrintHead
        company={company}
        title={sheet.title}
        parameters={sheet.parameters}
        marks={draft === undefined ? sheet.marks : [draft, ...sheet.marks]}
      />
      <table>
        <colgroup>
          {sheet.columns.map((column) => (
            <col key={column.key} span={1} />
          ))}
        </colgroup>
        <thead>
          {groups.some((group) => group.label !== undefined) ? (
            <tr>
              {groups.map((group) =>
                group.label === undefined ? (
                  <th key={group.key} rowSpan={2} className={headClass(group.columns[0])}>
                    {group.columns[0]?.label}
                  </th>
                ) : (
                  <th key={group.key} colSpan={group.columns.length} className="group">
                    {group.label}
                  </th>
                ),
              )}
            </tr>
          ) : null}
          <tr>
            {groups.flatMap((group) =>
              groups.some((candidate) => candidate.label !== undefined) && group.label === undefined
                ? []
                : group.columns.map((column) => (
                    <th key={column.key} className={headClass(column)}>
                      {column.label}
                    </th>
                  )),
            )}
          </tr>
        </thead>
        <tbody>
          {keyed(sheet.rows).map(({ key, item: row }) => (
            <tr key={key} className={row.emphasis}>
              {sheet.columns.map((column, position) => {
                const value = cellText(
                  column,
                  row.cells[column.key],
                  row.cells,
                  sheet.currency,
                  none,
                );
                return (
                  <td key={column.key} className={cellClass(column, value)}>
                    {position === 0 && row.level ? indent(row.level, value) : wrap(column, value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

/** Static rows, printed once in their order: each keyed by its position. */
const keyed = <T,>(items: readonly T[]) => items.map((item, at) => ({ key: `row-${at}`, item }));

const headClass = (column: SheetColumn | undefined) =>
  column?.kind === 'amount' || column?.kind === 'percent' ? 'num' : undefined;

const wrap = (column: SheetColumn, value: string): ReactNode =>
  column.kind === 'text' ? <bdi>{value}</bdi> : value;

/** An indented first cell: one figure space per level keeps the print free of inline styles. */
const indent = (level: number, value: string): ReactNode => (
  <>
    {' '.repeat(level)}
    <bdi>{value}</bdi>
  </>
);

interface ColumnGroup {
  readonly key: string;
  readonly label: string | undefined;
  readonly columns: readonly SheetColumn[];
}

/** Adjacent columns under one group heading. */
function groupsOf(columns: readonly SheetColumn[]): ColumnGroup[] {
  const groups: { key: string; label: string | undefined; columns: SheetColumn[] }[] = [];
  for (const column of columns) {
    const last = groups.at(-1);
    if (last !== undefined && column.group !== undefined && last.label === column.group) {
      last.columns.push(column);
    } else {
      groups.push({ key: column.key, label: column.group, columns: [column] });
    }
  }
  return groups;
}

export interface JournalBookText {
  readonly title: string;
  /** "صفحة {page}". */
  readonly page: string;
  /** "تابع القيد رقم {number}". */
  readonly continued: string;
  readonly pageTotal: string;
  readonly broughtForward: string;
  readonly cumulative: string;
  readonly order: string;
  readonly empty: string;
  /** The heading over an entry's description and a line's account (rule 26). */
  readonly textColumn: string;
  /** The heading over an entry's reference and a line's memo. */
  readonly detailColumn: string;
  readonly fiscalYear: string;
  readonly currency: string;
  readonly columns: {
    readonly date: string;
    readonly entry: string;
    readonly code: string;
    readonly debit: string;
    readonly credit: string;
  };
}

export interface JournalBookPrintProps {
  readonly company: string;
  readonly fiscalYear: string;
  readonly currency: ReportSheet['currency'];
  readonly currencyLabel: string;
  readonly pages: readonly JournalBookPage[];
  readonly text: JournalBookText;
  /** An entry's number as accountants read it (`2026/123`). */
  readonly entryNumber: (number: number) => string;
  readonly draft?: string;
}

/** The journal book (rules 26, 27): Mizan's pages, each with its header and footer totals. */
export function JournalBookPrint({
  company,
  fiscalYear,
  currency,
  currencyLabel,
  pages,
  text,
  entryNumber,
  draft,
}: JournalBookPrintProps) {
  const money = (minor: string) => (minor === '0' ? '' : formatMinor(BigInt(minor), currency));
  if (pages.length === 0) {
    return (
      <main data-slot="journal-book-print">
        {draft === undefined ? null : <div className="draft">{draft}</div>}
        <PrintHead
          company={company}
          title={text.title}
          parameters={[{ label: text.fiscalYear, value: fiscalYear }]}
          marks={draft === undefined ? [] : [draft]}
        />
        <p>{text.empty}</p>
      </main>
    );
  }
  return (
    <main data-slot="journal-book-print">
      {pages.map((page) => (
        <section className="book-page" key={page.page} data-page={page.page}>
          {draft === undefined ? null : <div className="draft">{draft}</div>}
          <div className="book-head">
            <strong>
              <bdi>{company}</bdi>
            </strong>
            <strong>{text.title}</strong>
            <span>
              {text.fiscalYear}: <span className="code">{fiscalYear}</span>
            </span>
            <span>{text.page.replace('{page}', String(page.page))}</span>
          </div>
          {draft === undefined ? null : <div className="report-mark">{draft}</div>}
          <table className="book-rows">
            <colgroup>
              {JOURNAL_BOOK_COLUMN_KEYS.map((key) => (
                <col key={key} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>{text.columns.date}</th>
                <th>{text.columns.entry}</th>
                <th>{text.columns.code}</th>
                <th>{text.textColumn}</th>
                <th>{text.detailColumn}</th>
                <th className="num">{text.columns.debit}</th>
                <th className="num">{text.columns.credit}</th>
              </tr>
            </thead>
            <tbody>
              {keyed(page.rows).map(({ key, item: row }) => (
                <JournalBookRowView
                  key={key}
                  row={row}
                  text={text}
                  money={money}
                  entryNumber={entryNumber}
                />
              ))}
            </tbody>
          </table>
          <table className="book-foot">
            <tbody>
              {(
                [
                  [text.pageTotal, page.totals],
                  [text.broughtForward, page.broughtForward],
                  [text.cumulative, page.cumulative],
                ] as const
              ).map(([label, totals]) => (
                <tr key={label}>
                  <td>
                    <strong>{label}</strong>{' '}
                    <span className="report-parameters">{currencyLabel}</span>
                  </td>
                  <td className="num">{formatMinor(BigInt(totals.debits), currency)}</td>
                  <td className="num">{formatMinor(BigInt(totals.credits), currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="book-order">{text.order}</div>
        </section>
      ))}
    </main>
  );
}

function JournalBookRowView({
  row,
  text,
  money,
  entryNumber,
}: {
  readonly row: JournalBookRow;
  readonly text: JournalBookText;
  readonly money: (minor: string) => string;
  readonly entryNumber: (number: number) => string;
}) {
  const textCell = (value: string | null, span = 1) => (
    <td colSpan={span}>{value === null ? null : <bdi>{value}</bdi>}</td>
  );
  switch (row.kind) {
    case 'entry':
      return (
        <tr className="entry">
          <td className="code">{row.entryDate}</td>
          <td className="code">{entryNumber(row.number)}</td>
          <td />
          {textCell(row.description, 2)}
          {textCell(row.reference, 2)}
        </tr>
      );
    case 'entry_text':
      return (
        <tr>
          <td />
          <td />
          <td />
          {textCell(row.description, 2)}
          {textCell(row.reference, 2)}
        </tr>
      );
    case 'continued':
      return (
        <tr className="continued">
          <td />
          <td />
          <td />
          <td colSpan={4}>{text.continued.replace('{number}', entryNumber(row.number))}</td>
        </tr>
      );
    case 'line':
      return (
        <tr>
          <td />
          <td />
          <td className="code">{row.accountCode}</td>
          {textCell(row.accountName)}
          {textCell(row.memo)}
          <td className="num">{money(row.debit)}</td>
          <td className="num">{money(row.credit)}</td>
        </tr>
      );
    case 'line_text':
      return (
        <tr>
          <td />
          <td />
          <td />
          {textCell(row.accountName)}
          {textCell(row.memo)}
          <td />
          <td />
        </tr>
      );
  }
}

/** The journal book's seven columns, in reading order (`JOURNAL_BOOK_WIDTHS` sizes them). */
const JOURNAL_BOOK_COLUMN_KEYS = [
  'date',
  'entry',
  'code',
  'text',
  'detail',
  'debit',
  'credit',
] as const;
