import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  type Ledger,
  PROFITABILITY_DIMENSIONS,
  type ProfitabilityDimension,
  type ProfitabilityFigures,
  type ProfitabilityRow,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  SelectField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { damascusToday, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { companyQuery } from '../company/company-queries';
import {
  CompareFields,
  DateInput,
  excelPathOf,
  ReportExport,
  ReportFrame,
  ReportState,
  ReportValueName,
} from './report-parts';
import { flagText, monthStart } from './report-search';
import { paramsOf, profitabilityQuery } from './reports-queries';

const t = ar.reports;
const route = getRouteApi('/_app/_company/reports/profitability');

/** `/reports/profitability`'s search (rules 20–23). */
export interface ProfitabilitySearch {
  by?: ProfitabilityDimension | undefined;
  from?: string | undefined;
  to?: string | undefined;
  ledger?: Ledger | undefined;
  compare?: boolean | undefined;
  compareFrom?: string | undefined;
  compareTo?: string | undefined;
  sort?: 'contribution' | 'margin' | undefined;
}

const byOptions = PROFITABILITY_DIMENSIONS.map((by) => ({
  value: by,
  label: t.profitability.by[by],
}));
const sortOptions = (['contribution', 'margin'] as const).map((sort) => ({
  value: sort,
  label: t.filters.sorts[sort],
}));

/** The margin's order: a missing margin ("—", no revenue) last. */
function marginOf(figures: ProfitabilityFigures): number {
  return figures.margin === null ? Number.NEGATIVE_INFINITY : Number(figures.margin);
}

/** Contribution's order, compared exactly as minor units. */
function byContribution(a: ProfitabilityRow, b: ProfitabilityRow): number {
  const left = BigInt(a.current.contribution);
  const right = BigInt(b.current.contribution);
  return left === right ? 0 : left > right ? -1 : 1;
}

/**
 * `/reports/profitability` (rules 20–23, "Screens"): revenue, direct costs, contribution and
 * margin per client, contract, department or service, "غير موزع" for the lines without one, the
 * totals equal to the income statement's lines; sorted by contribution or margin; the parallel
 * ledger by default where the company keeps one; each figure opens its lines; Excel and PDF.
 */
export function ProfitabilityPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/profitability' });
  const { companyId } = useCompany();
  const company = useQuery(companyQuery(companyId)).data;
  const by = search.by ?? 'client';
  const from = search.from ?? monthStart();
  const to = search.to ?? damascusToday();
  const ledger: Ledger = search.ledger ?? (company?.ledgers.parallel ? 'parallel' : 'book');
  const ordered = from <= to;
  const params = {
    by,
    from,
    to,
    ledger,
    compare: flagText(search.compare),
    compareFrom: search.compare === false ? undefined : search.compareFrom,
    compareTo: search.compare === false ? undefined : search.compareTo,
  };
  const report = useQuery({
    ...profitabilityQuery(companyId, params),
    enabled: ordered && company !== undefined,
  });
  const set = (patch: Partial<ProfitabilitySearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const data = report.data;
  const sort = search.sort ?? 'contribution';
  const rows = [...(data?.rows ?? [])].sort((a, b) =>
    sort === 'margin' ? marginOf(b.current) - marginOf(a.current) : byContribution(a, b),
  );
  const compared = data?.header.compare ?? null;
  const currency = data?.header.currency ?? 'SYP';
  const linesOf = (row: ProfitabilityRow) => ({
    ledger,
    from,
    to,
    statementLine: 'is.revenue',
    profitabilityBy: by,
    profitabilityValue: row.value?.id,
  });

  return (
    <ReportFrame
      report="profitability"
      search={search}
      title={t.names.profitability}
      description={`${t.profitability.by[by]} · ${formatDay(from)} – ${formatDay(to)}`}
      actions={
        <ReportExport
          disabled={!data}
          excelPath={excelPathOf('profitability', params)}
          pdf={{ report: 'profitability', params: paramsOf(params) }}
        />
      }
      ledger={{ value: ledger, onValueChange: (next) => set({ ledger: next }) }}
      header={data?.header}
      filters={
        <>
          <SelectField
            label={t.filters.by}
            value={by}
            options={byOptions}
            onValueChange={(next) => set({ by: next })}
          />
          <DateInput label={t.filters.from} value={from} onValueChange={(v) => set({ from: v })} />
          <DateInput
            label={t.filters.to}
            value={to}
            invalid={!ordered}
            onValueChange={(v) => set({ to: v })}
          />
          <SelectField
            label={t.filters.sort}
            value={sort}
            options={sortOptions}
            onValueChange={(next) => set({ sort: next })}
          />
          <CompareFields
            compare={search.compare ?? true}
            from={search.compareFrom ?? ''}
            to={search.compareTo ?? ''}
            onChange={(patch) => set(patch)}
          />
        </>
      }
    >
      <ReportState query={report} empty={data !== undefined && data.rows.length === 0}>
        {data && (
          <Table aria-label={`${t.profitabilityScreen.caption} ${from} – ${to}`}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.profitability.by[by]}</TableHead>
                <TableHead numeric>{t.columns.revenue}</TableHead>
                <TableHead numeric>{t.columns.directCosts}</TableHead>
                <TableHead numeric>{t.columns.contribution}</TableHead>
                <TableHead numeric>{t.columns.margin}</TableHead>
                {compared && (
                  <>
                    <TableHead
                      numeric
                    >{`${t.columns.compare} · ${t.columns.contribution}`}</TableHead>
                    <TableHead numeric>{`${t.columns.compare} · ${t.columns.margin}`}</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.value?.id ?? 'unassigned'}>
                  <TableHead scope="row" className="font-normal text-foreground">
                    <ReportValueName value={row.value} none={t.profitability.unassigned} />
                  </TableHead>
                  <TableCell numeric>
                    <Link
                      to="/reports/lines"
                      search={linesOf(row)}
                      aria-label={t.drill.figure}
                      className="underline-offset-4 hover:underline"
                    >
                      <Amount value={BigInt(row.current.revenue)} currency={currency} />
                    </Link>
                  </TableCell>
                  <TableCell numeric>
                    <Link
                      to="/reports/lines"
                      search={{ ...linesOf(row), statementLine: 'is.direct_costs' }}
                      aria-label={t.drill.figure}
                      className="underline-offset-4 hover:underline"
                    >
                      <Amount value={BigInt(row.current.directCosts)} currency={currency} />
                    </Link>
                  </TableCell>
                  <TableCell numeric>
                    <Amount value={BigInt(row.current.contribution)} currency={currency} strong />
                  </TableCell>
                  <TableCell numeric>
                    <Margin margin={row.current.margin} />
                  </TableCell>
                  {compared && (
                    <>
                      <TableCell numeric className="text-muted-foreground">
                        {compared.hasLines && row.compare ? (
                          <Amount value={BigInt(row.compare.contribution)} currency={currency} />
                        ) : (
                          t.none
                        )}
                      </TableCell>
                      <TableCell numeric className="text-muted-foreground">
                        <Margin margin={compared.hasLines ? (row.compare?.margin ?? null) : null} />
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              <TableRow className="border-t border-foreground font-bold hover:bg-transparent">
                <TableHead scope="row" className="text-foreground">
                  {t.totals.total}
                </TableHead>
                <TableCell numeric>
                  <Amount value={BigInt(data.totals.current.revenue)} currency={currency} strong />
                </TableCell>
                <TableCell numeric>
                  <Amount
                    value={BigInt(data.totals.current.directCosts)}
                    currency={currency}
                    strong
                  />
                </TableCell>
                <TableCell numeric>
                  <span className="inline-block border-b-[3px] border-double border-foreground">
                    <Amount
                      value={BigInt(data.totals.current.contribution)}
                      currency={currency}
                      strong
                    />
                  </span>
                </TableCell>
                <TableCell numeric>
                  <Margin margin={data.totals.current.margin} />
                </TableCell>
                {compared && (
                  <>
                    <TableCell numeric>
                      {compared.hasLines && data.totals.compare ? (
                        <Amount
                          value={BigInt(data.totals.compare.contribution)}
                          currency={currency}
                          strong
                        />
                      ) : (
                        t.none
                      )}
                    </TableCell>
                    <TableCell numeric>
                      <Margin
                        margin={compared.hasLines ? (data.totals.compare?.margin ?? null) : null}
                      />
                    </TableCell>
                  </>
                )}
              </TableRow>
            </TableBody>
          </Table>
        )}
      </ReportState>
    </ReportFrame>
  );
}

/** A margin with one decimal and its percent sign, "—" without revenue (rule 21). */
function Margin({ margin }: { margin: string | null }) {
  if (margin === null) return <span>{t.none}</span>;
  return (
    <bdi dir="ltr" className={margin.startsWith('-') ? 'text-negative' : undefined}>
      {`${margin}%`}
    </bdi>
  );
}
