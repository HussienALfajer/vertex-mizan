// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountLabel } from './account-label';
import { LedgerSwitch } from './ledger-switch';
import { PeriodBadge } from './period-badge';

afterEach(cleanup);

describe('AccountLabel', () => {
  it('puts the code first as an LTR isolate and the name in its own direction', () => {
    const { container } = render(<AccountLabel code="5110.01" name="مصاريف Google Ads" />);
    const [code, name] = container.querySelectorAll('bdi');
    expect(code?.getAttribute('dir')).toBe('ltr');
    expect(code?.textContent).toBe('5110.01');
    expect(name?.hasAttribute('dir')).toBe(false);
    expect(name?.textContent).toBe('مصاريف Google Ads');
    expect(code?.className).not.toContain('truncate');
  });

  it('marks a header or blocked account with an icon and text, never color alone', () => {
    render(<AccountLabel code="5100" name="المصاريف" kind="header" kindLabel="حساب رئيسي" />);
    const badge = screen.getByText('حساب رئيسي');
    expect(badge.querySelector('svg')).not.toBeNull();
    cleanup();
    // @ts-expect-error A blocked or header account needs its text: an unmarked one is refused.
    render(<AccountLabel code="5100" name="المصاريف" kind="blocked" />);
    cleanup();
    const { container } = render(<AccountLabel code="5100" name="المصاريف" />);
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
  });
});

describe('PeriodBadge', () => {
  it('shows each state with its own icon and text', () => {
    const states = ['open', 'closed', 'reopened'] as const;
    const icons = states.map((state) => {
      const { container } = render(<PeriodBadge state={state} label={state} />);
      const badge = container.querySelector('[data-slot="period-badge"]') as HTMLElement;
      expect(badge.dataset.state).toBe(state);
      expect(badge.textContent).toBe(state);
      const icon = badge.querySelector('svg')?.getAttribute('class') ?? '';
      cleanup();
      return icon;
    });
    expect(new Set(icons).size).toBe(3);
  });
});

describe('LedgerSwitch', () => {
  const ledgers = {
    book: { label: 'الدفاتر', currency: 'SYP' as const },
    parallel: { label: 'الدفتر الموازي', currency: 'USD' as const },
  };

  it('names each ledger with its currency and switches between them', () => {
    const onValueChange = vi.fn();
    render(
      <LedgerSwitch label="الدفتر" value="book" onValueChange={onValueChange} ledgers={ledgers} />,
    );
    expect(screen.getByRole('group', { name: 'الدفتر' })).toBeTruthy();
    const book = screen.getByRole('button', { name: /الدفاتر/ });
    expect(book.getAttribute('aria-pressed')).toBe('true');
    expect(book.textContent).toContain('SYP');
    fireEvent.click(screen.getByRole('button', { name: /الموازي/ }));
    expect(onValueChange).toHaveBeenCalledWith('parallel');
  });

  it('keeps one ledger shown when the pressed one is pressed again', () => {
    const onValueChange = vi.fn();
    render(
      <LedgerSwitch label="الدفتر" value="book" onValueChange={onValueChange} ledgers={ledgers} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /الدفاتر/ }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('is not shown to a company without a parallel ledger', () => {
    const { container } = render(
      <LedgerSwitch
        label="الدفتر"
        value="book"
        onValueChange={() => {}}
        ledgers={{ book: ledgers.book }}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
