import type { CurrencyAmount, CurrencyCode, ProjectMovementKind } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Amount, Badge, Card, cn } from '@vertex-mizan/ui';
import type { ReactNode } from 'react';

const t = ar.movements;

/** One figure of the dashboard or a project (S13 "Reports"): its name and its USD amount. */
export function FigureCard({
  label,
  value,
  currency,
  children,
  className,
}: {
  label: string;
  value: string;
  currency: CurrencyCode;
  /** The figure by currency, or a note, under it. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('min-w-0 gap-2 p-4', className)}>
      <p className="text-control text-muted-foreground">{label}</p>
      <Amount value={BigInt(value)} currency={currency} showCurrency strong className="text-xl" />
      {children}
    </Card>
  );
}

/** A count among the figures (the projects). */
export function CountCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="min-w-0 gap-2 p-4">
      <p className="text-control text-muted-foreground">{label}</p>
      {children}
    </Card>
  );
}

/**
 * An amount held in several currencies (a box, a debt): each in its own currency, with what it is
 * worth in the book currency beside it.
 */
export function ByCurrency({
  amounts,
  bookCurrency,
  empty = t.figures.none,
}: {
  amounts: readonly CurrencyAmount[];
  bookCurrency: CurrencyCode;
  empty?: string;
}) {
  const shown = amounts.filter((amount) => amount.amountMinor !== '0');
  if (shown.length === 0) return <p className="text-control text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 text-control">
      {shown.map((amount) => (
        <li key={amount.currency} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <Amount value={BigInt(amount.amountMinor)} currency={amount.currency} showCurrency />
          {amount.currency !== bookCurrency && (
            <span className="text-muted-foreground">
              <Amount value={BigInt(amount.bookMinor)} currency={bookCurrency} showCurrency />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const kindTones: Record<ProjectMovementKind, 'success' | 'info' | 'warning' | 'neutral' | 'gold'> =
  {
    received: 'success',
    debt_collected: 'success',
    owed_to_us: 'info',
    expense: 'warning',
    wages: 'warning',
    debt_paid: 'warning',
    owed_by_us: 'gold',
    deposit: 'neutral',
  };

/** A movement's kind, colored by what it does to the project's money. */
export function KindBadge({ kind }: { kind: ProjectMovementKind }) {
  return <Badge tone={kindTones[kind]}>{t.kinds[kind]}</Badge>;
}
