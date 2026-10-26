'use client';

import { useDirection } from '@base-ui/react/direction-provider';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { CircleAlertIcon } from 'lucide-react';
import {
  type ClipboardEvent,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Amount } from '../accounting/amount';
import { cn } from '../lib/cn';
import {
  type AmountKind,
  type CellEdit,
  cellText,
  copyRange,
  type EditPlan,
  type GridColumn,
  isCellEditable,
  planCellEdit,
  planClear,
  planFillDown,
  planPaste,
} from './cells';
import { type GridCommand, gridCommand } from './grid-keys';
import {
  type CellPosition,
  clampSelection,
  extendTo,
  type GridMove,
  type GridSelection,
  navigate,
  rangeContains,
  selectAll,
  selectCell,
  selectColumns,
  selectionRange,
  selectRows,
} from './selection';
import { summarizeSelection } from './summary';

/** A column of the grid: the core's column with its header, and optionally a footer and a view. */
export type GridColumnDef<Row> = GridColumn<Row> & {
  readonly header: ReactNode;
  /** The footer cell (a total, as `Amount strong`); the footer row shows when any column has one. */
  readonly footer?: ReactNode;
  /** A text cell's view when it is more than its text (an `AccountLabel`); its text still copies. */
  readonly render?: (row: Row) => ReactNode;
};

/** Why an edit changed nothing: the core's refusal, which the app turns into text. */
export type GridProblem = Exclude<EditPlan, { ok: true }>;

/** The summary bar's labels, from i18n `grid.summary`. */
export interface GridSummaryLabels {
  readonly label: string;
  readonly count: string;
  readonly sum: string;
  readonly average: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly kinds: Readonly<Record<AmountKind, string>>;
}

/** An editable grid takes both callbacks; without them it is read-only (it selects and copies). */
type GridEditing =
  | {
      /**
       * Called with every edit of a commit, paste, fill down or clear, all checked first: the app
       * applies them to its rows.
       */
      onEdit: (edits: readonly CellEdit[]) => void;
      /**
       * Called with the refusal when a cell's editor commits text the cell refuses, and with
       * `null` once that editor commits or cancels. The refused text stays in the editor while the
       * cell keeps its last committed value, so the app must not save or post while the last call
       * reported a refusal (ADR 0010 §4).
       */
      onEditError: (problem: GridProblem | null) => void;
    }
  | { onEdit?: undefined; onEditError?: undefined };

type GridProps<Row> = Omit<ComponentProps<'div'>, 'children' | 'onCopy' | 'onPaste'> &
  GridEditing & {
    rows: readonly Row[];
    columns: readonly GridColumnDef<Row>[];
    rowKey: (row: Row, index: number) => string;
    /** The text of a refusal, shown beside the grid with an icon (i18n `grid.problems`). */
    describeProblem: (problem: GridProblem) => string;
    summaryLabels: GridSummaryLabels;
    /** The first column stays at the start edge while the grid scrolls, as each row's header. */
    stickyStartColumn?: boolean;
    /** Shown when there is no row. */
    empty?: ReactNode;
  };

interface Editing {
  readonly position: CellPosition;
  readonly initial: string;
  readonly text: string;
}

interface Problem {
  readonly message: string;
  readonly cells: readonly CellPosition[];
}

const same = (a: CellPosition, b: CellPosition) => a.row === b.row && a.column === b.column;

/** Rows in one page for Page Up and Down: what the scroll area shows, less the header and footer. */
function pageRowsOf(scroller: HTMLElement | null): number {
  const row = scroller?.querySelector<HTMLElement>('tbody tr');
  if (!scroller || !row || row.offsetHeight === 0) return 10;
  return Math.max(1, Math.floor(scroller.clientHeight / row.offsetHeight) - 2);
}

/**
 * The data grid foundation (ADR 0010 §4): the WAI-ARIA grid pattern with one focusable cell
 * (roving tabindex), Excel's keys in both directions, range selection by keyboard and pointer,
 * editing mode, copy and paste with Excel, fill down, clear, and the selection summary bar per
 * kind of amount and currency. The logic is the pure core beside it; this renders DOM cells with
 * logical CSS at the density's row height, with a sticky header, footer and start column.
 */
function Grid<Row>({
  rows,
  columns,
  rowKey,
  onEdit,
  onEditError,
  describeProblem,
  summaryLabels,
  stickyStartColumn = false,
  empty,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: GridProps<Row>) {
  const direction = useDirection();
  const problemId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const startHeadRef = useRef<HTMLTableCellElement>(null);
  const focusPending = useRef(false);
  // Whether the app was last told that the open editor holds refused text.
  const editorRefused = useRef(false);
  const [selection, setSelection] = useState<GridSelection>(() =>
    selectCell({ row: 0, column: 0 }),
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  // Without `onEdit` every cell is read-only: the core then refuses each edit with `READ_ONLY`.
  const cells = useMemo<readonly GridColumn<Row>[]>(
    () => (onEdit ? columns : columns.map((column) => ({ ...column, readOnly: true }))),
    [columns, onEdit],
  );
  const shape = { rowCount: rows.length, columnCount: columns.length };
  const hasCells = shape.rowCount > 0 && shape.columnCount > 0;
  const current = hasCells ? clampSelection(selection, shape) : undefined;
  const range = current && selectionRange(current);
  const edited =
    editing && editing.position.row < shape.rowCount && editing.position.column < shape.columnCount
      ? editing
      : null;
  const hasFooter = columns.some((column) => column.footer !== undefined);

  useEffect(() => {
    if (!focusPending.current || !current || edited) return;
    focusPending.current = false;
    const cell = tableRef.current?.querySelector<HTMLElement>(
      `[data-row="${current.active.row}"][data-column="${current.active.column}"]`,
    );
    cell?.focus({ preventScroll: true });
    cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });

  // The sticky start column reserves its width as scroll padding, so it never hides the focused
  // cell (WCAG 2.4.11); the header and footer reserve a row (`scroll-pt-row`, `scroll-pb-row`).
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const head = startHeadRef.current;
    if (!scroller || !head) return;
    const reserve = () => {
      scroller.style.scrollPaddingInlineStart = `${head.offsetWidth}px`;
    };
    reserve();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reserve);
    observer.observe(head);
    return () => observer.disconnect();
  }, []);

  function select(next: GridSelection, focus = true) {
    setSelection(next);
    focusPending.current = focus;
  }

  /** Applies a plan: every edit to the app, or its refusal shown and nothing changed. */
  function apply(plan: EditPlan): boolean {
    if (plan.ok) {
      setProblem(null);
      if (plan.edits.length > 0) onEdit?.(plan.edits);
      return true;
    }
    setProblem({
      message: describeProblem(plan),
      cells: plan.problem === 'INVALID_CELLS' ? plan.cells : [],
    });
    return false;
  }

  function startEditing(position: CellPosition, typed?: string) {
    const column = cells[position.column] as GridColumn<Row>;
    const row = rows[position.row] as Row;
    if (!isCellEditable(column, row)) {
      apply({
        ok: false,
        problem: 'INVALID_CELLS',
        cells: [{ ...position, reason: 'READ_ONLY' }],
      });
      return;
    }
    const initial = cellText(column, row, { grouping: true });
    setProblem(null);
    setEditing({ position, initial, text: typed ?? initial });
  }

  /** Tells the app whether the open editor holds refused text, once per change. */
  function reportEditor(refusal: GridProblem | null) {
    if (refusal === null && !editorRefused.current) return;
    editorRefused.current = refusal !== null;
    onEditError?.(refusal);
  }

  /** Commits the editor; on success it closes and the active cell moves. False keeps it open. */
  function commit(move?: GridMove, focus = true): boolean {
    if (!edited) return true;
    if (edited.text !== edited.initial) {
      const plan = planCellEdit(rows, cells, edited.position, edited.text);
      if (!apply(plan)) {
        if (!plan.ok) reportEditor(plan);
        return false;
      }
    }
    reportEditor(null);
    setEditing(null);
    if (!edited.text || edited.text === edited.initial) setProblem(null);
    const at = selectCell(edited.position);
    select(
      (move && navigate(at, move, { shape, pageRows: pageRowsOf(scrollRef.current) })) ?? at,
      focus,
    );
    return true;
  }

  function cancel() {
    if (!edited) return;
    reportEditor(null);
    setEditing(null);
    setProblem(null);
    select(selectCell(edited.position));
  }

  /** Runs a command; false when the key is left to the browser (Tab out of the grid). */
  function run(command: GridCommand, at: GridSelection): boolean {
    switch (command.type) {
      case 'move': {
        const next = navigate(at, command.move, {
          shape,
          pageRows: pageRowsOf(scrollRef.current),
          extend: command.extend,
        });
        if (!next) return false;
        select(next);
        return true;
      }
      case 'selectAll':
        select(selectAll(at, shape));
        return true;
      case 'selectRows':
        select(selectRows(at, shape));
        return true;
      case 'selectColumns':
        select(selectColumns(at, shape));
        return true;
      case 'edit':
        startEditing(at.active);
        return true;
      case 'clear':
        apply(planClear(rows, cells, at));
        return true;
      case 'fillDown':
        apply(planFillDown(rows, cells, at));
        return true;
    }
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (edited || !current) return;
    const command = gridCommand(event.nativeEvent, direction);
    if (command) {
      if (run(command, current)) event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && problem) {
      setProblem(null);
      return;
    }
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (plain && event.key === 'Backspace') {
      event.preventDefault();
      startEditing(current.active, '');
    } else if (plain && event.key.length === 1) {
      // Typing replaces the cell's content, as in a spreadsheet.
      event.preventDefault();
      startEditing(current.active, event.key);
    }
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      commit(event.shiftKey ? 'up' : 'down');
    } else if (event.key === 'Tab') {
      event.preventDefault();
      commit(event.shiftKey ? 'previous' : 'next');
    }
  }

  function onCopy(event: ClipboardEvent<HTMLTableElement>) {
    if (edited || !range) return;
    event.preventDefault();
    const { tsv, html } = copyRange(rows, cells, range);
    event.clipboardData.setData('text/plain', tsv);
    event.clipboardData.setData('text/html', html);
  }

  function onPaste(event: ClipboardEvent<HTMLTableElement>) {
    if (edited || !current) return;
    event.preventDefault();
    const plan = planPaste(rows, cells, current, event.clipboardData.getData('text/plain'));
    if (!apply(plan) || !plan.ok) return;
    const first = { row: plan.range.firstRow, column: plan.range.firstColumn };
    select({
      active: first,
      anchor: first,
      extent: { row: plan.range.lastRow, column: plan.range.lastColumn },
    });
  }

  function onCellPointerDown(position: CellPosition, shiftKey: boolean) {
    if (edited && !same(edited.position, position) && !commit(undefined, false)) return;
    if (edited && same(edited.position, position)) return;
    select(shiftKey && current ? extendTo(current, position) : selectCell(position));
  }

  const summary =
    range && !(range.firstRow === range.lastRow && range.firstColumn === range.lastColumn)
      ? summarizeSelection(rows, cells, range)
      : [];
  const refused = (position: CellPosition) =>
    problem?.cells.some((cell) => same(cell, position)) ?? false;

  return (
    <div
      data-slot="grid"
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface text-control',
        className,
      )}
      {...props}
    >
      <div
        ref={scrollRef}
        data-slot="grid-scroll"
        className={cn(
          'relative min-h-0 flex-1 overflow-auto scroll-pt-row',
          hasFooter && 'scroll-pb-row',
        )}
      >
        <table
          ref={tableRef}
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: APG's data grid is a table with role grid; its rows and cells take row, columnheader, rowheader and gridcell from it (HTML-AAM).
          role="grid"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-multiselectable="true"
          aria-readonly={onEdit ? undefined : true}
          data-slot="grid-table"
          className="w-full border-separate border-spacing-0 tabular-nums"
          onKeyDown={onGridKeyDown}
          onCopy={onCopy}
          onPaste={onPaste}
        >
          <thead>
            <tr>
              {columns.map((column, c) => (
                <th
                  key={column.id}
                  ref={stickyStartColumn && c === 0 ? startHeadRef : undefined}
                  scope="col"
                  data-slot="grid-head"
                  className={cn(
                    'sticky top-0 z-10 h-row border-b border-border bg-muted px-cell text-start align-middle font-medium whitespace-nowrap text-muted-foreground',
                    column.type === 'amount' && 'ltr:text-end',
                    stickyStartColumn && c === 0 && 'start-0 z-20',
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length)}
                  className="h-row px-cell py-6 text-center text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, r) => (
                <tr key={rowKey(row, r)}>
                  {cells.map((column, c) => {
                    const position = { row: r, column: c };
                    const active = current ? same(current.active, position) : false;
                    const editor = edited && same(edited.position, position);
                    const selected = range ? rangeContains(range, position) : false;
                    const header = stickyStartColumn && c === 0;
                    const Cell = header ? 'th' : 'td';
                    const definition = columns[c] as GridColumnDef<Row>;
                    return (
                      <Cell
                        key={column.id}
                        scope={header ? 'row' : undefined}
                        tabIndex={active && !editor ? 0 : -1}
                        aria-selected={selected}
                        aria-readonly={isCellEditable(column, row) ? undefined : true}
                        aria-invalid={refused(position) || undefined}
                        data-slot="grid-cell"
                        data-row={r}
                        data-column={c}
                        className={cn(
                          'h-row cursor-cell border-b border-border px-cell text-start align-middle font-normal whitespace-nowrap select-none',
                          // The identity's 2 px focus ring, inset so it never overlaps a neighbour (ADR 0010 §4).
                          'focus-visible:-outline-offset-2',
                          'aria-selected:bg-selection',
                          'aria-invalid:ring-2 aria-invalid:ring-destructive-text aria-invalid:ring-inset',
                          column.type === 'amount' && 'ltr:text-end',
                          // A long name never takes the whole width of a phone: it is cut with an ellipsis.
                          header &&
                            'sticky start-0 z-5 max-w-[45vw] overflow-hidden text-ellipsis bg-surface',
                          editor && 'p-0',
                        )}
                        onPointerDown={(event) => {
                          if (event.button === 0) onCellPointerDown(position, event.shiftKey);
                        }}
                        onPointerEnter={(event) => {
                          if (event.buttons === 1 && current && !edited) {
                            select(extendTo(current, position));
                          }
                        }}
                        onMouseDown={(event) => {
                          // Focus stays in the editor until its commit, which a refused text never passes.
                          if (edited && !same(edited.position, position)) event.preventDefault();
                        }}
                        onDoubleClick={() => {
                          // A double-click inside an open editor selects a word; it never reopens
                          // the cell or drops the text being edited, refused or not.
                          if (!edited) startEditing(position);
                        }}
                      >
                        {editor ? (
                          <GridCellEditor
                            amount={column.type === 'amount'}
                            value={edited.text}
                            invalid={refused(position)}
                            describedBy={problem ? problemId : undefined}
                            onValueChange={(text) => setEditing({ ...edited, text })}
                            onKeyDown={onEditorKeyDown}
                            onBlur={() => commit(undefined, false)}
                          />
                        ) : column.type === 'amount' ? (
                          <CellAmount
                            value={column.valueMinor(row)}
                            currency={column.currency(row)}
                          />
                        ) : (
                          (definition.render?.(row) ?? <bdi>{column.value(row)}</bdi>)
                        )}
                      </Cell>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {hasFooter && (
            <tfoot>
              <tr>
                {columns.map((column, c) => (
                  <td
                    key={column.id}
                    data-slot="grid-footer"
                    className={cn(
                      'sticky bottom-0 z-10 h-row border-t border-border bg-muted px-cell text-start align-middle font-medium whitespace-nowrap',
                      column.type === 'amount' && 'ltr:text-end',
                      stickyStartColumn && c === 0 && 'start-0 z-20',
                    )}
                  >
                    {column.footer}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {(problem || summary.length > 0) && (
        <div
          data-slot="grid-bar"
          className="flex flex-col gap-1 border-t border-border bg-muted px-cell py-1 text-muted-foreground"
        >
          {problem && (
            <p
              id={problemId}
              role="alert"
              data-slot="grid-problem"
              className="flex items-center gap-1 font-medium text-destructive-text"
            >
              <CircleAlertIcon aria-hidden="true" className="size-icon shrink-0" />
              {problem.message}
            </p>
          )}
          {summary.length > 0 && <GridSummary summary={summary} labels={summaryLabels} />}
        </div>
      )}
    </div>
  );
}

function CellAmount({
  value,
  currency,
}: {
  value: bigint | null;
  currency: ComponentProps<typeof Amount>['currency'];
}) {
  return value === null ? null : <Amount value={value} currency={currency} />;
}

/**
 * The editor of the cell being edited: the caret at the end (F2 and typing alike), left to right
 * for an amount. Its text is committed through the core (`planCellEdit`), which parses amounts
 * through the money module, exactly as `AmountInput` does.
 */
function GridCellEditor({
  amount,
  value,
  invalid,
  describedBy,
  onValueChange,
  onKeyDown,
  onBlur,
}: {
  amount: boolean;
  value: string;
  invalid: boolean;
  describedBy: string | undefined;
  onValueChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);
  return (
    <InputPrimitive
      ref={ref}
      data-slot="grid-editor"
      // One character wide by itself: the editor fills its column and never widens it.
      size={1}
      dir={amount ? 'ltr' : undefined}
      inputMode={amount ? 'decimal' : undefined}
      autoComplete="off"
      spellCheck={false}
      value={value}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(
        'h-row w-full min-w-0 bg-surface px-cell text-control text-foreground outline-none',
        'ring-2 ring-ring ring-inset aria-invalid:ring-destructive-text',
        amount && 'text-end tabular-nums',
      )}
      onValueChange={(text: string) => onValueChange(text)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}

/** The selection summary bar's figures: per kind of amount, then per currency. */
function GridSummary({
  summary,
  labels,
}: {
  summary: ReturnType<typeof summarizeSelection>;
  labels: GridSummaryLabels;
}) {
  return (
    <section data-slot="grid-summary" aria-label={labels.label} className="contents">
      {summary.flatMap(({ kind, summaries }) =>
        summaries.map((figures) => (
          <dl
            key={`${kind}-${figures.currency}`}
            className="flex items-center gap-x-3 overflow-x-auto whitespace-nowrap"
          >
            <div className="flex gap-1 font-medium text-foreground">
              <dt>{labels.kinds[kind]}</dt>
              <dd>
                <bdi dir="ltr">{figures.currency}</bdi>
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>{labels.count}</dt>
              <dd>
                <bdi dir="ltr">{figures.count}</bdi>
              </dd>
            </div>
            {(
              [
                [labels.sum, figures.sumMinor],
                [labels.average, figures.averageMinor],
                [labels.minimum, figures.minMinor],
                [labels.maximum, figures.maxMinor],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex gap-1">
                <dt>{label}</dt>
                <dd>
                  <Amount value={value} currency={figures.currency} />
                </dd>
              </div>
            ))}
          </dl>
        )),
      )}
    </section>
  );
}

export { Grid, type GridProps };
