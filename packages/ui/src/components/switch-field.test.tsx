// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SwitchField } from './switch-field';

afterEach(cleanup);

describe('SwitchField', () => {
  it('names the switch by its label and toggles from the label', () => {
    const onCheckedChange = vi.fn();
    render(
      <SwitchField label="يقبل سعر العملية" checked={false} onCheckedChange={onCheckedChange} />,
    );
    const control = screen.getByRole('switch', { name: 'يقبل سعر العملية' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByText('يقبل سعر العملية'));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('links its description', () => {
    render(
      <SwitchField
        label="صلاحية الفترات"
        description="للمحاسب فقط."
        checked
        onCheckedChange={() => {}}
      />,
    );
    const control = screen.getByRole('switch', { name: 'صلاحية الفترات' });
    const described = control.getAttribute('aria-describedby');
    expect(described && document.getElementById(described)?.textContent).toBe('للمحاسب فقط.');
  });

  it('does not change while disabled', () => {
    const onCheckedChange = vi.fn();
    render(
      <SwitchField
        label="يقبل سعر العملية"
        checked={false}
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'يقبل سعر العملية' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
