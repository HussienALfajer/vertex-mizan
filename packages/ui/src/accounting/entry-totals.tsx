import type { CurrencyTotals } from '@vertex-mizan/contracts';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Badge } from '../components/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table';
import { cn } from '../lib/cn';
import { Amount } from './amount';

/** The totals' labels, from the app's i18n. */
export interface EntryTotalsLabels {
  /** The table's accessible name. */
  readonly label: string;
  readonly currency: string;
  readonly debit: string;
  readonly credit: string;
  readonly status: string;
  readonly balanced: string;
  /** Before the residual of an unbalanced currency: "difference". */
  readonly residual: string;
}

type EntryTotalsProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** One row per transaction currency, from the money module's `entryTotals()`. */
  totals: readonly CurrencyTotals[];
  labels: EntryTotalsLabels;
};

/**
 * An entry's live totals per transaction currency (S03 rule 14, ADR 0010 §3): debits, credits and
 * whether the currency balances, written out with its residual, never shown by color alone. The
 * figures come from the money module; nothing is added here. Its status is announced politely as
 * lines change.
 */
function EntryTotals({ totals, labels, className, ...props }: EntryTotalsProps) {
  return (
    <div data-slot="entry-totals" className={cn('min-w-0', className)} {...props}>
      <Table aria-label={labels.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.currency}</TableHead>
            <TableHead numeric>{labels.debit}</TableHead>
            <TableHead numeric>{labels.credit}</TableHead>
            <TableHead>{labels.status}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody aria-live="polite">
          {totals.map((total) => {
            const balanced = total.residualMinor === 0n;
            return (
              <TableRow key={total.currency} data-balanced={balanced}>
                <TableCell>
                  <bdi dir="ltr">{total.currency}</bdi>
                </TableCell>
                <TableCell numeric>
                  <Amount value={total.debitMinor} currency={total.currency} strong />
                </TableCell>
                <TableCell numeric>
                  <Amount value={total.creditMinor} currency={total.currency} strong />
                </TableCell>
                <TableCell>
                  {balanced ? (
                    <Badge tone="success">
                      <CircleCheckIcon aria-hidden="true" />
                      {labels.balanced}
                    </Badge>
                  ) : (
                    <Badge tone="danger">
                      <CircleAlertIcon aria-hidden="true" />
                      {`${labels.residual} `}
                      <Amount value={total.residualMinor} currency={total.currency} />
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export { EntryTotals, type EntryTotalsProps };
