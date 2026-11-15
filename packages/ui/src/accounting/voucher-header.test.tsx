// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VoucherHeader } from './voucher-header';

afterEach(cleanup);

const labels = {
  number: 'الرقم',
  numberPending: 'يُعطى عند الترحيل',
  date: 'التاريخ',
  balance: 'الرصيد',
};

describe('VoucherHeader', () => {
  it('heads a posted voucher with its kind, number as an LTR isolate, date and state', () => {
    render(
      <VoucherHeader
        kind="سند قبض"
        number="2026/15"
        date="2026-12-02"
        labels={labels}
        state={{ label: 'ملغى', tone: 'danger' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'سند قبض' })).toBeTruthy();
    const number = screen.getByText('2026/15');
    expect(number.tagName).toBe('BDI');
    expect(number.getAttribute('dir')).toBe('ltr');
    expect(screen.getByText('2026-12-02').getAttribute('dir')).toBe('ltr');
    expect(screen.getByText('ملغى').getAttribute('data-slot')).toBe('badge');
  });

  it('says the number comes at posting, and lays out the fields it is given', () => {
    const { container } = render(
      <VoucherHeader kind="سند صرف" number={null} labels={labels}>
        <label>
          البيان
          <input />
        </label>
        <label>
          صرفنا إلى
          <input />
        </label>
      </VoucherHeader>,
    );
    expect(screen.getByText('يُعطى عند الترحيل')).toBeTruthy();
    expect(screen.queryByText('التاريخ')).toBeNull();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    // One column on a phone, more from a tablet.
    const grid = container.querySelector('.grid');
    expect(grid?.className).toContain('grid-cols-1');
    expect(grid?.className).toContain('sm:grid-cols-2');
  });

  it('shows each cash account with its role and balance, a negative one with its sign', () => {
    render(
      <VoucherHeader
        kind="سند تحويل"
        number={null}
        labels={labels}
        accounts={[
          {
            role: 'من حساب',
            code: '111002',
            name: 'صندوق الدولار',
            currency: 'USD',
            balanceMinor: 150000n,
          },
          {
            role: 'إلى حساب',
            code: '111004',
            name: 'حساب مصرفي',
            currency: 'TRY',
            balanceMinor: -5000n,
          },
        ]}
      />,
    );
    const [source, destination] = screen
      .getAllByText(/حساب$/, { selector: 'dt' })
      .map((term) => term.parentElement as HTMLElement);
    expect(within(source as HTMLElement).getByText('111002')).toBeTruthy();
    expect((source as HTMLElement).querySelector('[data-slot="amount"]')?.textContent).toBe(
      '1,500.00USD',
    );
    const negative = (destination as HTMLElement).querySelector('[data-negative]');
    expect(negative?.getAttribute('dir')).toBe('ltr');
    expect(negative?.textContent).toBe('-50.00TRY');
  });
});
