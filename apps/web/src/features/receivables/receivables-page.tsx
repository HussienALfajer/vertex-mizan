import { useMutation, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  AGEING_BUCKETS,
  type AgeingClient,
  type AgeingCurrencyTotal,
  type BucketAmounts,
  type Ledger,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  AgeingTable,
  type AgeingTableRow,
  Amount,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DimensionPicker,
  EmptyState,
  Field,
  FieldLabel,
  Input,
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
import { DownloadIcon, ReceiptTextIcon, WalletIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { download } from '../../lib/api';
import { damascusToday, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import { dimensionPickerLabels, pickerValues } from '../entries/entry-parts';
import {
  AdjustedBadge,
  ageingBuckets,
  bucketLabel,
  ClientName,
  hasRunningAccount,
  ItemLink,
  ReportLedgerSwitch,
  useClients,
} from './receivables-parts';
import { ageingQuery, openItemsQuery, searchOf } from './receivables-queries';

const t = ar.openItems;
const route = getRouteApi('/_app/_company/receivables/');

/** A bucket row of the API as the table's amounts. */
function amountsOf(buckets: BucketAmounts): Record<string, bigint> {
  return Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, BigInt(buckets[bucket])]));
}

/**
 * `/receivables` (S04 "Screens", rule 16): the ageing as of a date, one row per client with the
 * six buckets and a total in the selected ledger, each opening to its items; the totals per
 * transaction currency under it; filters by account and client; the Excel export. `find` (from the
 * palette) opens the client-statement or the go-to-item finder.
 */
export function ReceivablesPage() {
  const { find } = route.useSearch();
  const navigate = useNavigate();
  const { companyId } = useCompany();
  const accounts = useQuery(accountsQuery(companyId));
  const clients = useClients(companyId);
  const [asOf, setAsOf] = useState(damascusToday);
  const [ledger, setLedger] = useState<Ledger>('book');
  const [account, setAccount] = useState('all');
  const [client, setClient] = useState<string | null>(null);
  const query = {
    asOf: asOf || undefined,
    ledger,
    accounts: account === 'all' ? undefined : account,
    client: client ?? undefined,
  };
  const ageing = useQuery({ ...ageingQuery(companyId, query), enabled: asOf !== '' });
  const exportFile = useMutation({
    mutationFn: () =>
      download(`/receivables/ageing/export${searchOf(query)}`, { company: companyId }),
  });
  const documentAccounts = (accounts.data ?? []).filter(
    (candidate) =>
      candidate.itemKind === 'document' && candidate.class === 'asset' && !candidate.archived,
  );
  const accountOptions = [
    { value: 'all', label: t.ageing.allAccounts },
    ...documentAccounts.map((candidate) => ({
      value: candidate.id,
      label: `${candidate.code} ${candidate.name}`,
    })),
  ];
  const report = ageing.data;
  const closeFinder = () => void navigate({ to: '/receivables', search: {}, replace: true });

  return (
    <>
      <PageHeader
        title={t.ageing.title}
        description={t.ageing.description}
        actions={
          <div className="flex flex-wrap gap-2">
            {hasRunningAccount(accounts.data) && (
              <Button variant="outline" render={<Link to="/client-funds" />}>
                <WalletIcon aria-hidden="true" />
                {t.ageing.clientFunds}
              </Button>
            )}
            <Button
              variant="outline"
              loading={exportFile.isPending}
              disabled={!report}
              onClick={() => exportFile.mutate()}
            >
              <DownloadIcon aria-hidden="true" />
              {t.ageing.exportExcel}
            </Button>
          </div>
        }
      />
      <FormError error={exportFile.error} />
      <Card className="p-4">
        <search aria-label={t.ageing.filters} className="grid gap-4 md:grid-cols-3">
          <Field>
            <FieldLabel>{t.ageing.asOf}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
            />
          </Field>
          <SelectField
            label={t.ageing.accounts}
            value={account}
            options={accountOptions}
            onValueChange={setAccount}
          />
          <DimensionPicker
            label={t.ageing.client}
            values={pickerValues(clients.values)}
            value={client}
            labels={dimensionPickerLabels}
            onValueChange={setClient}
          />
        </search>
      </Card>
      <ReportLedgerSwitch companyId={companyId} value={ledger} onValueChange={setLedger} />
      {asOf === '' ? null : ageing.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : ageing.isError ? (
        <FormError error={ageing.error} />
      ) : report && report.clients.length === 0 ? (
        <EmptyState
          icon={<ReceiptTextIcon />}
          title={t.ageing.emptyTitle}
          description={t.ageing.emptyDescription}
        />
      ) : report ? (
        <>
          <AgeingTable
            caption={`${t.ageing.caption} ${formatDay(report.asOf)}`}
            buckets={ageingBuckets}
            rows={report.clients.map((row) => clientRow(row, report.ledgerCurrency))}
            totals={{ amounts: amountsOf(report.buckets), totalMinor: BigInt(report.totalMinor) }}
            currency={report.ledgerCurrency}
            labels={t.ageingTable}
          />
          <CurrencyTotals totals={report.currencyTotals} />
        </>
      ) : null}
      <ClientFinder
        open={find === 'client'}
        clients={pickerValues(clients.values)}
        onClose={closeFinder}
        onChoose={(valueId) =>
          void navigate({ to: '/receivables/clients/$valueId', params: { valueId } })
        }
      />
      <ItemFinder
        open={find === 'item'}
        companyId={companyId}
        onClose={closeFinder}
        onChoose={(id) => void navigate({ to: '/open-items/$id', params: { id } })}
      />
    </>
  );
}

/** A client's row: its name with a link to its statement, its buckets, its items below. */
function clientRow(row: AgeingClient, currency: AgeingCurrencyTotal['currency']): AgeingTableRow {
  return {
    key: row.client?.id ?? 'none',
    label: row.client ? (
      <Link
        to="/receivables/clients/$valueId"
        params={{ valueId: row.client.id }}
        className="underline-offset-4 hover:underline"
      >
        <ClientName client={row.client} />
      </Link>
    ) : (
      <ClientName client={null} />
    ),
    amounts: amountsOf(row.buckets),
    totalMinor: BigInt(row.totalMinor),
    detail: <ClientItems row={row} currency={currency} />,
  };
}

/** A client's items in the ageing: reference, dates, days past due, both amounts. */
function ClientItems({
  row,
  currency,
}: {
  row: AgeingClient;
  currency: AgeingCurrencyTotal['currency'];
}) {
  return (
    <Table aria-label={t.ageing.itemsLabel}>
      <TableHeader>
        <TableRow>
          <TableHead>{t.ageing.reference}</TableHead>
          <TableHead>{t.ageing.account}</TableHead>
          <TableHead>{t.ageing.documentDate}</TableHead>
          <TableHead>{t.ageing.dueOn}</TableHead>
          <TableHead numeric>{t.ageing.daysPastDue}</TableHead>
          <TableHead>{t.ageing.bucket}</TableHead>
          <TableHead numeric>{t.ageing.open}</TableHead>
          <TableHead numeric>{t.ageing.carrying}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {row.items.map((item) => (
          <TableRow key={item.itemId}>
            <TableCell>
              <span className="flex flex-col gap-1">
                <ItemLink id={item.itemId} reference={item.reference} />
                <AdjustedBadge adjusted={item.adjusted} />
              </span>
            </TableCell>
            <TableCell>
              <AccountLabel code={item.account.code} name={item.account.name} />
            </TableCell>
            <TableCell>{formatDay(item.documentDate)}</TableCell>
            <TableCell>{formatDay(item.dueOn)}</TableCell>
            <TableCell numeric>
              <bdi dir="ltr">{item.daysPastDue}</bdi>
            </TableCell>
            <TableCell>{bucketLabel(item.bucket)}</TableCell>
            <TableCell numeric>
              <Amount value={BigInt(item.openMinor)} currency={item.currency} showCurrency />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(item.carryingMinor)} currency={currency} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The totals per transaction currency, under the ageing (rule 16). */
function CurrencyTotals({ totals }: { totals: readonly AgeingCurrencyTotal[] }) {
  if (totals.length === 0) return null;
  return (
    <section aria-labelledby="currency-totals" className="flex min-w-0 flex-col gap-3">
      <h2 id="currency-totals" className="text-lg font-bold">
        {t.ageing.currencyTotals}
      </h2>
      <Table aria-label={t.ageing.currencyTotalsLabel}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.ageing.currency}</TableHead>
            {ageingBuckets.map((bucket) => (
              <TableHead key={bucket.id} numeric>
                {bucket.label}
              </TableHead>
            ))}
            <TableHead numeric>{t.ageingTable.total}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals.map((total) => (
            <TableRow key={total.currency}>
              <TableCell>
                <bdi dir="ltr">{total.currency}</bdi>
              </TableCell>
              {AGEING_BUCKETS.map((bucket) => (
                <TableCell key={bucket} numeric>
                  <Amount
                    value={BigInt(total.buckets[bucket])}
                    currency={total.currency}
                    zero="dash"
                  />
                </TableCell>
              ))}
              <TableCell numeric>
                <Amount value={BigInt(total.totalMinor)} currency={total.currency} strong />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** The palette's "client statement…": choose a client, open its statement. */
function ClientFinder({
  open,
  clients,
  onClose,
  onChoose,
}: {
  open: boolean;
  clients: ReturnType<typeof pickerValues>;
  onClose: () => void;
  onChoose: (valueId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <DialogHeader>
          <DialogTitle>{t.find.clientTitle}</DialogTitle>
          <DialogDescription>{t.find.clientDescription}</DialogDescription>
        </DialogHeader>
        <DimensionPicker
          label={t.ageing.client}
          values={clients}
          value={null}
          labels={dimensionPickerLabels}
          onValueChange={(id) => id && onChoose(id)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The palette's "go to item…": items found by reference, in every state; one opens its page. */
function ItemFinder({
  open,
  companyId,
  onClose,
  onChoose,
}: {
  open: boolean;
  companyId: string;
  onClose: () => void;
  onChoose: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const typed = text.trim();
  const found = useQuery({
    ...openItemsQuery(companyId, { state: 'all', text: typed }),
    enabled: open && typed !== '',
  });
  const items = found.data?.items ?? [];
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <DialogHeader>
          <DialogTitle>{t.find.itemTitle}</DialogTitle>
          <DialogDescription>{t.find.itemDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const first = items[0];
            if (first) onChoose(first.id);
          }}
        >
          <Field>
            <FieldLabel>{t.find.reference}</FieldLabel>
            <Input
              type="search"
              value={text}
              maxLength={100}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          {typed === '' ? null : found.isPending ? (
            <p className="text-muted-foreground">{t.find.searching}</p>
          ) : found.isError ? (
            <FormError error={found.error} />
          ) : items.length === 0 ? (
            <p className="text-muted-foreground">{t.find.noMatch}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <li key={item.id}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-between gap-3 py-1"
                    onClick={() => onChoose(item.id)}
                  >
                    <span className="flex flex-col items-start">
                      <bdi className="font-medium">{item.reference}</bdi>
                      <span className="text-xs text-muted-foreground">
                        <ClientName client={item.client} />
                        {` · ${t.states[item.state]}`}
                      </span>
                    </span>
                    <Amount
                      value={BigInt(item.amounts.openMinor)}
                      currency={item.currency}
                      showCurrency
                    />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
