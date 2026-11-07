'use client';

import type { CurrencyCode } from '@vertex-mizan/contracts';
import { ChevronDownIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/table';
import { cn } from '../lib/cn';
import { Amount } from './amount';

/**
 * A bucket column: its id (a key of each row's `amounts`) and its heading; a range of days is
 * given as an LTR isolate by the app, so `1–30` and `61–90` read alike in RTL.
 */
export interface AgeingBucketColumn {
  readonly id: string;
  readonly label: ReactNode;
}

/** The amounts of a row or of the totals, in the table's currency. */
export interface AgeingAmounts {
  /** Minor units per bucket id; a bucket missing is zero. */
  readonly amounts: Readonly<Record<string, bigint>>;
  readonly totalMinor: bigint;
}

/** One row (a client): its label, its buckets and total, and what it opens to. */
export interface AgeingTableRow extends AgeingAmounts {
  readonly key: string;
  /** The row's name, such as the client with a link to its statement. */
  readonly label: ReactNode;
  /** The drill-down shown when the row is opened (the client's items); none for no button. */
  readonly detail?: ReactNode;
}

/** The table's labels, from the app's i18n. */
export interface AgeingTableLabels {
  /** The first column's heading ("العميل"). */
  readonly row: string;
  /** The total column and the totals row ("الإجمالي"). */
  readonly total: string;
  /** The open button's name, followed by the row's position ("عرض البنود"). */
  readonly showDetail: string;
}

/**
 * An ageing table (S04 "Screens", ADR 0010 §7): one row per client with an amount per bucket and
 * a total, in one currency, a totals row under a double rule, and each row opening to its detail
 * (its items) below it. From tablet width a table; on a phone one card per row with its buckets
 * stacked, which opens the same way. Buckets, rows and labels come in as props; every figure goes
 * through `Amount`.
 */
function AgeingTable({
  caption,
  buckets,
  rows,
  totals,
  currency,
  labels,
  className,
}: {
  /** The table's accessible name (the report and its date). */
  caption: string;
  buckets: readonly AgeingBucketColumn[];
  rows: readonly AgeingTableRow[];
  totals: AgeingAmounts;
  currency: CurrencyCode;
  labels: AgeingTableLabels;
  className?: string | undefined;
}) {
  const id = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const amountOf = (row: AgeingAmounts, bucket: string) => row.amounts[bucket] ?? 0n;
  const detailId = (index: number) => `${id}-detail-${index}`;

  const opener = (row: AgeingTableRow, index: number) =>
    row.detail === undefined ? null : (
      <button
        type="button"
        aria-expanded={open.has(row.key)}
        aria-controls={detailId(index)}
        aria-label={`${labels.showDetail} ${index + 1}`}
        onClick={() => toggle(row.key)}
        data-slot="ageing-table-toggle"
        className="flex size-hit shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground"
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            'size-icon transition-transform duration-150',
            !open.has(row.key) && 'rtl:rotate-90 ltr:-rotate-90',
          )}
        />
      </button>
    );

  return (
    <div data-slot="ageing-table" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="max-md:hidden">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.row}</TableHead>
              {buckets.map((bucket) => (
                <TableHead key={bucket.id} numeric>
                  {bucket.label}
                </TableHead>
              ))}
              <TableHead numeric>{labels.total}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.flatMap((row, index) => {
              const shown = open.has(row.key) && row.detail !== undefined;
              return [
                <TableRow key={row.key} data-slot="ageing-table-row">
                  <TableHead scope="row" className="font-normal text-foreground">
                    <span className="flex items-center gap-1">
                      {opener(row, index)}
                      <span className="min-w-0">{row.label}</span>
                    </span>
                  </TableHead>
                  {buckets.map((bucket) => (
                    <TableCell key={bucket.id} numeric>
                      <Amount value={amountOf(row, bucket.id)} currency={currency} zero="dash" />
                    </TableCell>
                  ))}
                  <TableCell numeric>
                    <Amount value={row.totalMinor} currency={currency} strong />
                  </TableCell>
                </TableRow>,
                shown ? (
                  <tr key={`${row.key}-detail`} id={detailId(index)} className="bg-muted/30">
                    <td colSpan={buckets.length + 2} className="px-cell py-2">
                      {row.detail}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            <TableRow
              data-slot="ageing-table-totals"
              className="border-t border-foreground hover:bg-transparent"
            >
              <TableHead scope="row" className="text-foreground">
                {labels.total}
              </TableHead>
              {buckets.map((bucket) => (
                <TableCell key={bucket.id} numeric>
                  <GrandTotal value={amountOf(totals, bucket.id)} currency={currency} />
                </TableCell>
              ))}
              <TableCell numeric>
                <GrandTotal value={totals.totalMinor} currency={currency} />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <ol className="flex flex-col gap-3 md:hidden" aria-label={caption}>
        {rows.map((row, index) => (
          <li
            key={row.key}
            data-slot="ageing-table-card"
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 font-medium">
                {opener(row, index)}
                <span className="min-w-0">{row.label}</span>
              </span>
              <Amount value={row.totalMinor} currency={currency} strong />
            </div>
            <BucketList buckets={buckets} row={row} currency={currency} />
            {open.has(row.key) && row.detail !== undefined && (
              <div id={detailId(index)} className="mt-3 border-t border-border pt-3">
                {row.detail}
              </div>
            )}
          </li>
        ))}
        <li
          data-slot="ageing-table-card"
          className="rounded-lg border border-foreground bg-surface p-4"
        >
          <div className="flex items-center justify-between gap-2 font-bold">
            <span>{labels.total}</span>
            <GrandTotal value={totals.totalMinor} currency={currency} />
          </div>
          <BucketList buckets={buckets} row={totals} currency={currency} />
        </li>
      </ol>
    </div>
  );
}

/** A grand total: bold, under a double rule (ADR 0010 §3). */
function GrandTotal({ value, currency }: { value: bigint; currency: CurrencyCode }) {
  return (
    <span className="inline-block border-b-[3px] border-double border-foreground">
      <Amount value={value} currency={currency} strong />
    </span>
  );
}

/** A card's buckets, stacked: each bucket's heading and amount on one line. */
function BucketList({
  buckets,
  row,
  currency,
}: {
  buckets: readonly AgeingBucketColumn[];
  row: AgeingAmounts;
  currency: CurrencyCode;
}) {
  return (
    <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-control">
      {buckets.map((bucket) => (
        <div key={bucket.id} className="contents">
          <dt className="text-muted-foreground">{bucket.label}</dt>
          <dd>
            <Amount value={row.amounts[bucket.id] ?? 0n} currency={currency} zero="dash" />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export { AgeingTable };
