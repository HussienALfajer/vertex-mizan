import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ClientFunds, Ledger } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Badge,
  Card,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { WalletIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { damascusToday } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import {
  ClientName,
  hasRunningAccount,
  ReceivablesBackLink,
  ReportLedgerSwitch,
} from './receivables-parts';
import { clientFundsQuery } from './receivables-queries';

const t = ar.openItems.funds;

/**
 * `/client-funds` (S04 "Screens", rule 17): each client's running item per currency at a date,
 * with the balance and both ledgers' carrying amounts; a debit balance is marked "مستحق من
 * العميل" and never netted against other clients. The ageing links here only when the chart has
 * a running account; without one the page says there is nothing to show.
 */
export function ClientFundsPage() {
  const { companyId } = useCompany();
  const accounts = useQuery(accountsQuery(companyId));
  const [asOf, setAsOf] = useState(damascusToday);
  const [ledger, setLedger] = useState<Ledger>('book');
  const running = hasRunningAccount(accounts.data);
  const funds = useQuery({
    ...clientFundsQuery(companyId, { asOf: asOf || undefined, ledger }),
    enabled: running && asOf !== '',
  });

  if (accounts.data && !running) {
    return (
      <>
        <ReceivablesBackLink />
        <EmptyState icon={<WalletIcon />} title={t.noRunning} />
      </>
    );
  }
  return (
    <>
      <PageHeader back={<ReceivablesBackLink />} title={t.title} description={t.description} />
      <Card className="p-4">
        <Field className="max-w-60">
          <FieldLabel>{t.asOf}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
          />
        </Field>
      </Card>
      <ReportLedgerSwitch companyId={companyId} value={ledger} onValueChange={setLedger} />
      {asOf === '' ? null : accounts.isError || funds.isError ? (
        // A failed chart read leaves the funds query disabled, so the error comes first.
        <FormError error={accounts.error ?? funds.error} />
      ) : accounts.isPending || funds.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : funds.data.funds.length === 0 ? (
        <EmptyState icon={<WalletIcon />} title={t.empty} />
      ) : (
        <FundsTable funds={funds.data} />
      )}
    </>
  );
}

function FundsTable({ funds }: { funds: ClientFunds }) {
  const ledgerCurrency =
    funds.ledger === 'parallel' && funds.parallelCurrency
      ? funds.parallelCurrency
      : funds.bookCurrency;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Table aria-label={t.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.client}</TableHead>
            <TableHead>{t.account}</TableHead>
            <TableHead numeric>{t.balance}</TableHead>
            <TableHead numeric>
              {`${t.book} `}
              <bdi dir="ltr">{funds.bookCurrency}</bdi>
            </TableHead>
            {funds.parallelCurrency && (
              <TableHead numeric>
                {`${t.parallel} `}
                <bdi dir="ltr">{funds.parallelCurrency}</bdi>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {funds.funds.map((fund) => (
            <TableRow key={fund.itemId}>
              <TableCell>
                <span className="flex flex-col items-start gap-1">
                  <Link
                    to="/receivables/clients/$valueId"
                    params={{ valueId: fund.client.id }}
                    className="underline-offset-4 hover:underline"
                  >
                    <ClientName client={fund.client} />
                  </Link>
                  {fund.receivable && (
                    <Badge tone="warning">{ar.openItems.labels.receivable}</Badge>
                  )}
                </span>
              </TableCell>
              <TableCell>
                <AccountLabel code={fund.account.code} name={fund.account.name} />
              </TableCell>
              <TableCell numeric>
                <Amount
                  value={BigInt(fund.amounts.openMinor)}
                  currency={fund.currency}
                  showCurrency
                />
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(fund.amounts.bookMinor)} currency={funds.bookCurrency} />
              </TableCell>
              {funds.parallelCurrency && (
                <TableCell numeric>
                  {fund.amounts.parallelMinor !== null && (
                    <Amount
                      value={BigInt(fund.amounts.parallelMinor)}
                      currency={funds.parallelCurrency}
                    />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{t.held}</dt>
          <dd>
            <Amount value={BigInt(funds.heldMinor)} currency={ledgerCurrency} showCurrency strong />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{t.receivable}</dt>
          <dd>
            <Amount
              value={BigInt(funds.receivableMinor)}
              currency={ledgerCurrency}
              showCurrency
              strong
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}
