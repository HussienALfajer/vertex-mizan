// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CashAccountPicker,
  type CashAccountPickerOption,
  cashAccountGroups,
  matchesCashAccount,
} from './cash-account-picker';

afterEach(cleanup);

const labels = {
  placeholder: 'اختر حسابًا نقديًا',
  empty: 'لا حساب نقدي بهذا الاسم',
  blocked: 'حساب موقوف',
  balance: 'الرصيد',
  currency: (currency: string) =>
    ({ USD: 'الدولار الأمريكي', TRY: 'الليرة التركية' })[currency] ?? currency,
};

const accounts: CashAccountPickerOption[] = [
  {
    id: 'try-box',
    code: '111005',
    name: 'صندوق الليرة التركية',
    currency: 'TRY',
    kindLabel: 'صندوق',
    balanceMinor: 0n,
  },
  {
    id: 'usd-bank',
    code: '111004',
    name: 'حساب مصرفي بالدولار',
    nameLatin: 'USD bank',
    currency: 'USD',
    kindLabel: 'حساب مصرفي',
    balanceMinor: -1250n,
  },
  {
    id: 'usd-box',
    code: '111002',
    name: 'صندوق الدولار',
    currency: 'USD',
    kindLabel: 'صندوق',
    balanceMinor: 150000n,
  },
  {
    id: 'blocked',
    code: '111003',
    name: 'صندوق موقوف',
    currency: 'USD',
    kindLabel: 'صندوق',
    balanceMinor: 0n,
    blocked: true,
  },
];

function renderPicker(
  props: Partial<Parameters<typeof CashAccountPicker>[0]> = {},
  onValueChange = vi.fn(),
) {
  render(
    <CashAccountPicker
      label="الحساب النقدي"
      accounts={accounts}
      value={null}
      onValueChange={onValueChange}
      labels={labels}
      {...props}
    />,
  );
  return { input: screen.getByRole('combobox', { name: 'الحساب النقدي' }), onValueChange };
}

async function open(input: HTMLElement, text: string, alt = false) {
  input.focus();
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: alt });
  });
}

describe('CashAccountPicker', () => {
  it('groups the accounts by currency in their order, each in code order', () => {
    expect(
      cashAccountGroups(accounts).map((group) => [
        group.value,
        group.items.map((item) => item.code),
      ]),
    ).toEqual([
      ['TRY', ['111005']],
      ['USD', ['111002', '111003', '111004']],
    ]);
  });

  it('finds an account by code, name, Latin name, currency or kind', () => {
    const [, bank, box] = accounts as [
      CashAccountPickerOption,
      CashAccountPickerOption,
      CashAccountPickerOption,
    ];
    expect(matchesCashAccount(box, '111002')).toBe(true);
    expect(matchesCashAccount(bank, 'bank')).toBe(true);
    expect(matchesCashAccount(box, 'usd')).toBe(true);
    expect(matchesCashAccount(bank, 'مصرفي')).toBe(true);
    expect(matchesCashAccount(box, 'TRY')).toBe(false);
  });

  it('opens with Alt+↓ and lists each group under its currency with balances', async () => {
    const { input } = renderPicker();
    expect(input.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowDown');
    await open(input, '', true);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent?.slice(0, 6))).toEqual([
      '111005',
      '111002',
      '111003',
      '111004',
    ]);
    expect(screen.getByText('الليرة التركية')).toBeTruthy();
    expect(screen.getByText('الدولار الأمريكي')).toBeTruthy();
    const usdBox = options[1] as HTMLElement;
    expect(usdBox.querySelector('[data-slot="amount"]')?.textContent).toBe('1,500.00USD');
    // A negative balance keeps its sign and its LTR isolate.
    const negative = (options[3] as HTMLElement).querySelector('[data-negative]');
    expect(negative?.getAttribute('dir')).toBe('ltr');
    expect(negative?.textContent).toBe('-12.50USD');
    // A blocked account is listed but disabled.
    expect((options[2] as HTMLElement).getAttribute('aria-disabled')).toBe('true');
  });

  it('chooses from the keyboard and reports the id, never a blocked account', async () => {
    const { input, onValueChange } = renderPicker();
    await open(input, '111002');
    await screen.findByRole('option');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onValueChange).toHaveBeenCalledWith('usd-box');
    onValueChange.mockClear();
    await open(input, 'موقوف');
    await screen.findByRole('option');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('says when nothing matches, and shows the chosen account and its error', async () => {
    const { input } = renderPicker({ value: 'usd-box', error: 'اختر الحساب النقدي' });
    expect((input as HTMLInputElement).value).toBe('111002 صندوق الدولار');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('اختر الحساب النقدي')).toBeTruthy();
    await open(input, 'غير موجود');
    expect(await screen.findByText('لا حساب نقدي بهذا الاسم')).toBeTruthy();
  });
});
