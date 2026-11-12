import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import {
  type IncomeStatement,
  type IncomeSubtotals,
  type Ledger,
  STATEMENT_LINES,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  type ReportFigure,
  ReportTable,
  type ReportTableColumn,
  type ReportTableRow,
} from '@vertex-mizan/ui';
import type { ReactElement } from 'react';
import { damascusToday, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import {
  CompareFields,
  compareParams,
  DateInput,
  excelPathOf,
  linesLink,
  ReportAccountName,
  ReportExport,
  ReportFrame,
  ReportState,
} from './report-parts';
import { monthStart } from './report-search';
import { incomeStatementQuery, paramsOf } from './reports-queries';

const t = ar.reports;
const s = t.statements;
const route = getRouteApi('/_app/_company/reports/income-statement');

/** `/reports/income-statement`'s search (rules 13, 14, 5). */
export interface IncomeStatementSearch {
  from?: string | undefined;
  to?: string | undefined;
  ledger?: Ledger | undefined;
  compare?: boolean | undefined;
  compareFrom?: string | undefined;
  compareTo?: string | undefined;
}

/** The two columns of a statement: the period, and the comparative when there is one. */
export function statementColumns(compared: boolean): ReportTableColumn[] {
  return [
    { id: 'current', label: t.columns.current },
    ...(compared ? [{ id: 'compare', label: t.columns.compare, compare: true }] : []),
  ];
}

/** A statement line's name from the catalogue (S02), its code for one this build does not know. */
export function statementLineName(code: string): string {
  return STATEMENT_LINES.find((line) => line.code === code)?.name ?? code;
}

const categoryOf = (code: string) =>
  STATEMENT_LINES.find((line) => line.code === code)?.ifrs18Category ?? 'operating';

/** A comparative figure: "—" when the comparative has no posted line (rule 5). */
export function compareFigure(
  compare: { hasLines: boolean },
  value: string | null,
  link?: ReactElement,
): ReportFigure {
  const shown = compare.hasLines && value !== null;
  return {
    value: shown ? BigInt(value) : null,
    ...(shown && link ? { link, linkLabel: t.drill.figure } : {}),
  };
}

/**
 * `/reports/income-statement` (rules 13, 14, "Screens"): revenue and other income, then expenses
 * by nature, income positive and expenses negative, each line opening to its accounts and each
 * figure to its lines; the subtotals by IFRS 18 category, "الربح قبل التمويل وضرائب الدخل" only
 * with an investing amount; the comparative; Excel and PDF.
 */
export function IncomeStatementPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/income-statement' });
  const { companyId } = useCompany();
  const from = search.from ?? monthStart();
  const to = search.to ?? damascusToday();
  const ledger = search.ledger ?? 'book';
  const ordered = from <= to;
  const params = {
    from,
    to,
    ledger,
    ...compareParams(search),
  };
  const report = useQuery({ ...incomeStatementQuery(companyId, params), enabled: ordered });
  const set = (patch: Partial<IncomeStatementSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const data = report.data;

  return (
    <ReportFrame
      report="income-statement"
      search={search}
      title={t.names.income_statement}
      description={`${formatDay(from)} – ${formatDay(to)}`}
      actions={
        <ReportExport
          disabled={!data}
          excelPath={excelPathOf('income_statement', params)}
          pdf={{ report: 'income_statement', params: paramsOf(params) }}
        />
      }
      ledger={{ value: ledger, onValueChange: (next) => set({ ledger: next }) }}
      header={data?.header}
      filters={
        <>
          <DateInput label={t.filters.from} value={from} onValueChange={(v) => set({ from: v })} />
          <DateInput
            label={t.filters.to}
            value={to}
            invalid={!ordered}
            onValueChange={(v) => set({ to: v })}
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
      <ReportState query={report} empty={data !== undefined && data.lines.length === 0}>
        {data && (
          <ReportTable
            caption={`${t.names.income_statement} ${from} – ${to}`}
            columns={statementColumns(data.header.compare !== null)}
            currency={data.header.currency}
            labels={{ row: t.columns.line, none: t.none }}
            rows={incomeRows(data, { ledger, from, to })}
          />
        )}
      </ReportState>
    </ReportFrame>
  );
}

/** The statement's rows in rule 14's order, each line followed by its accounts. */
function incomeRows(
  data: IncomeStatement,
  range: { ledger: Ledger; from: string; to: string },
): ReportTableRow[] {
  const compare = data.header.compare;
  // The comparative's lines: the same figure over the comparative's dates.
  const compareRange = {
    ledger: range.ledger,
    from: compare?.from ?? undefined,
    to: compare?.to ?? range.to,
  };
  const lineRows = (wanted: string) =>
    data.lines
      .filter((line) => categoryOf(line.line) === wanted)
      .flatMap((line): ReportTableRow[] => [
        {
          key: line.line,
          label: statementLineName(line.line),
          figures: {
            current: {
              value: BigInt(line.amount),
              link: linesLink({ ...range, statementLine: line.line }),
              linkLabel: t.drill.figure,
            },
            ...(compare
              ? {
                  compare: compareFigure(
                    compare,
                    line.compare,
                    linesLink({ ...compareRange, statementLine: line.line }),
                  ),
                }
              : {}),
          },
        },
        ...line.accounts.map(
          (part): ReportTableRow => ({
            key: `${line.line}-${part.account.id}`,
            label: <ReportAccountName account={part.account} />,
            level: 2,
            figures: {
              current: {
                value: BigInt(part.amount),
                link: linesLink({ ...range, account: part.account.id }),
                linkLabel: t.drill.figure,
              },
              ...(compare
                ? {
                    compare: compareFigure(
                      compare,
                      part.compare,
                      linesLink({ ...compareRange, account: part.account.id }),
                    ),
                  }
                : {}),
            },
          }),
        ),
      ]);
  const subtotal = (
    key: keyof IncomeSubtotals,
    label: string,
    current: string | null,
    comparative: string | null,
    kind: 'subtotal' | 'total' = 'subtotal',
  ): ReportTableRow => ({
    key,
    label,
    kind,
    figures: {
      current: { value: current === null ? null : BigInt(current) },
      ...(compare ? { compare: compareFigure(compare, comparative) } : {}),
    },
  });
  // Shown when either column has an investing amount; in a column without one it is its
  // operating profit (rule 14, IAS 1.38), as the printed statement shows it.
  const beforeFinancing = (subtotals: IncomeSubtotals | null) =>
    subtotals === null
      ? null
      : (subtotals.profitBeforeFinancingAndIncomeTaxes ?? subtotals.operatingProfit);
  const showsBeforeFinancing =
    data.subtotals.profitBeforeFinancingAndIncomeTaxes !== null ||
    (data.compareSubtotals?.profitBeforeFinancingAndIncomeTaxes ?? null) !== null;
  const other = data.compareSubtotals;
  return [
    ...lineRows('operating'),
    subtotal(
      'operatingProfit',
      s.operatingProfit,
      data.subtotals.operatingProfit,
      other?.operatingProfit ?? null,
    ),
    ...lineRows('investing'),
    ...(showsBeforeFinancing
      ? [
          subtotal(
            'profitBeforeFinancingAndIncomeTaxes',
            s.profitBeforeFinancingAndIncomeTaxes,
            beforeFinancing(data.subtotals),
            beforeFinancing(other),
          ),
        ]
      : []),
    ...lineRows('financing'),
    subtotal(
      'profitBeforeTax',
      s.profitBeforeTax,
      data.subtotals.profitBeforeTax,
      other?.profitBeforeTax ?? null,
    ),
    ...lineRows('income_taxes'),
    subtotal('profit', s.profit, data.subtotals.profit, other?.profit ?? null, 'total'),
  ];
}
