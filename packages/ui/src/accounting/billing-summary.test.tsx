// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BillingSummary } from './billing-summary';

afterEach(cleanup);

const labels = {
  cumulative: 'التراكمي حتى تاريخه',
  previous: 'السابق',
  period: 'قيمة الفترة',
  retention: 'المحتجزات',
  recovery: 'استرداد الدفعة المقدمة',
  net: 'الصافي المستحق',
  unknown: 'لم يُحسب بعد',
};

const figures = {
  cumulativeMinor: 3000000n,
  previousMinor: 0n,
  periodMinor: 3000000n,
  retentionMinor: 300000n,
  recoveryMinor: 600000n,
  netMinor: 2100000n,
};

const amountOf = (slot: string) =>
  document.querySelector(`[data-slot="billing-summary-${slot}"] [data-slot="amount"]`)?.textContent;

describe('BillingSummary', () => {
  it('shows the chain in order, each figure through Amount, the net in bold', () => {
    render(
      <BillingSummary
        currency="USD"
        figures={figures}
        labels={labels}
        retentionRate="10%"
        recoveryRate="20%"
      />,
    );
    const terms = screen.getAllByRole('term').map((term) => term.textContent);
    expect(terms).toEqual([
      'التراكمي حتى تاريخه',
      'السابق',
      'قيمة الفترة',
      'المحتجزات10%',
      'استرداد الدفعة المقدمة20%',
      'الصافي المستحق',
    ]);
    expect(amountOf('cumulative')).toBe('30,000.00');
    expect(amountOf('retention')).toBe('3,000.00');
    expect(amountOf('net')).toBe('21,000.00');
    expect(
      document.querySelector('[data-slot="billing-summary-net"] [data-slot="amount"]')?.className,
    ).toContain('font-bold');
    // A rate is an LTR isolate.
    expect(screen.getByText('10%').getAttribute('dir')).toBe('ltr');
  });

  it('reads a figure the preview has not given as unknown', () => {
    render(
      <BillingSummary
        currency="USD"
        figures={{ ...figures, previousMinor: null, netMinor: null }}
        labels={labels}
      />,
    );
    expect(screen.getAllByText('لم يُحسب بعد')).toHaveLength(2);
    expect(amountOf('net')).toBeUndefined();
  });

  it('puts the fields the app gives in place of the deductions', () => {
    render(
      <BillingSummary
        currency="USD"
        figures={figures}
        labels={labels}
        retentionField={<input aria-label="المحتجزات" />}
        recoveryField={<input aria-label="الاسترداد" />}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'المحتجزات' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'الاسترداد' })).toBeTruthy();
    expect(amountOf('retention')).toBeUndefined();
  });

  it('keeps a negative figure signed and coloured', () => {
    render(
      <BillingSummary currency="USD" figures={{ ...figures, netMinor: -100n }} labels={labels} />,
    );
    const net = document.querySelector('[data-slot="billing-summary-net"] [data-negative]');
    expect(net?.textContent).toBe('-1.00');
  });
});
