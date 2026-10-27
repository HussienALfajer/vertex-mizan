'use client';

import { type ComponentProps, useId } from 'react';
import { cn } from '../lib/cn';
import { Field, FieldError, FieldLabel } from './field';
import { Input } from './input';

/** Two calendar dates, `YYYY-MM-DD`; an empty string leaves that end open. */
interface DateRange {
  from: string;
  to: string;
}

/** Whether a range can filter: an open end, or `from` on or before `to`. */
function isDateRangeOrdered({ from, to }: DateRange): boolean {
  // ISO calendar dates compare as text.
  return from === '' || to === '' || from <= to;
}

type DateRangeFieldProps = Omit<ComponentProps<'fieldset'>, 'children' | 'onChange'> & {
  value: DateRange;
  onValueChange: (value: DateRange) => void;
  /** The group's name (a filter's or a report's period), from i18n. */
  label: string;
  fromLabel: string;
  toLabel: string;
  /** Shown under the end date while it is before the start date. */
  orderError: string;
  disabled?: boolean;
};

/**
 * A period of days for a filter or a report: a start and an end date, either left open. Dates are
 * typed in the browser's date control, LTR with Latin digits; an end before the start is marked
 * and explained, and `isDateRangeOrdered` tells the app not to use it.
 */
function DateRangeField({
  value,
  onValueChange,
  label,
  fromLabel,
  toLabel,
  orderError,
  disabled,
  className,
  ...props
}: DateRangeFieldProps) {
  const legendId = useId();
  const reversed = !isDateRangeOrdered(value);
  return (
    <fieldset
      data-slot="date-range-field"
      aria-labelledby={legendId}
      disabled={disabled}
      className={cn('flex min-w-0 flex-col gap-2', className)}
      {...props}
    >
      <legend id={legendId} className="mb-2 text-control font-medium text-foreground">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel className="text-muted-foreground">{fromLabel}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={value.from}
            max={value.to || undefined}
            onChange={(event) => onValueChange({ ...value, from: event.target.value })}
          />
        </Field>
        <Field invalid={reversed}>
          <FieldLabel className="text-muted-foreground">{toLabel}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={value.to}
            min={value.from || undefined}
            aria-invalid={reversed || undefined}
            onChange={(event) => onValueChange({ ...value, to: event.target.value })}
          />
        </Field>
      </div>
      {reversed && (
        <Field invalid>
          <FieldError match>{orderError}</FieldError>
        </Field>
      )}
    </fieldset>
  );
}

export { type DateRange, DateRangeField, type DateRangeFieldProps, isDateRangeOrdered };
