// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Amount } from './amount';

afterEach(cleanup);

const amountOf = (container: HTMLElement) =>
  container.querySelector('[data-slot="amount"]') as HTMLElement;

describe('Amount', () => {
  it('shows minor units as grouped Latin digits with every decimal of the currency', () => {
    const { container } = render(<Amount value={125_000_050n} currency="SYP" />);
    expect(amountOf(container).textContent).toBe('1,250,000.50');
  });

  it('isolates the figure left to right inside Arabic text, so the sign never moves', () => {
    const { container } = render(
      <p dir="rtl">
        الرصيد <Amount value={-125_000n} currency="USD" showCurrency /> اليوم
      </p>,
    );
    const amount = amountOf(container);
    expect(amount.tagName).toBe('BDI');
    expect(amount.getAttribute('dir')).toBe('ltr');
    // Sign, digits and code are one isolate, in that order.
    expect(amount.textContent).toBe('-1,250.00USD');
  });

  it('marks a negative figure with the minus sign and the negative color, never color alone', () => {
    const { container } = render(<Amount value={-5n} currency="USD" />);
    const amount = amountOf(container);
    expect(amount.textContent).toBe('-0.05');
    expect(amount.dataset.negative).toBe('true');
    expect(amount.className).toContain('text-negative');
  });

  it('leaves positive figures and zero in the text color', () => {
    for (const value of [0n, 5n]) {
      const { container } = render(<Amount value={value} currency="USD" />);
      const amount = amountOf(container);
      expect(amount.dataset.negative).toBeUndefined();
      expect(amount.className).not.toContain('text-negative');
      cleanup();
    }
  });

  it('uses an ASCII hyphen-minus, so a copied figure pastes into Excel as a number', () => {
    const { container } = render(<Amount value={-1n} currency="USD" strong />);
    expect(amountOf(container).textContent?.charCodeAt(0)).toBe(0x2d);
  });

  it('sets the separators of a bold total at the regular weight, keeping its text intact', () => {
    const { container } = render(<Amount value={-125_000_000_00n} currency="SYP" strong />);
    const amount = amountOf(container);
    expect(amount.textContent).toBe('-125,000,000.00');
    expect(amount.className).toContain('font-bold');
    const separators = [...amount.querySelectorAll('span.font-normal')].map((s) => s.textContent);
    expect(separators).toEqual([',', ',', '.']);
  });

  it('shows zero as a dash only when asked, still read out as zero', () => {
    const { container } = render(<Amount value={0n} currency="SYP" zero="dash" />);
    const amount = amountOf(container);
    expect(amount.querySelector('[aria-hidden="true"]')?.textContent).toBe('–');
    expect(amount.querySelector('.sr-only')?.textContent).toBe('0.00');
    cleanup();
    expect(amountOf(render(<Amount value={0n} currency="SYP" />).container).textContent).toBe(
      '0.00',
    );
  });

  it('never abbreviates or truncates the largest stored amount', () => {
    const { container } = render(<Amount value={-(2n ** 63n - 1n)} currency="USD" />);
    const amount = amountOf(container);
    expect(amount.textContent).toBe('-92,233,720,368,547,758.07');
    expect(amount.className).toContain('whitespace-nowrap');
    expect(amount.className).not.toMatch(/truncate|overflow-hidden|text-ellipsis/);
  });
});
