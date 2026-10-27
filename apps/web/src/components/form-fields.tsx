import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@vertex-mizan/ui';
import { useId } from 'react';

interface Option<T extends string> {
  value: T;
  label: string;
}

/** A labelled choice from a fixed list (a currency, a rate type, a role, a month). */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onValueChange,
  description,
  error,
  disabled,
  placeholder,
}: {
  label: string;
  value: T | null;
  options: readonly Option<T>[];
  onValueChange: (value: T) => void;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
}) {
  return (
    <Field invalid={error !== undefined} disabled={disabled}>
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

/** A labelled on/off value of a form (accepts the transaction's rate, the period permission). */
export function SwitchField({
  label,
  checked,
  onCheckedChange,
  description,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex w-fit cursor-pointer items-center gap-3 text-control font-medium text-foreground has-disabled:cursor-not-allowed"
      >
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-describedby={description ? `${id}-description` : undefined}
        />
        {label}
      </label>
      {description && (
        <p id={`${id}-description`} className="text-control text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
