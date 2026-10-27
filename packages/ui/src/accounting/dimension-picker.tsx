'use client';

import { Combobox } from '@base-ui/react/combobox';
import { ChevronDownIcon, XIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '../components/field';
import { cn } from '../lib/cn';
import { matchesCommand } from '../lib/command-search';
import { popupMotion } from '../lib/motion';

/** A dimension value the picker lists (a client, a contract, a department, …). */
export interface DimensionPickerOption {
  readonly id: string;
  /** The accountant's short code, if any. */
  readonly code?: string | null | undefined;
  readonly name: string;
  /** Another name it is found by (the Latin name). */
  readonly nameLatin?: string | null | undefined;
  /** A second line, such as a contract's client. */
  readonly detail?: string | null | undefined;
  readonly archived?: boolean | undefined;
}

/** The picker's labels, from the app's i18n. */
export interface DimensionPickerLabels {
  readonly placeholder: string;
  readonly empty: string;
  /** The clear button's name; without it the choice cannot be cleared. */
  readonly clear?: string | undefined;
}

/** Whether a value is found by the query: every word in its code or its names. */
export function matchesDimensionValue(value: DimensionPickerOption, query: string): boolean {
  return matchesCommand(
    { label: value.name, keywords: [value.code ?? '', value.nameLatin ?? ''] },
    query,
  );
}

const optionText = (value: DimensionPickerOption) =>
  value.code ? `${value.code} ${value.name}` : value.name;

const byCodeThenName = (a: DimensionPickerOption, b: DimensionPickerOption) => {
  const codeA = a.code ?? '';
  const codeB = b.code ?? '';
  if (codeA !== codeB) return codeA === '' ? 1 : codeB === '' ? -1 : codeA < codeB ? -1 : 1;
  return a.name.localeCompare(b.name, 'ar');
};

/**
 * A dimension value field (S02, ADR 0010 §7): type a code or a name, pick with the arrows and
 * Enter (the WAI-ARIA combobox pattern, Base UI's Combobox). Values come in as props: the app
 * fetches one type's page, and may search on the server through `onQueryChange`. Archived values
 * are not listed, but the chosen value stays shown when it is archived later, so the field never
 * hides what is set. `required` marks a dimension the account requires.
 */
function DimensionPicker({
  label,
  values,
  value,
  onValueChange,
  onQueryChange,
  labels,
  required,
  description,
  error,
  disabled,
  className,
}: {
  label: string;
  values: readonly DimensionPickerOption[];
  /** The chosen value's id, or null. */
  value: string | null;
  onValueChange: (id: string | null) => void;
  /** Called with the typed text, for a search on the server. */
  onQueryChange?: ((query: string) => void) | undefined;
  labels: DimensionPickerLabels;
  required?: boolean | undefined;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const chosen = values.find((option) => option.id === value) ?? null;
  const items = useMemo(
    () => values.filter((option) => !option.archived).toSorted(byCodeThenName),
    [values],
  );
  const clearable = labels.clear !== undefined && !required && chosen !== null && !disabled;
  return (
    <Field invalid={error !== undefined} disabled={disabled} className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox.Root<DimensionPickerOption>
        items={items}
        value={chosen}
        disabled={disabled}
        filter={matchesDimensionValue}
        itemToStringLabel={optionText}
        isItemEqualToValue={(a, b) => a.id === b.id}
        autoHighlight
        onInputValueChange={(text, details) => {
          // Only what the person typed or pasted is a query: the label shown for a choice is not.
          if (['input-change', 'input-paste', 'input-clear'].includes(details.reason)) {
            onQueryChange?.(text.trim());
          }
        }}
        onValueChange={(next) => onValueChange(next ? next.id : null)}
      >
        <div data-slot="dimension-picker" className="relative">
          <Combobox.Input
            placeholder={labels.placeholder}
            aria-invalid={error !== undefined || undefined}
            aria-required={required || undefined}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              'h-control w-full min-w-0 rounded-md border border-input bg-surface ps-cell text-control text-foreground',
              clearable ? 'pe-16' : 'pe-9',
              'transition-colors duration-150 ease-out placeholder:text-muted-foreground',
              'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive-text',
            )}
          />
          <div className="absolute inset-y-0 end-1 my-auto flex items-center">
            {clearable && (
              <Combobox.Clear
                aria-label={labels.clear}
                className="flex size-hit items-center justify-center rounded-md text-muted-foreground"
              >
                <XIcon aria-hidden="true" className="size-icon" />
              </Combobox.Clear>
            )}
            <Combobox.Trigger
              aria-label={label}
              className="flex size-hit items-center justify-center rounded-md text-muted-foreground"
            >
              <ChevronDownIcon aria-hidden="true" className="size-icon" />
            </Combobox.Trigger>
          </div>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="z-50 outline-none">
            <Combobox.Popup
              data-slot="dimension-picker-content"
              className={cn(
                'max-h-[min(var(--available-height),24rem)] w-(--anchor-width) min-w-64 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface p-1 text-surface-foreground shadow-float outline-none',
                popupMotion,
              )}
            >
              <Combobox.Empty>
                <p className="px-cell py-4 text-center text-control text-muted-foreground">
                  {labels.empty}
                </p>
              </Combobox.Empty>
              <Combobox.List>
                {(option: DimensionPickerOption) => (
                  <Combobox.Item
                    key={option.id}
                    value={option}
                    data-slot="dimension-picker-item"
                    className="flex min-h-row cursor-default flex-col justify-center rounded-sm px-2 py-1 text-control outline-none select-none data-highlighted:bg-muted"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      {option.code && (
                        <bdi dir="ltr" className="shrink-0 font-medium tabular-nums">
                          {option.code}
                        </bdi>
                      )}
                      <bdi className="truncate">{option.name}</bdi>
                    </span>
                    {option.detail && (
                      <bdi className="truncate text-muted-foreground text-xs">{option.detail}</bdi>
                    )}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError match={error !== undefined}>{error}</FieldError>
    </Field>
  );
}

export { DimensionPicker };
