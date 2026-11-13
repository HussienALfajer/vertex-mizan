'use client';

import type { CurrencyCode } from '@vertex-mizan/contracts';
import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, type BadgeProps } from '../components/badge';
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

/** Whether two sources' figures agree: equal, different, or one not entered yet. */
type AgreementStatus = 'agrees' | 'differs' | 'missing';

/** One pair of figures: a party (a client) and a currency, on a group (an account). */
interface AgreementRow {
  readonly key: string;
  /** The group the pair belongs to ("الذمم المدينة"). */
  readonly group: ReactNode;
  /** The party ("عميل تجريبي"), a name people typed, given as a `<bdi>` by the app. */
  readonly label: ReactNode;
  readonly currency: CurrencyCode;
  /** The first source's figure (the old records), in minor units; null when not entered. */
  readonly recordsMinor: bigint | null;
  /** The second source's figure (Hub's items), in minor units. */
  readonly hubMinor: bigint;
  /** The records' figure less Hub's, from the money logic; null when not known. */
  readonly differenceMinor: bigint | null;
  readonly status: AgreementStatus;
  /** An input in place of the records' figure, when the app lets it be typed. */
  readonly records?: ReactNode;
}

/** The table's labels, from the app's i18n. */
interface AgreementTableLabels {
  readonly group: string;
  readonly row: string;
  readonly currency: string;
  readonly records: string;
  readonly hub: string;
  readonly difference: string;
  readonly status: string;
  readonly statuses: Readonly<Record<AgreementStatus, string>>;
}

const looks = {
  agrees: { tone: 'success', Icon: CircleCheckIcon },
  differs: { tone: 'danger', Icon: CircleAlertIcon },
  missing: { tone: 'warning', Icon: CircleDashedIcon },
} as const satisfies Record<
  AgreementStatus,
  { tone: NonNullable<BadgeProps['tone']>; Icon: typeof CircleCheckIcon }
>;

function StatusBadge({ status, label }: { status: AgreementStatus; label: string }) {
  const { tone, Icon } = looks[status];
  return (
    <Badge tone={tone} data-status={status}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

/**
 * Two sources' figures side by side per party and currency (S10 "Screens" step 3, ADR 0010 §7):
 * the old records' figure, Hub's, the difference and whether they agree, the status as an icon and
 * words, never color alone. The records' figure may be an input the app gives. From tablet width
 * a table; on a phone one card per pair with its figures stacked. Every figure goes through
 * `Amount`; a difference not known is a dash.
 */
function AgreementTable({
  caption,
  rows,
  labels,
  empty,
  className,
}: {
  /** The table's accessible name. */
  caption: string;
  rows: readonly AgreementRow[];
  labels: AgreementTableLabels;
  /** Shown when there is no pair. */
  empty?: ReactNode;
  className?: string | undefined;
}) {
  if (rows.length === 0 && empty !== undefined) {
    return (
      <div
        data-slot="agreement-table"
        className={cn('text-control text-muted-foreground', className)}
      >
        {empty}
      </div>
    );
  }
  const records = (row: AgreementRow) =>
    row.records ??
    (row.recordsMinor === null ? (
      <span aria-hidden="true">—</span>
    ) : (
      <Amount value={row.recordsMinor} currency={row.currency} />
    ));
  const difference = (row: AgreementRow) =>
    row.differenceMinor === null ? (
      <span aria-hidden="true">—</span>
    ) : (
      <Amount
        value={row.differenceMinor}
        currency={row.currency}
        strong={row.status === 'differs'}
      />
    );
  return (
    <div data-slot="agreement-table" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="max-md:hidden">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.group}</TableHead>
              <TableHead>{labels.row}</TableHead>
              <TableHead>{labels.currency}</TableHead>
              <TableHead numeric>{labels.records}</TableHead>
              <TableHead numeric>{labels.hub}</TableHead>
              <TableHead numeric>{labels.difference}</TableHead>
              <TableHead>{labels.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} data-slot="agreement-table-row" data-status={row.status}>
                <TableCell>{row.group}</TableCell>
                <TableHead scope="row" className="font-normal text-foreground">
                  {row.label}
                </TableHead>
                <TableCell>
                  <bdi dir="ltr">{row.currency}</bdi>
                </TableCell>
                <TableCell numeric>{records(row)}</TableCell>
                <TableCell numeric>
                  <Amount value={row.hubMinor} currency={row.currency} />
                </TableCell>
                <TableCell numeric>{difference(row)}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} label={labels.statuses[row.status]} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ol className="flex flex-col gap-3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li
            key={row.key}
            data-slot="agreement-table-card"
            data-status={row.status}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 font-medium">{row.label}</span>
              <StatusBadge status={row.status} label={labels.statuses[row.status]} />
            </div>
            <span className="text-muted-foreground text-xs">
              {row.group} · <bdi dir="ltr">{row.currency}</bdi>
            </span>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-control">
              <dt className="text-muted-foreground">{labels.records}</dt>
              <dd className="text-end">{records(row)}</dd>
              <dt className="text-muted-foreground">{labels.hub}</dt>
              <dd className="text-end">
                <Amount value={row.hubMinor} currency={row.currency} />
              </dd>
              <dt className="text-muted-foreground">{labels.difference}</dt>
              <dd className="text-end">{difference(row)}</dd>
            </dl>
          </li>
        ))}
      </ol>
    </div>
  );
}

export { type AgreementRow, type AgreementStatus, AgreementTable, type AgreementTableLabels };
