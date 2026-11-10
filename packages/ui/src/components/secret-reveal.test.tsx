// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretReveal } from './secret-reveal';

// Synthetic, made at run time: the secret scan refuses literals that look like keys.
const secret = ['mzn', 'x'.repeat(40)].join('_');
const writeText = vi.fn(async () => {});

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  writeText.mockClear();
  vi.useRealTimers();
});

function renderReveal(onDone = vi.fn()) {
  render(
    <SecretReveal
      secret={secret}
      label="المفتاح"
      warning="لن يظهر المفتاح مرة أخرى"
      copyLabel="نسخ المفتاح"
      copiedLabel="نُسخ"
      confirmLabel="حفظت المفتاح"
      doneLabel="تم"
      onDone={onDone}
    />,
  );
  return onDone;
}

describe('SecretReveal', () => {
  it('shows the secret left to right under its name, with the warning', () => {
    renderReveal();
    const shown = screen.getByRole('status', { name: 'المفتاح' });
    expect(shown.textContent).toBe(secret);
    expect(shown.getAttribute('dir')).toBe('ltr');
    expect(screen.getByText('لن يظهر المفتاح مرة أخرى')).toBeTruthy();
  });

  it('copies the whole secret and says so for a moment', async () => {
    vi.useFakeTimers();
    renderReveal();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'نسخ المفتاح' }));
    });
    expect(writeText).toHaveBeenCalledWith(secret);
    expect(screen.getByRole('button', { name: 'نُسخ' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('button', { name: 'نسخ المفتاح' })).toBeTruthy();
  });

  it('is done only once the person confirms they kept it', () => {
    const onDone = renderReveal();
    const done = screen.getByRole('button', { name: 'تم' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'حفظت المفتاح' }));
    expect(done.disabled).toBe(false);
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
