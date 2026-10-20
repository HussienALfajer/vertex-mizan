'use client';

import { Input as InputPrimitive } from '@base-ui/react/input';
import {
  type AmountTextError,
  type CurrencyCode,
  formatMinor,
  parseAmount,
} from '@vertex-mizan/contracts';
import { useState } from 'react';
import { cn } from '../lib/cn';

type AmountInputProps = Omit<
  InputPrimitive.Props,
  'value' | 'defaultValue' | 'onChange' | 'onValueChange' | 'type' | 'dir'
> & {
  currency: CurrencyCode;
  /** The amount in minor units, or `null` when the field is empty. */
  value: bigint | null;
  /** Called on commit (blur, Enter) with the amount the text stands for, never while typing. */
  onValueChange: (value: bigint | null) => void;
  /** False for debit and credit cells, which hold magnitudes (ADR 0009). */
  allowNegative?: boolean;
  /**
   * Called on commit with the reason the text is not an amount, or `null` once it is. The text
   * stays as typed: an error never clears what the person entered (ADR 0010 §4). The last
   * committed amount still stands behind refused text, so the form must not save or post while
   * any amount input reports an error.
   */
  onTextError?: (error: AmountTextError | null) => void;
};

const display = (value: bigint | null, currency: CurrencyCode) =>
  value === null ? '' : formatMinor(value, currency);

/**
 * An amount typed in major units and kept in minor units through the money module, with no float
 * at any step (ADR 0007, ADR 0010 §4). It accepts Latin and Arabic-Indic digits and the Arabic
 * separators, refuses more decimals than the currency has instead of rounding them, and evaluates
 * an expression starting with `=` exactly, rounding once on commit. The text is left to right,
 * aligned like a figure column, and negative amounts carry the `negative` color.
 */
function AmountInput({
  currency,
  value,
  onValueChange,
  allowNegative = true,
  onTextError,
  className,
  onBlur,
  onKeyDown,
  'aria-invalid': ariaInvalid,
  ...props
}: AmountInputProps) {
  const [text, setText] = useState(() => display(value, currency));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [shown, setShown] = useState({ value, currency });

  // An amount set from outside (a loaded entry, a fill down) replaces the text unless it is
  // being edited; a refused commit leaves the amount, so the typed text stays.
  if (!editing && (shown.value !== value || shown.currency !== currency)) {
    setShown({ value, currency });
    setText(display(value, currency));
  }

  function commit() {
    setEditing(false);
    const result = parseAmount(text, currency, { allowNegative });
    if (result.ok) {
      setInvalid(false);
      onTextError?.(null);
      setText(formatMinor(result.amountMinor, currency));
      if (result.amountMinor !== value) onValueChange(result.amountMinor);
    } else if (result.error === 'EMPTY') {
      setInvalid(false);
      onTextError?.(null);
      setText('');
      if (value !== null) onValueChange(null);
    } else {
      setInvalid(true);
      onTextError?.(result.error);
    }
  }

  return (
    <InputPrimitive
      data-slot="amount-input"
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
        !editing && value !== null && value < 0n && 'text-negative',
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
          // Esc cancels the edit and restores the last committed amount.
          setEditing(false);
          setInvalid(false);
          onTextError?.(null);
          setText(display(value, currency));
        }
        onKeyDown?.(event);
      }}
      {...props}
    />
  );
}

export { AmountInput, type AmountInputProps };
