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
  /**
   * Keeps the group's name for screen readers only, so both dates sit on the same line as the
   * fields beside them in a filter bar; the end labels then read as full field labels.
   */
  labelHidden?: boolean;
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
  labelHidden,
  className,
  ...props
}: DateRangeFieldProps) {
  const legendId = useId();
  const reversed = !isDateRangeOrdered(value);
  const endLabelClass = labelHidden ? undefined : 'text-muted-foreground';
  return (
    <fieldset
      data-slot="date-range-field"
      aria-labelledby={legendId}
      disabled={disabled}
      className={cn('flex min-w-0 flex-col gap-2', className)}
      {...props}
    >
      <legend
        id={legendId}
        className={labelHidden ? 'sr-only' : 'mb-2 text-control font-medium text-foreground'}
      >
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel className={endLabelClass}>{fromLabel}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={value.from}
            max={value.to || undefined}
            onChange={(event) => onValueChange({ ...value, from: event.target.value })}
          />
        </Field>
        <Field invalid={reversed}>
          <FieldLabel className={endLabelClass}>{toLabel}</FieldLabel>
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
