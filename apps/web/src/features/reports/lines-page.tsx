import { useInfiniteQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { type CurrencyCode, debitCreditOf, STATEMENT_LINES } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import type { ReactNode } from 'react';
import { formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { EntryNumberText, HubDocumentText, useFiscalYearStartMonth } from '../entries/entry-parts';
import {
  type LinesSearch,
  ReportAccountName,
  ReportFrame,
  ReportState,
  ReportValues,
} from './report-parts';
import { reportLinesQuery } from './reports-queries';

const t = ar.reports;
const route = getRouteApi('/_app/_company/reports/lines');

/**
 * `/reports/lines` (rule 6, "Screens"): the posted lines behind a figure, with the figure's
 * parameters, their sum (equal to the figure) and count, 200 a page; each line opens its entry,
 * and a Hub entry names its document.
 */
export function LinesPage() {
  const search = route.useSearch();
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const pages = useInfiniteQuery(reportLinesQuery(companyId, { ...search }));
  const first = pages.data?.pages[0];
  const lines = pages.data?.pages.flatMap((page) => page.lines) ?? [];
  const currency = first?.header.currency ?? 'SYP';
  const statementLine = STATEMENT_LINES.find((line) => line.code === search.statementLine);

  return (
    <ReportFrame
      report="lines"
      search={search}
      title={t.lines.title}
      description={t.lines.description}
      header={first?.header}
    >
      <Card className="p-4">
        <dl className="grid gap-x-6 gap-y-2 text-control sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t.filters.from}>
            {search.from ? formatDay(search.from) : t.lines.fromStart}
          </Fact>
          <Fact label={t.filters.to}>{formatDay(search.to)}</Fact>
          {statementLine && <Fact label={t.lines.statementLine}>{statementLine.name}</Fact>}
          {lines[0] && search.account && (
            <Fact label={t.filters.account}>
              <ReportAccountName account={lines[0].account} />
            </Fact>
          )}
          {search.side && <Fact label={t.columns.side}>{t.lines.side[search.side]}</Fact>}
          {search.openingEntry && <Fact label={t.filters.label}>{t.lines.openingEntry}</Fact>}
          {first && (
            <>
              <Fact label={t.lines.sum}>
                <LinesSum sum={first.sum} currency={currency} />
              </Fact>
              <Fact label={t.lines.count}>
                <bdi dir="ltr">{first.count}</bdi>
              </Fact>
            </>
          )}
        </dl>
      </Card>
      <ReportState query={pages} empty={first !== undefined && first.count === 0}>
        <Table aria-label={t.lines.caption}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.columns.date}</TableHead>
              <TableHead>{t.columns.entry}</TableHead>
              <TableHead>{t.columns.account}</TableHead>
              <TableHead>{t.columns.description}</TableHead>
              <TableHead className="max-lg:hidden">{t.columns.dimensions}</TableHead>
              <TableHead numeric>{t.columns.amount}</TableHead>
              <TableHead numeric className="max-md:hidden">
                {t.columns.transactionAmount}
              </TableHead>
              <TableHead className="max-md:hidden">{t.lines.hub}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={`${line.entryId}-${line.lineNo}`}>
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
                <TableCell>
                  <ReportAccountName account={line.account} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <span className="flex flex-col">
                    <bdi>{line.description}</bdi>
                    {line.memo && <bdi className="text-xs text-muted-foreground">{line.memo}</bdi>}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal max-lg:hidden">
                  <ReportValues values={line.values} />
                </TableCell>
                <TableCell numeric>
                  <Amount value={BigInt(line.amount)} currency={currency} />
                </TableCell>
                <TableCell numeric className="max-md:hidden">
                  <Amount
                    value={BigInt(line.transactionAmount)}
                    currency={line.currency}
                    showCurrency
                  />
                </TableCell>
                <TableCell className="max-md:hidden">
                  {line.hubDocument && <HubDocumentText document={line.hubDocument} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {pages.hasNextPage && (
          <Button
            variant="outline"
            className="w-fit self-center"
            loading={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          >
            {t.states.loadMore}
          </Button>
        )}
      </ReportState>
    </ReportFrame>
  );
}

/**
 * The lines' sum on its side (rule 6): the ledger sums debits as positive and credits as negative,
 * while a report presents a credit figure (a credit column, revenue, a liability) positive on its
 * side, so the sum is shown as the figure is, with the side it is on.
 */
function LinesSum({ sum, currency }: { sum: string; currency: CurrencyCode }) {
  const { debitMinor, creditMinor } = debitCreditOf(BigInt(sum));
  const credit = creditMinor !== null;
  return (
    <span className="inline-flex items-baseline gap-2" data-side={credit ? 'credit' : 'debit'}>
      <Amount value={(credit ? creditMinor : debitMinor) ?? 0n} currency={currency} strong />
      <span className="text-muted-foreground">{credit ? t.columns.credit : t.columns.debit}</span>
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export type { LinesSearch };
