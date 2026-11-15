import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import type { CashBalances, CashStatement, CurrencyCode } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Amount,
  Badge,
  Button,
  Card,
  Checkbox,
  type DateRange,
  DateRangeField,
  EmptyState,
  isDateRangeOrdered,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { ArrowRightIcon, FileQuestionIcon } from 'lucide-react';
import { FormError } from '../../components/form-error';
import { hasCode } from '../../lib/api';
import { damascusToday, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { EntryNumberText, useFiscalYearStartMonth } from '../entries/entry-parts';
import { searchOf } from '../receivables/receivables-queries';
import { ReportExport } from '../reports/report-parts';
import { VoucherNumberText } from './cash-parts';
import { cashStatementQuery } from './cash-queries';

const t = ar.cash.statement;
const c = t.columns;
const route = getRouteApi('/_app/_company/cash/$accountId');

/** The cash screens' way back to the position. */
export function CashBackLink() {
  return (
    <Button variant="ghost" size="sm" className="w-fit" render={<Link to="/cash" />}>
      <ArrowRightIcon aria-hidden="true" />
      {ar.cash.position.title}
    </Button>
  );
}

/**
 * `/cash/:accountId` (S11 rule 17, "Screens"): a cash account's statement for a range (this month
 * by default): the opening balance, each line in date then entry order with its entry, voucher,
 * counter account (or "متعدد"), counterparty and contract, in, out and the running balance; the
 * book and parallel amounts as optional columns; each count with its expected and counted amounts;
 * the totals and the closing balance. Each row opens its entry or voucher; the export writes Excel
 * at once and queues the PDF.
 */
export function CashStatementPage() {
  const { accountId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate();
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const today = damascusToday();
  const range: DateRange = {
    from: search.from ?? `${today.slice(0, 7)}-01`,
    to: search.to ?? today,
  };
  const ledgers = new Set((search.ledgers ?? '').split(',').filter((name) => name !== ''));
  const params = {
    from: range.from,
    to: range.to,
    ledgers: ledgers.size === 0 ? undefined : [...ledgers].join(','),
  };
  const ordered = range.from !== '' && range.to !== '' && isDateRangeOrdered(range);
  const statement = useQuery({
    ...cashStatementQuery(companyId, accountId, params),
    enabled: ordered,
  });
  const data = statement.data;
  const setSearch = (next: Partial<typeof search>) =>
    void navigate({
      to: '/cash/$accountId',
      params: { accountId },
      search: { ...search, ...next },
      replace: true,
    });
  const toggle = (ledger: 'book' | 'parallel', on: boolean) => {
    const next = new Set(ledgers);
    if (on) next.add(ledger);
    else next.delete(ledger);
    setSearch({ ledgers: next.size === 0 ? undefined : [...next].sort().join(',') });
  };

  if (hasCode(statement.error, 'NOT_FOUND')) {
    return (
      <>
        <CashBackLink />
        <EmptyState icon={<FileQuestionIcon />} title={ar.cash.position.empty} />
      </>
    );
  }
  return (
    <>
      <PageHeader
        back={<CashBackLink />}
        title={
          <span className="flex flex-wrap items-center gap-x-3">
            {t.title}
            {data && <AccountLabel code={data.account.code} name={data.account.name} />}
          </span>
        }
        actions={
          <ReportExport
            disabled={!data}
            excelPath={`/cash/accounts/${accountId}/statement/export${searchOf({ format: 'xlsx', ...params })}`}
            pdf={{
              report: 'cash_statement',
              params: Object.fromEntries(
                Object.entries({ account: accountId, ...params }).filter(
                  (entry): entry is [string, string] => entry[1] !== undefined,
                ),
              ),
            }}
          />
        }
      />
      <Card className="p-4">
        <search aria-label={t.range} className="grid gap-4 md:grid-cols-3">
          <DateRangeField
            value={range}
            onValueChange={(next) =>
              setSearch({ from: next.from || undefined, to: next.to || undefined })
            }
            label={t.range}
            fromLabel={ar.reports.header.from}
            toLabel={ar.reports.header.to}
            orderError={t.rangeError}
            className="md:col-span-2"
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-control font-medium">{t.ledgers}</legend>
            {(['book', 'parallel'] as const).map((ledger) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control.
              <label key={ledger} className="flex items-center gap-2 text-control">
                <Checkbox
                  checked={ledgers.has(ledger)}
                  onCheckedChange={(checked) => toggle(ledger, checked === true)}
                />
                {c[ledger]}
              </label>
            ))}
          </fieldset>
        </search>
      </Card>
      {!ordered ? null : statement.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
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

function BalanceCells({ balance, statement }: { balance: CashBalances; statement: CashStatement }) {
  return (
    <>
      <TableCell numeric>
        <Amount
          value={BigInt(balance.amount.amountMinor)}
          currency={balance.amount.currency}
          strong
        />
      </TableCell>
      {statement.ledgers.includes('book') && (
        <TableCell numeric>
          {balance.book && (
            <Amount
              value={BigInt(balance.book.amountMinor)}
              currency={balance.book.currency}
              strong
            />
          )}
        </TableCell>
      )}
      {statement.ledgers.includes('parallel') && (
        <TableCell numeric>
          {balance.parallel && (
            <Amount
              value={BigInt(balance.parallel.amountMinor)}
              currency={balance.parallel.currency}
              strong
            />
          )}
        </TableCell>
      )}
    </>
  );
}

function StatementTable({
  statement,
  startMonth,
}: {
  statement: CashStatement;
  startMonth: number;
}) {
  const currency: CurrencyCode = statement.account.currency;
  const book = statement.ledgers.includes('book');
  const parallel = statement.ledgers.includes('parallel');
  const named = (value: { code: string | null; name: string } | null) =>
    value === null ? null : <bdi>{value.code ? `${value.code} ${value.name}` : value.name}</bdi>;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Table aria-label={t.title}>
        <TableHeader>
          <TableRow>
            <TableHead>{c.date}</TableHead>
            <TableHead>{c.entry}</TableHead>
            <TableHead>{c.description}</TableHead>
            <TableHead>{c.counterAccount}</TableHead>
            <TableHead>{c.counterparty}</TableHead>
            <TableHead numeric>{c.in}</TableHead>
            <TableHead numeric>{c.out}</TableHead>
            <TableHead numeric>{c.balance}</TableHead>
            {book && (
              <TableHead numeric>
                {`${c.book} `}
                <bdi dir="ltr">{statement.bookCurrency}</bdi>
              </TableHead>
            )}
            {parallel && (
              <TableHead numeric>
                {`${c.parallel} `}
                <bdi dir="ltr">{statement.parallelCurrency}</bdi>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={7} className="font-medium">
              {t.opening}
            </TableCell>
            <BalanceCells balance={statement.opening} statement={statement} />
          </TableRow>
          {statement.rows.map((row) => (
            <TableRow
              key={`${row.kind}:${row.entry?.id ?? ''}:${row.entry?.lineNo ?? ''}:${row.voucher?.id ?? ''}`}
              data-kind={row.kind}
            >
              <TableCell className="whitespace-nowrap">{formatDay(row.date)}</TableCell>
              <TableCell>
                <span className="flex flex-col gap-1">
                  {row.entry && (
                    <Link
                      to="/entries/$id"
                      params={{ id: row.entry.id }}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <EntryNumberText number={row.entry} startMonth={startMonth} />
                    </Link>
                  )}
                  {row.voucher && (
                    <Link
                      to="/cash/vouchers/$id"
                      params={{ id: row.voucher.id }}
                      className="text-xs text-primary underline-offset-4 hover:underline"
                    >
                      <VoucherNumberText voucher={row.voucher} startMonth={startMonth} />
                    </Link>
                  )}
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-col gap-1">
                  <bdi className="max-w-64 truncate">{row.description}</bdi>
                  {row.kind === 'count' &&
                    row.expectedMinor !== null &&
                    row.countedMinor !== null && (
                      <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>
                          {`${c.expected} `}
                          <Amount value={BigInt(row.expectedMinor)} currency={currency} />
                        </span>
                        <span>
                          {`${c.counted} `}
                          <Amount value={BigInt(row.countedMinor)} currency={currency} />
                        </span>
                      </span>
                    )}
                </span>
              </TableCell>
              <TableCell>
                {row.severalCounterAccounts ? (
                  <Badge tone="neutral">{t.several}</Badge>
                ) : row.counterAccount ? (
                  <AccountLabel code={row.counterAccount.code} name={row.counterAccount.name} />
                ) : null}
              </TableCell>
              <TableCell>
                <span className="flex flex-col gap-0.5">
                  {named(row.counterparty)}
                  {row.contract && (
                    <span className="text-xs text-muted-foreground">{named(row.contract)}</span>
                  )}
                </span>
              </TableCell>
              <TableCell numeric>
                {row.kind === 'line' && row.in !== '0' && (
                  <Amount value={BigInt(row.in)} currency={currency} />
                )}
              </TableCell>
              <TableCell numeric>
                {row.kind === 'line' && row.out !== '0' && (
                  <Amount value={BigInt(row.out)} currency={currency} />
                )}
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(row.balance)} currency={currency} />
              </TableCell>
              {book && (
                <TableCell numeric>
                  {row.book !== null && row.kind === 'line' && (
                    <Amount value={BigInt(row.book)} currency={statement.bookCurrency} />
                  )}
                </TableCell>
              )}
              {parallel && (
                <TableCell numeric>
                  {row.parallel !== null && row.kind === 'line' && statement.parallelCurrency && (
                    <Amount value={BigInt(row.parallel)} currency={statement.parallelCurrency} />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={5} className="font-medium">
              {t.totals}
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(statement.totalIn)} currency={currency} strong />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(statement.totalOut)} currency={currency} strong />
            </TableCell>
            <TableCell colSpan={1 + (book ? 1 : 0) + (parallel ? 1 : 0)} />
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={7} className="font-medium">
              {t.closing}
            </TableCell>
            <BalanceCells balance={statement.closing} statement={statement} />
          </TableRow>
        </TableBody>
      </Table>
      {statement.rows.length === 0 && <EmptyState title={t.empty} />}
    </div>
  );
}
