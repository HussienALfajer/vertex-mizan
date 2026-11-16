import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  PROJECT_DOCUMENT_KINDS,
  PROJECT_DOCUMENT_STATES,
  type ProjectDocumentKind,
  type ProjectDocumentSummary,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Button,
  Card,
  type DateRange,
  DateRangeField,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  isDateRangeOrdered,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { BanIcon, FilePlusIcon, FileTextIcon } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '../../components/form-error';
import { formatDay, formatEntryNumber } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { companyQuery } from '../company/company-queries';
import { ReverseDialog } from '../entries/entry-page';
import { EntryNumberText, useFiscalYearStartMonth } from '../entries/entry-parts';
import {
  DocumentNumberText,
  DocumentStateBadge,
  PrintDocumentButton,
  ProjectsBackLink,
  useProjectCatalog,
  valueLabel,
} from './project-parts';
import { projectDocumentQuery, projectDocumentsQuery } from './project-queries';

const t = ar.projects.register;
const route = getRouteApi('/_app/_company/projects/documents/');

const ALL = 'all';

/**
 * `/projects/documents` (S12 "Screens"): the project documents by date, newest first, filtered by
 * kind, project, state and dates in the address; each opens its entry, prints, and is cancelled
 * by reversing its entry (rule 22, the API refusing a billing that is not its project's latest).
 */
export function ProjectDocumentsPage() {
  const search = route.useSearch();
  const navigate = useNavigate();
  const { companyId, me, membership } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const { projects, nameOf } = useProjectCatalog(companyId);
  const range: DateRange = { from: search.from ?? '', to: search.to ?? '' };
  const filters = {
    kind: search.kind,
    contract: search.project,
    state: search.state,
    from: search.from,
    to: search.to,
  };
  const active = !membership.company.archived;
  const cancels = active && can(me, 'entries.post');
  const prepares = active && can(me, 'drafts.manage');
  const pages = useInfiniteQuery({
    ...projectDocumentsQuery(companyId, filters),
    enabled: isDateRangeOrdered(range),
  });
  const [cancelling, setCancelling] = useState<ProjectDocumentSummary | null>(null);
  const documents = pages.data?.pages.flatMap((page) => page.documents) ?? [];
  const set = (next: Partial<typeof search>) =>
    void navigate({ to: '/projects/documents', search: { ...search, ...next }, replace: true });
  return (
    <>
      <PageHeader
        back={<ProjectsBackLink />}
        title={t.title}
        actions={prepares && <NewDocumentMenu projectId={search.project} />}
      />
      <Card className="p-4">
        <search aria-label={t.filters} className="grid gap-4 md:grid-cols-3">
          <DateRangeField
            value={range}
            onValueChange={(next) =>
              set({ from: next.from || undefined, to: next.to || undefined })
            }
            label={t.range}
            fromLabel={ar.reports.header.from}
            toLabel={ar.reports.header.to}
            orderError={ar.cash.statement.rangeError}
            className="md:col-span-3"
          />
          <SelectField
            label={t.kind}
            value={search.kind ?? ALL}
            options={[
              { value: ALL, label: t.allKinds },
              ...PROJECT_DOCUMENT_KINDS.map((kind) => ({
                value: kind,
                label: ar.projects.kinds[kind],
              })),
            ]}
            onValueChange={(value) =>
              set({ kind: value === ALL ? undefined : (value as ProjectDocumentKind) })
            }
          />
          <SelectField
            label={t.project}
            value={search.project ?? ALL}
            options={[
              { value: ALL, label: t.allProjects },
              ...projects.map((project) => ({ value: project.id, label: valueLabel(project) })),
            ]}
            onValueChange={(value) => set({ project: value === ALL ? undefined : value })}
          />
          <SelectField
            label={t.state}
            value={search.state ?? ALL}
            options={[
              { value: ALL, label: t.allStates },
              ...PROJECT_DOCUMENT_STATES.map((state) => ({
                value: state,
                label: ar.projects.states[state],
              })),
            ]}
            onValueChange={(value) =>
              set({ state: value === ALL ? undefined : (value as 'posted' | 'cancelled') })
            }
          />
        </search>
      </Card>
      {pages.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-row" />
          <Skeleton className="h-row" />
        </div>
      ) : pages.isError ? (
        <FormError error={pages.error} />
      ) : documents.length === 0 ? (
        <EmptyState icon={<FileTextIcon />} title={t.empty} />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <Table aria-label={t.title}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.columns.number}</TableHead>
                <TableHead>{t.columns.date}</TableHead>
                <TableHead>{t.columns.project}</TableHead>
                <TableHead>{t.columns.counterparty}</TableHead>
                <TableHead numeric>{t.columns.total}</TableHead>
                <TableHead>{t.columns.state}</TableHead>
                <TableHead>
                  <span className="sr-only">{t.columns.actions}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((document) => {
                const cancelled = document.cancelledBy !== null;
                return (
                  <TableRow key={document.id}>
                    <TableCell>
                      <span className="flex flex-col gap-0.5">
                        <Link
                          to="/entries/$id"
                          params={{ id: document.entry.id }}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          <DocumentNumberText document={document} startMonth={startMonth} />
                        </Link>
                        {document.projectSequence !== null && (
                          <span className="text-xs text-muted-foreground">
                            {ar.reports.projectDocument.billingNumber.replace(
                              '{number}',
                              String(document.projectSequence),
                            )}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDay(document.documentDate)}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/projects/$valueId"
                        params={{ valueId: document.contractValueId }}
                        search={{}}
                        className="underline-offset-4 hover:underline"
                      >
                        <bdi>{nameOf(document.contractValueId) ?? ''}</bdi>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col gap-0.5">
                        <bdi>{nameOf(document.counterpartyValueId) ?? ''}</bdi>
                        {document.supplierReference && (
                          <bdi dir="auto" className="text-xs text-muted-foreground">
                            {document.supplierReference}
                          </bdi>
                        )}
                      </span>
                    </TableCell>
                    <TableCell numeric>
                      <Amount
                        value={BigInt(document.totalMinor)}
                        currency={document.currency}
                        showCurrency
                      />
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        <DocumentStateBadge cancelled={cancelled} />
                        {document.cancelledBy && (
                          <Link
                            to="/entries/$id"
                            params={{ id: document.cancelledBy.id }}
                            className="text-xs text-primary underline-offset-4 hover:underline"
                          >
                            {`${t.cancelledBy} `}
                            <EntryNumberText
                              number={document.cancelledBy}
                              startMonth={startMonth}
                            />
                          </Link>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        <PrintDocumentButton documentId={document.id} size="sm" />
                        {cancels && !cancelled && (
                          <Button variant="ghost" size="sm" onClick={() => setCancelling(document)}>
                            <BanIcon aria-hidden="true" />
                            {t.cancel}
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {pages.hasNextPage && (
            <Button
              variant="outline"
              className="w-fit"
              loading={pages.isFetchingNextPage}
              onClick={() => void pages.fetchNextPage()}
            >
              {t.more}
            </Button>
          )}
        </div>
      )}
      {cancelling && (
        <CancelDocumentDialog document={cancelling} onClose={() => setCancelling(null)} />
      )}
    </>
  );
}

/**
 * Cancels a document by reversing its entry (rule 22): the entry is read, then the reversal's
 * dialog asks for its date and description, as on the entry's page.
 */
function CancelDocumentDialog({
  document,
  onClose,
}: {
  document: ProjectDocumentSummary;
  onClose: () => void;
}) {
  const { companyId } = useCompany();
  const startMonth = useFiscalYearStartMonth(companyId);
  const read = useQuery(projectDocumentQuery(companyId, document.id));
  const company = useQuery(companyQuery(companyId));
  if (read.isError) return <FormError error={read.error} />;
  if (!read.data || !company.data) return null;
  return (
    <ReverseDialog
      entry={read.data.entryDetail}
      number={formatEntryNumber(read.data.entryDetail, startMonth)}
      approval={company.data.manualEntryApproval}
      onClose={onClose}
    />
  );
}

/** A new document of any kind, from a menu; on a project's register, on that project. */
export function NewDocumentMenu({ projectId }: { projectId?: string | undefined }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>
        <FilePlusIcon aria-hidden="true" />
        {t.newDocument}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {PROJECT_DOCUMENT_KINDS.map((kind) => (
          <DropdownMenuItem
            key={kind}
            render={
              <Link
                to="/projects/documents/new/$kind"
                params={{ kind }}
                search={projectId ? { project: projectId } : {}}
              />
            }
          >
            {ar.projects.newDocument[kind]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
