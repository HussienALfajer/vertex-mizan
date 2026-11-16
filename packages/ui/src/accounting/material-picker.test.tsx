// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaterialPicker, type MaterialPickerOption, matchesMaterial } from './material-picker';

afterEach(cleanup);

const labels = {
  placeholder: 'اختر مادة',
  empty: 'لا مادة بهذا الاسم',
  unit: 'الوحدة',
  archived: 'مؤرشفة',
};

const materials: MaterialPickerOption[] = [
  { id: 'steel', code: 'M-002', name: 'حديد تسليح', unit: 'طن' },
  { id: 'cement', code: 'M-001', name: 'أسمنت', nameLatin: 'Cement', unit: 'طن' },
  { id: 'old', code: 'M-003', name: 'رمل قديم', unit: 'م³', archived: true },
];

function renderPicker(
  props: Partial<Parameters<typeof MaterialPicker>[0]> = {},
  onValueChange = vi.fn(),
) {
  render(
    <MaterialPicker
      label="المادة"
      materials={materials}
      value={null}
      onValueChange={onValueChange}
      labels={labels}
      {...props}
    />,
  );
  return { input: screen.getByRole('combobox', { name: 'المادة' }), onValueChange };
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

describe('MaterialPicker', () => {
  it('finds a material by code, name, Latin name or unit', () => {
    const [steel, cement] = materials as [MaterialPickerOption, MaterialPickerOption];
    expect(matchesMaterial(cement, 'm-001')).toBe(true);
    expect(matchesMaterial(cement, 'cement')).toBe(true);
    expect(matchesMaterial(steel, 'حديد')).toBe(true);
    expect(matchesMaterial(steel, 'طن')).toBe(true);
    expect(matchesMaterial(steel, 'أسمنت')).toBe(false);
  });

  it('opens with Alt+↓ in code order with units, archived materials hidden', async () => {
    const { input } = renderPicker();
    expect(input.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowDown');
    await open(input, '', true);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'M-001أسمنتالوحدةطن',
      'M-002حديد تسليحالوحدةطن',
    ]);
    // The code is an LTR isolate.
    expect(options[0]?.querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
  });

  it('chooses from the keyboard and reports the material with its unit', async () => {
    const { input, onValueChange } = renderPicker();
    await open(input, 'حديد');
    await screen.findByRole('option');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onValueChange).toHaveBeenCalledWith(materials[0]);
  });

  it('keeps an archived material that is chosen, marked, and shows the error', async () => {
    const { input } = renderPicker({ value: 'old', error: 'المادة مؤرشفة' });
    expect((input as HTMLInputElement).value).toBe('M-003 رمل قديم');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await open(input, '', true);
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[2]?.textContent).toContain('مؤرشفة');
  });

  it('says when nothing matches', async () => {
    const { input } = renderPicker();
    await open(input, 'غير موجود');
    expect(await screen.findByText('لا مادة بهذا الاسم')).toBeTruthy();
  });
});
