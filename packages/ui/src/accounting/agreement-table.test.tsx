// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type AgreementRow, AgreementTable } from './agreement-table';

afterEach(cleanup);

const labels = {
  group: 'الحساب',
  row: 'العميل',
  currency: 'العملة',
  records: 'السجلات',
  hub: 'Hub',
  difference: 'الفرق',
  status: 'الحالة',
  statuses: { agrees: 'متطابق', differs: 'فرق', missing: 'لم يُدخل' },
};

const rows: AgreementRow[] = [
  {
    key: 'r1',
    group: 'الذمم المدينة',
    label: 'عميل تجريبي',
    currency: 'USD',
    recordsMinor: 30000n,
    hubMinor: 30000n,
    differenceMinor: 0n,
    status: 'agrees',
  },
  {
    key: 'r2',
    group: 'أموال الإعلانات',
    label: 'عميل آخر',
    currency: 'USD',
    recordsMinor: 10000n,
    hubMinor: -12000n,
    differenceMinor: 22000n,
    status: 'differs',
  },
  {
    key: 'r3',
    group: 'الذمم المدينة',
    label: 'عميل ثالث',
    currency: 'SYP',
    recordsMinor: null,
    hubMinor: 500000n,
    differenceMinor: null,
    status: 'missing',
  },
];

describe('AgreementTable', () => {
  it('shows each pair with both figures, the difference and its status in words', () => {
    render(<AgreementTable caption="المطابقة" rows={rows} labels={labels} />);
    const table = screen.getByRole('table', { name: 'المطابقة' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['الحساب', 'العميل', 'العملة', 'السجلات', 'Hub', 'الفرق', 'الحالة']);
    const body = within(table).getAllByRole('row').slice(1);
    expect(body.map((row) => row.textContent)).toEqual([
      'الذمم المدينةعميل تجريبيUSD300.00300.000.00متطابق',
      'أموال الإعلاناتعميل آخرUSD100.00-120.00220.00فرق',
      // A figure not entered and its unknown difference are dashes.
      'الذمم المدينةعميل ثالثSYP—5,000.00—لم يُدخل',
    ]);
    expect(body.map((row) => row.getAttribute('data-status'))).toEqual([
      'agrees',
      'differs',
      'missing',
    ]);
    // Hub's negative figure carries its sign and the negative color.
    expect(within(body[1] as HTMLElement).getAllByText('-120.00').length).toBeGreaterThan(0);
  });

  it('names the status by icon and words, never by color alone', () => {
    render(<AgreementTable caption="المطابقة" rows={rows} labels={labels} />);
    const badges = screen.getByRole('table').querySelectorAll('[data-slot="badge"][data-status]');
    expect([...badges].map((badge) => badge.textContent)).toEqual(['متطابق', 'فرق', 'لم يُدخل']);
    for (const badge of badges) {
      expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it("takes the app's input in place of the records' figure", () => {
    const typed: AgreementRow[] = [
      { ...rows[2], records: <input aria-label="رقم السجلات" /> } as AgreementRow,
    ];
    render(<AgreementTable caption="المطابقة" rows={typed} labels={labels} />);
    const row = within(screen.getByRole('table')).getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByRole('textbox', { name: 'رقم السجلات' })).toBeTruthy();
  });

  it('lists a card per pair for a phone, and the empty state with no pair', () => {
    const { rerender } = render(<AgreementTable caption="المطابقة" rows={rows} labels={labels} />);
    const cards = screen.getByRole('list', { name: 'المطابقة' });
    expect(within(cards).getAllByRole('listitem')).toHaveLength(3);
    rerender(<AgreementTable caption="المطابقة" rows={[]} labels={labels} empty="لا عملاء" />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('لا عملاء')).toBeTruthy();
  });
});
