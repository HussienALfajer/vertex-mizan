'use client';

import { Combobox } from '@base-ui/react/combobox';
import type { CurrencyCode } from '@vertex-mizan/contracts';
import { ChevronDownIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '../components/field';
import { cn } from '../lib/cn';
import { matchesCommand } from '../lib/command-search';
import { popupMotion } from '../lib/motion';
import { AccountLabel } from './account-label';
import { Amount } from './amount';

/** A cash account the picker lists (S11): a box or a bank account, its currency and balance. */
export interface CashAccountPickerOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Another name it is found by (the Latin name). */
  readonly nameLatin?: string | null | undefined;
  readonly currency: CurrencyCode;
  /** "صندوق" or "حساب مصرفي", from the app's i18n. */
  readonly kindLabel: string;
  /** Its balance in its currency, in minor units. */
  readonly balanceMinor: bigint;
  /** A blocked account is listed, marked, and cannot be chosen (S02 rule 5). */
  readonly blocked?: boolean | undefined;
}

/** The picker's labels, from the app's i18n. */
export interface CashAccountPickerLabels {
  readonly placeholder: string;
  readonly empty: string;
  readonly blocked: string;
  /** The balance's name ("الرصيد"). */
  readonly balance: string;
  /** A currency group's heading ("الدولار الأمريكي"). */
  readonly currency: (currency: CurrencyCode) => string;
}

interface CurrencyGroup {
  readonly value: CurrencyCode;
  readonly items: readonly CashAccountPickerOption[];
}

/** Whether a cash account is found by the query: every word in its code, names or currency. */
export function matchesCashAccount(account: CashAccountPickerOption, query: string): boolean {
  return matchesCommand(
    {
      label: account.name,
      keywords: [account.code, account.nameLatin ?? '', account.currency, account.kindLabel],
    },
    query,
  );
}

const optionText = (account: CashAccountPickerOption) => `${account.code} ${account.name}`;

/**
 * Groups the accounts by currency, in the order the currencies first appear, each group in code
 * order.
 */
export function cashAccountGroups(accounts: readonly CashAccountPickerOption[]): CurrencyGroup[] {
  const groups = new Map<CurrencyCode, CashAccountPickerOption[]>();
  for (const account of accounts) {
    const group = groups.get(account.currency) ?? [];
    group.push(account);
    groups.set(account.currency, group);
  }
  return [...groups].map(([value, items]) => ({
    value,
    items: items.toSorted((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
  }));
}

/**
 * A cash account field (S11 "Screens", ADR 0010 §7): the boxes and bank accounts grouped by
 * currency, each with its kind and its balance through `Amount`. Type a code, a name or a
 * currency, open the list with `Alt+↓` (or `↓`), pick with the arrows and Enter (the WAI-ARIA
 * combobox pattern, Base UI's Combobox). A blocked account is listed and marked but not chosen;
 * the app leaves archived ones out. Accounts and labels come in as props.
 */
function CashAccountPicker({
  label,
  accounts,
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
  accounts: readonly CashAccountPickerOption[];
  /** The chosen account's id, or null. */
  value: string | null;
  onValueChange: (id: string) => void;
  labels: CashAccountPickerLabels;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  /** The field's id, which an error summary links to. */
  id?: string | undefined;
}) {
  const groups = useMemo(() => cashAccountGroups(accounts), [accounts]);
  const chosen = accounts.find((account) => account.id === value) ?? null;
  return (
    <Field id={id} invalid={error !== undefined} disabled={disabled} className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox.Root<CashAccountPickerOption>
        items={groups}
        value={chosen}
        disabled={disabled}
        filter={matchesCashAccount}
        itemToStringLabel={optionText}
        isItemEqualToValue={(a, b) => a.id === b.id}
        autoHighlight
        onValueChange={(next) => {
          if (next && !next.blocked) onValueChange(next.id);
        }}
      >
        <div data-slot="cash-account-picker" className="relative">
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
              data-slot="cash-account-picker-content"
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
                {(group: CurrencyGroup) => (
                  <Combobox.Group key={group.value} items={group.items} className="not-last:mb-1">
                    <Combobox.GroupLabel className="flex h-row items-center px-2 text-xs font-medium text-muted-foreground select-none">
                      {labels.currency(group.value)}
                    </Combobox.GroupLabel>
                    <Combobox.Collection>
                      {(account: CashAccountPickerOption) => (
                        <Combobox.Item
                          key={account.id}
                          value={account}
                          disabled={account.blocked}
                          data-slot="cash-account-picker-item"
                          className="flex min-h-row cursor-default flex-wrap items-center justify-between gap-x-3 rounded-sm px-2 py-1 text-control outline-none select-none data-disabled:text-muted-foreground data-highlighted:bg-muted"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {account.blocked ? (
                              <AccountLabel
                                code={account.code}
                                name={account.name}
                                kind="blocked"
                                kindLabel={labels.blocked}
                              />
                            ) : (
                              <AccountLabel code={account.code} name={account.name} />
                            )}
                            <span className="text-xs text-muted-foreground">
                              {account.kindLabel}
                            </span>
                          </span>
                          <span className="flex items-baseline gap-1">
                            <span className="text-xs text-muted-foreground">{labels.balance}</span>
                            <Amount
                              value={account.balanceMinor}
                              currency={account.currency}
                              showCurrency
                            />
                          </span>
                        </Combobox.Item>
                      )}
                    </Combobox.Collection>
                  </Combobox.Group>
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

export { CashAccountPicker };
