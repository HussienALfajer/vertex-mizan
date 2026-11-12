'use client';

import { useDirection } from '@base-ui/react/direction-provider';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { CurrencyCode } from '@vertex-mizan/contracts';
import { type KeyboardEvent, type ReactElement, type ReactNode, useId } from 'react';
import { cn } from '../lib/cn';
import { Amount } from './amount';

/**
 * A figure column of a report: its id (a key of each row's `figures`), its heading, and the
 * heading of the group it sits under ("رصيد أول المدة" over its debit and credit), if any.
 * `compare` marks a comparative column, shown quieter.
 */
export interface ReportTableColumn {
  readonly id: string;
  readonly label: ReactNode;
  readonly group?: string | undefined;
  readonly compare?: boolean | undefined;
}

/**
 * A figure: its amount in minor units of the table's currency, or `null` for "—" (a comparative
 * with no posted line, S09 rule 5). `link` is the element the figure renders as to open the lines
 * behind it (S09 rule 6), such as a router link; it receives the figure as its children.
 */
export interface ReportFigure {
  readonly value: bigint | null;
  readonly link?: ReactElement | undefined;
  /** The figure's accessible name when it is a link ("أسطر …"). */
  readonly linkLabel?: string | undefined;
}

/**
 * A row's kind: an ordinary `line`, a `heading` (a section's title, no figures), a `subtotal`
 * (a single rule above) or a `total` (a double rule under; ADR 0010 §3).
 */
export type ReportRowKind = 'line' | 'heading' | 'subtotal' | 'total';

/** One row: its label (an account, a statement line), its level and its figures. */
export interface ReportTableRow {
  readonly key: string;
  readonly label: ReactNode;
  readonly kind?: ReportRowKind | undefined;
  /** Indentation from 1 (the outermost, the default) to 4. */
  readonly level?: number | undefined;
  readonly figures?: Readonly<Record<string, ReportFigure>> | undefined;
  /** A note shown under the row's label (a reclassification, the year's unclosed result). */
  readonly note?: ReactNode;
}

const indent = ['', 'ps-4', 'ps-8', 'ps-12'] as const;

function indentOf(level: number | undefined): string {
  return indent[Math.min(Math.max((level ?? 1) - 1, 0), indent.length - 1)] ?? '';
}

/** A position among the table's focusable cells: the row's index and the column's (0 the label). */
export interface ReportCellPosition {
  readonly row: number;
  readonly column: number;
}

/**
 * Where an arrow, Home or End key moves the focus from `from` (null: not a navigation key), among
 * `cells`, the focusable positions. Up and down keep the column, skipping rows without a link
 * there; left and right are visual, as the data grid's (APG): Left is the next column in RTL.
 */
export function reportTableMove(
  cells: readonly ReportCellPosition[],
  from: ReportCellPosition,
  key: string,
  direction: 'ltr' | 'rtl',
): ReportCellPosition | null {
  const inRow = (row: number) =>
    cells.filter((cell) => cell.row === row).sort((a, b) => a.column - b.column);
  const vertical = (step: 1 | -1) => {
    const candidates = cells
      .filter((cell) => cell.column === from.column && (cell.row - from.row) * step > 0)
      .sort((a, b) => (a.row - b.row) * step);
    return candidates[0] ?? null;
  };
  const horizontal = (step: 1 | -1) => {
    const row = inRow(from.row);
    const index = row.findIndex((cell) => cell.column === from.column);
    return row[index + step] ?? null;
  };
  switch (key) {
    case 'ArrowDown':
      return vertical(1);
    case 'ArrowUp':
      return vertical(-1);
    case 'ArrowLeft':
      return horizontal(direction === 'rtl' ? 1 : -1);
    case 'ArrowRight':
      return horizontal(direction === 'rtl' ? -1 : 1);
    case 'Home':
      return inRow(from.row)[0] ?? null;
    case 'End':
      return inRow(from.row).at(-1) ?? null;
    default:
      return null;
  }
}

const cellAttribute = 'data-report-cell';

function positionOf(element: Element | null): ReportCellPosition | null {
  const text = element?.getAttribute(cellAttribute);
  if (!text) return null;
  const [row, column] = text.split(':').map(Number);
  if (row === undefined || column === undefined) return null;
  return { row, column };
}

/**
 * A report's table (S09 "Screens", ADR 0010 §7): rows indented by level, headings, subtotals
 * under a single rule and totals under a double rule, figure columns with grouped headings and
 * quieter comparative columns, every figure that has a `link` a drill-down to its lines, a sticky
 * header inside its own scroll area, arrow keys between the links (Home and End in a row), and on
 * a phone one card per row with its figures stacked. Columns, rows and labels come in as props;
 * every figure goes through `Amount`, `null` shows "—".
 */
function ReportTable({
  caption,
  columns,
  rows,
  currency,
  labels,
  className,
}: {
  /** The table's accessible name (the report and its dates). */
  caption: string;
  columns: readonly ReportTableColumn[];
  rows: readonly ReportTableRow[];
  currency: CurrencyCode;
  labels: {
    /** The first column's heading ("الحساب", "البند"). */
    readonly row: string;
    /** "—": a figure that has no value (a comparative without lines). */
    readonly none: string;
  };
  className?: string | undefined;
}) {
  const id = useId();
  const direction = useDirection();
  const groups = groupsOf(columns);
  const grouped = groups.some((group) => group.label !== undefined);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const from = positionOf(event.target as Element);
    if (!from) return;
    const scope = event.currentTarget;
    const elements = [...scope.querySelectorAll(`[${cellAttribute}]`)];
    const cells = elements.flatMap((element) => {
      const position = positionOf(element);
      return position ? [position] : [];
    });
    const to = reportTableMove(cells, from, event.key, direction);
    if (!to) return;
    event.preventDefault();
    const target = scope.querySelector<HTMLElement>(`[${cellAttribute}="${to.row}:${to.column}"]`);
    target?.focus();
  };

  const figureOf = (row: ReportTableRow, column: ReportTableColumn, index: number, c: number) => {
    const figure = row.figures?.[column.id];
    if (!figure) return null;
    return (
      <Figure
        figure={figure}
        currency={currency}
        strong={row.kind === 'subtotal' || row.kind === 'total'}
        none={labels.none}
        cell={figure.link ? `${index}:${c + 1}` : undefined}
      />
    );
  };

  return (
    <div data-slot="report-table" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div
        data-slot="report-table-scroll"
        className="relative max-h-[75dvh] overflow-auto rounded-lg border border-border bg-surface max-md:hidden"
      >
        <table
          aria-labelledby={`${id}-caption`}
          className="w-full border-separate border-spacing-0 text-control tabular-nums"
          onKeyDown={onKeyDown}
        >
          <caption id={`${id}-caption`} className="sr-only">
            {caption}
          </caption>
          <thead className="sticky top-0 z-10 bg-muted">
            {grouped && (
              <tr>
                <th
                  rowSpan={2}
                  scope="col"
                  className="h-row border-b border-border px-cell text-start align-bottom font-medium whitespace-nowrap text-muted-foreground"
                >
                  {labels.row}
                </th>
                {groups.map((group) => (
                  <th
                    key={group.key}
                    scope="colgroup"
                    colSpan={group.span}
                    rowSpan={group.label === undefined ? 2 : 1}
                    className={cn(
                      'h-row border-b border-border px-cell font-medium whitespace-nowrap text-muted-foreground',
                      group.label === undefined ? 'align-bottom ltr:text-end' : 'text-center',
                    )}
                  >
                    {group.label ?? group.columns[0]?.label}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {!grouped && (
                <th
                  scope="col"
                  className="h-row border-b border-border px-cell text-start align-middle font-medium whitespace-nowrap text-muted-foreground"
                >
                  {labels.row}
                </th>
              )}
              {columns.map((column) =>
                grouped && column.group === undefined ? null : (
                  <th
                    key={column.id}
                    scope="col"
                    className="h-row border-b border-border px-cell align-middle font-medium whitespace-nowrap text-muted-foreground ltr:text-end"
                  >
                    {column.label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const kind = row.kind ?? 'line';
              if (kind === 'heading') {
                return (
                  <tr key={row.key} data-slot="report-table-heading">
                    <th
                      scope="colgroup"
                      colSpan={columns.length + 1}
                      className={cn(
                        'h-row border-b border-border bg-muted/40 px-cell text-start font-bold',
                        indentOf(row.level),
                      )}
                    >
                      {row.label}
                    </th>
                  </tr>
                );
              }
              // A single rule above a subtotal and a total; the total's double rule is under its figures.
              const rule = kind === 'line' ? '' : 'border-t border-foreground';
              return (
                <tr
                  key={row.key}
                  data-slot="report-table-row"
                  data-kind={kind}
                  className="transition-colors duration-150 hover:bg-muted/50"
                >
                  <th
                    scope="row"
                    className={cn(
                      'h-row border-b border-border px-cell py-1 text-start align-middle font-normal',
                      kind !== 'line' && 'font-bold',
                      rule,
                    )}
                  >
                    <div className={cn('flex min-w-0 flex-col', indentOf(row.level))}>
                      <span>{row.label}</span>
                      {row.note !== undefined && row.note !== null && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {row.note}
                        </span>
                      )}
                    </div>
                  </th>
                  {columns.map((column, c) => (
                    <td
                      key={column.id}
                      className={cn(
                        'h-row border-b border-border px-cell align-middle whitespace-nowrap ltr:text-end',
                        column.compare && 'text-muted-foreground',
                        rule,
                      )}
                    >
                      {kind === 'total' ? (
                        <span className="inline-block border-b-[3px] border-double border-foreground">
                          {figureOf(row, column, index, c)}
                        </span>
                      ) : (
                        figureOf(row, column, index, c)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ol className="flex flex-col gap-2 md:hidden" aria-label={caption} onKeyDown={onKeyDown}>
        {rows.map((row, index) => {
          const kind = row.kind ?? 'line';
          if (kind === 'heading') {
            return (
              <li key={row.key} data-slot="report-table-card-heading" className="pt-2 font-bold">
                {row.label}
              </li>
            );
          }
          return (
            <li
              key={row.key}
              data-slot="report-table-card"
              data-kind={kind}
              className={cn(
                'rounded-lg border bg-surface p-3',
                kind === 'line' ? 'border-border' : 'border-foreground font-bold',
              )}
            >
              <div className="flex min-w-0 flex-col">
                <span>{row.label}</span>
                {row.note !== undefined && row.note !== null && (
                  <span className="text-xs font-normal text-muted-foreground">{row.note}</span>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-control">
                {columns.map((column, c) =>
                  row.figures?.[column.id] ? (
                    <div key={column.id} className="contents">
                      <dt className="font-normal text-muted-foreground">
                        {column.group ? `${column.group} · ` : ''}
                        {column.label}
                      </dt>
                      <dd className={cn(column.compare && 'text-muted-foreground')}>
                        {figureOf(row, column, index, c)}
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface ColumnGroup {
  readonly key: string;
  readonly label: string | undefined;
  readonly span: number;
  readonly columns: readonly ReportTableColumn[];
}

/** Consecutive columns of one group under one heading; a column without a group stands alone. */
function groupsOf(columns: readonly ReportTableColumn[]): ColumnGroup[] {
  const groups: ColumnGroup[] = [];
  for (const column of columns) {
    const last = groups.at(-1);
    if (last && column.group !== undefined && last.label === column.group) {
      groups[groups.length - 1] = {
        ...last,
        span: last.span + 1,
        columns: [...last.columns, column],
      };
    } else {
      groups.push({ key: column.id, label: column.group, span: 1, columns: [column] });
    }
  }
  return groups;
}

/** A figure, as a link to its lines when it has one; "—" for `null`. */
function Figure({
  figure,
  currency,
  strong,
  none,
  cell,
}: {
  figure: ReportFigure;
  currency: CurrencyCode;
  strong: boolean;
  none: string;
  cell: string | undefined;
}) {
  const content =
    figure.value === null ? (
      <span>{none}</span>
    ) : (
      <Amount value={figure.value} currency={currency} strong={strong} />
    );
  if (!figure.link) return content;
  return (
    <FigureLink
      link={figure.link}
      cell={cell}
      label={figure.linkLabel}
      className="rounded-sm underline-offset-4 hover:underline focus-visible:underline"
    >
      {content}
    </FigureLink>
  );
}

function FigureLink({
  link,
  cell,
  label,
  className,
  children,
}: {
  link: ReactElement;
  cell: string | undefined;
  label: string | undefined;
  className: string;
  children: ReactNode;
}) {
  return useRender({
    render: link,
    props: mergeProps<'a'>({ className, children, 'aria-label': label }, {
      // The data attribute names the cell for the arrow keys.
      [cellAttribute]: cell,
    } as object),
  });
}

export { ReportTable };
