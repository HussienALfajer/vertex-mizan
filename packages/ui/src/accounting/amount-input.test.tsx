// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AmountTextError, CurrencyCode } from '@vertex-mizan/contracts';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmountInput } from './amount-input';

afterEach(cleanup);

/** An input wired to its own state, reporting each committed value and error. */
function Harness({
  initial = null,
  currency = 'SYP',
  allowNegative = true,
  onCommit = () => {},
  onError = () => {},
}: {
  initial?: bigint | null;
  currency?: CurrencyCode;
  allowNegative?: boolean;
  onCommit?: (value: bigint | null) => void;
  onError?: (error: AmountTextError | null) => void;
}) {
  const [value, setValue] = useState<bigint | null>(initial);
  return (
    <AmountInput
      aria-label="amount"
      currency={currency}
      value={value}
      allowNegative={allowNegative}
      onValueChange={(next) => {
        setValue(next);
        onCommit(next);
      }}
      onTextError={onError}
    />
  );
}

const input = () => screen.getByRole('textbox', { name: 'amount' }) as HTMLInputElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

describe('AmountInput', () => {
  it('is a left-to-right decimal field aligned like a figure column', () => {
    render(<Harness />);
    expect(input().getAttribute('dir')).toBe('ltr');
    expect(input().getAttribute('inputmode')).toBe('decimal');
    expect(input().className).toContain('text-end');
    expect(input().className).toContain('tabular-nums');
  });

  it('commits minor units on blur, never while typing, and shows the canonical text', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    type('1250.5');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledWith(125_050n);
    expect(input().value).toBe('1,250.50');
  });

  it('commits on Enter, from Arabic-Indic digits and the Arabic separators', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    type('١٬٢٥٠٫٥');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(125_050n);
    expect(input().value).toBe('1,250.50');
  });

  it('evaluates an expression exactly and rounds once on commit', () => {
    const onCommit = vi.fn();
    render(<Harness currency="USD" onCommit={onCommit} />);
    type('=10/3');
    fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledWith(333n);
    expect(input().value).toBe('3.33');
  });

  it('refuses extra decimals without rounding them, and keeps the typed text', () => {
    const onCommit = vi.fn();
    const onError = vi.fn();
    render(<Harness currency="USD" onCommit={onCommit} onError={onError} />);
    type('1.234');
    fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith('TOO_MANY_DECIMALS');
    expect(input().value).toBe('1.234');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    type('1.23');
    fireEvent.blur(input());
    expect(onError).toHaveBeenLastCalledWith(null);
    expect(input().hasAttribute('aria-invalid')).toBe(false);
    expect(onCommit).toHaveBeenCalledWith(123n);
  });

  it('refuses a paste of several cells or lines instead of joining them', () => {
    const onCommit = vi.fn();
    const onError = vi.fn();
    render(<Harness initial={500n} currency="USD" onCommit={onCommit} onError={onError} />);
    for (const pasted of ['500\r\n250\r\n', '500\t250', '500\n250']) {
      const event = fireEvent.paste(input(), { clipboardData: { getData: () => pasted } });
      expect(event, JSON.stringify(pasted)).toBe(false); // default prevented
      expect(onError).toHaveBeenLastCalledWith('INVALID');
    }
    expect(input().value).toBe('5.00');
    fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('lets a single pasted value in, with breaks only at its ends', () => {
    const onError = vi.fn();
    render(<Harness onError={onError} />);
    const event = fireEvent.paste(input(), { clipboardData: { getData: () => '1,250.00\r\n' } });
    expect(event).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('holds magnitudes only in a debit or credit cell', () => {
    const onError = vi.fn();
    render(<Harness allowNegative={false} onError={onError} />);
    type('-5');
    fireEvent.blur(input());
    expect(onError).toHaveBeenLastCalledWith('NEGATIVE_NOT_ALLOWED');
  });

  it('empties to null without an error', () => {
    const onCommit = vi.fn();
    const onError = vi.fn();
    render(<Harness initial={500n} onCommit={onCommit} onError={onError} />);
    expect(input().value).toBe('5.00');
    type('');
    fireEvent.blur(input());
    expect(onCommit).toHaveBeenCalledWith(null);
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('restores the committed amount on Esc', () => {
    const onCommit = vi.fn();
    render(<Harness initial={500n} onCommit={onCommit} />);
    type('99');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('5.00');
    fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('shows a committed negative amount in the negative color', () => {
    render(<Harness initial={-500n} />);
    expect(input().value).toBe('-5.00');
    expect(input().className).toContain('text-negative');
  });

  it('follows an amount set from outside while not editing, clearing a refused text', () => {
    // The parent keeps the error in its own state, as callers must; React warns (and the test
    // fails) if the input updates that state while rendering.
    const warnings = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fillDown = (_value: bigint) => {};
    function Form() {
      const [value, setValue] = useState<bigint | null>(100n);
      const [error, setError] = useState<AmountTextError | null>(null);
      fillDown = setValue;
      return (
        <>
          <AmountInput
            aria-label="amount"
            currency="USD"
            value={value}
            onValueChange={setValue}
            onTextError={setError}
          />
          <output>{error ?? 'none'}</output>
        </>
      );
    }
    render(<Form />);
    type('1.234');
    fireEvent.blur(input());
    expect(screen.getByRole('status').textContent).toBe('TOO_MANY_DECIMALS');
    // A fill down replaces the refused text with a valid amount.
    act(() => fillDown(250n));
    expect(input().value).toBe('2.50');
    expect(input().hasAttribute('aria-invalid')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('none');
    expect(warnings).not.toHaveBeenCalled();
  });
});
