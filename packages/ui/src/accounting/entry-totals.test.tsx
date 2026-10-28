// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { entryTotals } from '@vertex-mizan/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { EntryTotals } from './entry-totals';

afterEach(cleanup);

const labels = {
  label: 'مجاميع القيد',
  currency: 'العملة',
  debit: 'مدين',
  credit: 'دائن',
  status: 'الحالة',
  balanced: 'متوازن',
  residual: 'الفرق',
  crossCurrency: 'يُرحَّل فرق كل عملة فرقَ صرف محققًا.',
};

describe('EntryTotals', () => {
  it('shows each currency’s debits and credits, and writes out whether it balances', () => {
    render(
      <EntryTotals
        labels={labels}
        totals={entryTotals([
          { amountMinor: 10_000n, currency: 'USD' },
          { amountMinor: -1_225_000n, currency: 'SYP' },
          { amountMinor: 1_225_000n, currency: 'SYP' },
          { amountMinor: -10_050n, currency: 'USD' },
        ])}
      />,
    );
    const table = screen.getByRole('table', { name: 'مجاميع القيد' });
    const [usd, syp] = within(table).getAllByRole('row').slice(1);
    expect(usd?.textContent).toBe('USD100.00100.50الفرق -0.50');
    expect(usd?.getAttribute('data-balanced')).toBe('false');
    // A negative residual keeps its sign and the negative color (ADR 0010 §3).
    expect(usd?.querySelector('[data-negative]')?.textContent).toBe('-0.50');
    expect(syp?.textContent).toBe('SYP12,250.0012,250.00متوازن');
    expect(syp?.getAttribute('data-balanced')).toBe('true');
  });

  it('marks a one-currency imbalance as an error, and explains residuals in several currencies', () => {
    const { rerender } = render(
      <EntryTotals labels={labels} totals={entryTotals([{ amountMinor: 5n, currency: 'SYP' }])} />,
    );
    expect(document.querySelector('[data-slot="badge"]')?.className).toContain('danger');
    expect(document.querySelector('[data-slot="entry-totals-note"]')).toBeNull();
    rerender(
      <EntryTotals
        labels={labels}
        totals={entryTotals([
          { amountMinor: 10_000n, currency: 'USD' },
          { amountMinor: -1_225_000n, currency: 'SYP' },
        ])}
      />,
    );
    for (const badge of document.querySelectorAll('[data-slot="badge"]')) {
      expect(badge.className).not.toContain('danger');
    }
    expect(document.querySelector('[data-slot="entry-totals-note"]')?.textContent).toBe(
      labels.crossCurrency,
    );
  });

  it('keeps every figure an LTR isolate, and announces changes politely', () => {
    render(
      <EntryTotals labels={labels} totals={entryTotals([{ amountMinor: 1n, currency: 'SYP' }])} />,
    );
    for (const figure of document.querySelectorAll('[data-slot="amount"]')) {
      expect(figure.getAttribute('dir')).toBe('ltr');
    }
    expect(document.querySelector('tbody')?.getAttribute('aria-live')).toBe('polite');
  });
});
