// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DateRange, DateRangeField, isDateRangeOrdered } from './date-range-field';

afterEach(cleanup);

function Controlled({
  initial,
  onChange,
}: {
  initial: DateRange;
  onChange?: (value: DateRange) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateRangeField
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      label="الفترة"
      fromLabel="من"
      toLabel="إلى"
      orderError="تاريخ النهاية قبل تاريخ البداية."
    />
  );
}

describe('DateRangeField', () => {
  it('names the group and both dates, typed left to right', () => {
    render(<Controlled initial={{ from: '', to: '' }} />);
    expect(screen.getByRole('group', { name: 'الفترة' })).toBeTruthy();
    for (const name of ['من', 'إلى']) {
      const input = screen.getByLabelText(name) as HTMLInputElement;
      expect(input.type).toBe('date');
      expect(input.getAttribute('dir')).toBe('ltr');
    }
  });

  it('reports each end as it changes and keeps the other', () => {
    const onChange = vi.fn();
    render(<Controlled initial={{ from: '', to: '2026-10-31' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('من'), { target: { value: '2026-10-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('bounds each date by the other', () => {
    render(<Controlled initial={{ from: '2026-10-01', to: '2026-10-31' }} />);
    expect(screen.getByLabelText('من').getAttribute('max')).toBe('2026-10-31');
    expect(screen.getByLabelText('إلى').getAttribute('min')).toBe('2026-10-01');
  });

  it('marks and explains an end before the start', () => {
    render(<Controlled initial={{ from: '2026-10-10', to: '2026-10-31' }} />);
    expect(screen.queryByText('تاريخ النهاية قبل تاريخ البداية.')).toBeNull();
    fireEvent.change(screen.getByLabelText('إلى'), { target: { value: '2026-10-05' } });
    expect(screen.getByText('تاريخ النهاية قبل تاريخ البداية.')).toBeTruthy();
    expect(screen.getByLabelText('إلى').getAttribute('aria-invalid')).toBe('true');
  });

  it('disables both dates with the group', () => {
    render(
      <DateRangeField
        value={{ from: '', to: '' }}
        onValueChange={() => {}}
        label="الفترة"
        fromLabel="من"
        toLabel="إلى"
        orderError="خطأ"
        disabled
      />,
    );
    expect((screen.getByRole('group', { name: 'الفترة' }) as HTMLFieldSetElement).disabled).toBe(
      true,
    );
  });
});

describe('isDateRangeOrdered', () => {
  it('accepts open ends and an ordered range, and refuses a reversed one', () => {
    expect(isDateRangeOrdered({ from: '', to: '' })).toBe(true);
    expect(isDateRangeOrdered({ from: '2026-10-01', to: '' })).toBe(true);
    expect(isDateRangeOrdered({ from: '', to: '2026-10-01' })).toBe(true);
    expect(isDateRangeOrdered({ from: '2026-10-01', to: '2026-10-01' })).toBe(true);
    expect(isDateRangeOrdered({ from: '2026-10-02', to: '2026-10-01' })).toBe(false);
  });
});
