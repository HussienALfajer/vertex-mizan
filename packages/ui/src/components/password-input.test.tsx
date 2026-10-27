// @vitest-environment jsdom

import { DirectionProvider } from '@base-ui/react/direction-provider';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PasswordInput } from './password-input';

afterEach(cleanup);

function renderInput(disabled = false) {
  render(
    <DirectionProvider direction="rtl">
      <PasswordInput
        aria-label="كلمة المرور"
        showLabel="إظهار كلمة المرور"
        hideLabel="إخفاء كلمة المرور"
        defaultValue="correct horse"
        disabled={disabled}
      />
    </DirectionProvider>,
  );
  return screen.getByLabelText('كلمة المرور', { selector: 'input' }) as HTMLInputElement;
}

describe('PasswordInput', () => {
  it('hides the password, written left to right', () => {
    const input = renderInput();
    expect(input.type).toBe('password');
    expect(input.dir).toBe('ltr');
  });

  it('shows and hides it with a pressed button whose name follows the state', () => {
    const input = renderInput();
    const show = screen.getByRole('button', { name: 'إظهار كلمة المرور' });
    expect(show.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(show);
    expect(input.type).toBe('text');
    const hide = screen.getByRole('button', { name: 'إخفاء كلمة المرور' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(hide);
    expect(input.type).toBe('password');
  });

  it('disables the button with the input', () => {
    renderInput(true);
    expect(
      (screen.getByRole('button', { name: 'إظهار كلمة المرور' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
