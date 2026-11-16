// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatQuantity, QuantityCell } from './quantity-cell';

afterEach(cleanup);

describe('formatQuantity', () => {
  it('groups the whole part and keeps the decimals as given', () => {
    expect(formatQuantity('12.500')).toBe('12.500');
    expect(formatQuantity('1234567.125')).toBe('1,234,567.125');
    expect(formatQuantity('-2.000')).toBe('-2.000');
    expect(formatQuantity('0.000')).toBe('0.000');
  });

  it('drops trailing zeros when asked, and never shows a negative zero', () => {
    expect(formatQuantity('6.000', true)).toBe('6');
    expect(formatQuantity('6.500', true)).toBe('6.5');
    expect(formatQuantity('-0.000')).toBe('0.000');
  });

  it('returns text that is not a decimal as it is', () => {
    expect(formatQuantity('abc')).toBe('abc');
  });
});

describe('QuantityCell', () => {
  it('shows the figure as an LTR isolate with its unit after it', () => {
    const { container } = render(<QuantityCell quantity="1250.500" unit="طن" />);
    const figure = screen.getByText('1,250.500');
    expect(figure.tagName).toBe('BDI');
    expect(figure.getAttribute('dir')).toBe('ltr');
    expect(figure.className).toContain('tabular-nums');
    expect(container.textContent).toBe('1,250.500طن');
  });

  it('marks a quantity out with its minus and the negative color', () => {
    render(<QuantityCell quantity="-2.000" unit="طن" />);
    const figure = screen.getByText('-2.000');
    expect(figure.getAttribute('data-negative')).toBe('true');
    expect(figure.className).toContain('text-negative');
  });

  it('shows days without trailing zeros and no unit when none is given', () => {
    const { container } = render(<QuantityCell quantity="6.000" trim />);
    expect(container.textContent).toBe('6');
  });
});
