import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  type CurrencyCode,
  debitCreditOf,
  type Ledger,
  type ReportAccount,
  type ReportLine,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountPicker,
  Amount,
  Button,
  DimensionPicker,
  SelectField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { Fragment, type ReactNode } from 'react';
import { damascusToday, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { accountsQuery } from '../chart/chart-queries';
import {
  accountPickerLabels,
  dimensionPickerLabels,
  EntryNumberText,
  pickerAccounts,
  pickerValues,
  useFiscalYearStartMonth,
} from '../entries/entry-parts';
import { useDimensionCatalog } from '../entries/entry-queries';
import { HubDocumentLink } from '../inbox/inbox-parts';
import {
  CodeRangeFields,
  DateInput,
  excelPathOf,
  ReportAccountName,
  ReportExport,
  ReportFrame,
  ReportState,
  ReportValues,
} from './report-parts';
import { monthStart } from './report-search';
import { accountStatementQuery, generalLedgerQuery, paramsOf } from './reports-queries';

const t = ar.reports;
const ledgerRoute = getRouteApi('/_app/_company/reports/general-ledger');
const statementRoute = getRouteApi('/_app/_company/reports/accounts/$id');

/** `/reports/general-ledger`'s search (rule 10). */
export interface GeneralLedgerSearch {
  from?: string | undefined;
  to?: string | undefined;
  ledger?: Ledger | undefined;
  codeFrom?: string | undefined;
  codeTo?: string | undefined;
}

/** `/reports/accounts/:id`'s search (rule 11). */
export interface AccountStatementSearch {
  from?: string | undefined;
  to?: string | undefined;
  ledger?: Ledger | undefined;
  currency?: string | undefined;
  /** A dimension value every line carries (rule 11, as `GET /api/accounts/:id/lines`). */
  dims?: string | undefined;
}

/** A balance row of an account's lines: the opening or the closing, under its rule. */
function BalanceRow({
  label,
  balance,
  currency,
  span,
  closing,
}: {
  label: string;
  balance: string;
  currency: CurrencyCode;
  span: number;
  closing?: boolean;
}) {
  return (
    <TableRow className={closing ? 'border-t border-foreground font-bold' : 'bg-muted/30'}>
      <TableHead scope="row" colSpan={span} className="text-foreground">
        {label}
      </TableHead>
      <TableCell numeric>
        <Amount value={BigInt(balance)} currency={currency} strong={closing === true} />
      </TableCell>
    </TableRow>
  );
}

/** One line: its date, entry (opening the entry and its Hub event), text, sides and balance. */
function LineRow({
  line,
  currency,
  startMonth,
  transaction,
}: {
  line: ReportLine;
  currency: CurrencyCode;
  startMonth: number;
  /** The account statement's transaction currency columns (rule 11). */
  transaction?: boolean;
}) {
  const { debitMinor, creditMinor } = debitCreditOf(BigInt(line.amount));
  return (
    <TableRow>
      <TableCell>{formatDay(line.entryDate)}</TableCell>
      <TableCell>
        <Link
          to="/entries/$id"
          params={{ id: line.entryId }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          <EntryNumberText number={line} startMonth={startMonth} />
        </Link>
      </TableCell>
      <TableCell className="min-w-48 whitespace-normal">
        <span className="flex flex-col gap-1">
          <bdi>{line.description}</bdi>
          {line.memo && <bdi className="text-xs text-muted-foreground">{line.memo}</bdi>}
          <ReportValues values={line.values} />
          {line.openItem && (
            <Link
              to="/open-items/$id"
              params={{ id: line.openItem.id }}
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              <bdi>{line.openItem.reference}</bdi>
            </Link>
          )}
          {line.hubDocument && <HubDocumentLink document={line.hubDocument} eventId={null} />}
        </span>
      </TableCell>
      <TableCell numeric>
        {debitMinor !== null && debitMinor !== 0n && (
          <Amount value={debitMinor} currency={currency} />
        )}
      </TableCell>
      <TableCell numeric>
        {creditMinor !== null && <Amount value={creditMinor} currency={currency} />}
      </TableCell>
      {transaction && (
        <>
          <TableCell numeric>
            <Amount value={BigInt(line.transactionAmount)} currency={line.currency} showCurrency />
          </TableCell>
          <TableCell numeric>
            <Amount value={BigInt(line.transactionBalance)} currency={line.currency} showCurrency />
          </TableCell>
        </>
      )}
      <TableCell numeric>
        <Amount value={BigInt(line.balance)} currency={currency} />
      </TableCell>
    </TableRow>
  );
}

/** The headings of an account's lines. */
function LinesHead({ transaction }: { transaction?: boolean }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{t.columns.date}</TableHead>
        <TableHead>{t.columns.entry}</TableHead>
        <TableHead>{t.columns.description}</TableHead>
        <TableHead numeric>{t.columns.debit}</TableHead>
        <TableHead numeric>{t.columns.credit}</TableHead>
        {transaction && (
          <>
            <TableHead numeric>{t.columns.transactionAmount}</TableHead>
            <TableHead numeric>{t.columns.transactionBalance}</TableHead>
          </>
        )}
        <TableHead numeric>{t.columns.balance}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** "المزيد": the next page of a paged report. */
function MorePages({
  pages,
}: {
  pages: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
}) {
  if (!pages.hasNextPage) return null;
  return (
    <Button
      variant="outline"
      className="w-fit self-center"
      loading={pages.isFetchingNextPage}
      onClick={() => void pages.fetchNextPage()}
    >
      {t.states.loadMore}
    </Button>
  );
}

/**
 * `/reports/general-ledger` (rule 10, "Screens"): for each account of a code range, its opening
 * balance, its lines in `(entry_date, number, line)` order with their running balance, each
 * opening its entry, and its closing balance; 200 lines a page, the export carrying all.
 */
export function GeneralLedgerPage() {
  const search = ledgerRoute.useSearch();
  const navigate = useNavigate({ from: '/reports/general-ledger' });
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const from = search.from ?? monthStart();
  const to = search.to ?? damascusToday();
  const ledger = search.ledger ?? 'book';
  const ordered = from <= to;
  const params = { from, to, ledger, codeFrom: search.codeFrom, codeTo: search.codeTo };
  const pages = useInfiniteQuery({ ...generalLedgerQuery(companyId, params), enabled: ordered });
  const set = (patch: Partial<GeneralLedgerSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const first = pages.data?.pages[0];
  const currency = first?.header.currency ?? 'SYP';
  // An account continued on the next page repeats: its parts join under one heading.
  const accounts = new Map<
    string,
    { account: ReportAccount; opening: string; closing: string; lines: ReportLine[] }
  >();
  for (const part of pages.data?.pages.flatMap((page) => page.accounts) ?? []) {
    const known = accounts.get(part.account.id);
    if (known) {
      known.lines.push(...part.lines);
      known.closing = part.closing;
    } else {
      accounts.set(part.account.id, { ...part, lines: [...part.lines] });
    }
  }

  return (
    <ReportFrame
      report="general-ledger"
      search={search}
      title={t.names.general_ledger}
      description={`${formatDay(from)} – ${formatDay(to)}`}
      actions={
        <ReportExport
          disabled={!first}
          excelPath={excelPathOf('general_ledger', params)}
          pdf={{ report: 'general_ledger', params: paramsOf(params) }}
        />
      }
      ledger={{ value: ledger, onValueChange: (next) => set({ ledger: next }) }}
      header={first?.header}
      filters={
        <>
          <DateInput label={t.filters.from} value={from} onValueChange={(v) => set({ from: v })} />
          <DateInput
            label={t.filters.to}
            value={to}
            invalid={!ordered}
            onValueChange={(v) => set({ to: v })}
          />
          <CodeRangeFields
            codeFrom={search.codeFrom}
            codeTo={search.codeTo}
            onChange={(codes) => set(codes)}
          />
        </>
      }
    >
      <ReportState query={pages} empty={first !== undefined && accounts.size === 0}>
        <Table aria-label={`${t.ledgerBook.caption} ${from} – ${to}`}>
          <LinesHead />
          <TableBody>
            {[...accounts.values()].map((part) => (
              <Fragment key={part.account.id}>
                <TableRow className="bg-muted/50">
                  <TableHead scope="colgroup" colSpan={6} className="text-foreground">
                    <span className="flex flex-wrap items-center gap-3">
                      <ReportAccountName account={part.account} />
                      <Link
                        to="/reports/accounts/$id"
                        params={{ id: part.account.id }}
                        search={{ from, to, ledger }}
                        className="text-xs font-normal text-primary underline-offset-4 hover:underline"
                      >
                        {t.ledgerBook.statement}
                      </Link>
                    </span>
                  </TableHead>
                </TableRow>
                <BalanceRow
                  label={t.totals.opening}
                  balance={part.opening}
                  currency={currency}
                  span={5}
                />
                {part.lines.map((line) => (
                  <LineRow
                    key={`${line.entryId}-${line.lineNo}`}
                    line={line}
                    currency={currency}
                    startMonth={startMonth}
                  />
                ))}
                <BalanceRow
                  label={t.totals.closing}
                  balance={part.closing}
                  currency={currency}
                  span={5}
                  closing
                />
              </Fragment>
            ))}
          </TableBody>
        </Table>
        <MorePages pages={pages} />
      </ReportState>
    </ReportFrame>
  );
}

/**
 * `/reports/accounts/:id` (rule 11, "Screens"): one account as the general ledger shows it, with
 * each line's transaction amount and the running balance of its currency, the account picker, the
 * currency view, each currency's opening and closing; a control account's line names its item.
 */
export function AccountStatementPage() {
  const search = statementRoute.useSearch();
  const { id } = statementRoute.useParams();
  const navigate = useNavigate({ from: '/reports/accounts/$id' });
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const accounts = useQuery(accountsQuery(companyId));
  const from = search.from ?? monthStart();
  const to = search.to ?? damascusToday();
  const ledger = search.ledger ?? 'book';
  const ordered = from <= to;
  const catalog = useDimensionCatalog(companyId);
  const params = { from, to, ledger, currency: search.currency, dims: search.dims };
  const pages = useInfiniteQuery({
    ...accountStatementQuery(companyId, id, params),
    enabled: ordered,
  });
  const set = (patch: Partial<AccountStatementSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const first = pages.data?.pages[0];
  const last = pages.data?.pages.at(-1);
  const lines = pages.data?.pages.flatMap((page) => page.lines) ?? [];
  const currency = first?.header.currency ?? 'SYP';
  const currencyOptions = [
    { value: 'all', label: t.filters.allCurrencies },
    ...(first?.currencies ?? []).map((row) => ({ value: row.currency, label: row.currency })),
  ];
  const fileParams = { ...params, account: id };

  return (
    <ReportFrame
      report="account-statement"
      search={{ ...search, account: id }}
      title={
        first ? (
          <span className="flex flex-wrap items-center gap-2">
            {`${t.names.account_statement}: `}
            <ReportAccountName account={first.account} />
          </span>
        ) : (
          t.names.account_statement
        )
      }
      description={`${formatDay(from)} – ${formatDay(to)}`}
      actions={
        <ReportExport
          disabled={!first}
          excelPath={excelPathOf('account_statement', fileParams)}
          pdf={{ report: 'account_statement', params: paramsOf(fileParams) }}
        />
      }
      ledger={{ value: ledger, onValueChange: (next) => set({ ledger: next }) }}
      header={first?.header}
      filters={
        <>
          <AccountPicker
            label={t.filters.account}
            accounts={pickerAccounts(accounts.data ?? [])}
            value={id}
            labels={accountPickerLabels}
            onValueChange={(next) =>
              void navigate({
                to: '/reports/accounts/$id',
                params: { id: next },
                search: (previous) => ({ ...previous, currency: undefined }),
              })
            }
          />
          <DateInput label={t.filters.from} value={from} onValueChange={(v) => set({ from: v })} />
          <DateInput
            label={t.filters.to}
            value={to}
            invalid={!ordered}
            onValueChange={(v) => set({ to: v })}
          />
          <DimensionPicker
            label={t.filters.dimension}
            values={pickerValues([...catalog.byId.values()])}
            value={search.dims ?? null}
            labels={dimensionPickerLabels}
            onValueChange={(dims) => set({ dims: dims ?? undefined })}
          />
          <SelectField
            label={t.filters.currency}
            value={search.currency ?? 'all'}
            options={currencyOptions}
            onValueChange={(next) => set({ currency: next === 'all' ? undefined : next })}
          />
        </>
      }
    >
      <ReportState query={pages}>
        {first && last && (
          <>
            <Table aria-label={t.ledgerBook.statementCaption}>
              <LinesHead transaction />
              <TableBody>
                <BalanceRow
                  label={t.totals.opening}
                  balance={first.opening}
                  currency={currency}
                  span={7}
                />
                {lines.map((line) => (
                  <LineRow
                    key={`${line.entryId}-${line.lineNo}`}
                    line={line}
                    currency={currency}
                    startMonth={startMonth}
                    transaction
                  />
                ))}
                <BalanceRow
                  label={t.totals.closing}
                  balance={last.closing}
                  currency={currency}
                  span={7}
                  closing
                />
              </TableBody>
            </Table>
            <MorePages pages={pages} />
            {first.currencies.length > 0 && <CurrencyBalances rows={first.currencies} />}
          </>
        )}
      </ReportState>
    </ReportFrame>
  );
}

/** Each transaction currency's opening and closing on the account (rule 11). */
function CurrencyBalances({
  rows,
}: {
  rows: readonly { currency: CurrencyCode; opening: string; closing: string }[];
}): ReactNode {
  return (
    <section aria-labelledby="statement-currencies" className="flex min-w-0 flex-col gap-3">
      <h2 id="statement-currencies" className="text-lg font-bold">
        {t.ledgerBook.currencies}
      </h2>
      <Table aria-label={t.ledgerBook.currenciesCaption}>
        <TableHeader>
          <TableRow>
            <TableHead>{t.columns.currency}</TableHead>
            <TableHead numeric>{t.columns.opening}</TableHead>
            <TableHead numeric>{t.columns.closing}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.currency}>
              <TableCell>
                <bdi dir="ltr">{row.currency}</bdi>
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(row.opening)} currency={row.currency} />
              </TableCell>
              <TableCell numeric>
                <Amount value={BigInt(row.closing)} currency={row.currency} strong />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
