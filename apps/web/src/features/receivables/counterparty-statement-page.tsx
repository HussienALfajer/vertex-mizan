import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import {
  type ClientStatement,
  CURRENCY_CODES,
  type CurrencyCode,
  type Ledger,
  type StatementBalance,
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
import { FileQuestionIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { hasCode } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { EntryNumberText, useFiscalYearStartMonth } from '../entries/entry-parts';
import { ReportExport } from '../reports/report-parts';
import { paramsOf } from '../reports/reports-queries';
import {
  AdjustedBadge,
  ClientName,
  ItemLink,
  ReceivablesBackLink,
  ReportLedgerSwitch,
} from './receivables-parts';
import { clientStatementQuery, searchOf } from './receivables-queries';

const t = ar.openItems.statement;
const route = getRouteApi('/_app/_company/receivables/clients/$valueId');

const currencyOptions = [
  { value: 'any', label: t.anyCurrency },
  ...CURRENCY_CODES.map((code) => ({ value: code, label: code })),
];

/**
 * `/receivables/clients/:valueId` (S04 "Screens"): the client's items on every control account,
 * the opening balance per item currency, every movement in date then entry-number order with its
 * entry, item, memo and running balances, and the closing balance; the Excel export, and a new
 * receipt with the client's open items ready to pick.
 */
export function ClientStatementPage() {
  const { valueId } = route.useParams();
  const { companyId, me, membership } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [ledger, setLedger] = useState<Ledger>('book');
  const [currency, setCurrency] = useState<CurrencyCode | 'any'>('any');
  const query = {
    from: range.from || undefined,
    to: range.to || undefined,
    ledger,
    currency: currency === 'any' ? undefined : currency,
  };
  const statement = useQuery({
    ...clientStatementQuery(companyId, valueId, query),
    enabled: isDateRangeOrdered(range),
  });
  const data = statement.data;

  if (hasCode(statement.error, 'NOT_FOUND') || hasCode(statement.error, 'VALIDATION_FAILED')) {
    return (
      <>
        <ReceivablesBackLink />
        <EmptyState icon={<FileQuestionIcon />} title={t.notFound} />
      </>
    );
  }
  const receipt = !membership.company.archived && can(me, 'drafts.manage');
  return (
    <>
      <PageHeader
        back={<ReceivablesBackLink />}
        title={
          <span className="flex flex-wrap items-center gap-x-3">
            {t.title}
            {data && <ClientName client={data.client} />}
          </span>
        }
        description={t.description}
        actions={
          <div className="flex flex-wrap gap-2">
            {receipt && (
              <Button
                variant="outline"
                render={<Link to="/entries/new" search={{ client: valueId }} />}
              >
                <PlusIcon aria-hidden="true" />
                {t.newReceipt}
              </Button>
            )}
            <ReportExport
              disabled={!data}
              excelPath={`/clients/${valueId}/statement/export${searchOf(query)}`}
              pdf={{ report: 'client_statement', params: paramsOf({ ...query, client: valueId }) }}
            />
          </div>
        }
      />
      <Card className="p-4">
        <search aria-label={t.filters} className="grid gap-4 md:grid-cols-3">
          <DateRangeField
            value={range}
            onValueChange={setRange}
            label={t.range}
            fromLabel={t.from}
            toLabel={t.to}
            orderError={t.order}
            className="md:col-span-2"
          />
          <SelectField
            label={t.currency}
            value={currency}
            options={currencyOptions}
            onValueChange={(value) => setCurrency(value as CurrencyCode | 'any')}
          />
        </search>
      </Card>
      <ReportLedgerSwitch companyId={companyId} value={ledger} onValueChange={setLedger} />
      {!isDateRangeOrdered(range) ? null : statement.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : statement.isError ? (
        <FormError error={statement.error} />
      ) : data ? (
        <StatementTable statement={data} startMonth={startMonth} />
      ) : null}
    </>
  );
}

/** The opening or closing balances: one line per item currency, and the ledger's total. */
function BalanceRow({
  label,
  balances,
  ledgerMinor,
  ledgerCurrency,
}: {
  label: string;
  balances: readonly StatementBalance[];
  ledgerMinor: string;
  ledgerCurrency: CurrencyCode;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={6} className="font-medium">
        {label}
      </TableCell>
      <TableCell numeric>
        <span className="flex flex-col items-end gap-0.5">
          {balances.map((balance) => (
            <Amount
              key={balance.currency}
              value={BigInt(balance.amountMinor)}
              currency={balance.currency}
              showCurrency
              strong
            />
          ))}
        </span>
      </TableCell>
      <TableCell numeric>
        <Amount value={BigInt(ledgerMinor)} currency={ledgerCurrency} strong />
      </TableCell>
    </TableRow>
  );
}

function StatementTable({
  statement,
  startMonth,
}: {
  statement: ClientStatement;
  startMonth: number;
}) {
  const currency = statement.ledgerCurrency;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Table aria-label={t.label}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.date}</TableHead>
            <TableHead>{t.entry}</TableHead>
            <TableHead>{t.item}</TableHead>
            <TableHead>{t.movement}</TableHead>
            <TableHead numeric>{t.amount}</TableHead>
            <TableHead numeric>
              {`${t.ledgerAmount} `}
              <bdi dir="ltr">{currency}</bdi>
            </TableHead>
            <TableHead numeric>{t.balance}</TableHead>
            <TableHead numeric>
              {`${t.ledgerBalance} `}
              <bdi dir="ltr">{currency}</bdi>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <BalanceRow
            label={t.opening}
            balances={statement.opening}
            ledgerMinor={statement.openingLedgerMinor}
            ledgerCurrency={currency}
          />
          {statement.lines.map((line) => (
            <TableRow key={line.movementId}>
              <TableCell className="whitespace-nowrap">{formatDay(line.entryDate)}</TableCell>
              <TableCell>
                <span className="flex flex-col gap-1">
                  <Link
                    to="/entries/$id"
                    params={{ id: line.entryId }}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    <EntryNumberText number={line} startMonth={startMonth} />
                  </Link>
                  <bdi className="max-w-64 truncate text-xs text-muted-foreground">
                    {line.memo ?? line.description}
                  </bdi>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-col gap-1">
                  <ItemLink id={line.itemId} reference={line.itemReference} />
                  <AccountLabel
                    code={line.account.code}
                    name={line.account.name}
                    className="text-xs text-muted-foreground"
                  />
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-1">
                  <Badge tone="neutral">{ar.openItems.movements[line.kind]}</Badge>
                  <AdjustedBadge adjusted={line.adjusted} />
                </span>
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(line.amountMinor)} currency={line.currency} showCurrency />
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(line.ledgerMinor)} currency={currency} />
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(line.balanceMinor)} currency={line.currency} showCurrency />
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(line.ledgerBalanceMinor)} currency={currency} />
              </TableCell>
            </TableRow>
          ))}
          <BalanceRow
            label={t.closing}
            balances={statement.closing}
            ledgerMinor={statement.closingLedgerMinor}
            ledgerCurrency={currency}
          />
        </TableBody>
      </Table>
      {statement.lines.length === 0 && <EmptyState title={t.empty} />}
    </div>
  );
}
