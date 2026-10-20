'use client';

import type { CurrencyCode, Ledger } from '@vertex-mizan/contracts';
import { ToggleGroup, ToggleGroupItem } from '../components/toggle-group';

type LedgerOption = { label: string; currency: CurrencyCode };

type LedgerSwitchProps = {
  value: Ledger;
  onValueChange: (ledger: Ledger) => void;
  /** The book ledger, and the parallel one when the company keeps it. */
  ledgers: { book: LedgerOption; parallel?: LedgerOption };
  /** The group's accessible name, from i18n (`accounting.ledger.label`). */
  label: string;
  className?: string;
};

/**
 * The book ledger or the parallel ledger, on every report (ADR 0009): each option names its
 * currency. A company without a parallel ledger sees no switch.
 */
function LedgerSwitch({ value, onValueChange, ledgers, label, className }: LedgerSwitchProps) {
  const { book, parallel } = ledgers;
  if (!parallel) return null;
  return (
    <ToggleGroup<Ledger>
      data-slot="ledger-switch"
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        // A pressed option stays pressed: one ledger is always shown.
        const [ledger] = next;
        if (ledger) onValueChange(ledger);
      }}
      className={className}
    >
      {(['book', 'parallel'] as const).map((ledger) => {
        const option = ledger === 'book' ? book : parallel;
        return (
          <ToggleGroupItem key={ledger} value={ledger}>
            {option.label}
            <bdi dir="ltr" className="font-medium tabular-nums">
              {option.currency}
            </bdi>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

export { LedgerSwitch, type LedgerSwitchProps };
