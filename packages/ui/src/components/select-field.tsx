'use client';

import { Field, FieldDescription, FieldError, FieldLabel } from './field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A labelled choice from a fixed list (a currency, a rate type, a role, a month): a `Field` with
 * its label, description and error linked to a `Select`. The options' labels are the app's text.
 */
function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onValueChange,
  description,
  error,
  disabled,
  placeholder,
}: {
  /** The field's id, which an error summary links to. */
  id?: string | undefined;
  label: string;
  value: T | null;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
}) {
  return (
    <Field id={id} invalid={error !== undefined} disabled={disabled}>
      <FieldLabel render={<span />}>{label}</FieldLabel>
      <Select
        items={options}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next as T);
        }}
      >
        <SelectTrigger aria-invalid={error !== undefined || undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError match={error !== undefined}>{error}</FieldError>
    </Field>
  );
}

export { SelectField, type SelectOption };
