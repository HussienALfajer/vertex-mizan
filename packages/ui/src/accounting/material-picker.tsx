'use client';

import { Combobox } from '@base-ui/react/combobox';
import { ChevronDownIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '../components/field';
import { cn } from '../lib/cn';
import { matchesCommand } from '../lib/command-search';
import { popupMotion } from '../lib/motion';

/** A material of the catalogue the picker lists (S12): its code, names and unit. */
export interface MaterialPickerOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Another name it is found by (the Latin name). */
  readonly nameLatin?: string | null | undefined;
  /** Its unit as typed (طن، م³، كيس). */
  readonly unit: string;
  /** An archived material is left out of the list, but kept when it is the chosen one (rule 3). */
  readonly archived?: boolean | undefined;
}

/** The picker's labels, from the app's i18n. */
export interface MaterialPickerLabels {
  readonly placeholder: string;
  readonly empty: string;
  /** The unit's name ("الوحدة"), read before the unit in the list. */
  readonly unit: string;
  /** The mark of an archived material that is still chosen ("مؤرشفة"). */
  readonly archived: string;
}

/** Whether a material is found by the query: every word in its code, names or unit. */
export function matchesMaterial(material: MaterialPickerOption, query: string): boolean {
  return matchesCommand(
    { label: material.name, keywords: [material.code, material.nameLatin ?? '', material.unit] },
    query,
  );
}

const optionText = (material: MaterialPickerOption) => `${material.code} ${material.name}`;

/**
 * A material field (S12 "Screens", ADR 0010 §7): the catalogue in code order, each material with
 * its code as an LTR isolate, its name and its unit. Type a code or a name, open the list with
 * `Alt+↓` (or `↓`), pick with the arrows and Enter (the WAI-ARIA combobox pattern, Base UI's
 * Combobox). Archived materials are hidden, except the chosen one, which stays readable and
 * marked. Materials and labels come in as props.
 */
function MaterialPicker({
  label,
  materials,
  value,
  onValueChange,
  labels,
  description,
  error,
  disabled,
  className,
  id,
}: {
  label: string;
  materials: readonly MaterialPickerOption[];
  /** The chosen material's id, or null. */
  value: string | null;
  onValueChange: (material: MaterialPickerOption) => void;
  labels: MaterialPickerLabels;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  /** The field's id, which an error summary links to. */
  id?: string | undefined;
}) {
  const chosen = materials.find((material) => material.id === value) ?? null;
  const items = useMemo(
    () =>
      materials
        .filter((material) => !material.archived || material.id === value)
        .toSorted((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    [materials, value],
  );
  return (
    <Field id={id} invalid={error !== undefined} disabled={disabled} className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox.Root<MaterialPickerOption>
        items={items}
        value={chosen}
        disabled={disabled}
        filter={matchesMaterial}
        itemToStringLabel={optionText}
        isItemEqualToValue={(a, b) => a.id === b.id}
        autoHighlight
        onValueChange={(next) => {
          if (next) onValueChange(next);
        }}
      >
        <div data-slot="material-picker" className="relative">
          <Combobox.Input
            placeholder={labels.placeholder}
            aria-invalid={error !== undefined || undefined}
            aria-keyshortcuts="Alt+ArrowDown"
            autoComplete="off"
            spellCheck={false}
            className={cn(
              'h-control w-full min-w-0 rounded-md border border-input bg-surface ps-cell pe-9 text-control text-foreground',
              'transition-colors duration-150 ease-out placeholder:text-muted-foreground',
              'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive-text',
            )}
          />
          <Combobox.Trigger
            aria-label={label}
            className="absolute inset-y-0 end-1 my-auto flex size-hit items-center justify-center rounded-md text-muted-foreground"
          >
            <ChevronDownIcon aria-hidden="true" className="size-icon" />
          </Combobox.Trigger>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="z-50 outline-none">
            <Combobox.Popup
              data-slot="material-picker-content"
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
                {(material: MaterialPickerOption) => (
                  <Combobox.Item
                    key={material.id}
                    value={material}
                    data-slot="material-picker-item"
                    className="flex min-h-row cursor-default flex-wrap items-center justify-between gap-x-3 rounded-sm px-2 py-1 text-control outline-none select-none data-highlighted:bg-muted"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <bdi dir="ltr" className="font-medium tabular-nums">
                        {material.code}
                      </bdi>
                      <bdi className="truncate">{material.name}</bdi>
                      {material.archived && (
                        <span className="text-muted-foreground text-xs">{labels.archived}</span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-1 text-xs">
                      <span className="text-muted-foreground">{labels.unit}</span>
                      <bdi>{material.unit}</bdi>
                    </span>
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

export { MaterialPicker };
