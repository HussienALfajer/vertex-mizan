// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryPicker, type EntryPickerOption, matchesEntry } from './entry-picker';

afterEach(cleanup);

const labels = { placeholder: 'ابحث برقم القيد أو بيانه', empty: 'لا قيد' };

const entries: EntryPickerOption[] = [
  {
    id: 'e14',
    number: '2026/14',
    date: '2026-11-20',
    description: 'دفعة زائدة من العميل',
    totalMinor: 1_250_000n,
    totalCurrency: 'SYP',
  },
  { id: 'e9', number: '2026/9', date: '2026-11-02', description: 'تسوية فرق السداد' },
];

function renderPicker(
  props: Partial<Parameters<typeof EntryPicker>[0]> = {},
  onValueChange = vi.fn(),
) {
  render(
    <EntryPicker
      label="القيد اليدوي"
      entries={entries}
      value={null}
      onValueChange={onValueChange}
      labels={labels}
      {...props}
    />,
  );
  return { input: screen.getByRole('combobox', { name: 'القيد اليدوي' }), onValueChange };
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

describe('EntryPicker', () => {
  it('finds an entry by its number or words of its description', () => {
    const [first, second] = entries as [EntryPickerOption, EntryPickerOption];
    expect(matchesEntry(first, '2026/14')).toBe(true);
    expect(matchesEntry(first, 'زائدة')).toBe(true);
    expect(matchesEntry(second, '٢٠٢٦/٩')).toBe(true);
    expect(matchesEntry(second, 'زائدة')).toBe(false);
  });

  it('lists entries in the app’s order with number, date, total and description', async () => {
    const { input } = renderPicker();
    await type(input, '');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain('2026/14');
    expect(options[0]?.textContent).toContain('12,500.00');
    expect(options[0]?.textContent).toContain('دفعة زائدة من العميل');
    expect(options[0]?.querySelector('bdi[dir="ltr"]')?.textContent).toBe('2026/14');
    expect(options[1]?.textContent).toContain('2026/9');
  });

  it('chooses from the keyboard, reports the id and passes the query on', async () => {
    const onQueryChange = vi.fn();
    const { input, onValueChange } = renderPicker({ onQueryChange });
    await type(input, 'تسوية');
    expect(onQueryChange).toHaveBeenCalledWith('تسوية');
    await screen.findByRole('option');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onValueChange).toHaveBeenCalledWith('e9');
  });

  it('says when nothing matches, and shows its error', async () => {
    const { input } = renderPicker({ error: 'اختر القيد' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('اختر القيد')).toBeTruthy();
    await type(input, 'لا شيء يطابق');
    expect(await screen.findByText('لا قيد')).toBeTruthy();
  });

  it('shows the chosen entry by its number and description', () => {
    const { input } = renderPicker({ value: 'e14' });
    expect((input as HTMLInputElement).value).toBe('2026/14 دفعة زائدة من العميل');
  });
});
