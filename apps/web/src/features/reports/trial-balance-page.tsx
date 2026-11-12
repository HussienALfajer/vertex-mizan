import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { debitCreditOf, type Ledger, type TrialBalanceRow } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  type ReportFigure,
  ReportTable,
  type ReportTableColumn,
  type ReportTableRow,
  SelectField,
  SwitchField,
} from '@vertex-mizan/ui';
import { addDays, damascusToday, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import {
  CodeRangeFields,
  CompareFields,
  compareParams,
  DateInput,
  excelPathOf,
  type LinesSearch,
  linesLink,
  ReportAccountName,
  ReportExport,
  ReportFrame,
  ReportState,
  UnbalancedNotice,
} from './report-parts';
import { flagText, monthStart } from './report-search';
import { paramsOf, trialBalanceQuery } from './reports-queries';

const t = ar.reports;
const route = getRouteApi('/_app/_company/reports/trial-balance');

/** `/reports/trial-balance`'s search (rule 9); each unset parameter keeps the API's default. */
export interface TrialBalanceSearch {
  from?: string | undefined;
  to?: string | undefined;
  ledger?: Ledger | undefined;
  level?: 1 | 2 | 3 | 4 | undefined;
  codeFrom?: string | undefined;
  codeTo?: string | undefined;
  nonZero?: boolean | undefined;
  compare?: boolean | undefined;
  compareFrom?: string | undefined;
  compareTo?: string | undefined;
}

const levelOptions = ([1, 2, 3, 4] as const).map((level) => ({
  value: String(level) as '1' | '2' | '3' | '4',
  label: `${t.filters.level} ${level}`,
}));

/**
 * `/reports/trial-balance` (rule 9, "Screens"): six columns per account (opening, the period's
 * debits and credits, closing, each balance on its side) and the comparative's closing, at a
 * level of the chart, a code range, non-zero accounts by default; each figure opens its lines,
 * the totals are checked equal; Excel and PDF.
 */
export function TrialBalancePage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/trial-balance' });
  const { companyId } = useCompany();
  const from = search.from ?? monthStart();
  const to = search.to ?? damascusToday();
  const ledger = search.ledger ?? 'book';
  const ordered = from <= to;
  const params = {
    from,
    to,
    ledger,
    level: search.level === undefined ? undefined : String(search.level),
    codeFrom: search.codeFrom,
    codeTo: search.codeTo,
    nonZero: flagText(search.nonZero),
    ...compareParams(search),
  };
  const report = useQuery({ ...trialBalanceQuery(companyId, params), enabled: ordered });
  const set = (patch: Partial<TrialBalanceSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const data = report.data;
  const currency = data?.header.currency ?? 'SYP';
  const compared = data?.header.compare ?? null;

  const columns: ReportTableColumn[] = [
    { id: 'openingDebit', label: t.columns.debit, group: t.columns.opening },
    { id: 'openingCredit', label: t.columns.credit, group: t.columns.opening },
    { id: 'debits', label: t.columns.debit, group: t.columns.movement },
    { id: 'credits', label: t.columns.credit, group: t.columns.movement },
    { id: 'closingDebit', label: t.columns.debit, group: t.columns.closing },
    { id: 'closingCredit', label: t.columns.credit, group: t.columns.closing },
    ...(compared
      ? [
          { id: 'compareDebit', label: t.columns.debit, group: t.columns.compare, compare: true },
          { id: 'compareCredit', label: t.columns.credit, group: t.columns.compare, compare: true },
        ]
      : []),
  ];

  const lines = (row: TrialBalanceRow, figure: Omit<LinesSearch, 'ledger' | 'account'>) =>
    linesLink({ ledger, account: row.account.id, ...figure });

  const rowOf = (row: TrialBalanceRow): ReportTableRow => {
    const opening = debitCreditOf(BigInt(row.opening));
    const closing = debitCreditOf(BigInt(row.closing));
    const balanceTo = { to: addDays(from, -1) };
    const figures: Record<string, ReportFigure> = {
      debits: {
        value: BigInt(row.debits),
        link: lines(row, { from, to, side: 'debit' }),
        linkLabel: t.drill.figure,
      },
      credits: {
        value: BigInt(row.credits),
        link: lines(row, { from, to, side: 'credit' }),
        linkLabel: t.drill.figure,
      },
    };
    if (opening.debitMinor !== null) {
      figures.openingDebit = { value: opening.debitMinor, link: lines(row, balanceTo) };
    }
    if (opening.creditMinor !== null) {
      figures.openingCredit = { value: opening.creditMinor, link: lines(row, balanceTo) };
    }
    if (closing.debitMinor !== null) {
      figures.closingDebit = { value: closing.debitMinor, link: lines(row, { to }) };
    }
    if (closing.creditMinor !== null) {
      figures.closingCredit = { value: closing.creditMinor, link: lines(row, { to }) };
    }
    if (compared) {
      // A comparative with no posted line shows "—" (rule 5); otherwise its closing on its side.
      if (!compared.hasLines || row.compare === null) {
        figures.compareDebit = { value: null };
        figures.compareCredit = { value: null };
      } else {
        // The comparative's closing balance: every line of the account to its end.
        const side = debitCreditOf(BigInt(row.compare));
        const link = lines(row, { to: compared.to });
        if (side.debitMinor !== null) figures.compareDebit = { value: side.debitMinor, link };
        if (side.creditMinor !== null) figures.compareCredit = { value: side.creditMinor, link };
      }
    }
    return {
      key: row.account.id,
      label: <ReportAccountName account={row.account} />,
      level: row.account.level,
      kind: row.account.postable ? 'line' : 'subtotal',
      figures,
    };
  };

  const comparativeTotal = (total: string | null) =>
    compared?.hasLines && total !== null ? BigInt(total) : null;
  const totals = data?.totals;
  const balanced =
    !totals ||
    (totals.openingDebit === totals.openingCredit &&
      totals.debits === totals.credits &&
      totals.closingDebit === totals.closingCredit);

  return (
    <ReportFrame
      report="trial-balance"
      search={search}
      title={t.names.trial_balance}
      description={`${formatDay(from)} – ${formatDay(to)}`}
      actions={
        <ReportExport
          disabled={!data}
          excelPath={excelPathOf('trial_balance', params)}
          pdf={{ report: 'trial_balance', params: paramsOf(params) }}
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
          <SelectField
            label={t.filters.level}
            value={String(search.level ?? 4) as '1' | '2' | '3' | '4'}
            options={levelOptions}
            onValueChange={(level) => set({ level: Number(level) as 1 | 2 | 3 | 4 })}
          />
          <SwitchField
            label={t.filters.nonZero}
            checked={search.nonZero ?? true}
            onCheckedChange={(nonZero) => set({ nonZero })}
          />
          <CodeRangeFields
            codeFrom={search.codeFrom}
            codeTo={search.codeTo}
            onChange={(codes) => set(codes)}
          />
          <CompareFields
            compare={search.compare ?? true}
            from={search.compareFrom ?? ''}
            to={search.compareTo ?? ''}
            onChange={(patch) => set(patch)}
          />
          {!ordered && (
            <p className="text-destructive-text sm:col-span-2">{t.filters.invalidRange}</p>
          )}
        </>
      }
    >
      <ReportState query={report} empty={data !== undefined && data.rows.length === 0}>
        {data && totals && (
          <>
            <UnbalancedNotice balanced={balanced} />
            <ReportTable
              caption={`${t.names.trial_balance} ${from} – ${to}`}
              columns={columns}
              currency={currency}
              labels={{ row: t.columns.account, none: t.none }}
              rows={[
                ...data.rows.map(rowOf),
                {
                  key: 'totals',
                  label: t.totals.total,
                  kind: 'total',
                  figures: {
                    openingDebit: { value: BigInt(totals.openingDebit) },
                    openingCredit: { value: BigInt(totals.openingCredit) },
                    debits: { value: BigInt(totals.debits) },
                    credits: { value: BigInt(totals.credits) },
                    closingDebit: { value: BigInt(totals.closingDebit) },
                    closingCredit: { value: BigInt(totals.closingCredit) },
                    ...(compared
                      ? {
                          compareDebit: { value: comparativeTotal(totals.compareDebit) },
                          compareCredit: { value: comparativeTotal(totals.compareCredit) },
                        }
                      : {}),
                  },
                },
              ]}
            />
          </>
        )}
      </ReportState>
    </ReportFrame>
  );
}
