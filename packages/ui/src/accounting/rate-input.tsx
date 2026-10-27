'use client';

import { Input as InputPrimitive } from '@base-ui/react/input';
import { rateValueSchema } from '@vertex-mizan/contracts';
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';

type RateInputProps = Omit<
  InputPrimitive.Props,
  'value' | 'defaultValue' | 'onChange' | 'onValueChange' | 'type' | 'dir'
> & {
  /** The rate as quoted (`"118.5000"`), or `null` when the field is empty. */
  value: string | null;
  /** Called on commit (blur, Enter) with the rate the text stands for, never while typing. */
  onValueChange: (value: string | null) => void;
  /**
   * Required: called on commit with `true` when the text is not a rate, `false` once it is. The
   * text stays as typed, and the last committed rate stands behind it, so the form must not save
   * while the field reports an error.
   */
  onTextError: (invalid: boolean) => void;
};

/**
 * Arabic-Indic and Eastern Arabic-Indic digits to Latin and the Arabic decimal separator to `.`,
 * what an Arabic keyboard types; nothing else changes, so the rate stays as quoted.
 */
export function normalizeRateText(text: string): string {
  return text
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}

/**
 * An exchange rate typed as quoted (S02 rule 14, ADR 0007): quote units per one base unit, up to
 * 12 integer digits and 10 decimals, checked with the contract's `rateValueSchema`. It keeps every
 * decimal the person typed (`120.0000` stays `120.0000`) and never rounds, inverts or computes a
 * rate. Left to right, aligned like a figure column.
 */
function RateInput({
  value,
  onValueChange,
  onTextError,
  className,
  onBlur,
  onKeyDown,
  'aria-invalid': ariaInvalid,
  ...props
}: RateInputProps) {
  const [text, setText] = useState(value ?? '');
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [shown, setShown] = useState(value);
  const [clearedError, setClearedError] = useState(false);

  // A rate set from outside (a reset form) replaces the text unless it is being edited.
  if (!editing && shown !== value) {
    setShown(value);
    setText(value ?? '');
    if (invalid) {
      setInvalid(false);
      setClearedError(true);
    }
  }
  useEffect(() => {
    if (!clearedError) return;
    setClearedError(false);
    onTextError(false);
  }, [clearedError, onTextError]);

  function commit() {
    setEditing(false);
    const normalized = normalizeRateText(text);
    if (normalized === '') {
      setInvalid(false);
      onTextError(false);
      setText('');
      if (value !== null) onValueChange(null);
      return;
    }
    if (rateValueSchema.safeParse(normalized).success) {
      setInvalid(false);
      onTextError(false);
      setText(normalized);
      if (normalized !== value) onValueChange(normalized);
    } else {
      setInvalid(true);
      onTextError(true);
    }
  }

  return (
    <InputPrimitive
      data-slot="rate-input"
      dir="ltr"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={text}
      aria-invalid={invalid || ariaInvalid || undefined}
      className={cn(
        'h-control w-full min-w-0 rounded-md border border-input bg-surface px-cell text-end text-control text-foreground tabular-nums',
        'transition-colors duration-150 ease-out placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-muted',
        'aria-invalid:border-destructive-text',
        className,
      )}
      onValueChange={(next: string) => {
        setEditing(true);
        setText(next);
      }}
      onBlur={(event) => {
        commit();
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape' && editing) {
          setEditing(false);
          setInvalid(false);
          onTextError(false);
          setText(value ?? '');
        }
        onKeyDown?.(event);
      }}
      {...props}
    />
  );
}

export { RateInput };
