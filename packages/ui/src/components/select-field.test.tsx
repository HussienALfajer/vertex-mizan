// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectField } from './select-field';

afterEach(cleanup);

const options = [
  { value: 'market', label: 'سعر السوق' },
  { value: 'bulletin', label: 'سعر النشرة' },
] as const;

describe('SelectField', () => {
  it('names the choice by its label and shows the chosen option', () => {
    render(
      <SelectField label="نوع السعر" value="bulletin" options={options} onValueChange={() => {}} />,
    );
    const trigger = screen.getByRole('combobox', { name: 'نوع السعر' });
    expect(trigger.textContent).toContain('سعر النشرة');
  });

  it('reports the option chosen', async () => {
    const onValueChange = vi.fn();
    render(
      <SelectField
        label="نوع السعر"
        value="bulletin"
        options={options}
        onValueChange={onValueChange}
      />,
    );
    // From the keyboard: open with the down arrow, move up, choose with Enter.
    const trigger = screen.getByRole('combobox', { name: 'نوع السعر' });
    trigger.focus();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    });
    await screen.findByRole('option', { name: 'سعر السوق' });
    // The chosen option is highlighted first; the one above it is the market rate.
    for (const key of ['ArrowUp', 'Enter']) {
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? trigger, { key });
      });
    }
    expect(onValueChange).toHaveBeenCalledWith('market');
  });

  it('links the description and marks and explains an error', () => {
    render(
      <SelectField
        label="العملة"
        value="market"
        options={options}
        onValueChange={() => {}}
        description="عملة الدفاتر"
        error="العملة الموازية تختلف عن عملة الدفاتر."
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'العملة' });
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('عملة الدفاتر')).toBeTruthy();
    expect(screen.getByText('العملة الموازية تختلف عن عملة الدفاتر.')).toBeTruthy();
  });

  it('shows no error without one', () => {
    render(
      <SelectField label="العملة" value="market" options={options} onValueChange={() => {}} />,
    );
    expect(screen.getByRole('combobox', { name: 'العملة' }).getAttribute('aria-invalid')).toBe(
      null,
    );
  });
});
