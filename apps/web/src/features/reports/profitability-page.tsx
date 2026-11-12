import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import {
  type Ledger,
  PROFITABILITY_DIMENSIONS,
  type ProfitabilityDimension,
  type ProfitabilityFigures,
  type ProfitabilityRow,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { type ReportFigure, ReportTable, type ReportTableRow, SelectField } from '@vertex-mizan/ui';
import { damascusToday, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { companyQuery } from '../company/company-queries';
import {
  CompareFields,
  compareParams,
  DateInput,
  excelPathOf,
  linesLink,
  ReportExport,
  ReportFrame,
  ReportState,
  ReportValueName,
} from './report-parts';
import { monthStart } from './report-search';
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
    ...compareParams(search),
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
  // A row's lines: the statement line's lines of the period carrying the row's value (rule 23).
  const linesOf = (row: ProfitabilityRow, statementLine: string) => ({
    ledger,
    from,
    to,
    statementLine,
    profitabilityBy: by,
    profitabilityValue: row.value?.id,
  });
  // Contribution and margin, and the comparative's when there is one ("—" without lines).
  const figuresOf = (
    current: ProfitabilityFigures,
    other: ProfitabilityFigures | null,
  ): Record<string, ReportFigure> => ({
    contribution: { value: BigInt(current.contribution) },
    margin: marginFigure(current.margin),
    ...(compared
      ? {
          compareContribution: {
            value: compared.hasLines && other ? BigInt(other.contribution) : null,
          },
          compareMargin: marginFigure(compared.hasLines ? (other?.margin ?? null) : null),
        }
      : {}),
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
          <ReportTable
            caption={`${t.profitabilityScreen.caption} ${from} – ${to}`}
            columns={[
              { id: 'revenue', label: t.columns.revenue },
              { id: 'directCosts', label: t.columns.directCosts },
              { id: 'contribution', label: t.columns.contribution },
              { id: 'margin', label: t.columns.margin },
              ...(compared
                ? [
                    {
                      id: 'compareContribution',
                      label: t.columns.contribution,
                      group: t.columns.compare,
                      compare: true,
                    },
                    {
                      id: 'compareMargin',
                      label: t.columns.margin,
                      group: t.columns.compare,
                      compare: true,
                    },
                  ]
                : []),
            ]}
            currency={currency}
            labels={{ row: t.profitability.by[by], none: t.none }}
            rows={[
              ...rows.map(
                (row): ReportTableRow => ({
                  key: row.value?.id ?? 'unassigned',
                  label: <ReportValueName value={row.value} none={t.profitability.unassigned} />,
                  figures: {
                    revenue: {
                      value: BigInt(row.current.revenue),
                      link: linesLink(linesOf(row, 'is.revenue')),
                      linkLabel: t.drill.figure,
                    },
                    directCosts: {
                      value: BigInt(row.current.directCosts),
                      link: linesLink(linesOf(row, 'is.direct_costs')),
                      linkLabel: t.drill.figure,
                    },
                    ...figuresOf(row.current, row.compare),
                  },
                }),
              ),
              {
                key: 'totals',
                label: t.totals.total,
                kind: 'total',
                figures: {
                  revenue: { value: BigInt(data.totals.current.revenue) },
                  directCosts: { value: BigInt(data.totals.current.directCosts) },
                  ...figuresOf(data.totals.current, data.totals.compare),
                },
              },
            ]}
          />
        )}
      </ReportState>
    </ReportFrame>
  );
}

/** A margin with one decimal and its percent sign, "—" without revenue (rule 21). */
function marginFigure(margin: string | null): ReportFigure {
  return margin === null ? { value: null } : { value: null, text: `${margin}%` };
}
