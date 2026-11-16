import type { CurrencyCode } from '@vertex-mizan/contracts';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Amount } from './amount';

/** The figures of a billing, in minor units of its currency; null before the preview gives one. */
export interface BillingFigures {
  readonly cumulativeMinor: bigint | null;
  readonly previousMinor: bigint | null;
  readonly periodMinor: bigint | null;
  readonly retentionMinor: bigint | null;
  readonly recoveryMinor: bigint | null;
  readonly netMinor: bigint | null;
}

/** The summary's labels, from the app's i18n. */
export interface BillingSummaryLabels {
  readonly cumulative: string;
  readonly previous: string;
  readonly period: string;
  readonly retention: string;
  readonly recovery: string;
  readonly net: string;
  /** What a figure not yet known reads as ("—" is shown, this is read out). */
  readonly unknown: string;
}

/**
 * A progress billing's chain (S12 rules 14–16, 18; ADR 0010 §7): the cumulative certified to date,
 * less the previous billing's, gives the period's value; less the retention and the advance
 * recovery, the net due, under a single rule and in bold. Each figure goes through `Amount` in the
 * billing's currency; a figure the preview has not given yet reads "—". A deduction's rate shows
 * beside its name, and the app may put a field in a deduction's place (`retentionField`,
 * `recoveryField`) so the accountant changes the amount (rule 15). Nothing is computed here.
 */
function BillingSummary({
  currency,
  figures,
  labels,
  retentionRate,
  recoveryRate,
  retentionField,
  recoveryField,
  className,
  ...props
}: Omit<ComponentProps<'dl'>, 'children'> & {
  currency: CurrencyCode;
  figures: BillingFigures;
  labels: BillingSummaryLabels;
  /** The retention's rate as text ("10%"), shown beside its name. */
  retentionRate?: string | undefined;
  recoveryRate?: string | undefined;
  /** A field in place of the retention's figure, for the accountant to change it. */
  retentionField?: ReactNode;
  recoveryField?: ReactNode;
}) {
  const figure = (value: bigint | null, strong = false) =>
    value === null ? (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{labels.unknown}</span>
      </span>
    ) : (
      <Amount value={value} currency={currency} strong={strong} />
    );
  const row = (
    slot: string,
    label: string,
    value: ReactNode,
    options: { rate?: string | undefined; deduction?: boolean; total?: boolean } = {},
  ) => (
    <div
      data-slot={`billing-summary-${slot}`}
      className={cn(
        'flex min-h-row flex-wrap items-center justify-between gap-x-4 gap-y-1 px-cell py-1',
        options.total && 'border-border border-t pt-2 font-semibold',
      )}
    >
      <dt className={cn('flex items-baseline gap-2', options.deduction && 'ps-4')}>
        <span>{label}</span>
        {options.rate !== undefined && (
          <bdi dir="ltr" className="text-muted-foreground text-xs tabular-nums">
            {options.rate}
          </bdi>
        )}
      </dt>
      <dd className="ms-auto text-end">{value}</dd>
    </div>
  );
  return (
    <dl
      data-slot="billing-summary"
      className={cn(
        'flex flex-col rounded-lg border border-border bg-surface py-2 text-control text-surface-foreground',
        className,
      )}
      {...props}
    >
      {row('cumulative', labels.cumulative, figure(figures.cumulativeMinor))}
      {row('previous', labels.previous, figure(figures.previousMinor), { deduction: true })}
      {row('period', labels.period, figure(figures.periodMinor), { total: true })}
      {row('retention', labels.retention, retentionField ?? figure(figures.retentionMinor), {
        rate: retentionRate,
        deduction: true,
      })}
      {row('recovery', labels.recovery, recoveryField ?? figure(figures.recoveryMinor), {
        rate: recoveryRate,
        deduction: true,
      })}
      {row('net', labels.net, figure(figures.netMinor, true), { total: true })}
    </dl>
  );
}

export { BillingSummary };
