// @vitest-environment jsdom
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ReportCellPosition,
  ReportTable,
  type ReportTableColumn,
  type ReportTableRow,
  reportTableMove,
} from './report-table';

afterEach(cleanup);

/** A link the table renders its figure into, as the app's router link. */
function Href({ children, ...props }: ComponentProps<'a'>) {
  return <a {...props}>{children}</a>;
}

const columns: ReportTableColumn[] = [
  { id: 'debit', label: 'مدين', group: 'حركة الفترة' },
  { id: 'credit', label: 'دائن', group: 'حركة الفترة' },
  { id: 'compare', label: 'المقارنة', compare: true },
];

const rows: ReportTableRow[] = [
  { key: 'h', label: 'الأصول', kind: 'heading' },
  {
    key: 'a',
    label: '1 الأصول',
    level: 1,
    figures: {
      debit: { value: 500000n, link: <Href href="#a-debit" />, linkLabel: 'أسطر مدين الأصول' },
      credit: { value: 0n, link: <Href href="#a-credit" /> },
      compare: { value: null },
    },
  },
  {
    key: 'b',
    label: '112001 الذمم',
    level: 3,
    note: 'أعيد تبويب للعرض',
    figures: {
      debit: { value: -2400n, link: <Href href="#b-debit" /> },
      credit: { value: 100n, link: <Href href="#b-credit" /> },
      compare: { value: 300n },
    },
  },
  {
    key: 't',
    label: 'المجموع',
    kind: 'total',
    figures: { debit: { value: 497600n }, credit: { value: 100n }, compare: { value: 300n } },
  },
];

function renderTable(direction: 'rtl' | 'ltr' = 'rtl') {
  return render(
    <DirectionProvider direction={direction}>
      <div dir={direction}>
        <ReportTable
          caption="ميزان المراجعة"
          columns={columns}
          rows={rows}
          currency="SYP"
          labels={{ row: 'الحساب', none: '—' }}
        />
      </div>
    </DirectionProvider>,
  );
}

describe('ReportTable', () => {
  it('groups the headings and shows each row with its figures, "—" for none', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'ميزان المراجعة' });
    const head = table.querySelector('thead') as HTMLElement;
    const headers = within(head)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['الحساب', 'حركة الفترة', 'المقارنة', 'مدين', 'دائن']);
    const body = within(table).getAllByRole('row').slice(2);
    expect(body.map((row) => row.textContent)).toEqual([
      'الأصول',
      '1 الأصول5,000.000.00—',
      '112001 الذممأعيد تبويب للعرض-24.001.003.00',
      'المجموع4,976.001.003.00',
    ]);
  });

  it('gives a negative figure its sign and color, and a total its double rule', () => {
    renderTable();
    const table = screen.getByRole('table');
    const negative = within(table).getByText('-24.00', { exact: false });
    expect(negative.closest('[data-slot=amount]')?.getAttribute('data-negative')).toBe('true');
    const total = within(table).getAllByRole('row').at(-1);
    expect(total?.getAttribute('data-kind')).toBe('total');
    expect(total?.querySelector('.border-double')).not.toBeNull();
  });

  it('makes each linked figure a link to its lines, named when it has a label', () => {
    renderTable();
    const table = screen.getByRole('table');
    const link = within(table).getByRole('link', { name: 'أسطر مدين الأصول' });
    expect(link.getAttribute('href')).toBe('#a-debit');
    expect(within(table).getAllByRole('link')).toHaveLength(4);
  });

  it('moves between the links with the arrow keys, visually in RTL', () => {
    renderTable('rtl');
    const table = screen.getByRole('table');
    const start = within(table).getByRole('link', { name: 'أسطر مدين الأصول' });
    start.focus();
    // Left is the next column in RTL.
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('href')).toBe('#a-credit');
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('href')).toBe('#b-credit');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(document.activeElement?.getAttribute('href')).toBe('#b-debit');
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('href')).toBe('#a-debit');
  });

  it('shows one card per row on a phone with its figures stacked', () => {
    renderTable();
    const list = screen.getByRole('list', { name: 'ميزان المراجعة' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(4);
    expect(cards[2]?.textContent).toContain('حركة الفترة · مدين');
    expect(cards[2]?.textContent).toContain('-24.00');
  });
});

describe('reportTableMove', () => {
  const cells: ReportCellPosition[] = [
    { row: 0, column: 1 },
    { row: 0, column: 2 },
    { row: 2, column: 2 },
    { row: 3, column: 1 },
  ];

  it('keeps the column going up and down, skipping rows without a link there', () => {
    expect(reportTableMove(cells, { row: 0, column: 1 }, 'ArrowDown', 'rtl')).toEqual({
      row: 3,
      column: 1,
    });
    expect(reportTableMove(cells, { row: 3, column: 1 }, 'ArrowUp', 'ltr')).toEqual({
      row: 0,
      column: 1,
    });
    expect(reportTableMove(cells, { row: 3, column: 1 }, 'ArrowDown', 'ltr')).toBeNull();
  });

  it('reads left and right by direction, and ignores other keys', () => {
    expect(reportTableMove(cells, { row: 0, column: 1 }, 'ArrowRight', 'ltr')).toEqual({
      row: 0,
      column: 2,
    });
    expect(reportTableMove(cells, { row: 0, column: 1 }, 'ArrowRight', 'rtl')).toBeNull();
    expect(reportTableMove(cells, { row: 0, column: 2 }, 'End', 'rtl')).toEqual({
      row: 0,
      column: 2,
    });
    expect(reportTableMove(cells, { row: 0, column: 2 }, 'Enter', 'rtl')).toBeNull();
  });
});
