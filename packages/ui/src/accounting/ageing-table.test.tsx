// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AgeingTable, type AgeingTableRow } from './ageing-table';

afterEach(cleanup);

const buckets = [
  { id: 'not_due', label: 'غير مستحق' },
  { id: 'days_1_30', label: '1–30 يومًا' },
];

const rows: AgeingTableRow[] = [
  {
    key: 'c1',
    label: 'عميل تجريبي',
    amounts: { not_due: 12000000n },
    totalMinor: 12000000n,
    detail: <p>بنود العميل الأول</p>,
  },
  {
    key: 'c2',
    label: 'عميل آخر',
    amounts: { not_due: 0n, days_1_30: -50000n },
    totalMinor: -50000n,
  },
];

const labels = { row: 'العميل', total: 'الإجمالي', showDetail: 'عرض البنود' };

function renderTable() {
  return render(
    <AgeingTable
      caption="أعمار الذمم"
      buckets={buckets}
      rows={rows}
      totals={{ amounts: { not_due: 12000000n, days_1_30: -50000n }, totalMinor: 11950000n }}
      currency="SYP"
      labels={labels}
    />,
  );
}

describe('AgeingTable', () => {
  it('shows a row per client with each bucket, a total and the totals row', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'أعمار الذمم' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['العميل', 'غير مستحق', '1–30 يومًا', 'الإجمالي']);
    const body = within(table).getAllByRole('row').slice(1);
    expect(body.map((row) => row.textContent)).toEqual([
      // An empty bucket is a dash, read out as zero.
      'عميل تجريبي120,000.00–0.00120,000.00',
      'عميل آخر–0.00-500.00-500.00',
      'الإجمالي120,000.00-500.00119,500.00',
    ]);
    // A negative figure carries its sign and color.
    expect(
      within(body[1] as HTMLElement)
        .getAllByText('-500.00')[0]
        ?.closest('[data-negative]'),
    ).toBeTruthy();
  });

  it('opens a row to its detail and closes it, the button saying which', async () => {
    renderTable();
    const table = screen.getByRole('table');
    const toggle = within(table).getByRole('button', { name: 'عرض البنود 1' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('بنود العميل الأول')).toBeNull();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const detail = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(detail?.textContent).toContain('بنود العميل الأول');
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(screen.queryByText('بنود العميل الأول')).toBeNull();
    // A row without a detail has no button.
    expect(within(table).queryByRole('button', { name: 'عرض البنود 2' })).toBeNull();
  });

  it('gives a phone one card per client with its buckets stacked, and the totals', () => {
    renderTable();
    const list = screen.getByRole('list', { name: 'أعمار الذمم' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    const terms = within(cards[0] as HTMLElement)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(terms).toEqual(['غير مستحق', '1–30 يومًا']);
    expect(cards[2]?.textContent).toContain('119,500.00');
  });
});
