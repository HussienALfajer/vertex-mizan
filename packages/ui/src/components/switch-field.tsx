'use client';

import { useId } from 'react';
import { Switch } from './switch';

/**
 * A labelled on/off value of a form (accepts the transaction's rate, the period permission): the
 * label toggles the switch, and the description is linked to it.
 */
function SwitchField({
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

export { SwitchField };
