// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DimensionPicker,
  type DimensionPickerOption,
  matchesDimensionValue,
} from './dimension-picker';

afterEach(cleanup);

const labels = { placeholder: 'ابحث بالرمز أو الاسم', empty: 'لا قيمة', clear: 'مسح' };

const values: DimensionPickerOption[] = [
  { id: 'b', name: 'شركة النور', nameLatin: 'Al Nour Co' },
  { id: 'a', code: 'C-002', name: 'مؤسسة الأمل' },
  { id: 'c', code: 'C-001', name: 'عميل تجريبي', detail: 'مشروع' },
  { id: 'old', code: 'C-000', name: 'عميل قديم', archived: true },
];

function renderPicker(
  props: Partial<Parameters<typeof DimensionPicker>[0]> = {},
  onValueChange = vi.fn(),
) {
  render(
    <DimensionPicker
      label="العميل"
      values={values}
      value={null}
      onValueChange={onValueChange}
      labels={labels}
      {...props}
    />,
  );
  return { input: screen.getByRole('combobox', { name: 'العميل' }), onValueChange };
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

describe('DimensionPicker', () => {
  it('finds a value by code, Arabic name or Latin name', () => {
    expect(matchesDimensionValue(values[1] as DimensionPickerOption, 'c-002')).toBe(true);
    expect(matchesDimensionValue(values[0] as DimensionPickerOption, 'النور')).toBe(true);
    expect(matchesDimensionValue(values[0] as DimensionPickerOption, 'nour')).toBe(true);
    expect(matchesDimensionValue(values[0] as DimensionPickerOption, 'الأمل')).toBe(false);
  });

  it('lists coded values first in code order, then the others, and hides archived ones', async () => {
    const { input } = renderPicker();
    await type(input, '');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'C-001عميل تجريبيمشروع',
      'C-002مؤسسة الأمل',
      'شركة النور',
    ]);
  });

  it('chooses from the keyboard, reports the id and passes the query on', async () => {
    const onQueryChange = vi.fn();
    const { input, onValueChange } = renderPicker({ onQueryChange });
    await type(input, 'الأمل');
    expect(onQueryChange).toHaveBeenCalledWith('الأمل');
    await screen.findByRole('option');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onValueChange).toHaveBeenCalledWith('a');
  });

  it('says when nothing matches', async () => {
    const { input } = renderPicker();
    await type(input, 'لا يوجد');
    expect(await screen.findByText('لا قيمة')).toBeTruthy();
  });

  it('shows the chosen value, even an archived one, and clears it', async () => {
    const { input, onValueChange } = renderPicker({ value: 'old', error: 'اختر قيمة' });
    expect((input as HTMLInputElement).value).toBe('C-000 عميل قديم');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('اختر قيمة')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'مسح' }));
    });
    expect(onValueChange).toHaveBeenCalledWith(null);
  });

  it('marks a required dimension and offers no clearing', () => {
    const { input } = renderPicker({ value: 'a', required: true });
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(screen.queryByRole('button', { name: 'مسح' })).toBeNull();
  });
});
