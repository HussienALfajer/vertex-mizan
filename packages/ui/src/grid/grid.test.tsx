// @vitest-environment jsdom

import { DirectionProvider } from '@base-ui/react/direction-provider';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CurrencyCode } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keymap } from '../lib/keymap';
import { matchesShortcut } from '../lib/shortcuts';
import type { CellEdit } from './cells';
import { Grid, type GridColumnDef, type GridProblem, gridCellOf } from './grid';

afterEach(cleanup);

/** A synthetic line: an account, the transaction amount and the parallel amount in USD. */
interface Line {
  readonly id: string;
  readonly account: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint | null;
  readonly parallel: bigint | null;
  readonly posted?: boolean;
}

const columns: GridColumnDef<Line>[] = [
  { id: 'account', type: 'text', header: 'الحساب', value: (line) => line.account },
  {
    id: 'amount',
    type: 'amount',
    kind: 'transaction',
    header: 'المبلغ',
    valueMinor: (line) => line.amount,
    currency: (line) => line.currency,
    allowNegative: false,
    readOnly: (line) => Boolean(line.posted),
  },
  {
    id: 'parallel',
    type: 'amount',
    kind: 'parallel',
    header: 'الموازي',
    valueMinor: (line) => line.parallel,
    currency: () => 'USD',
    footer: 'الإجمالي',
  },
];

const initialLines: Line[] = [
  { id: 'a', account: '1100 نقدية', currency: 'USD', amount: 125050n, parallel: 125050n },
  { id: 'b', account: '4100 إيرادات', currency: 'USD', amount: 2500n, parallel: -2500n },
  { id: 'c', account: '1200 بنك', currency: 'SYP', amount: 1300000n, parallel: 10000n },
  { id: 'd', account: '2100 مرحّل', currency: 'USD', amount: 500n, parallel: 500n, posted: true },
];

/** The app's text for a refusal, from i18n, as an app would write it. */
function problemText(problem: GridProblem): string {
  if (problem.problem !== 'INVALID_CELLS') return ar.grid.problems[problem.problem];
  const first = problem.cells[0];
  if (!first) return ar.grid.problems.nothingChanged;
  const reason =
    first.reason === 'AMOUNT'
      ? ar.accounting.amountInput[first.error]
      : first.reason === 'TEXT'
        ? first.error
        : ar.grid.problems[first.reason];
  return `${ar.grid.problems.nothingChanged} ${reason}`;
}

const ids = ['account', 'amount', 'parallel'] as const;

/** A grid over its own rows, applying each edit as an app would. */
function Harness({
  direction = 'rtl',
  editable = true,
  enterMoves,
  onEdit = () => {},
  onEditError = () => {},
  onPost = () => {},
  onLookup = () => {},
}: {
  direction?: 'rtl' | 'ltr';
  editable?: boolean;
  enterMoves?: 'down' | 'next';
  onLookup?: (cell: ReturnType<typeof gridCellOf>) => void;
  onEdit?: (edits: readonly CellEdit[]) => void;
  onEditError?: (problem: GridProblem | null) => void;
  onPost?: (lines: readonly Line[]) => void;
}) {
  const [lines, setLines] = useState(initialLines);
  const insertFirst = () =>
    setLines((current) => [
      { id: `new-${current.length}`, account: '', currency: 'USD', amount: null, parallel: null },
      ...current,
    ]);
  const apply = (edits: readonly CellEdit[]) => {
    onEdit(edits);
    setLines((current) => {
      const next = current.map((line) => ({ ...line }));
      for (const edit of edits) {
        const line = next[edit.row] as { -readonly [K in keyof Line]: Line[K] };
        if (edit.type === 'text') line.account = edit.text;
        else if (ids[edit.column] === 'amount') line.amount = edit.amountMinor;
        else line.parallel = edit.amountMinor;
      }
      return next;
    });
  };
  // An app's line keys, on an ancestor as component keys are: post the lines, insert a line.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (matchesShortcut(event.nativeEvent, keymap.post, 'other')) onPost(lines);
    if (matchesShortcut(event.nativeEvent, keymap.insertLine, 'other')) insertFirst();
    if (matchesShortcut(event.nativeEvent, keymap.lookup, 'other'))
      onLookup(gridCellOf(event.target));
  };
  return (
    <DirectionProvider direction={direction}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a test stand-in for an app's line keys. */}
      <div onKeyDown={onKeyDown}>
        <button type="button" onClick={insertFirst}>
          insert
        </button>
        <button type="button" onClick={() => setLines((current) => current.slice(1))}>
          delete first
        </button>
        <Grid
          aria-label="قيد"
          rows={lines}
          columns={columns}
          rowKey={(line) => line.id}
          {...(editable ? { onEdit: apply, onEditError } : {})}
          describeProblem={problemText}
          summaryLabels={ar.grid.summary}
          stickyStartColumn
          {...(enterMoves ? { enterMoves } : {})}
        />
      </div>
    </DirectionProvider>
  );
}

const grid = () => screen.getByRole('grid', { name: 'قيد' });
const cell = (row: number, column: number) =>
  grid().querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`) as HTMLElement;
const active = () => grid().querySelector<HTMLElement>('[data-slot="grid-cell"][tabindex="0"]');
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? grid(), { key, ...init });
const editor = () => screen.getByRole('textbox') as HTMLInputElement;
const alertText = () => screen.queryByRole('alert')?.textContent ?? null;

function focusCell(row: number, column: number) {
  fireEvent.pointerDown(cell(row, column), { button: 0 });
  expect(document.activeElement).toBe(cell(row, column));
}

describe('Grid', () => {
  it('is an APG grid with one cell in the tab sequence, headers and row headers', () => {
    render(<Harness />);
    expect(grid().getAttribute('aria-multiselectable')).toBe('true');
    expect(grid().querySelectorAll('[data-slot="grid-cell"][tabindex="0"]')).toHaveLength(1);
    expect(active()).toBe(cell(0, 0));
    expect(grid().querySelectorAll('thead th[scope="col"]')).toHaveLength(3);
    // The sticky start column holds each row's header.
    expect(cell(1, 0).tagName).toBe('TH');
    expect(cell(1, 0).getAttribute('scope')).toBe('row');
    expect(cell(1, 0).className).toContain('sticky');
    expect(cell(1, 1).tagName).toBe('TD');
    expect(cell(3, 1).getAttribute('aria-readonly')).toBe('true');
    expect(grid().querySelector('tfoot')?.textContent).toBe('الإجمالي');
  });

  it('shows amounts through Amount, negatives with their sign and color', () => {
    render(<Harness />);
    expect(cell(0, 1).textContent).toBe('1,250.50');
    const negative = cell(1, 2).querySelector('[data-slot="amount"]');
    expect(negative?.textContent).toBe('-25.00');
    expect(negative?.getAttribute('data-negative')).toBe('true');
    expect(negative?.getAttribute('dir')).toBe('ltr');
  });

  it('moves visually: Left is the next column in RTL', () => {
    render(<Harness />);
    focusCell(0, 0);
    press('ArrowLeft');
    expect(document.activeElement).toBe(cell(0, 1));
    press('ArrowDown');
    expect(document.activeElement).toBe(cell(1, 1));
    press('ArrowRight');
    expect(document.activeElement).toBe(cell(1, 0));
    expect(active()).toBe(cell(1, 0));
  });

  it('moves visually: Right is the next column in LTR', () => {
    render(<Harness direction="ltr" />);
    focusCell(0, 0);
    press('ArrowRight');
    expect(document.activeElement).toBe(cell(0, 1));
  });

  it('wraps Tab across rows and lets Tab leave the grid after the last cell', () => {
    render(<Harness />);
    focusCell(0, 2);
    press('Tab');
    expect(document.activeElement).toBe(cell(1, 0));
    focusCell(3, 2);
    expect(press('Tab')).toBe(true);
  });

  it('selects a range with Shift and summarizes it per kind and currency', () => {
    render(<Harness />);
    focusCell(0, 1);
    press('ArrowDown', { shiftKey: true });
    press('ArrowLeft', { shiftKey: true });
    expect(grid().querySelectorAll('[aria-selected="true"]')).toHaveLength(4);
    // The active cell stays where the selection started.
    expect(document.activeElement).toBe(cell(0, 1));
    const summary = screen.getByRole('region', { name: ar.grid.summary.label });
    const groups = summary.querySelectorAll('dl');
    // A transaction amount in USD and a parallel amount in USD are never added together.
    expect([...groups].map((group) => group.firstElementChild?.textContent)).toEqual([
      `${ar.grid.summary.kinds.transaction}USD`,
      `${ar.grid.summary.kinds.parallel}USD`,
    ]);
    expect(groups[0]?.textContent).toContain(`${ar.grid.summary.sum}1,275.50`);
    expect(groups[1]?.textContent).toContain(`${ar.grid.summary.sum}1,225.50`);
    expect(groups[1]?.textContent).toContain(`${ar.grid.summary.minimum}-25.00`);
  });

  it('selects every cell, whole rows and whole columns from the keymap', () => {
    render(<Harness />);
    focusCell(1, 1);
    press('a', { code: 'KeyA', ctrlKey: true });
    expect(grid().querySelectorAll('[aria-selected="true"]')).toHaveLength(12);
    focusCell(1, 1);
    press(' ', { code: 'Space', shiftKey: true });
    expect(grid().querySelectorAll('[aria-selected="true"]')).toHaveLength(3);
    focusCell(1, 1);
    press(' ', { code: 'Space', ctrlKey: true });
    expect(grid().querySelectorAll('[aria-selected="true"]')).toHaveLength(4);
  });

  it('extends the selection with Shift+click', () => {
    render(<Harness />);
    focusCell(0, 0);
    fireEvent.pointerDown(cell(2, 1), { button: 0, shiftKey: true });
    expect(grid().querySelectorAll('[aria-selected="true"]')).toHaveLength(6);
  });

  it('replaces the content when typing, commits on Enter and moves down', () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    focusCell(1, 1);
    press('7');
    expect(editor().value).toBe('7');
    expect(editor().getAttribute('dir')).toBe('ltr');
    fireEvent.change(editor(), { target: { value: '7,500.25' } });
    fireEvent.keyDown(editor(), { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith([
      { row: 1, column: 1, type: 'amount', amountMinor: 750025n },
    ]);
    expect(cell(1, 1).textContent).toBe('7,500.25');
    expect(document.activeElement).toBe(cell(2, 1));
  });

  it('moves Enter along the line in an entry grid, in navigation and after an edit', () => {
    render(<Harness enterMoves="next" />);
    focusCell(1, 0);
    press('Enter');
    expect(document.activeElement).toBe(cell(1, 1));
    press('3');
    fireEvent.keyDown(editor(), { key: 'Enter' });
    expect(cell(1, 1).textContent).toBe('3.00');
    expect(document.activeElement).toBe(cell(1, 2));
    // The last cell of a line goes on to the first of the next.
    press('Enter');
    expect(document.activeElement).toBe(cell(2, 0));
    press('Enter', { shiftKey: true });
    expect(document.activeElement).toBe(cell(1, 2));
  });

  it('names the cell a lookup key came from, even from its editor', () => {
    const onLookup = vi.fn();
    render(<Harness onLookup={onLookup} />);
    focusCell(2, 0);
    press('ArrowDown', { altKey: true });
    expect(onLookup).toHaveBeenLastCalledWith({ row: 2, column: 0 });
    press('F2');
    fireEvent.keyDown(editor(), { key: 'ArrowDown', altKey: true });
    expect(onLookup).toHaveBeenLastCalledWith({ row: 2, column: 0 });
    expect(gridCellOf(document.body)).toBeNull();
  });

  it('edits with F2 from the grouped amount, and Escape cancels without an edit', () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    focusCell(0, 1);
    press('F2');
    expect(editor().value).toBe('1,250.50');
    expect(editor().selectionStart).toBe('1,250.50'.length);
    fireEvent.change(editor(), { target: { value: '9' } });
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(cell(0, 1));
  });

  it('keeps refused text in the editor with its reason, and changes nothing', () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    focusCell(0, 1);
    press('F2');
    fireEvent.change(editor(), { target: { value: '12.345' } });
    fireEvent.keyDown(editor(), { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(editor().value).toBe('12.345');
    expect(editor().getAttribute('aria-invalid')).toBe('true');
    expect(alertText()).toBe(
      `${ar.grid.problems.nothingChanged} ${ar.accounting.amountInput.TOO_MANY_DECIMALS}`,
    );
    expect(editor().getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });

  it('commits when another cell is clicked, and keeps a refused text open', () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    focusCell(0, 1);
    press('F2');
    fireEvent.change(editor(), { target: { value: 'abc' } });
    fireEvent.pointerDown(cell(2, 1), { button: 0 });
    expect(onEdit).not.toHaveBeenCalled();
    expect(editor().value).toBe('abc');
    fireEvent.change(editor(), { target: { value: '12' } });
    fireEvent.pointerDown(cell(2, 1), { button: 0 });
    expect(onEdit).toHaveBeenCalledWith([
      { row: 0, column: 1, type: 'amount', amountMinor: 1200n },
    ]);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(cell(2, 1));
  });

  it('tells the app while refused text stands in an editor, and when it no longer does', () => {
    const onEditError = vi.fn();
    render(<Harness onEditError={onEditError} />);
    focusCell(0, 1);
    press('F2');
    fireEvent.change(editor(), { target: { value: '1,500.505' } });
    // Leaving the grid (towards a Post button) commits on blur: the app hears the refusal.
    fireEvent.blur(editor());
    expect(onEditError).toHaveBeenLastCalledWith({
      ok: false,
      problem: 'INVALID_CELLS',
      cells: [{ row: 0, column: 1, reason: 'AMOUNT', error: 'TOO_MANY_DECIMALS' }],
    });
    expect(editor().value).toBe('1,500.505');
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(onEditError).toHaveBeenLastCalledWith(null);
    expect(onEditError).toHaveBeenCalledTimes(2);
  });

  it('commits before Post (Ctrl+Shift+Enter), which reaches the app only with the edited rows', () => {
    const onEditError = vi.fn();
    const onPost = vi.fn();
    render(<Harness onEditError={onEditError} onPost={onPost} />);
    focusCell(0, 1);
    press('F2');
    fireEvent.change(editor(), { target: { value: '12.345' } });
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true, shiftKey: true });
    // Refused text stops Post, already reported.
    expect(onPost).not.toHaveBeenCalled();
    expect(onEditError).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
    expect(editor().value).toBe('12.345');
    fireEvent.change(editor(), { target: { value: '12.34' } });
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(onEditError).toHaveBeenLastCalledWith(null);
    expect(onPost).toHaveBeenCalledTimes(1);
    // The app posts the lines it rendered after the edit, never the old ones.
    expect(onPost.mock.calls[0]?.[0][0].amount).toBe(1234n);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('drops a held row key when the edit empties the grid, never sending it later', () => {
    const onPost = vi.fn();
    /** An app showing unmatched lines only: an amount entered matches the line and hides it. */
    function Unmatched() {
      const [lines, setLines] = useState(initialLines.slice(1, 2));
      return (
        <DirectionProvider direction="rtl">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: a test stand-in for an app's Post key. */}
          <div
            onKeyDown={(event) =>
              matchesShortcut(event.nativeEvent, keymap.post, 'other') && onPost()
            }
          >
            <button type="button" onClick={() => setLines(initialLines.slice(0, 2))}>
              reload
            </button>
            <Grid
              aria-label="قيد"
              rows={lines}
              columns={columns}
              rowKey={(line) => line.id}
              onEdit={() => setLines([])}
              onEditError={() => {}}
              describeProblem={problemText}
              summaryLabels={ar.grid.summary}
            />
          </div>
        </DirectionProvider>
      );
    }
    render(<Unmatched />);
    focusCell(0, 1);
    press('F2');
    fireEvent.change(editor(), { target: { value: '30' } });
    fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(grid().querySelectorAll('[data-slot="grid-cell"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'reload' }));
    expect(grid().querySelectorAll('[data-slot="grid-cell"]')).toHaveLength(6);
    expect(onPost).not.toHaveBeenCalled();
  });

  it('commits before the app inserts a line, and the text stays on its own line', () => {
    render(<Harness />);
    focusCell(2, 1);
    press('2');
    fireEvent.change(editor(), { target: { value: '250' } });
    fireEvent.keyDown(editor(), { key: 'Insert', code: 'Insert', ctrlKey: true });
    // The line inserted above moved line c down one row, with its new amount.
    expect(cell(0, 0).textContent).toBe('');
    expect(cell(3, 0).textContent).toBe('1200 بنك');
    expect(cell(3, 1).textContent).toBe('250.00');
  });

  it('keeps an open editor on its own line when lines move under it, and closes it with its line', () => {
    const onEdit = vi.fn();
    const onEditError = vi.fn();
    render(<Harness onEdit={onEdit} onEditError={onEditError} />);
    focusCell(1, 1);
    press('F2');
    fireEvent.change(editor(), { target: { value: 'abc' } });
    fireEvent.blur(editor());
    fireEvent.click(screen.getByRole('button', { name: 'insert' }));
    // Line b is now row 2, and its editor with it.
    expect(cell(2, 1).contains(editor())).toBe(true);
    fireEvent.change(editor(), { target: { value: '7' } });
    fireEvent.keyDown(editor(), { key: 'Enter' });
    expect(onEdit).toHaveBeenLastCalledWith([
      { row: 2, column: 1, type: 'amount', amountMinor: 700n },
    ]);
    expect(cell(2, 0).textContent).toBe('4100 إيرادات');
    expect(cell(2, 1).textContent).toBe('7.00');
    // An editor whose line is deleted closes, and the app hears that nothing is refused any more.
    focusCell(1, 1);
    press('F2');
    fireEvent.change(editor(), { target: { value: 'abc' } });
    fireEvent.blur(editor());
    expect(onEditError).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
    fireEvent.click(screen.getByRole('button', { name: 'delete first' }));
    fireEvent.click(screen.getByRole('button', { name: 'delete first' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onEditError).toHaveBeenLastCalledWith(null);
  });

  it('keeps the editor and its text through a double-click, inside it or on another cell', () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    focusCell(0, 1);
    press('F2');
    fireEvent.change(editor(), { target: { value: '12.345' } });
    fireEvent.keyDown(editor(), { key: 'Enter' });
    const refusal = alertText();
    fireEvent.doubleClick(editor());
    expect(editor().value).toBe('12.345');
    expect(alertText()).toBe(refusal);
    fireEvent.pointerDown(cell(2, 1), { button: 0 });
    fireEvent.pointerDown(cell(2, 1), { button: 0 });
    fireEvent.doubleClick(cell(2, 1));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(editor().value).toBe('12.345');
    expect(cell(0, 1).contains(editor())).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('commits text on Tab and moves to the next cell', () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    focusCell(1, 0);
    press('F2');
    fireEvent.change(editor(), { target: { value: '4200 مصاريف' } });
    fireEvent.keyDown(editor(), { key: 'Tab' });
    expect(onEdit).toHaveBeenCalledWith([{ row: 1, column: 0, type: 'text', text: '4200 مصاريف' }]);
    expect(document.activeElement).toBe(cell(1, 1));
  });

  it('refuses to edit a locked cell', () => {
    render(<Harness />);
    focusCell(3, 1);
    press('5');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(alertText()).toBe(`${ar.grid.problems.nothingChanged} ${ar.grid.problems.READ_ONLY}`);
    expect(cell(3, 1).getAttribute('aria-invalid')).toBe('true');
  });

  it('copies the selection as TSV and an HTML table', () => {
    render(<Harness />);
    focusCell(0, 1);
    press('ArrowDown', { shiftKey: true });
    const setData = vi.fn();
    fireEvent.copy(document.activeElement as HTMLElement, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', '1250.50\r\n25.00\r\n');
    expect(setData).toHaveBeenCalledWith(
      'text/html',
      '<table><tr><td>1250.50</td></tr><tr><td>25.00</td></tr></table>',
    );
  });

  it('pastes a block after checking every cell, and selects what it pasted', () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    focusCell(1, 1);
    const paste = (text: string) =>
      fireEvent.paste(document.activeElement as HTMLElement, {
        clipboardData: { getData: () => text },
      });
    paste('-5\t1\r\n');
    expect(onEdit).not.toHaveBeenCalled();
    expect(alertText()).toBe(
      `${ar.grid.problems.nothingChanged} ${ar.accounting.amountInput.NEGATIVE_NOT_ALLOWED}`,
    );
    paste('5\t1\r\n6\t2\r\n');
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(cell(1, 1).textContent).toBe('5.00');
    expect(cell(2, 2).textContent).toBe('2.00');
    expect(alertText()).toBeNull();
    expect(grid().querySelectorAll('[aria-selected="true"]')).toHaveLength(4);
  });

  it('fills down with Ctrl+D, refusing an amount into another currency', () => {
    render(<Harness />);
    focusCell(0, 2);
    press('ArrowDown', { shiftKey: true });
    press('d', { code: 'KeyD', ctrlKey: true });
    expect(cell(1, 2).textContent).toBe('1,250.50');
    focusCell(1, 1);
    press('ArrowDown', { shiftKey: true });
    press('d', { code: 'KeyD', ctrlKey: true });
    expect(alertText()).toBe(
      `${ar.grid.problems.nothingChanged} ${ar.grid.problems.CURRENCY_MISMATCH}`,
    );
    expect(cell(2, 1).textContent).toBe('13,000.00');
  });

  it('clears the selection with Delete', () => {
    render(<Harness />);
    focusCell(0, 2);
    press('ArrowDown', { shiftKey: true });
    press('Delete');
    expect(cell(0, 2).textContent).toBe('');
    expect(cell(1, 2).textContent).toBe('');
  });

  it('is read-only without onEdit, and still selects and copies', () => {
    render(<Harness editable={false} />);
    expect(grid().getAttribute('aria-readonly')).toBe('true');
    focusCell(0, 2);
    press('Delete');
    expect(alertText()).toBe(`${ar.grid.problems.nothingChanged} ${ar.grid.problems.READ_ONLY}`);
    expect(cell(0, 2).textContent).toBe('1,250.50');
    const setData = vi.fn();
    fireEvent.copy(document.activeElement as HTMLElement, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', '1250.50\r\n');
  });
});

describe('grid text', () => {
  it('has a text for every refusal of the grid core', () => {
    const codes: GridProblem['problem'][] = [
      'EMPTY',
      'NOT_RECTANGULAR',
      'DOES_NOT_FIT',
      'NOTHING_TO_FILL',
      'INVALID_CELLS',
    ];
    for (const code of codes.filter((code) => code !== 'INVALID_CELLS')) {
      expect(ar.grid.problems, code).toHaveProperty(code);
    }
    for (const reason of ['READ_ONLY', 'CURRENCY_MISMATCH']) {
      expect(ar.grid.problems, reason).toHaveProperty(reason);
    }
  });
});
