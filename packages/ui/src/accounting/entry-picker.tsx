'use client';

import { Combobox } from '@base-ui/react/combobox';
import type { CurrencyCode } from '@vertex-mizan/contracts';
import { ChevronDownIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '../components/field';
import { cn } from '../lib/cn';
import { matchesCommand } from '../lib/command-search';
import { popupMotion } from '../lib/motion';
import { Amount } from './amount';

/** A posted entry the picker lists (S05: the manual entry that resolves a held event). */
export interface EntryPickerOption {
  readonly id: string;
  /** The entry's number as the app writes it ("2026/12"). */
  readonly number: string;
  /** The entry's date as the app writes it. */
  readonly date: string;
  readonly description: string;
  /** The entry's debit total in the book ledger, in minor units. */
  readonly totalMinor?: bigint | undefined;
  readonly totalCurrency?: CurrencyCode | undefined;
}

/** The picker's labels, from the app's i18n. */
export interface EntryPickerLabels {
  readonly placeholder: string;
  readonly empty: string;
}

/** Whether an entry is found by the query: every word in its number or its description. */
export function matchesEntry(entry: EntryPickerOption, query: string): boolean {
  return matchesCommand({ label: entry.description, keywords: [entry.number] }, query);
}

/**
 * A posted entry field (S05 "Screens", ADR 0010 §7): type an entry's number or words of its
 * description, pick with the arrows and Enter (the WAI-ARIA combobox pattern, Base UI's Combobox).
 * Entries come in as props in the app's order (newest first); the app searches the journal through
 * `onQueryChange`. Each option shows its number and date, its description and its debit total
 * through `Amount`.
 */
function EntryPicker({
  id,
  label,
  entries,
  value,
  onValueChange,
  onQueryChange,
  labels,
  description,
  error,
  disabled,
  className,
}: {
  /** Names the field for an error summary. */
  id?: string | undefined;
  label: string;
  entries: readonly EntryPickerOption[];
  /** The chosen entry's id, or null. */
  value: string | null;
  onValueChange: (id: string | null) => void;
  /** Called with the typed text, for a search on the server. */
  onQueryChange?: ((query: string) => void) | undefined;
  labels: EntryPickerLabels;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const listed = useMemo(() => [...entries], [entries]);
  const chosen = listed.find((entry) => entry.id === value) ?? null;
  return (
    <Field id={id} invalid={error !== undefined} disabled={disabled} className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox.Root<EntryPickerOption>
        items={listed}
        value={chosen}
        disabled={disabled}
        filter={matchesEntry}
        itemToStringLabel={(entry) => `${entry.number} ${entry.description}`}
        isItemEqualToValue={(a, b) => a.id === b.id}
        autoHighlight
        onInputValueChange={(text, details) => {
          if (['input-change', 'input-paste', 'input-clear'].includes(details.reason)) {
            onQueryChange?.(text.trim());
          }
        }}
        onValueChange={(next) => onValueChange(next ? next.id : null)}
      >
        <div data-slot="entry-picker" className="relative">
          <Combobox.Input
            placeholder={labels.placeholder}
            aria-invalid={error !== undefined || undefined}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              'h-control w-full min-w-0 rounded-md border border-input bg-surface ps-cell pe-9 text-control text-foreground',
              'transition-colors duration-150 ease-out placeholder:text-muted-foreground',
              'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive-text',
            )}
          />
          <div className="absolute inset-y-0 end-1 my-auto flex items-center">
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
              data-slot="entry-picker-content"
              className={cn(
                'max-h-[min(var(--available-height),24rem)] w-(--anchor-width) min-w-72 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface p-1 text-surface-foreground shadow-float outline-none',
                popupMotion,
              )}
            >
              <Combobox.Empty>
                <p className="px-cell py-4 text-center text-control text-muted-foreground">
                  {labels.empty}
                </p>
              </Combobox.Empty>
              <Combobox.List>
                {(entry: EntryPickerOption) => (
                  <Combobox.Item
                    key={entry.id}
                    value={entry}
                    data-slot="entry-picker-item"
                    className="flex min-h-row cursor-default flex-col justify-center gap-0.5 rounded-sm px-2 py-1 text-control outline-none select-none data-highlighted:bg-muted"
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                      <span className="flex items-baseline gap-2">
                        <bdi dir="ltr" className="font-medium tabular-nums">
                          {entry.number}
                        </bdi>
                        <bdi dir="ltr" className="text-muted-foreground text-xs tabular-nums">
                          {entry.date}
                        </bdi>
                      </span>
                      {entry.totalMinor !== undefined && entry.totalCurrency && (
                        <Amount
                          value={entry.totalMinor}
                          currency={entry.totalCurrency}
                          showCurrency
                        />
                      )}
                    </span>
                    <bdi className="truncate text-muted-foreground text-xs">
                      {entry.description}
                    </bdi>
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

export { EntryPicker };
