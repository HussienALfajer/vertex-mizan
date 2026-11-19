import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CurrencyCode,
  cancelMovementSchema,
  type Movement,
  movementSchema,
  PROJECT_MOVEMENT_KINDS,
  type ProjectMovementKind,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  type DateRange,
  DateRangeField,
  EmptyState,
  isDateRangeOrdered,
  SelectField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { useState } from 'react';
import { ReasonDialog } from '../../components/reason-dialog';
import { api } from '../../lib/api';
import { formatDay, formatEntryNumber } from '../../lib/format';
import { MOVEMENT_CURRENCIES, movementsQuery, refreshBooks } from '../../lib/movements';
import { KindBadge } from './figures';

const t = ar.movements.list;

/** A movement's number, `2026/12`: numbered per fiscal year, which starts in January here. */
export const movementNumber = (movement: Movement) => formatEntryNumber(movement, 1);

/**
 * Movements in a table, newest first (S13 screen 4): number, date, kind, description, material and
 * amount; a cancelled one stays, marked, with its reason. `onCancel` adds the cancel action.
 */
export function MovementTable({
  movements,
  bookCurrency,
  showProject = false,
  onCancel,
}: {
  movements: readonly Movement[];
  bookCurrency: CurrencyCode;
  showProject?: boolean;
  onCancel?: ((movement: Movement) => void) | undefined;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.columns.number}</TableHead>
          <TableHead>{t.columns.date}</TableHead>
          <TableHead>{t.columns.kind}</TableHead>
          {showProject && <TableHead>{t.columns.project}</TableHead>}
          <TableHead>{t.columns.description}</TableHead>
          <TableHead numeric>{t.columns.amount}</TableHead>
          <TableHead numeric>{t.columns.book}</TableHead>
          {onCancel && (
            <TableHead>
              <span className="sr-only">{t.columns.actions}</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {movements.map((movement) => {
          const cancelled = movement.cancellation !== null;
          return (
            <TableRow key={movement.id} data-cancelled={cancelled || undefined}>
              <TableCell>
                <bdi dir="ltr">{movementNumber(movement)}</bdi>
              </TableCell>
              <TableCell>{formatDay(movement.date)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1">
                  <KindBadge kind={movement.kind} />
                  {cancelled && <Badge tone="danger">{ar.movements.cancelled}</Badge>}
                </div>
              </TableCell>
              {showProject && <TableCell>{movement.project?.name ?? '—'}</TableCell>}
              <TableCell className="min-w-48 whitespace-normal">
                <span className={cancelled ? 'text-muted-foreground line-through' : undefined}>
                  {movement.description}
                </span>
                {movement.party && (
                  <span className="block text-muted-foreground">{movement.party.name}</span>
                )}
                {movement.material && (
                  <span className="block text-muted-foreground">
                    {movement.material.name}: <bdi dir="ltr">{movement.material.quantity}</bdi>{' '}
                    {movement.material.unit} {t.quantityOf}{' '}
                    <bdi dir="ltr">{movement.material.unitPrice}</bdi>
                  </span>
                )}
                {movement.cancellation && (
                  <span className="block text-muted-foreground">
                    {t.cancelledOn} {formatDay(movement.cancellation.on)}:{' '}
                    {movement.cancellation.reason}
                  </span>
                )}
              </TableCell>
              <TableCell numeric>
                <Amount
                  value={BigInt(movement.amountMinor)}
                  currency={movement.currency}
                  showCurrency
                />
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(movement.bookMinor)} currency={bookCurrency} />
              </TableCell>
              {onCancel && (
                <TableCell>
                  {!cancelled && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${t.cancel} ${movementNumber(movement)}`}
                      onClick={() => onCancel(movement)}
                    >
                      {t.cancel}
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * A project's movements with their filters (kind, currency, dates), by pages, each cancellable
 * with a reason when the person may post (S13 rule 8).
 */
export function ProjectMovements({
  companyId,
  projectId,
  bookCurrency,
  canCancel,
}: {
  companyId: string;
  projectId: string;
  bookCurrency: CurrencyCode;
  canCancel: boolean;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ProjectMovementKind | 'all'>('all');
  const [currency, setCurrency] = useState<CurrencyCode | 'all'>('all');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [cancelling, setCancelling] = useState<Movement | null>(null);
  const ordered = isDateRangeOrdered(range);
  const filtered = kind !== 'all' || currency !== 'all' || range.from !== '' || range.to !== '';
  const list = useInfiniteQuery({
    ...movementsQuery(companyId, {
      project: projectId,
      kind: kind === 'all' ? undefined : kind,
      currency: currency === 'all' ? undefined : currency,
      from: ordered ? range.from : undefined,
      to: ordered ? range.to : undefined,
    }),
  });
  const movements = list.data?.pages.flatMap((page) => page.movements) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,12rem))_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
        <SelectField
          label={t.kind}
          value={kind}
          options={[
            { value: 'all' as const, label: t.allKinds },
            ...PROJECT_MOVEMENT_KINDS.filter((value) => value !== 'deposit').map((value) => ({
              value,
              label: ar.movements.kinds[value],
            })),
          ]}
          onValueChange={setKind}
        />
        <SelectField
          label={t.currency}
          value={currency}
          options={[
            { value: 'all' as const, label: t.allCurrencies },
            ...MOVEMENT_CURRENCIES.map((value) => ({
              value,
              label: ar.accounting.currencies[value],
            })),
          ]}
          onValueChange={setCurrency}
        />
        <DateRangeField
          className="sm:col-span-2 lg:col-span-1"
          value={range}
          onValueChange={setRange}
          label={t.range}
          fromLabel={t.from}
          toLabel={t.to}
          orderError={t.rangeOrder}
        />
      </div>
      {filtered && (
        <Button
          variant="link"
          size="sm"
          className="w-fit px-0"
          onClick={() => {
            setKind('all');
            setCurrency('all');
            setRange({ from: '', to: '' });
          }}
        >
          {t.clear}
        </Button>
      )}
      {list.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
          <Skeleton className="h-row w-full" />
        </div>
      ) : list.isError ? (
        <EmptyState
          title={ar.common.errorTitle}
          description={ar.common.errorDescription}
          action={
            <Button variant="outline" onClick={() => void list.refetch()}>
              {ar.common.retry}
            </Button>
          }
        />
      ) : movements.length === 0 ? (
        <EmptyState
          title={filtered ? t.noMatch : t.empty}
          description={filtered ? undefined : t.emptyHint}
        />
      ) : (
        <>
          <MovementTable
            movements={movements}
            bookCurrency={bookCurrency}
            onCancel={canCancel ? setCancelling : undefined}
          />
          {list.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t.more}
            </Button>
          )}
        </>
      )}
      <ReasonDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
        title={`${t.cancelTitle} ${cancelling ? movementNumber(cancelling) : ''}`}
        description={t.cancelDescription}
        reasonLabel={t.cancelReason}
        submitLabel={t.cancelSubmit}
        destructive
        schema={cancelMovementSchema}
        maxLength={500}
        lengthError={ar.movements.dialog.tooLong}
        onConfirm={(reason) =>
          api('POST', `/movements/${cancelling?.id}/cancel`, {
            company: companyId,
            body: { reason },
            schema: movementSchema,
          })
        }
        onDone={() => refreshBooks(queryClient, companyId)}
      />
    </div>
  );
}
