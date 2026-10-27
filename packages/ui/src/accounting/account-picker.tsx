'use client';

import { Combobox } from '@base-ui/react/combobox';
import { ChevronDownIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '../components/field';
import { cn } from '../lib/cn';
import { matchesCommand } from '../lib/command-search';
import { popupMotion } from '../lib/motion';
import { AccountLabel } from './account-label';

/** An account the picker lists. */
export interface AccountPickerOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Another name it is found by (the Latin name). */
  readonly nameLatin?: string | null | undefined;
  readonly kind: 'header' | 'postable';
  readonly blocked?: boolean | undefined;
  readonly archived?: boolean | undefined;
}

/** The picker's labels, from the app's i18n. */
export interface AccountPickerLabels {
  readonly placeholder: string;
  readonly empty: string;
  readonly header: string;
  readonly blocked: string;
}

/** Whether an account can be chosen: a postable account neither blocked nor archived (S02). */
export function isPickableAccount(account: AccountPickerOption): boolean {
  return account.kind === 'postable' && !account.blocked && !account.archived;
}

/** Whether an account is found by the query: every word in its code or its names. */
export function matchesAccount(account: AccountPickerOption, query: string): boolean {
  return matchesCommand(
    { label: account.name, keywords: [account.code, account.nameLatin ?? ''] },
    query,
  );
}

const optionText = (account: AccountPickerOption) => `${account.code} ${account.name}`;

/**
 * An account field (S02, ADR 0010 §7): type a code or a name, pick with the arrows and Enter (the
 * WAI-ARIA combobox pattern, Base UI's Combobox). Headers and blocked accounts are listed, in code
 * order and marked, but cannot be chosen; archived accounts are not listed. The chosen account
 * stays shown when it is blocked or archived later, so the field never hides what is set.
 */
function AccountPicker({
  label,
  accounts,
  value,
  onValueChange,
  labels,
  description,
  error,
  disabled,
  className,
}: {
  label: string;
  accounts: readonly AccountPickerOption[];
  /** The chosen account's id, or null. */
  value: string | null;
  onValueChange: (id: string) => void;
  labels: AccountPickerLabels;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const chosen = accounts.find((account) => account.id === value) ?? null;
  const items = useMemo(
    () =>
      accounts
        .filter((account) => !account.archived)
        .toSorted((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    [accounts],
  );
  return (
    <Field invalid={error !== undefined} disabled={disabled} className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Combobox.Root<AccountPickerOption>
        items={items}
        value={chosen}
        disabled={disabled}
        filter={matchesAccount}
        itemToStringLabel={optionText}
        isItemEqualToValue={(a, b) => a.id === b.id}
        autoHighlight
        onValueChange={(next) => {
          if (next && isPickableAccount(next)) onValueChange(next.id);
        }}
      >
        <div data-slot="account-picker" className="relative">
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
              data-slot="account-picker-content"
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
                {(account: AccountPickerOption) => (
                  <Combobox.Item
                    key={account.id}
                    value={account}
                    disabled={!isPickableAccount(account)}
                    data-slot="account-picker-item"
                    className="flex min-h-row cursor-default items-center rounded-sm px-2 py-1 text-control outline-none select-none data-disabled:text-muted-foreground data-highlighted:bg-muted"
                  >
                    {account.kind === 'header' ? (
                      <AccountLabel
                        code={account.code}
                        name={account.name}
                        kind="header"
                        kindLabel={labels.header}
                      />
                    ) : account.blocked ? (
                      <AccountLabel
                        code={account.code}
                        name={account.name}
                        kind="blocked"
                        kindLabel={labels.blocked}
                      />
                    ) : (
                      <AccountLabel code={account.code} name={account.name} />
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

export { AccountPicker };
