// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccountPicker,
  type AccountPickerOption,
  isPickableAccount,
  matchesAccount,
} from './account-picker';

afterEach(cleanup);

const labels = {
  placeholder: 'ابحث بالرمز أو الاسم',
  empty: 'لا حساب',
  header: 'حساب رئيسي',
  blocked: 'موقوف',
};

const accounts: AccountPickerOption[] = [
  { id: 'h', code: '111', name: 'النقد', kind: 'header' },
  { id: 'cash', code: '111001', name: 'الصندوق', nameLatin: 'Cash on hand', kind: 'postable' },
  { id: 'bank', code: '111002', name: 'المصرف', kind: 'postable', blocked: true },
  { id: 'old', code: '111003', name: 'المحفظة القديمة', kind: 'postable', archived: true },
  { id: 'rev', code: '411001', name: 'إيرادات الخدمات', kind: 'postable' },
];

function renderPicker(value: string | null = null, onValueChange = vi.fn()) {
  render(
    <AccountPicker
      label="الحساب"
      accounts={accounts}
      value={value}
      onValueChange={onValueChange}
      labels={labels}
    />,
  );
  return { input: screen.getByRole('combobox', { name: 'الحساب' }), onValueChange };
}

async function type(input: HTMLElement, text: string) {
  input.focus();
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'ArrowDown' });
  });
}

describe('AccountPicker', () => {
  it('finds an account by code, Arabic name or Latin name', () => {
    expect(matchesAccount(accounts[1] as AccountPickerOption, '111')).toBe(true);
    expect(matchesAccount(accounts[1] as AccountPickerOption, 'الصندوق')).toBe(true);
    expect(matchesAccount(accounts[1] as AccountPickerOption, 'cash')).toBe(true);
    expect(matchesAccount(accounts[1] as AccountPickerOption, '411')).toBe(false);
  });

  it('lets only postable accounts neither blocked nor archived be chosen', () => {
    expect(accounts.filter(isPickableAccount).map((a) => a.id)).toEqual(['cash', 'rev']);
  });

  it('lists the matches in code order with headers and blocked accounts disabled and archived ones hidden', async () => {
    const { input } = renderPicker();
    await type(input, '111');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.querySelector('bdi')?.textContent)).toEqual([
      '111',
      '111001',
      '111002',
    ]);
    expect(options[0]?.getAttribute('aria-disabled')).toBe('true');
    expect(options[1]?.getAttribute('aria-disabled')).not.toBe('true');
    expect(options[2]?.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('موقوف')).toBeTruthy();
  });

  it('chooses from the keyboard and reports the id', async () => {
    const { input, onValueChange } = renderPicker();
    await type(input, 'إيرادات');
    await screen.findByRole('option');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onValueChange).toHaveBeenCalledWith('rev');
  });

  it('says when nothing matches', async () => {
    const { input } = renderPicker();
    await type(input, 'لا يوجد');
    expect(await screen.findByText('لا حساب')).toBeTruthy();
  });

  it('shows the chosen account, even an archived one, and marks an error', () => {
    render(
      <AccountPicker
        label="الحساب"
        accounts={accounts}
        value="old"
        onValueChange={() => {}}
        labels={labels}
        error="اختر حسابًا"
      />,
    );
    const input = screen.getByRole('combobox', { name: 'الحساب' }) as HTMLInputElement;
    expect(input.value).toBe('111003 المحفظة القديمة');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('اختر حسابًا')).toBeTruthy();
  });
});
