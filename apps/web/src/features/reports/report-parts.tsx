import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type ErrorCode,
  type Ledger,
  type Report,
  type ReportAccount,
  type ReportFile,
  type ReportHeader,
  type ReportValue,
  reportFileSchema,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  AccountLabel,
  Badge,
  Button,
  Card,
  EmptyState,
  ExportMenu,
  type ExportMenuFile,
  Field,
  FieldLabel,
  Input,
  PageHeader,
  type ReportMarkItem,
  ReportMarks,
  Skeleton,
  SwitchField,
} from '@vertex-mizan/ui';
import { ArrowRightIcon, FileBarChartIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { FormError } from '../../components/form-error';
import { api, download } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { EntryNumberText, useFiscalYearStartMonth } from '../entries/entry-parts';
import { ReportLedgerSwitch } from '../receivables/receivables-parts';
import { flagText, rememberSearch } from './report-search';
import { type ReportParams, reportFileQuery, searchOf } from './reports-queries';

const t = ar.reports;

/** The way back to `/reports`, above a report's title. */
export function ReportsBackLink() {
  return (
    <Button variant="ghost" size="sm" className="w-fit" render={<Link to="/reports" />}>
      <ArrowRightIcon aria-hidden="true" />
      {t.back}
    </Button>
  );
}

/** An account as the reports name it: its code and name, archived and blocked marked (rule 7). */
export function ReportAccountName({
  account,
}: {
  account: Pick<ReportAccount, 'code' | 'name'> &
    Partial<Pick<ReportAccount, 'archived' | 'blocked'>>;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <AccountLabel code={account.code} name={account.name} />
      {account.archived && <Badge tone="neutral">{t.archived}</Badge>}
      {account.blocked && <Badge tone="danger">{t.blocked}</Badge>}
    </span>
  );
}

/** A dimension value as the reports name it: its code first, archived marked. */
export function ReportValueName({
  value,
  none,
}: {
  value: (Pick<ReportValue, 'code' | 'name'> & Partial<Pick<ReportValue, 'archived'>>) | null;
  none?: string;
}) {
  if (!value) return <span className="text-muted-foreground">{none ?? t.none}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {value.code && (
        <bdi dir="ltr" className="font-medium tabular-nums">
          {value.code}
        </bdi>
      )}
      <bdi>{value.name}</bdi>
      {value.archived && <Badge tone="neutral">{t.archived}</Badge>}
    </span>
  );
}

/** The dimension values a line carries, each with its code first. */
export function ReportValues({ values }: { values: readonly ReportValue[] }) {
  if (values.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value.id} tone="outline">
          {value.code && <bdi dir="ltr">{value.code}</bdi>}
          <bdi>{value.name}</bdi>
        </Badge>
      ))}
    </span>
  );
}

/** The search of `/reports/lines`: the figure's parameters (rule 6). */
export interface LinesSearch {
  ledger?: Ledger | undefined;
  from?: string | undefined;
  to: string;
  account?: string | undefined;
  statementLine?: string | undefined;
  side?: 'debit' | 'credit' | undefined;
  client?: string | undefined;
  contract?: string | undefined;
  profitabilityBy?: string | undefined;
  profitabilityValue?: string | undefined;
  /** S10 rule 32: only the opening entries' lines, an opening column read from them. */
  openingEntry?: 'true' | undefined;
}

/** A figure's drill-down: the link to the lines behind it, for `ReportTable`'s `link`. */
export function linesLink(search: LinesSearch) {
  return <Link to="/reports/lines" search={search} />;
}

/**
 * Where a mark leads: the month's period page, or its revaluation in the report's ledger; S10's
 * marks only explain how the report was read, and lead nowhere.
 */
function markLink(mark: ReportHeader['current']['marks'][number], month: string, ledger: Ledger) {
  if (mark === 'period_open') return <Link to="/periods/$period" params={{ period: month }} />;
  if (mark === 'before_revaluation') {
    return <Link to="/revaluation" search={{ period: month, ledger }} />;
  }
  return undefined;
}

/** The marks of every column of a report's header (rule 4), with their links. */
export function HeaderMarks({ header }: { header: ReportHeader }) {
  const { companyId, me } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const readsPeriods = can(me, 'periods.read');
  const marksOf = (column: ReportHeader['current']): ReportMarkItem[] =>
    column.marks.map((mark) => {
      const month = column.to.slice(0, 7);
      return {
        mark,
        label: t.marks[mark].replace('{date}', header.booksStart ?? ''),
        link: readsPeriods ? markLink(mark, month, header.ledger) : undefined,
        linkLabel: mark === 'period_open' ? t.markLinks.period : t.markLinks.revaluation,
      };
    });
  return (
    <ReportMarks
      aria-label={t.filters.label}
      columns={[
        { key: 'current', marks: marksOf(header.current) },
        ...(header.compare
          ? [{ key: 'compare', label: t.columns.compare, marks: marksOf(header.compare) }]
          : []),
      ]}
      details={[
        {
          label: t.header.producedAt,
          value: <bdi>{formatDateTime(header.producedAt)}</bdi>,
        },
        {
          label: t.header.latestEntry,
          value: header.latestEntry ? (
            <EntryNumberText number={header.latestEntry} startMonth={startMonth} />
          ) : (
            t.header.noEntry
          ),
        },
      ]}
    />
  );
}

/** A PDF state as `ExportMenu` shows it, its failure in words. */
function menuFile(file: ReportFile | undefined): ExportMenuFile | null {
  if (!file) return null;
  const code = file.error as ErrorCode | null;
  return {
    state: file.state,
    error:
      code && code in ar.errors
        ? ar.errors[code]
        : file.error
          ? ar.common.errorDescription
          : undefined,
  };
}

/**
 * A report's PDF (rule 36): the request, the file read again while it is queued, its download.
 * One file at a time per screen; a new request replaces the one shown.
 */
export function useReportFile(companyId: string) {
  const queryClient = useQueryClient();
  const [id, setId] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: (body: { report: Report; params: Record<string, string>; official?: boolean }) =>
      api('POST', '/reports/files', { company: companyId, body, schema: reportFileSchema }),
    onSuccess: (file) => {
      queryClient.setQueryData(reportFileQuery(companyId, file.id).queryKey, file);
      setId(file.id);
    },
  });
  const file = useQuery({ ...reportFileQuery(companyId, id ?? ''), enabled: id !== null });
  const fetchFile = useMutation({
    mutationFn: () => download(`/reports/files/${id}/download`, { company: companyId }),
  });
  return {
    request,
    file: id === null ? undefined : file.data,
    menuFile: id === null ? null : menuFile(file.data),
    fetchFile,
    error: request.error ?? fetchFile.error ?? file.error,
  };
}

/**
 * A report's exports (rules 35, 36) through `ExportMenu`: Excel from `excelPath` at once, the PDF
 * of `pdf` queued; either may be absent. Refusals show under it.
 */
export function ReportExport({
  excelPath,
  pdf,
  disabled,
}: {
  excelPath?: string | undefined;
  pdf?: { report: Report; params: Record<string, string> } | undefined;
  disabled?: boolean | undefined;
}) {
  const { companyId } = useCompany();
  const excel = useMutation({
    mutationFn: (path: string) => download(path, { company: companyId }),
  });
  const file = useReportFile(companyId);
  return (
    <div className="flex flex-col items-end gap-1">
      <ExportMenu
        labels={t.exportMenu}
        disabled={disabled}
        pending={excel.isPending ? 'excel' : file.request.isPending ? 'pdf' : null}
        onExcel={excelPath ? () => excel.mutate(excelPath) : undefined}
        onPdf={pdf ? () => file.request.mutate(pdf) : undefined}
        file={file.menuFile}
        onDownload={() => file.fetchFile.mutate()}
        downloading={file.fetchFile.isPending}
      />
      <FormError error={excel.error ?? file.error} />
    </div>
  );
}

/** The Excel path of a report of `/api/reports/:report/export`. */
export function excelPathOf(report: Report, params: ReportParams): string {
  return `/reports/${report}/export${searchOf({ ...params, format: 'xlsx' })}`;
}

/**
 * A report's page (S09 "Screens"): the way back, its title and exports, its parameters in a card,
 * the ledger switch, the header's marks once read, and its content. The search is kept as the
 * report's last parameters in this browser.
 */
export function ReportFrame({
  report,
  search,
  title,
  description,
  actions,
  filters,
  ledger,
  header,
  children,
}: {
  /** The key the last parameters are kept under. */
  report: string;
  search: object;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  ledger?: { value: Ledger; onValueChange: (ledger: Ledger) => void } | undefined;
  header?: ReportHeader | undefined;
  children: ReactNode;
}) {
  const { companyId, me } = useCompany();
  const personId = me.person.id;
  const kept = JSON.stringify(search);
  useEffect(
    () => rememberSearch({ personId, companyId }, report, JSON.parse(kept)),
    [personId, companyId, report, kept],
  );
  return (
    <>
      <PageHeader
        back={<ReportsBackLink />}
        title={title}
        description={description}
        actions={actions}
      />
      {filters && (
        <Card className="p-4">
          <search aria-label={t.filters.label} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {filters}
          </search>
        </Card>
      )}
      {ledger && (
        <ReportLedgerSwitch
          companyId={companyId}
          value={ledger.value}
          onValueChange={ledger.onValueChange}
        />
      )}
      {header && <HeaderMarks header={header} />}
      {children}
    </>
  );
}

/** A report's loading, error and empty states (S09 "Screens"); its content otherwise. */
export function ReportState({
  query,
  empty,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown };
  empty?: boolean | undefined;
  children: ReactNode;
}) {
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
        <Skeleton className="h-row" />
      </div>
    );
  }
  if (query.isError) return <FormError error={query.error} />;
  if (empty) {
    return (
      <EmptyState
        icon={<FileBarChartIcon />}
        title={t.states.empty}
        description={t.states.emptyDescription}
      />
    );
  }
  return <>{children}</>;
}

/** A date control of a report's parameters. */
export function DateInput({
  label,
  value,
  onValueChange,
  invalid,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  invalid?: boolean | undefined;
}) {
  return (
    <Field invalid={invalid}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="date"
        dir="ltr"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onValueChange(event.target.value)}
      />
    </Field>
  );
}

/** A month control of a report's parameters (`YYYY-MM`). */
export function MonthInput({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="month"
        dir="ltr"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    </Field>
  );
}

/** A comparative's parameters as the API reads them (rule 5): both dates, in order, or neither. */
export function compareParams(search: {
  compare?: boolean | undefined;
  compareFrom?: string | undefined;
  compareTo?: string | undefined;
}): {
  compare?: string | undefined;
  compareFrom?: string | undefined;
  compareTo?: string | undefined;
} {
  const named =
    search.compare !== false &&
    search.compareFrom !== undefined &&
    search.compareTo !== undefined &&
    search.compareFrom <= search.compareTo;
  return {
    compare: flagText(search.compare),
    compareFrom: named ? search.compareFrom : undefined,
    compareTo: named ? search.compareTo : undefined,
  };
}

/**
 * The comparative of a period report (rule 5): on by default at the API's default period. Its two
 * dates are applied together once both are set and in order, and cleared together; one date alone
 * or an end before the start is marked and keeps the period in force.
 */
export function CompareFields({
  compare,
  from,
  to,
  onChange,
}: {
  compare: boolean;
  from: string;
  to: string;
  onChange: (next: {
    compare?: boolean;
    compareFrom?: string | undefined;
    compareTo?: string | undefined;
  }) => void;
}) {
  const [typedFrom, setTypedFrom] = useState(from);
  const [typedTo, setTypedTo] = useState(to);
  const both = typedFrom !== '' && typedTo !== '';
  const invalid = (typedFrom === '') !== (typedTo === '') || (both && typedFrom > typedTo);
  const commit = (nextFrom: string, nextTo: string) => {
    if (nextFrom === '' && nextTo === '') {
      onChange({ compareFrom: undefined, compareTo: undefined });
    } else if (nextFrom !== '' && nextTo !== '' && nextFrom <= nextTo) {
      onChange({ compareFrom: nextFrom, compareTo: nextTo });
    }
  };
  return (
    <>
      <SwitchField
        label={t.filters.compare}
        description={t.filters.compareHint}
        checked={compare}
        onCheckedChange={(checked) => onChange({ compare: checked })}
      />
      {compare && (
        <>
          <DateInput
            label={t.filters.compareFrom}
            value={typedFrom}
            invalid={invalid}
            onValueChange={(value) => {
              setTypedFrom(value);
              commit(value, typedTo);
            }}
          />
          <DateInput
            label={t.filters.compareTo}
            value={typedTo}
            invalid={invalid}
            onValueChange={(value) => {
              setTypedTo(value);
              commit(typedFrom, value);
            }}
          />
          {invalid && (
            <p role="alert" className="text-destructive-text sm:col-span-2">
              {t.filters.invalidCompare}
            </p>
          )}
        </>
      )}
    </>
  );
}

/**
 * A code range (rules 9, 10): two codes typed as digits; the range is applied once both are valid
 * and in order (an empty one is open), and refused beside the fields otherwise.
 */
export function CodeRangeFields({
  codeFrom,
  codeTo,
  onChange,
}: {
  codeFrom: string | undefined;
  codeTo: string | undefined;
  onChange: (codes: { codeFrom: string | undefined; codeTo: string | undefined }) => void;
}) {
  const [from, setFrom] = useState(codeFrom ?? '');
  const [to, setTo] = useState(codeTo ?? '');
  const valid = (code: string) => code === '' || /^\d{1,12}$/.test(code);
  const ordered = from === '' || to === '' || from <= to;
  const invalid = !valid(from) || !valid(to) || !ordered;
  const commit = (nextFrom: string, nextTo: string) => {
    if (!valid(nextFrom) || !valid(nextTo)) return;
    if (nextFrom !== '' && nextTo !== '' && nextFrom > nextTo) return;
    onChange({ codeFrom: nextFrom || undefined, codeTo: nextTo || undefined });
  };
  return (
    <>
      <Field invalid={invalid}>
        <FieldLabel>{t.filters.codeFrom}</FieldLabel>
        <Input
          dir="ltr"
          inputMode="numeric"
          value={from}
          maxLength={12}
          onChange={(event) => setFrom(event.target.value.trim())}
          onBlur={() => commit(from, to)}
        />
      </Field>
      <Field invalid={invalid}>
        <FieldLabel>{t.filters.codeTo}</FieldLabel>
        <Input
          dir="ltr"
          inputMode="numeric"
          value={to}
          maxLength={12}
          onChange={(event) => setTo(event.target.value.trim())}
          onBlur={() => commit(from, to)}
        />
      </Field>
      {invalid && (
        <p role="alert" className="text-destructive-text sm:col-span-2">
          {t.filters.invalidCodes}
        </p>
      )}
    </>
  );
}

/** The totals' check of a balanced report: never expected to fail; a failure is an incident. */
export function UnbalancedNotice({ balanced }: { balanced: boolean }) {
  if (balanced) return null;
  return (
    <p role="alert" className="rounded-lg bg-status-danger px-4 py-3 text-status-danger-foreground">
      {t.states.unbalanced}
    </p>
  );
}
