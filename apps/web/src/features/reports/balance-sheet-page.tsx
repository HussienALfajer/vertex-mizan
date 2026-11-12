import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import {
  type BalanceSheet,
  type BalanceSheetPart,
  type Ledger,
  STATEMENT_LINES,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Amount, ReportTable, type ReportTableRow, SwitchField } from '@vertex-mizan/ui';
import type { ReactNode } from 'react';
import { damascusToday, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { compareFigure, statementColumns, statementLineName } from './income-statement-page';
import {
  DateInput,
  excelPathOf,
  linesLink,
  ReportAccountName,
  ReportExport,
  ReportFrame,
  ReportState,
  ReportValueName,
  UnbalancedNotice,
} from './report-parts';
import { flagText } from './report-search';
import { balanceSheetQuery, paramsOf } from './reports-queries';

const t = ar.reports;
const s = t.statements;
const route = getRouteApi('/_app/_company/reports/balance-sheet');

/** `/reports/balance-sheet`'s search (rules 15–19, 5). */
export interface BalanceSheetSearch {
  asOf?: string | undefined;
  ledger?: Ledger | undefined;
  compare?: boolean | undefined;
  compareAsOf?: string | undefined;
}

const sectionOf = (code: string) => STATEMENT_LINES.find((line) => line.code === code)?.section;

/**
 * `/reports/balance-sheet` (rules 15–19, "Screens"): as of a date, the four sections with their
 * totals, assets equal to liabilities and equity; each line opening to the balances it is made of
 * (an account, per contract or per client) and those to their lines; the reclassifications of
 * rule 18 and the unclosed years of rule 16 noted under their lines, a balance on the opposite
 * side flagged; "ربح (خسارة) السنة الحالية" in equity; the comparative; Excel and PDF.
 */
export function BalanceSheetPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/balance-sheet' });
  const { companyId } = useCompany();
  const asOf = search.asOf ?? damascusToday();
  const ledger = search.ledger ?? 'book';
  const params = {
    asOf,
    ledger,
    compare: flagText(search.compare),
    compareAsOf: search.compare === false ? undefined : search.compareAsOf,
  };
  const report = useQuery(balanceSheetQuery(companyId, params));
  const set = (patch: Partial<BalanceSheetSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const data = report.data;

  return (
    <ReportFrame
      report="balance-sheet"
      search={search}
      title={t.names.balance_sheet}
      description={`${t.header.asOf} ${formatDay(asOf)}`}
      actions={
        <ReportExport
          disabled={!data}
          excelPath={excelPathOf('balance_sheet', params)}
          pdf={{ report: 'balance_sheet', params: paramsOf(params) }}
        />
      }
      ledger={{ value: ledger, onValueChange: (next) => set({ ledger: next }) }}
      header={data?.header}
      filters={
        <>
          <DateInput label={t.filters.asOf} value={asOf} onValueChange={(v) => set({ asOf: v })} />
          <SwitchField
            label={t.filters.compare}
            description={t.filters.compareAsOfHint}
            checked={search.compare ?? true}
            onCheckedChange={(compare) => set({ compare })}
          />
          {(search.compare ?? true) && (
            <DateInput
              label={t.filters.compareAsOf}
              value={search.compareAsOf ?? ''}
              onValueChange={(v) => set({ compareAsOf: v || undefined })}
            />
          )}
        </>
      }
    >
      <ReportState query={report}>
        {data && (
          <>
            <UnbalancedNotice balanced={data.totals.assets === data.totals.liabilitiesAndEquity} />
            <ReportTable
              caption={`${t.names.balance_sheet} ${asOf}`}
              columns={statementColumns(data.header.compare !== null)}
              currency={data.header.currency}
              labels={{ row: t.columns.line, none: t.none }}
              rows={balanceRows(data, { ledger, to: asOf })}
            />
          </>
        )}
      </ReportState>
    </ReportFrame>
  );
}

/** A part's name: its account, and the contract or client it is read per. */
function partLabel(part: BalanceSheetPart): ReactNode {
  return (
    <span className="flex flex-col">
      <ReportAccountName account={part.account} />
      {(part.contract || part.client) && (
        <span className="text-xs text-muted-foreground">
          <ReportValueName value={part.contract ?? part.client} />
        </span>
      )}
    </span>
  );
}

/** The notes under a line (rules 16, 18): what was reclassified, the unclosed years, Q17's flag. */
function lineNote(
  line: BalanceSheet['lines'][number],
  currency: BalanceSheet['header']['currency'],
) {
  const notes: ReactNode[] = [];
  if (line.reclassified !== '0') {
    notes.push(
      <span key="reclassified" data-note="reclassified">
        {`${s.reclassified}: `}
        <Amount value={BigInt(line.reclassified)} currency={currency} />
      </span>,
    );
  }
  if (line.unclosedYears !== null && line.unclosedYears !== '0') {
    notes.push(
      <span key="unclosed" data-note="unclosed-years">
        {`${s.unclosedYears}: `}
        <Amount value={BigInt(line.unclosedYears)} currency={currency} />
      </span>,
    );
  }
  return notes.length === 0 ? undefined : <span className="flex flex-col">{notes}</span>;
}

/**
 * Whether `/reports/lines` can read exactly a part's lines (rule 6): its filter names the account
 * and, when the part has them, its client and contract, but cannot ask for "no client" or "no
 * contract". So a part without one is drillable only when no other part of the same account falls
 * inside its filter (another client's balance, another contract's); otherwise its lines would
 * not sum to it, and it shows without a link.
 */
function drillable(part: BalanceSheetPart, parts: readonly BalanceSheetPart[]): boolean {
  return !parts.some(
    (other) =>
      other !== part &&
      other.account.id === part.account.id &&
      (part.client === null || other.client?.id === part.client.id) &&
      (part.contract === null || other.contract?.id === part.contract.id),
  );
}

/** The sheet's rows in the printed order (rules 15, 16). */
function balanceRows(data: BalanceSheet, range: { ledger: Ledger; to: string }): ReportTableRow[] {
  const compare = data.header.compare;
  const currency = data.header.currency;
  const allParts = data.lines.flatMap((line) => line.parts);
  const linesOf = (section: string) =>
    data.lines
      .filter((line) => sectionOf(line.line) === section)
      .flatMap((line): ReportTableRow[] => [
        {
          key: line.line,
          label: statementLineName(line.line),
          note: lineNote(line, currency),
          figures: {
            current: { value: BigInt(line.amount) },
            ...(compare ? { compare: compareFigure(compare, line.compare) } : {}),
          },
        },
        ...line.parts.map(
          (part, index): ReportTableRow => ({
            key: `${line.line}-${part.account.id}-${part.client?.id ?? part.contract?.id ?? index}`,
            label: partLabel(part),
            level: 2,
            note: part.reclassified
              ? s.reclassified
              : part.oppositeSide
                ? s.oppositeSide
                : undefined,
            figures: {
              current: {
                value: BigInt(part.amount),
                link: drillable(part, allParts)
                  ? linesLink({
                      ...range,
                      account: part.account.id,
                      client: part.client?.id,
                      contract: part.contract?.id,
                    })
                  : undefined,
                linkLabel: t.drill.figure,
              },
            },
          }),
        ),
      ]);
  const section = (key: keyof typeof s.sections): ReportTableRow[] => [
    { key: `section-${key}`, label: s.sections[key], kind: 'heading' },
    ...linesOf(key),
  ];
  const total = (
    key: keyof BalanceSheet['totals'],
    label: string,
    kind: 'subtotal' | 'total',
  ): ReportTableRow => ({
    key: `total-${key}`,
    label,
    kind,
    figures: {
      current: { value: BigInt(data.totals[key]) },
      ...(compare ? { compare: compareFigure(compare, data.compareTotals?.[key] ?? null) } : {}),
    },
  });
  return [
    ...section('current_assets'),
    ...section('non_current_assets'),
    total('assets', t.totals.assets, 'total'),
    ...section('current_liabilities'),
    total('liabilities', t.totals.liabilities, 'subtotal'),
    ...section('equity'),
    {
      key: 'year-result',
      label: s.yearResult,
      figures: {
        current: { value: BigInt(data.yearResult) },
        ...(compare ? { compare: compareFigure(compare, data.compareYearResult) } : {}),
      },
    },
    total('equity', t.totals.equity, 'subtotal'),
    total('liabilitiesAndEquity', t.totals.liabilitiesAndEquity, 'total'),
  ];
}
