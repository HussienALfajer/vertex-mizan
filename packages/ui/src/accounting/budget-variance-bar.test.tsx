// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BudgetVarianceBar, varianceFillStep } from './budget-variance-bar';

afterEach(cleanup);

const labels = {
  budget: 'الموازنة',
  actual: 'الفعلي',
  variance: 'الانحراف',
  used: 'المستخدم',
  noVariance: 'بعملة أخرى',
};

describe('varianceFillStep', () => {
  it('reads the share as tenths and rounds to the nearest twentieth', () => {
    expect(varianceFillStep(null)).toBe(0);
    expect(varianceFillStep('0.0')).toBe(0);
    expect(varianceFillStep('0.1')).toBe(1);
    expect(varianceFillStep('6.4')).toBe(1);
    expect(varianceFillStep('7.5')).toBe(2);
    expect(varianceFillStep('50.0')).toBe(10);
    expect(varianceFillStep('100.0')).toBe(20);
    expect(varianceFillStep('140.2')).toBe(20);
    expect(varianceFillStep('-3.0')).toBe(0);
  });
});

describe('BudgetVarianceBar', () => {
  it('shows the figures and a meter of the share used', () => {
    render(
      <BudgetVarianceBar
        label="511001 مواد"
        currency="USD"
        budgetMinor={4000000n}
        actualMinor={255809n}
        varianceMinor={3744191n}
        used="6.4"
        labels={labels}
      />,
    );
    const meter = screen.getByRole('meter', { name: 'المستخدم: 511001 مواد' });
    expect(meter.getAttribute('aria-valuetext')).toBe('6.4%');
    expect(meter.getAttribute('aria-valuenow')).toBe('5');
    const amounts = [...document.querySelectorAll('[data-slot="amount"]')].map(
      (amount) => amount.textContent,
    );
    expect(amounts).toEqual(['40,000.00', '2,558.09', '37,441.91']);
    expect(document.querySelector('[data-slot="budget-variance-fill"]')?.className).toContain(
      'bg-primary',
    );
  });

  it('marks a cost over its budget in the negative color and fills the bar', () => {
    render(
      <BudgetVarianceBar
        label="511002 أجور"
        currency="USD"
        budgetMinor={100000n}
        actualMinor={120000n}
        varianceMinor={-20000n}
        used="120.0"
        labels={labels}
      />,
    );
    const root = document.querySelector('[data-slot="budget-variance-bar"]');
    expect(root?.getAttribute('data-over')).toBe('true');
    const fill = document.querySelector('[data-slot="budget-variance-fill"]');
    expect(fill?.className).toContain('bg-negative');
    expect(fill?.className).toContain('w-full');
    expect(document.querySelector('[data-negative]')?.textContent).toBe('-200.00');
    expect(screen.getByText('120.0%').className).toContain('text-negative');
  });

  it('shows no variance and no meter when the budget cannot be compared', () => {
    render(
      <BudgetVarianceBar
        label="511001 مواد"
        currency="USD"
        budgetMinor={4000000n}
        actualMinor={255809n}
        varianceMinor={null}
        used={null}
        labels={labels}
      />,
    );
    expect(screen.getByText('بعملة أخرى')).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });
});
