// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeRateText, RateInput } from './rate-input';

afterEach(cleanup);

function Harness({
  initial = null,
  onCommit = () => {},
  onError = () => {},
}: {
  initial?: string | null;
  onCommit?: (value: string | null) => void;
  onError?: (invalid: boolean) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <RateInput
      aria-label="rate"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onCommit(next);
      }}
      onTextError={onError}
    />
  );
}

async function enter(input: HTMLElement, text: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.blur(input);
  });
}

describe('RateInput', () => {
  it('reads Arabic-Indic digits and the Arabic decimal separator, nothing else', () => {
    expect(normalizeRateText(' ١٢٠٫٥٠٠٠ ')).toBe('120.5000');
    expect(normalizeRateText('۱۲۵.۵')).toBe('125.5');
    expect(normalizeRateText('1,200')).toBe('1,200');
  });

  it('keeps every quoted decimal and reports the rate on commit', async () => {
    const onCommit = vi.fn();
    const onError = vi.fn();
    render(<Harness onCommit={onCommit} onError={onError} />);
    const input = screen.getByRole('textbox', { name: 'rate' }) as HTMLInputElement;
    expect(input.getAttribute('dir')).toBe('ltr');
    await enter(input, '١٢٠٫٠٠٠٠');
    expect(onCommit).toHaveBeenCalledWith('120.0000');
    expect(onError).toHaveBeenLastCalledWith(false);
    expect(input.value).toBe('120.0000');
  });

  it.each([
    ['0'],
    ['0.0000'],
    ['-1'],
    ['1.12345678901'],
    ['1234567890123'],
    ['1,200'],
    ['1e3'],
    ['012'],
  ])('refuses %s and keeps the text as typed', async (text) => {
    const onCommit = vi.fn();
    const onError = vi.fn();
    render(<Harness initial="118.5" onCommit={onCommit} onError={onError} />);
    const input = screen.getByRole('textbox', { name: 'rate' }) as HTMLInputElement;
    await enter(input, text);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith(true);
    expect(input.value).toBe(text);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('empties to null and Escape restores the committed rate', async () => {
    const onCommit = vi.fn();
    render(<Harness initial="118.5" onCommit={onCommit} />);
    const input = screen.getByRole('textbox', { name: 'rate' }) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '9' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(input.value).toBe('118.5');
    await enter(input, '  ');
    expect(onCommit).toHaveBeenCalledWith(null);
  });
});
