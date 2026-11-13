import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import type { JournalBookPrint, Ledger } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Digest,
  EmptyState,
  ExportFileState,
  Field,
  FieldLabel,
  Input,
  SelectField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { BookOpenCheckIcon, PrinterIcon, ScrollTextIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { FormError } from '../../components/form-error';
import { ApiError, download, hasCode } from '../../lib/api';
import { damascusToday, formatDateTime, formatDay, formatMonthName } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { EntryNumberText, HubDocumentText, useFiscalYearStartMonth } from '../entries/entry-parts';
import { formatMonth } from '../periods/period-parts';
import {
  DateInput,
  excelPathOf,
  MonthInput,
  ReportAccountName,
  ReportExport,
  ReportFrame,
  ReportState,
  ReportValues,
  useReportFile,
} from './report-parts';
import { fiscalYearOf, monthStart } from './report-search';
import { journalBookPrintsQuery, journalQuery } from './reports-queries';

const t = ar.reports;
const p = t.journalScreen.print;
const journalRoute = getRouteApi('/_app/_company/reports/journal');
const printsRoute = getRouteApi('/_app/_company/reports/journal-book/prints');

/** `/reports/journal`'s search (rule 12); `print` opens the journal book's print. */
export interface JournalSearch {
  from?: string | undefined;
  to?: string | undefined;
  ledger?: Ledger | undefined;
  print?: boolean | undefined;
}

/** `/reports/journal-book/prints`' search (rule 29). */
export interface PrintsSearch {
  fiscalYear?: number | undefined;
}

/**
 * `/reports/journal` (rule 12, "Screens"): posted entries in `(entry_date, number)` order with
 * their lines, each opening its entry; Excel; the journal book's print, official or draft.
 */
export function JournalPage() {
  const search = journalRoute.useSearch();
  const navigate = useNavigate({ from: '/reports/journal' });
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const from = search.from ?? monthStart();
  const to = search.to ?? damascusToday();
  const ledger = search.ledger ?? 'book';
  const ordered = from <= to;
  const params = { from, to, ledger };
  const pages = useInfiniteQuery({ ...journalQuery(companyId, params), enabled: ordered });
  const set = (patch: Partial<JournalSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const first = pages.data?.pages[0];
  const entries = pages.data?.pages.flatMap((page) => page.entries) ?? [];
  const currency = first?.header.currency ?? 'SYP';

  return (
    <ReportFrame
      report="journal"
      search={{ ...search, print: undefined }}
      title={t.journal}
      description={`${formatDay(from)} – ${formatDay(to)}`}
      actions={
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="outline" render={<Link to="/reports/journal-book/prints" />}>
            <ScrollTextIcon aria-hidden="true" />
            {t.journalScreen.register}
          </Button>
          <Button onClick={() => set({ print: true })}>
            <PrinterIcon aria-hidden="true" />
            {p.open}
          </Button>
          <ReportExport disabled={!first} excelPath={excelPathOf('journal_book', params)} />
        </div>
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
        </>
      }
    >
      <ReportState query={pages} empty={first !== undefined && entries.length === 0}>
        <Table aria-label={`${t.journalScreen.caption} ${from} – ${to}`}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.columns.account}</TableHead>
              <TableHead>{t.columns.memo}</TableHead>
              <TableHead numeric>{t.columns.debit}</TableHead>
              <TableHead numeric>{t.columns.credit}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <Fragment key={entry.entryId}>
                <TableRow className="bg-muted/50">
                  <TableHead scope="colgroup" colSpan={4} className="font-normal text-foreground">
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>{formatDay(entry.entryDate)}</span>
                      <Link
                        to="/entries/$id"
                        params={{ id: entry.entryId }}
                        className="font-bold text-primary underline-offset-4 hover:underline"
                      >
                        <EntryNumberText number={entry} startMonth={startMonth} />
                      </Link>
                      <bdi className="whitespace-normal">{entry.description}</bdi>
                      {entry.reference && (
                        <bdi className="text-muted-foreground">{entry.reference}</bdi>
                      )}
                      {entry.hubDocument && <HubDocumentText document={entry.hubDocument} />}
                    </span>
                  </TableHead>
                </TableRow>
                {entry.lines.map((line) => (
                  <TableRow key={`${entry.entryId}-${line.lineNo}`}>
                    <TableCell>
                      <ReportAccountName account={line.account} />
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="flex flex-col gap-1">
                        {line.memo && <bdi>{line.memo}</bdi>}
                        <ReportValues values={line.values} />
                      </span>
                    </TableCell>
                    <TableCell numeric>
                      {line.debit !== '0' && (
                        <Amount value={BigInt(line.debit)} currency={currency} />
                      )}
                    </TableCell>
                    <TableCell numeric>
                      {line.credit !== '0' && (
                        <Amount value={BigInt(line.credit)} currency={currency} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
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
      {/* Mounted while open, per ledger and month: its kind and months start from them each time. */}
      {search.print === true && (
        <JournalBookPrintDialog
          key={`${ledger}-${from}`}
          open
          ledger={ledger}
          month={from.slice(0, 7)}
          onClose={() => set({ print: undefined })}
        />
      )}
    </ReportFrame>
  );
}

/** A month's text in a refusal: its name and year. */
function monthText(month: string): string {
  return `${formatMonthName(Number(month.slice(5, 7)))} ${month.slice(0, 4)}`;
}

/**
 * The journal book's print (rules 27–30): a range of months of one fiscal year, official (closed
 * months of the book ledger, registered) or a draft; an official print refused names the first
 * open month. The file's state and download follow in the dialog.
 */
function JournalBookPrintDialog({
  open,
  ledger,
  month,
  onClose,
}: {
  open: boolean;
  ledger: Ledger;
  month: string;
  onClose: () => void;
}) {
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const [from, setFrom] = useState(month);
  const [to, setTo] = useState(month);
  const [kind, setKind] = useState<'official' | 'draft'>(ledger === 'book' ? 'official' : 'draft');
  const file = useReportFile(companyId);
  const fiscalYear = fiscalYearOf(`${from}-01`, startMonth);
  const ordered = from !== '' && to !== '' && from <= to;
  const sameYear = ordered && fiscalYearOf(`${to}-01`, startMonth) === fiscalYear;
  const notClosed =
    file.request.error instanceof ApiError &&
    hasCode(file.request.error, 'PERIOD_NOT_CLOSED') &&
    typeof (file.request.error.details as Record<string, unknown> | undefined)?.period === 'string'
      ? ((file.request.error.details as Record<string, string>).period as string)
      : null;
  const kindOptions = [
    ...(ledger === 'book' ? [{ value: 'official' as const, label: p.official }] : []),
    { value: 'draft' as const, label: p.draft },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!sameYear) return;
            file.request.mutate({
              report: 'journal_book',
              params: { fiscalYear: String(fiscalYear), from, to, ledger },
              official: kind === 'official',
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{p.title}</DialogTitle>
            <DialogDescription>{p.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <MonthInput label={p.fromMonth} value={from} onValueChange={setFrom} />
            <MonthInput label={p.toMonth} value={to} onValueChange={setTo} />
            <Field>
              <FieldLabel>{p.fiscalYear}</FieldLabel>
              <Input dir="ltr" readOnly value={String(fiscalYear)} />
            </Field>
            <SelectField
              label={p.kind}
              value={kind}
              options={kindOptions}
              onValueChange={setKind}
            />
          </div>
          {!sameYear && (
            <p role="alert" className="text-destructive-text">
              {p.invalidRange}
            </p>
          )}
          {notClosed ? (
            <p role="alert" className="text-destructive-text">
              {p.notClosed.replace('{month}', monthText(notClosed))}
            </p>
          ) : (
            <FormError error={file.request.error} />
          )}
          <ExportFileState
            labels={t.exportMenu}
            file={file.menuFile}
            onDownload={() => file.fetchFile.mutate()}
            downloading={file.fetchFile.isPending}
          />
          <FormError error={file.fetchFile.error} />
          <DialogFooter>
            <Button type="submit" loading={file.request.isPending} disabled={!sameYear}>
              <PrinterIcon aria-hidden="true" />
              {p.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * `/reports/journal-book/prints` (rule 29, "Screens"): one fiscal year's official prints, newest
 * first, with range, pages, counts, totals, both hashes, who and when; a superseded print marked
 * with the reopen's time; each print's PDF downloaded.
 */
export function PrintsPage() {
  const search = printsRoute.useSearch();
  const navigate = useNavigate({ from: '/reports/journal-book/prints' });
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const fiscalYear = search.fiscalYear ?? fiscalYearOf(damascusToday(), startMonth);
  const prints = useQuery(journalBookPrintsQuery(companyId, fiscalYear));
  const fetchPrint = useMutation({
    mutationFn: (print: JournalBookPrint) =>
      download(`/reports/files/${print.reportFileId}/download`, { company: companyId }),
  });
  const rows = prints.data ?? [];

  return (
    <ReportFrame
      report="prints"
      search={search}
      title={t.prints.title}
      description={t.prints.description}
      filters={
        <Field>
          <FieldLabel>{p.fiscalYear}</FieldLabel>
          <Input
            type="number"
            dir="ltr"
            min={2000}
            max={9999}
            value={String(fiscalYear)}
            onChange={(event) => {
              const year = Number(event.target.value);
              if (Number.isInteger(year) && year >= 2000 && year <= 9999) {
                void navigate({ search: { fiscalYear: year }, replace: true });
              }
            }}
          />
        </Field>
      }
    >
      <FormError error={fetchPrint.error} />
      {prints.isPending || prints.isError ? (
        <ReportState query={prints}>{null}</ReportState>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<BookOpenCheckIcon />}
          title={t.prints.empty}
          description={t.prints.emptyDescription}
        />
      ) : (
        <Table aria-label={`${t.prints.caption} ${fiscalYear}`}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.prints.range}</TableHead>
              <TableHead>{t.prints.state}</TableHead>
              <TableHead numeric>{t.prints.pages}</TableHead>
              <TableHead numeric>{t.prints.entries}</TableHead>
              <TableHead numeric>{t.prints.lineCount}</TableHead>
              <TableHead numeric>{t.prints.debit}</TableHead>
              <TableHead numeric>{t.prints.credit}</TableHead>
              <TableHead>{t.prints.contentHash}</TableHead>
              <TableHead>{t.prints.fileHash}</TableHead>
              <TableHead>{t.prints.printedBy}</TableHead>
              <TableHead>
                <span className="sr-only">{t.prints.download}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((print) => (
              <TableRow key={print.id} data-superseded={print.superseded || undefined}>
                <TableCell>
                  {print.from === print.to ? (
                    formatMonth(print.from)
                  ) : (
                    <span>
                      {formatMonth(print.from)} – {formatMonth(print.to)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {print.superseded ? (
                    <span className="flex flex-col gap-1">
                      <Badge tone="warning">{t.prints.superseded}</Badge>
                      {print.supersededAt && (
                        <span className="text-xs text-muted-foreground">
                          {`${t.prints.supersededAt} `}
                          <bdi>{formatDateTime(print.supersededAt)}</bdi>
                        </span>
                      )}
                    </span>
                  ) : (
                    <Badge tone="success">{t.prints.current}</Badge>
                  )}
                </TableCell>
                <TableCell numeric>
                  {print.firstPage === null || print.lastPage === null ? (
                    t.prints.noPages
                  ) : (
                    <bdi dir="ltr">{`${print.firstPage}–${print.lastPage}`}</bdi>
                  )}
                </TableCell>
                <TableCell numeric>
                  <bdi dir="ltr">{print.entryCount}</bdi>
                </TableCell>
                <TableCell numeric>
                  <bdi dir="ltr">{print.lineCount}</bdi>
                </TableCell>
                <TableCell numeric>
                  <Amount value={BigInt(print.debitTotal)} currency={print.currency} />
                </TableCell>
                <TableCell numeric>
                  <Amount value={BigInt(print.creditTotal)} currency={print.currency} />
                </TableCell>
                <TableCell>
                  <Digest
                    value={print.contentSha256}
                    copyLabel={t.prints.copyHash}
                    copiedLabel={t.prints.copied}
                  />
                </TableCell>
                <TableCell>
                  <Digest
                    value={print.fileSha256}
                    copyLabel={t.prints.copyHash}
                    copiedLabel={t.prints.copied}
                  />
                </TableCell>
                <TableCell>
                  <span className="flex flex-col">
                    <bdi>{print.printedBy.name}</bdi>
                    <bdi className="text-xs text-muted-foreground">
                      {formatDateTime(print.createdAt)}
                    </bdi>
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={fetchPrint.isPending && fetchPrint.variables?.id === print.id}
                    onClick={() => fetchPrint.mutate(print)}
                  >
                    {t.prints.download}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportFrame>
  );
}
