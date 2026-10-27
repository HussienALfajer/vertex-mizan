// @vitest-environment jsdom

import { DirectionProvider } from '@base-ui/react/direction-provider';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OtpField } from './otp-field';

afterEach(cleanup);

function renderField(onValueComplete = vi.fn()) {
  render(
    <DirectionProvider direction="rtl">
      <OtpField slotLabel={(position) => `الخانة ${position}`} onValueComplete={onValueComplete} />
    </DirectionProvider>,
  );
  return onValueComplete;
}

describe('OtpField', () => {
  it('lays six slots out left to right inside an RTL page, each with a name', () => {
    renderField();
    const slots = screen.getAllByRole('textbox');
    expect(slots).toHaveLength(6);
    const root = slots[0]?.closest('[data-slot="otp-field"]');
    expect(root?.getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('textbox', { name: 'الخانة 6' })).toBe(slots[5]);
  });

  it('takes a pasted code across every slot and reports it complete', () => {
    const onValueComplete = renderField();
    const [first] = screen.getAllByRole('textbox');
    fireEvent.paste(first as HTMLElement, { clipboardData: { getData: () => '123456' } });
    expect(onValueComplete).toHaveBeenCalledWith('123456', expect.anything());
    expect(screen.getAllByRole('textbox').map((slot) => (slot as HTMLInputElement).value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it('refuses letters', () => {
    const onValueComplete = renderField();
    const [first] = screen.getAllByRole('textbox');
    fireEvent.paste(first as HTMLElement, { clipboardData: { getData: () => 'abcdef' } });
    expect(onValueComplete).not.toHaveBeenCalled();
    expect((first as HTMLInputElement).value).toBe('');
  });

  it('sizes its slots by density', () => {
    renderField();
    for (const slot of screen.getAllByRole('textbox')) {
      expect(slot.className).toContain('size-control');
      expect(slot.className).toContain('text-control');
    }
  });
});
