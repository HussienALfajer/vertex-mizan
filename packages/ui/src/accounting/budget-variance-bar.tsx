import type { CurrencyCode } from '@vertex-mizan/contracts';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { Amount } from './amount';

/** The bar's fill in twentieths: literal classes, so Tailwind generates each one. */
const FILL = [
  'w-0',
  'w-1/20',
  'w-2/20',
  'w-3/20',
  'w-4/20',
  'w-5/20',
  'w-6/20',
  'w-7/20',
  'w-8/20',
  'w-9/20',
  'w-10/20',
  'w-11/20',
  'w-12/20',
  'w-13/20',
  'w-14/20',
  'w-15/20',
  'w-16/20',
  'w-17/20',
  'w-18/20',
  'w-19/20',
  'w-full',
] as const;

/**
 * The bar's fill for a share used as the report gives it ("64.0", a percentage): the nearest
 * twentieth, at least one twentieth for any spend above zero, the whole bar from 100% on. The
 * share is text with one decimal; it is read as tenths of a percent, never as a float.
 */
export function varianceFillStep(used: string | null): number {
  if (used === null) return 0;
  const match = /^(-?)(\d+)(?:\.(\d))?/.exec(used);
  if (!match || match[1] === '-') return 0;
  const tenths = Number(match[2]) * 10 + Number(match[3] ?? '0');
  if (tenths === 0) return 0;
  // Twentieths of 1000 tenths: 50 tenths a step, rounded half up.
  const step = Math.floor((tenths + 25) / 50);
  return Math.min(20, Math.max(1, step));
}

/** The bar's labels, from the app's i18n. */
export interface BudgetVarianceLabels {
  readonly budget: string;
  readonly actual: string;
  readonly variance: string;
  /** The share's name ("المستخدم"), the meter's accessible name with the row's own. */
  readonly used: string;
  /** Why there is no variance: the terms are in another currency than the ledger's (answer 15). */
  readonly noVariance: string;
}

/**
 * A budget against its actual cost (S12 "Screens", answer 15; ADR 0010 §7): the budget, the actual
 * cost and the variance through `Amount`, and a meter of the share used. A cost over its budget
 * fills the bar and turns it and the variance (budget less cost, below zero) the negative color.
 * Without a variance (terms in another currency than the ledger's), the budget and cost show with
 * the note in its place and no meter. Figures come in computed; nothing is computed here but the
 * bar's twentieth.
 */
function BudgetVarianceBar({
  label,
  currency,
  budgetMinor,
  actualMinor,
  varianceMinor,
  used,
  labels,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  /** The row's name (an account's), part of the meter's name. */
  label: string;
  /** The budget's and variance's currency; the actual cost is in it when a variance is given. */
  currency: CurrencyCode;
  budgetMinor: bigint;
  actualMinor: bigint;
  /** Null when the budget cannot be compared (answer 15). */
  varianceMinor: bigint | null;
  /** The share used as a percentage with one decimal ("64.0"); null without a budget. */
  used: string | null;
  labels: BudgetVarianceLabels;
}) {
  const over = varianceMinor !== null && varianceMinor < 0n;
  const step = varianceFillStep(used);
  return (
    <div
      data-slot="budget-variance-bar"
      data-over={over || undefined}
      className={cn('flex min-w-0 flex-col gap-1.5 text-control', className)}
      {...props}
    >
      <dl className="flex flex-wrap gap-x-5 gap-y-1">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground text-xs">{labels.budget}</dt>
          <dd>
            <Amount value={budgetMinor} currency={currency} />
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground text-xs">{labels.actual}</dt>
          <dd>
            <Amount value={actualMinor} currency={currency} />
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground text-xs">{labels.variance}</dt>
          <dd>
            {varianceMinor === null ? (
              <span className="text-muted-foreground text-xs">{labels.noVariance}</span>
            ) : (
              <Amount value={varianceMinor} currency={currency} strong={over} />
            )}
          </dd>
        </div>
        {varianceMinor !== null && used !== null && (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground text-xs">{labels.used}</dt>
            <dd>
              <bdi dir="ltr" className={cn('tabular-nums', over && 'text-negative')}>
                {`${used}%`}
              </bdi>
            </dd>
          </div>
        )}
      </dl>
      {varianceMinor !== null && used !== null && (
        // biome-ignore lint/a11y/useSemanticElements: a native meter cannot take the brand's fill from the theme's tokens in every engine; the ARIA meter keeps its semantics.
        <div
          role="meter"
          aria-label={`${labels.used}: ${label}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, step * 5)}
          aria-valuetext={`${used}%`}
          className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            data-slot="budget-variance-fill"
            className={cn('h-full rounded-full', FILL[step], over ? 'bg-negative' : 'bg-primary')}
          />
        </div>
      )}
    </div>
  );
}

export { BudgetVarianceBar };
