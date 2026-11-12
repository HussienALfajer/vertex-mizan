import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import type { ContractPositionRow, Ledger } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Badge, ReportTable, type ReportTableColumn, type ReportTableRow } from '@vertex-mizan/ui';
import { damascusToday, formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { currentMonth, formatMonth } from '../revenue/revenue-parts';
import {
  DateInput,
  excelPathOf,
  linesLink,
  MonthInput,
  ReportExport,
  ReportFrame,
  ReportState,
  ReportValueName,
} from './report-parts';
import { contractPositionQuery, paramsOf, revenueScheduleQuery } from './reports-queries';

const t = ar.reports;

/** `/reports/contract-position`'s search (rule 24). */
export interface ContractPositionSearch {
  asOf?: string | undefined;
  ledger?: Ledger | undefined;
}

/** `/reports/revenue-schedule`'s search (rule 25). */
export interface RevenueScheduleSearch {
  from?: string | undefined;
  ledger?: Ledger | undefined;
}

const positionRoute = getRouteApi('/_app/_company/reports/contract-position');
const scheduleRoute = getRouteApi('/_app/_company/reports/revenue-schedule');

/** A contract's name, opening its schedules on `/revenue` (S06). */
function ContractCell({
  contract,
  client,
  kind,
}: {
  contract: ContractPositionRow['contract'] | null;
  client: ContractPositionRow['client'];
  kind?: ContractPositionRow['kind'] | undefined;
}) {
  const { me } = useCompany();
  return (
    <span className="flex flex-col gap-0.5">
      {contract && can(me, 'recognition.read') ? (
        <Link
          to="/revenue"
          search={{ contract: contract.id }}
          aria-label={`${t.contracts.schedules}: ${contract.name}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          <ReportValueName value={contract} />
        </Link>
      ) : contract ? (
        <ReportValueName value={contract} />
      ) : (
        <span className="text-muted-foreground">{t.contracts.noContract}</span>
      )}
      <span className="flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">
        <ReportValueName value={client} />
        {kind && <Badge tone="outline">{t.contractKinds[kind]}</Badge>}
      </span>
    </span>
  );
}

/**
 * `/reports/contract-position` (rule 24, "Screens"): per contract, its gross contract assets and
 * liabilities, the net and the side it is presented on, its client and kind, each opening its
 * schedules; the totals as the balance sheet's two lines, and the balances without a contract;
 * Excel and PDF.
 */
export function ContractPositionPage() {
  const search = positionRoute.useSearch();
  const navigate = useNavigate({ from: '/reports/contract-position' });
  const { companyId } = useCompany();
  const asOf = search.asOf ?? damascusToday();
  const ledger = search.ledger ?? 'book';
  const params = { asOf, ledger };
  const report = useQuery(contractPositionQuery(companyId, params));
  const set = (patch: Partial<ContractPositionSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const data = report.data;
  const columns: ReportTableColumn[] = [
    { id: 'assets', label: t.columns.contractAssets },
    { id: 'liabilities', label: t.columns.contractLiabilities },
    { id: 'net', label: t.columns.net },
  ];
  const rows: ReportTableRow[] = (data?.rows ?? []).map((row) => ({
    key: row.contract.id,
    label: <ContractCell contract={row.contract} client={row.client} kind={row.kind} />,
    note:
      row.net === '0'
        ? undefined
        : `${t.columns.side}: ${row.net.startsWith('-') ? t.sides.liabilities : t.sides.assets}`,
    figures: {
      assets: {
        value: BigInt(row.assets),
        link: linesLink({
          ledger,
          to: asOf,
          statementLine: 'bs.contract_assets',
          contract: row.contract.id,
        }),
        linkLabel: t.drill.figure,
      },
      liabilities: {
        value: BigInt(row.liabilities),
        link: linesLink({
          ledger,
          to: asOf,
          statementLine: 'bs.contract_liabilities',
          contract: row.contract.id,
        }),
        linkLabel: t.drill.figure,
      },
      net: { value: BigInt(row.net) },
    },
  }));

  return (
    <ReportFrame
      report="contract-position"
      search={search}
      title={t.names.contract_position}
      description={`${t.header.asOf} ${formatDay(asOf)}`}
      actions={
        <ReportExport
          disabled={!data}
          excelPath={excelPathOf('contract_position', params)}
          pdf={{ report: 'contract_position', params: paramsOf(params) }}
        />
      }
      ledger={{ value: ledger, onValueChange: (next) => set({ ledger: next }) }}
      header={data?.header}
      filters={
        <DateInput label={t.filters.asOf} value={asOf} onValueChange={(v) => set({ asOf: v })} />
      }
    >
      <ReportState query={report} empty={data !== undefined && data.rows.length === 0}>
        {data && (
          <ReportTable
            caption={`${t.contracts.caption} ${asOf}`}
            columns={columns}
            currency={data.header.currency}
            labels={{ row: t.columns.contract, none: t.none }}
            rows={[
              ...rows,
              {
                key: 'without-contract',
                label: t.totals.withoutContract,
                figures: {
                  assets: { value: BigInt(data.totals.withoutContractAssets) },
                  liabilities: { value: BigInt(data.totals.withoutContractLiabilities) },
                },
              },
              // The balance sheet's two lines (rule 24): the contracts' net debits and net
              // credits, each under the net column, never as the gross columns' totals.
              {
                key: 'balance-sheet-assets',
                label: t.contracts.balanceSheetAssets,
                kind: 'subtotal',
                figures: { net: { value: BigInt(data.totals.contractAssets) } },
              },
              {
                key: 'balance-sheet-liabilities',
                label: t.contracts.balanceSheetLiabilities,
                kind: 'subtotal',
                figures: { net: { value: BigInt(data.totals.contractLiabilities) } },
              },
            ]}
          />
        )}
      </ReportState>
    </ReportFrame>
  );
}

/**
 * `/reports/revenue-schedule` (rule 25, "Screens"): from a month, per contract, the over-time
 * releases still to post in each month ahead and what waits for a done ("عند الإنجاز"), with the
 * totals equal to what the schedules still have to recognise; Excel and PDF.
 */
export function RevenueSchedulePage() {
  const search = scheduleRoute.useSearch();
  const navigate = useNavigate({ from: '/reports/revenue-schedule' });
  const { companyId } = useCompany();
  const from = search.from ?? currentMonth();
  const ledger = search.ledger ?? 'book';
  const params = { from, ledger };
  const report = useQuery(revenueScheduleQuery(companyId, params));
  const set = (patch: Partial<RevenueScheduleSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const data = report.data;
  const columns: ReportTableColumn[] = [
    ...(data?.months ?? []).map((month) => ({ id: month, label: formatMonth(month) })),
    { id: 'atDone', label: t.columns.atDone },
    { id: 'total', label: t.columns.total },
  ];
  const figuresOf = (row: {
    months: readonly { month: string; amount: string }[];
    atDone: string;
    total: string;
  }) => ({
    ...Object.fromEntries(row.months.map((cell) => [cell.month, { value: BigInt(cell.amount) }])),
    atDone: { value: BigInt(row.atDone) },
    total: { value: BigInt(row.total) },
  });

  return (
    <ReportFrame
      report="revenue-schedule"
      search={search}
      title={t.names.revenue_schedule}
      description={formatMonth(from)}
      actions={
        <ReportExport
          disabled={!data}
          excelPath={excelPathOf('revenue_schedule', params)}
          pdf={{ report: 'revenue_schedule', params: paramsOf(params) }}
        />
      }
      ledger={{ value: ledger, onValueChange: (next) => set({ ledger: next }) }}
      header={data?.header}
      filters={
        <MonthInput
          label={t.filters.fromMonth}
          value={from}
          onValueChange={(v) => set({ from: v || undefined })}
        />
      }
    >
      <ReportState query={report} empty={data !== undefined && data.rows.length === 0}>
        {data && (
          <ReportTable
            caption={`${t.contracts.scheduleCaption} ${from}`}
            columns={columns}
            currency={data.header.currency}
            labels={{ row: t.columns.contract, none: t.none }}
            rows={[
              ...data.rows.map(
                (row, index): ReportTableRow => ({
                  key: row.contract?.id ?? `none-${index}`,
                  label: <ContractCell contract={row.contract} client={row.client} />,
                  figures: figuresOf(row),
                }),
              ),
              {
                key: 'totals',
                label: t.totals.total,
                kind: 'total',
                figures: figuresOf(data.totals),
              },
            ]}
          />
        )}
      </ReportState>
    </ReportFrame>
  );
}
