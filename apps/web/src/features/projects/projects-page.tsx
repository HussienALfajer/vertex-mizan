import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import type { Ledger, ProjectListRow } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DimensionPicker,
  EmptyState,
  SwitchField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { BoxesIcon, FileTextIcon, FolderKanbanIcon } from 'lucide-react';
import { damascusToday } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { companyQuery } from '../company/company-queries';
import { dimensionPickerLabels, pickerValues } from '../entries/entry-parts';
import { DateInput, ReportFrame, ReportState } from '../reports/report-parts';
import { NewDocumentMenu } from './project-documents-page';
import { useProjectCatalog } from './project-parts';
import { projectListQuery } from './project-queries';

const t = ar.projects.list;
const route = getRouteApi('/_app/_company/projects/');

/** `/projects`'s search. */
export interface ProjectsSearch {
  asOf?: string | undefined;
  ledger?: Ledger | undefined;
  archived?: boolean | undefined;
  /** From the palette's "تقرير مشروع…": a project's picker that opens its report. */
  find?: 'project' | undefined;
}

/**
 * `/projects` (S12 "Screens"): one row per project with its client, contract value, billed to
 * date and its share, direct costs, contribution, the client's retentions and advance, from the
 * start of the books to a date in a ledger; each opens its report; a new document from the
 * toolbar. Archived projects are hidden by default; the register and the material quantities are
 * a link away.
 */
export function ProjectsPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/projects/' });
  const { companyId, me, membership } = useCompany();
  const company = useQuery(companyQuery(companyId)).data;
  const asOf = search.asOf ?? damascusToday();
  const ledger: Ledger = search.ledger ?? 'book';
  const params = {
    asOf,
    ledger,
    archived: search.archived ? 'true' : undefined,
  };
  const list = useQuery({ ...projectListQuery(companyId, params), enabled: company !== undefined });
  const set = (patch: Partial<ProjectsSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const prepares = !membership.company.archived && can(me, 'drafts.manage');
  const data = list.data;
  const currency = data?.header.currency ?? company?.ledgers.book.currency ?? 'USD';
  return (
    <ReportFrame
      report="projects"
      search={search}
      back={false}
      title={t.title}
      description={t.description}
      actions={
        <div className="flex flex-wrap items-start gap-2">
          {prepares && <NewDocumentMenu />}
          <Button variant="outline" render={<Link to="/projects/documents" search={{}} />}>
            <FileTextIcon aria-hidden="true" />
            {t.documents}
          </Button>
          <Button variant="outline" render={<Link to="/reports/material-quantities" search={{}} />}>
            <BoxesIcon aria-hidden="true" />
            {t.quantities}
          </Button>
        </div>
      }
      ledger={
        company?.ledgers.parallel
          ? { value: ledger, onValueChange: (next) => set({ ledger: next }) }
          : undefined
      }
      header={data?.header}
      filters={
        <>
          <DateInput label={t.asOf} value={asOf} onValueChange={(value) => set({ asOf: value })} />
          <SwitchField
            label={t.showArchived}
            checked={search.archived ?? false}
            onCheckedChange={(archived) => set({ archived: archived || undefined })}
          />
        </>
      }
    >
      {search.find === 'project' && <ProjectFinder onClose={() => set({ find: undefined })} />}
      <ReportState query={list}>
        {data &&
          (data.projects.length === 0 ? (
            <EmptyState
              icon={<FolderKanbanIcon />}
              title={t.empty}
              description={t.emptyHint}
              action={
                <Button variant="outline" render={<Link to="/dimensions" />}>
                  {t.toDimensions}
                </Button>
              }
            />
          ) : (
            <Table aria-label={t.title}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.project}</TableHead>
                  <TableHead>{t.columns.client}</TableHead>
                  <TableHead numeric>{t.columns.contractValue}</TableHead>
                  <TableHead numeric>{t.columns.cumulative}</TableHead>
                  <TableHead numeric>{t.columns.costs}</TableHead>
                  <TableHead numeric>{t.columns.contribution}</TableHead>
                  <TableHead numeric>{t.columns.retention}</TableHead>
                  <TableHead numeric>{t.columns.advance}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.projects.map((row) => (
                  <ProjectRow key={row.project.id} row={row} currency={currency} />
                ))}
              </TableBody>
            </Table>
          ))}
      </ReportState>
    </ReportFrame>
  );
}

/** Picks a project and opens its report (the palette's "تقرير مشروع…"). */
function ProjectFinder({ onClose }: { onClose: () => void }) {
  const { companyId } = useCompany();
  const navigate = useNavigate();
  const { projects } = useProjectCatalog(companyId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={ar.common.close}>
        <DialogHeader>
          <DialogTitle>{ar.projects.palette.report}</DialogTitle>
        </DialogHeader>
        <DimensionPicker
          label={ar.projects.palette.pickProject}
          values={pickerValues(projects)}
          value={null}
          labels={dimensionPickerLabels}
          required
          onValueChange={(id) => {
            if (id)
              void navigate({ to: '/projects/$valueId', params: { valueId: id }, search: {} });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProjectRow({
  row,
  currency,
}: {
  row: ProjectListRow;
  currency: Parameters<typeof Amount>[0]['currency'];
}) {
  return (
    <TableRow>
      <TableCell>
        <span className="flex flex-col items-start gap-0.5">
          <Link
            to="/projects/$valueId"
            params={{ valueId: row.project.id }}
            search={{}}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.project.code && (
              <>
                <bdi dir="ltr">{row.project.code}</bdi>{' '}
              </>
            )}
            <bdi>{row.project.name}</bdi>
          </Link>
          {row.project.archived && <Badge tone="neutral">{t.archived}</Badge>}
        </span>
      </TableCell>
      <TableCell>{row.client && <bdi>{row.client.name}</bdi>}</TableCell>
      <TableCell numeric>
        {row.terms ? (
          <Amount
            value={BigInt(row.terms.contractValueMinor)}
            currency={row.terms.currency}
            showCurrency
          />
        ) : (
          <span className="text-muted-foreground">{t.noTerms}</span>
        )}
      </TableCell>
      <TableCell numeric>
        <span className="flex flex-col items-end gap-0.5">
          {row.terms && (
            <Amount
              value={BigInt(row.cumulativeMinor)}
              currency={row.terms.currency}
              showCurrency
            />
          )}
          {row.billed !== null && (
            <bdi dir="ltr" className="text-xs text-muted-foreground tabular-nums">
              {`${row.billed}%`}
            </bdi>
          )}
        </span>
      </TableCell>
      <TableCell numeric>
        <Amount value={BigInt(row.directCosts)} currency={currency} />
      </TableCell>
      <TableCell numeric>
        <span className="flex flex-col items-end gap-0.5">
          <Amount value={BigInt(row.contribution)} currency={currency} />
          {row.margin !== null && (
            <bdi dir="ltr" className="text-xs text-muted-foreground tabular-nums">
              {`${row.margin}%`}
            </bdi>
          )}
        </span>
      </TableCell>
      <TableCell numeric>
        <Amount value={BigInt(row.retentionReceivable)} currency={currency} />
      </TableCell>
      <TableCell numeric>
        <Amount value={BigInt(row.clientAdvance)} currency={currency} />
      </TableCell>
    </TableRow>
  );
}
