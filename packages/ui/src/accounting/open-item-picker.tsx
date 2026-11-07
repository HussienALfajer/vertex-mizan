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

/**
 * An open item the picker lists (S04): a client's invoice or document on a control account, with
 * what is still open in its currency and what it carries in the ledger the screen shows.
 */
export interface OpenItemPickerOption {
  readonly id: string;
  /** The item's reference: a manual document's reference or Hub's document number. */
  readonly reference: string;
  readonly currency: CurrencyCode;
  /** The open amount in the item's currency, in minor units (signed: a receivable is positive). */
  readonly openMinor: bigint;
  /** The carrying amount in `carryingCurrency`, in minor units. */
  readonly carryingMinor: bigint;
  readonly carryingCurrency: CurrencyCode;
  /** A second line, such as the account and the due date, formatted by the app. */
  readonly detail?: string | null | undefined;
}

/** The picker's labels, from the app's i18n. */
export interface OpenItemPickerLabels {
  readonly placeholder: string;
  readonly empty: string;
  /** The open amount's name ("المفتوح"). */
  readonly open: string;
  /** The carrying amount's name ("الدفتري"). */
  readonly carrying: string;
}

/** Whether an item is found by the query: every word in its reference or its detail. */
export function matchesOpenItem(item: OpenItemPickerOption, query: string): boolean {
  return matchesCommand({ label: item.reference, keywords: [item.detail ?? ''] }, query);
}

/**
 * An open item field (S04 "Screens", ADR 0010 §7): the lookup of a client's open items on a
 * control account line, opened by `Alt+↓` in the entry grid. Type a reference, pick with the
 * arrows and Enter (the WAI-ARIA combobox pattern, Base UI's Combobox). Each option shows what is
 * open in the item's currency and its carrying amount, both through `Amount`. Items come in as
 * props, in the app's order (oldest first); the app reads them for the line's account, client and
 * currency.
 */
function OpenItemPicker({
  label,
  items,
  value,
  onValueChange,
  labels,
  description,
  error,
  disabled,
  className,
}: {
  label: string;
  items: readonly OpenItemPickerOption[];
  /** The chosen item's id, or null. */
  value: string | null;
  onValueChange: (id: string | null) => void;
  labels: OpenItemPickerLabels;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const listed = useMemo(() => [...items], [items]);
  const chosen = listed.find((item) => item.id === value) ?? null;
  return (
    <Field invalid={error !== undefined} disabled={disabled} className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox.Root<OpenItemPickerOption>
        items={listed}
        value={chosen}
        disabled={disabled}
        filter={matchesOpenItem}
        itemToStringLabel={(item) => item.reference}
        isItemEqualToValue={(a, b) => a.id === b.id}
        autoHighlight
        onValueChange={(next) => onValueChange(next ? next.id : null)}
      >
        <div data-slot="open-item-picker" className="relative">
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
              data-slot="open-item-picker-content"
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
                {(item: OpenItemPickerOption) => (
                  <Combobox.Item
                    key={item.id}
                    value={item}
                    data-slot="open-item-picker-item"
                    className="flex min-h-row cursor-default flex-col justify-center gap-0.5 rounded-sm px-2 py-1 text-control outline-none select-none data-highlighted:bg-muted"
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                      <bdi className="truncate font-medium">{item.reference}</bdi>
                      <span className="flex items-baseline gap-1">
                        <span className="text-muted-foreground text-xs">{labels.open}</span>
                        <Amount value={item.openMinor} currency={item.currency} showCurrency />
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-muted-foreground text-xs">
                      <bdi className="truncate">{item.detail}</bdi>
                      <span className="flex items-baseline gap-1">
                        <span>{labels.carrying}</span>
                        <Amount
                          value={item.carryingMinor}
                          currency={item.carryingCurrency}
                          showCurrency
                        />
                      </span>
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

export { OpenItemPicker };
