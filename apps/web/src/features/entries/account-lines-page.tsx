import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import {
  type AccountLine,
  CURRENCY_CODES,
  type CurrencyCode,
  type LineBalances,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Badge,
  Button,
  Card,
  type DateRange,
  DateRangeField,
  DimensionPicker,
  EmptyState,
  isDateRangeOrdered,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { FileQuestionIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { hasCode } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import {
  BackLink,
  DimensionNames,
  dimensionPickerLabels,
  EntryNumberText,
  pickerValues,
  useFiscalYearStartMonth,
} from './entry-parts';
import { accountLinesQuery, useDimensionCatalog } from './entry-queries';

const t = ar.entries.lines;
const route = getRouteApi('/_app/_company/accounts/$id/lines');

const currencyOptions = [
  { value: 'any', label: t.anyCurrency },
  ...CURRENCY_CODES.map((code) => ({ value: code, label: code })),
];

/** A balance with its currency, or nothing when the ledger is not kept. */
function BalanceAmount({ value }: { value: LineBalances['book'] | null }) {
  return value ? <Amount value={BigInt(value.amountMinor)} currency={value.currency} /> : null;
}

/**
 * `/accounts/:id/lines` (S03 "Screens"): an account's lines in a date range, oldest first, with
 * the balance before the range and a running balance per ledger; the transaction amount runs
 * once a currency is chosen. Filtered by the account's dimensions; each line opens its entry.
 */
export function AccountLinesPage() {
  const { id } = route.useParams();
  const { companyId } = useCompany();
  const accounts = useQuery(accountsQuery(companyId, true));
  const catalog = useDimensionCatalog(companyId);
  const startMonth = useFiscalYearStartMonth(companyId);
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [currency, setCurrency] = useState<CurrencyCode | 'any'>('any');
  const [dims, setDims] = useState<Record<string, string | null>>({});
  const account = accounts.data?.find((candidate) => candidate.id === id);
  const chosen = Object.values(dims).filter((value): value is string => value !== null);
  const lines = useInfiniteQuery({
    ...accountLinesQuery(companyId, id, {
      ...(range.from ? { from: range.from } : {}),
      ...(range.to ? { to: range.to } : {}),
      ...(currency === 'any' ? {} : { currency }),
      dims: chosen,
    }),
    enabled: isDateRangeOrdered(range),
  });
  const pages = lines.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.lines);
  const opening = pages[0]?.opening;
  const notFound =
    (accounts.data && !account) ||
    hasCode(lines.error, 'NOT_FOUND') ||
    hasCode(lines.error, 'VALIDATION_FAILED');

  if (notFound) {
    return (
      <>
        <BackLink to="/entries" label={ar.entries.entry.back} />
        <EmptyState icon={<FileQuestionIcon />} title={t.notFound} />
      </>
    );
  }
  const dimensionTypes = catalog.types.filter((type) =>
    account?.requiredDimensionTypeIds.includes(type.id),
  );
  return (
    <>
      <PageHeader
        back={<BackLink to="/entries" label={ar.entries.entry.back} />}
        title={
          account ? (
            <span className="flex flex-wrap items-center gap-x-3">
              {t.title}
              <AccountLabel code={account.code} name={account.name} />
            </span>
          ) : (
            t.title
          )
        }
        description={t.description}
      />
      <Card className="p-4">
        <search
          aria-label={ar.entries.filters.label}
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <DateRangeField
            value={range}
            onValueChange={setRange}
            label={ar.entries.filters.range}
            fromLabel={ar.entries.filters.from}
            toLabel={ar.entries.filters.to}
            orderError={ar.entries.filters.order}
            className="md:col-span-2"
          />
          <SelectField
            label={t.currency}
            value={currency}
            options={currencyOptions}
            description={t.currencyHint}
            onValueChange={(value) => setCurrency(value as CurrencyCode | 'any')}
          />
          {dimensionTypes.map((type) => (
            <DimensionPicker
              key={type.id}
              label={type.name}
              values={pickerValues(catalog.valuesOf(type.id))}
              value={dims[type.id] ?? null}
              labels={dimensionPickerLabels}
              onValueChange={(value) => setDims({ ...dims, [type.id]: value })}
            />
          ))}
        </search>
      </Card>
      {lines.isPending || accounts.isPending ? (
        isDateRangeOrdered(range) ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-row" />
            <Skeleton className="h-row" />
          </div>
        ) : null
      ) : lines.isError ? (
        <FormError error={lines.error} />
      ) : (
        <>
          <Table aria-label={t.label}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.entry}</TableHead>
                <TableHead>{t.date}</TableHead>
                <TableHead>{t.statement}</TableHead>
                <TableHead numeric>{t.amount}</TableHead>
                <TableHead numeric>{t.book}</TableHead>
                <TableHead numeric>{t.parallel}</TableHead>
                {currency !== 'any' && <TableHead numeric>{t.transactionBalance}</TableHead>}
                <TableHead numeric>{t.bookBalance}</TableHead>
                <TableHead numeric>{t.parallelBalance}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opening && (
                <TableRow>
                  <TableCell colSpan={6} className="font-medium">
                    {t.opening}
                  </TableCell>
                  {currency !== 'any' && (
                    <TableCell numeric>
                      <BalanceAmount value={opening.transaction} />
                    </TableCell>
                  )}
                  <TableCell numeric>
                    <BalanceAmount value={opening.book} />
                  </TableCell>
                  <TableCell numeric>
                    <BalanceAmount value={opening.parallel} />
                  </TableCell>
                </TableRow>
              )}
              {rows.map((line) => (
                <LineRow
                  key={`${line.entryId}-${line.lineNo}`}
                  line={line}
                  startMonth={startMonth}
                  showTransaction={currency !== 'any'}
                  dimensions={catalog.byId}
                />
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && <EmptyState title={t.empty} />}
          {lines.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit self-center"
              loading={lines.isFetchingNextPage}
              onClick={() => void lines.fetchNextPage()}
            >
              {ar.entries.loadMore}
            </Button>
          )}
        </>
      )}
    </>
  );
}

function LineRow({
  line,
  startMonth,
  showTransaction,
  dimensions,
}: {
  line: AccountLine;
  startMonth: number;
  showTransaction: boolean;
  dimensions: ReturnType<typeof useDimensionCatalog>['byId'];
}) {
  return (
    <TableRow>
      <TableCell>
        <Link
          to="/entries/$id"
          params={{ id: line.entryId }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          <EntryNumberText number={line} startMonth={startMonth} />
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatDay(line.entryDate)}</TableCell>
      <TableCell className="max-w-64">
        <span className="flex flex-col gap-1">
          <bdi className="truncate">{line.description}</bdi>
          {line.kind !== 'measured' && (
            <Badge tone="info" className="w-fit">
              {ar.entries.kinds[line.kind]}
            </Badge>
          )}
          <DimensionNames ids={line.dimensionValueIds} byId={dimensions} />
        </span>
      </TableCell>
      <TableCell numeric>
        <Amount value={BigInt(line.amountMinor)} currency={line.currency} showCurrency />
      </TableCell>
      <TableCell numeric>
        <BalanceAmount
          value={{ amountMinor: line.bookMinor, currency: line.balance.book.currency }}
        />
      </TableCell>
      <TableCell numeric>
        {line.parallelMinor !== null && line.balance.parallel && (
          <BalanceAmount
            value={{ amountMinor: line.parallelMinor, currency: line.balance.parallel.currency }}
          />
        )}
      </TableCell>
      {showTransaction && (
        <TableCell numeric>
          <BalanceAmount value={line.balance.transaction} />
        </TableCell>
      )}
      <TableCell numeric>
        <BalanceAmount value={line.balance.book} />
      </TableCell>
      <TableCell numeric>
        <BalanceAmount value={line.balance.parallel} />
      </TableCell>
    </TableRow>
  );
}
