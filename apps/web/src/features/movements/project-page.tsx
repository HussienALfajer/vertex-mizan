import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type Me, type Project, projectSchema } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Badge,
  Button,
  Callout,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-mizan/ui';
import { ArrowRightIcon, CircleAlertIcon, PackageIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { api, hasCode } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { materialCostsQuery, projectQuery, refreshBooks } from '../../lib/movements';
import { can } from '../../lib/session';
import { ByCurrency, FigureCard } from './figures';
import { MovementDialog } from './movement-dialog';
import { MovementBrowser } from './movement-list';
import { ReportPdfButton } from './report-pdf';

const t = ar.movements.project;
const f = ar.movements.figures;

/**
 * `/projects/:projectId` (S13 screen 4): the project's figures, its movements with their filters
 * and cancellation, its materials, a new movement, and finishing or reopening it (rule 9).
 */
export function ProjectPage({
  me,
  companyId,
  projectId,
}: {
  me: Me;
  companyId: string;
  projectId: string;
}) {
  const project = useQuery(projectQuery(companyId, projectId));
  const back = (
    <Button variant="link" size="sm" className="w-fit px-0" render={<Link to="/projects" />}>
      <ArrowRightIcon className="rtl:rotate-0 ltr:rotate-180" />
      {t.back}
    </Button>
  );

  if (project.isPending) {
    return (
      <>
        <PageHeader back={back} title={<Skeleton className="h-8 w-48" />} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders without identity.
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      </>
    );
  }
  if (project.isError) {
    const missing = hasCode(project.error, 'NOT_FOUND');
    return (
      <>
        <PageHeader back={back} title={missing ? t.notFound : ar.common.errorTitle} />
        <EmptyState
          title={missing ? t.notFound : ar.common.errorTitle}
          description={missing ? t.notFoundHint : ar.common.errorDescription}
          action={
            !missing && (
              <Button variant="outline" onClick={() => void project.refetch()}>
                {ar.common.retry}
              </Button>
            )
          }
        />
      </>
    );
  }
  return <ProjectView me={me} companyId={companyId} project={project.data} back={back} />;
}

function ProjectView({
  me,
  companyId,
  project,
  back,
}: {
  me: Me;
  companyId: string;
  project: Project;
  back: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'movement' | 'state' | null>(null);
  const canRecord = can(me, 'drafts.manage') && can(me, 'entries.post');
  const canManage = can(me, 'dimensions.manage');
  const finished = project.state === 'finished';
  const book = project.figures.bookCurrency;
  const figures = project.figures;

  return (
    <>
      <PageHeader
        back={back}
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {t.client}: {project.client.name}
            </span>
            <span>
              {t.started} {formatDay(project.startDate)}
            </span>
            <Badge tone={finished ? 'neutral' : 'success'}>
              {ar.movements.states[project.state]}
            </Badge>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <ReportPdfButton
              companyId={companyId}
              report="project_statement"
              params={{ project: project.id }}
              label={ar.movements.print.projectAction}
            />
            {canManage && (
              <Button variant="outline" onClick={() => setDialog('state')}>
                {finished ? t.reopen : t.finish}
              </Button>
            )}
            {canRecord && !finished && (
              <Button onClick={() => setDialog('movement')}>
                {ar.movements.dashboard.newMovement}
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        {finished && <Callout tone="info" icon={<CircleAlertIcon />} title={t.finishedNote} />}
        <section aria-label={project.name} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FigureCard label={f.received} value={figures.receivedMinor} currency={book} />
          <FigureCard label={f.costs} value={figures.costsMinor} currency={book}>
            <p className="text-control text-muted-foreground">
              {f.expenses} <Amount value={BigInt(figures.expensesMinor)} currency={book} /> ·{' '}
              {f.wages} <Amount value={BigInt(figures.wagesMinor)} currency={book} />
            </p>
          </FigureCard>
          <FigureCard label={f.profit} value={figures.profitMinor} currency={book}>
            <p className="text-control text-muted-foreground">
              {f.revenue} <Amount value={BigInt(figures.revenueMinor)} currency={book} />
            </p>
          </FigureCard>
          <FigureCard label={f.netCash} value={figures.netCashMinor} currency={book}>
            {project.contractValue && (
              <p className="text-control text-muted-foreground">
                {f.contractValue}{' '}
                <Amount
                  value={BigInt(project.contractValue.amountMinor)}
                  currency={project.contractValue.currency}
                  showCurrency
                />
              </p>
            )}
          </FigureCard>
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-4 sm:col-span-1 lg:col-span-2">
            <p className="text-control text-muted-foreground">{f.owedToUs}</p>
            <ByCurrency amounts={figures.owedToUs} bookCurrency={book} />
          </div>
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-4 sm:col-span-1 lg:col-span-2">
            <p className="text-control text-muted-foreground">{f.owedByUs}</p>
            <ByCurrency amounts={figures.owedByUs} bookCurrency={book} />
          </div>
        </section>

        <Tabs defaultValue="movements">
          <TabsList>
            <TabsTrigger value="movements">{t.tabs.movements}</TabsTrigger>
            <TabsTrigger value="materials">{t.tabs.materials}</TabsTrigger>
          </TabsList>
          <TabsContent value="movements">
            <MovementBrowser
              companyId={companyId}
              scope={{ project: project.id }}
              bookCurrency={book}
              canCancel={can(me, 'entries.post')}
            />
          </TabsContent>
          <TabsContent value="materials">
            <ProjectMaterials companyId={companyId} projectId={project.id} />
          </TabsContent>
        </Tabs>
      </div>

      <MovementDialog
        companyId={companyId}
        project={project}
        open={dialog === 'movement'}
        onOpenChange={(open) => setDialog(open ? 'movement' : null)}
      />
      <ConfirmDialog
        open={dialog === 'state'}
        onOpenChange={(open) => setDialog(open ? 'state' : null)}
        title={finished ? t.reopen : t.finishTitle}
        description={finished ? t.finishedNote : t.finishDescription}
        submitLabel={finished ? t.reopen : t.finish}
        onConfirm={() =>
          api('PATCH', `/project-books/${project.id}`, {
            company: companyId,
            body: { state: finished ? 'active' : 'finished' },
            schema: projectSchema,
          })
        }
        onDone={() => refreshBooks(queryClient, companyId)}
      />
    </>
  );
}

/** The project's materials (S13 screen 4): each with its quantity and cost in USD. */
function ProjectMaterials({ companyId, projectId }: { companyId: string; projectId: string }) {
  const costs = useQuery(materialCostsQuery(companyId, { project: projectId }));
  const m = ar.movements.materials;
  if (costs.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-row w-full" />
        <Skeleton className="h-row w-full" />
      </div>
    );
  }
  if (costs.isError) {
    return (
      <EmptyState
        title={ar.common.errorTitle}
        description={ar.common.errorDescription}
        action={
          <Button variant="outline" onClick={() => void costs.refetch()}>
            {ar.common.retry}
          </Button>
        }
      />
    );
  }
  if (costs.data.materials.length === 0) {
    return <EmptyState icon={<PackageIcon />} title={m.empty} description={m.emptyHint} />;
  }
  const book = costs.data.bookCurrency;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{m.columns.material}</TableHead>
          <TableHead>{m.columns.unit}</TableHead>
          <TableHead numeric>{m.columns.quantity}</TableHead>
          <TableHead numeric>{m.columns.cost}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {costs.data.materials.map((row) => (
          <TableRow key={row.material.id}>
            <TableCell>{row.material.name}</TableCell>
            <TableCell>{row.material.unit}</TableCell>
            <TableCell numeric>
              <bdi dir="ltr">{row.quantity}</bdi>
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.bookMinor)} currency={book} />
            </TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-bold">{m.total}</TableCell>
          <TableCell />
          <TableCell />
          <TableCell numeric>
            <Amount value={BigInt(costs.data.totalBookMinor)} currency={book} strong />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
