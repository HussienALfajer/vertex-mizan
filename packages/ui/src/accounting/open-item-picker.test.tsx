// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchesOpenItem, OpenItemPicker, type OpenItemPickerOption } from './open-item-picker';

afterEach(cleanup);

const labels = {
  placeholder: 'ابحث بالمرجع',
  empty: 'لا بنود مفتوحة',
  open: 'المفتوح',
  carrying: 'الدفتري',
};

const items: OpenItemPickerOption[] = [
  {
    id: 'm1',
    reference: 'M-1',
    currency: 'USD',
    openMinor: 60000n,
    carryingMinor: 7200000n,
    carryingCurrency: 'SYP',
    detail: '112001 · 2026-12-03',
  },
  {
    id: 'm2',
    reference: 'M-2',
    currency: 'USD',
    openMinor: -2500n,
    carryingMinor: -300000n,
    carryingCurrency: 'SYP',
    detail: '112001 · 2026-12-10',
  },
];

function renderPicker(
  props: Partial<Parameters<typeof OpenItemPicker>[0]> = {},
  onValueChange = vi.fn(),
) {
  render(
    <OpenItemPicker
      label="البند"
      items={items}
      value={null}
      onValueChange={onValueChange}
      labels={labels}
      {...props}
    />,
  );
  return { input: screen.getByRole('combobox', { name: 'البند' }), onValueChange };
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

describe('OpenItemPicker', () => {
  it('finds an item by its reference or its detail', () => {
    expect(matchesOpenItem(items[0] as OpenItemPickerOption, 'm-1')).toBe(true);
    expect(matchesOpenItem(items[1] as OpenItemPickerOption, '12-10')).toBe(true);
    expect(matchesOpenItem(items[0] as OpenItemPickerOption, 'M-2')).toBe(false);
  });

  it('lists the items in the given order with their open and carrying amounts', async () => {
    const { input } = renderPicker();
    await type(input, '');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    const first = options[0] as HTMLElement;
    expect(first.textContent).toContain('M-1');
    const amounts = first.querySelectorAll('[data-slot="amount"]');
    expect([...amounts].map((amount) => amount.textContent)).toEqual(['600.00USD', '72,000.00SYP']);
    // A negative figure keeps its sign, its color and its LTR isolate.
    const negative = (options[1] as HTMLElement).querySelector('[data-negative]');
    expect(negative?.getAttribute('dir')).toBe('ltr');
    expect(negative?.textContent).toBe('-25.00USD');
  });

  it('chooses from the keyboard and reports the id', async () => {
    const { input, onValueChange } = renderPicker();
    await type(input, 'M-2');
    await screen.findByRole('option');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onValueChange).toHaveBeenCalledWith('m2');
  });

  it('says when nothing matches', async () => {
    const { input } = renderPicker();
    await type(input, 'X-9');
    expect(await screen.findByText('لا بنود مفتوحة')).toBeTruthy();
  });

  it('shows the chosen item and its error', () => {
    const { input } = renderPicker({ value: 'm1', error: 'اختر بنداً' });
    expect((input as HTMLInputElement).value).toBe('M-1');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('اختر بنداً')).toBeTruthy();
  });
});
