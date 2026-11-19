import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type CurrencyAmount,
  type CurrencyCode,
  type Dashboard,
  type DayRates,
  type Me,
  money,
  summarizeAmounts,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  Button,
  Callout,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { CircleAlertIcon, LockIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { SystemStatus } from '../../components/system-status';
import { formatDay } from '../../lib/format';
import { dashboardQuery } from '../../lib/movements';
import { can } from '../../lib/session';
import { DayRatesDialog } from './day-rates-dialog';
import { ByCurrency, CountCard, FigureCard } from './figures';
import { MovementDialog } from './movement-dialog';
import { MovementTable } from './movement-list';
import { NewProjectDialog } from './new-project-dialog';
import { ReportPdfButton } from './report-pdf';

const t = ar.movements.dashboard;
const f = ar.movements.figures;

/** What amounts in several currencies are worth together in the book currency. */
const total = (amounts: readonly CurrencyAmount[], book: CurrencyCode) =>
  String(
    summarizeAmounts(amounts.map((amount) => money(BigInt(amount.bookMinor), book)))[0]?.sumMinor ??
      0n,
  );

/**
 * `/` (S13 screen 2): the company's figures in USD, each box in its currency, the day's rates or a
 * prompt to record them, the projects by profit, the latest movements and the materials by cost.
 */
export function DashboardPage({ me, companyId }: { me: Me; companyId: string }) {
  const canRead = can(me, 'reports.read');
  const canRecord = can(me, 'drafts.manage') && can(me, 'entries.post');
  const canProjects = can(me, 'dimensions.manage');
  const dashboard = useQuery({ ...dashboardQuery(companyId), enabled: canRead });
  const [dialog, setDialog] = useState<'project' | 'movement' | 'deposit' | 'rates' | null>(null);
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          canRead && (
            <div className="flex flex-wrap gap-2">
              <ReportPdfButton
                companyId={companyId}
                report="projects_overview"
                params={{}}
                label={ar.movements.print.allProjectsAction}
              />
              {canProjects && (
                <Button variant="outline" onClick={() => setDialog('project')}>
                  {t.newProject}
                </Button>
              )}
              {canRecord && <Button onClick={() => setDialog('movement')}>{t.newMovement}</Button>}
            </div>
          )
        }
      />
      {!canRead ? (
        <EmptyState icon={<LockIcon />} title={t.noAccess} />
      ) : dashboard.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders without identity.
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : dashboard.isError ? (
        <EmptyState
          title={ar.common.errorTitle}
          description={ar.common.errorDescription}
          action={
            <Button variant="outline" onClick={() => void dashboard.refetch()}>
              {ar.common.retry}
            </Button>
          }
        />
      ) : (
        <Figures
          data={dashboard.data}
          canRecord={canRecord}
          canRates={can(me, 'rates.manage')}
          onRates={() => setDialog('rates')}
          onDeposit={() => setDialog('deposit')}
        />
      )}
      <div className="mt-8">
        <SystemStatus />
      </div>
      <NewProjectDialog companyId={companyId} open={dialog === 'project'} onOpenChange={close} />
      <MovementDialog companyId={companyId} open={dialog === 'movement'} onOpenChange={close} />
      <MovementDialog
        companyId={companyId}
        open={dialog === 'deposit'}
        onOpenChange={close}
        initialKind="deposit"
      />
      <DayRatesDialog companyId={companyId} open={dialog === 'rates'} onOpenChange={close} />
    </>
  );
}

function Figures({
  data,
  canRecord,
  canRates,
  onRates,
  onDeposit,
}: {
  data: Dashboard;
  canRecord: boolean;
  canRates: boolean;
  onRates: () => void;
  onDeposit: () => void;
}) {
  const book = data.bookCurrency;
  const figures = data.figures;
  return (
    <div className="flex flex-col gap-6">
      <DayRatesSummary rates={data.rates} canRates={canRates} onRates={onRates} />
      <section aria-label={t.title} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CountCard label={f.projects}>
          <p className="text-xl font-bold tabular-nums">
            {data.projects.active + data.projects.finished}
          </p>
          <p className="text-control text-muted-foreground">
            {f.activeProjects} {data.projects.active} · {f.finishedProjects}{' '}
            {data.projects.finished}
          </p>
        </CountCard>
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
        <FigureCard label={f.cash} value={total(data.boxes, book)} currency={book} />
        <FigureCard label={f.owedToUs} value={total(figures.owedToUs, book)} currency={book}>
          <ByCurrency amounts={figures.owedToUs} bookCurrency={book} />
        </FigureCard>
        <FigureCard label={f.owedByUs} value={total(figures.owedByUs, book)} currency={book}>
          <ByCurrency amounts={figures.owedByUs} bookCurrency={book} />
        </FigureCard>
        <FigureCard
          label={f.exchangeDifferences}
          value={data.exchangeDifferencesMinor}
          currency={book}
        >
          <p className="text-control text-muted-foreground">{f.exchangeDifferencesHint}</p>
        </FigureCard>
      </section>

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel
          title={t.boxes}
          action={
            canRecord && (
              <Button variant="outline" size="sm" onClick={onDeposit}>
                {t.deposit}
              </Button>
            )
          }
        >
          <ByCurrency amounts={data.boxes} bookCurrency={book} empty={t.boxesEmpty} />
        </Panel>
        <Panel
          title={t.topProjects}
          className="lg:col-span-2"
          action={
            <Button variant="link" size="sm" render={<Link to="/projects" />}>
              {t.allProjects}
            </Button>
          }
        >
          {data.topProjects.length === 0 ? (
            <p className="text-control text-muted-foreground">{t.topProjectsEmpty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ar.movements.projects.columns.project}</TableHead>
                  <TableHead numeric>{f.profit}</TableHead>
                  <TableHead numeric>{f.netCash}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topProjects.map((row) => (
                  <TableRow key={row.project.id}>
                    <TableCell>
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: row.project.id }}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.project.name}
                      </Link>
                    </TableCell>
                    <TableCell numeric>
                      <Amount value={BigInt(row.profitMinor)} currency={book} />
                    </TableCell>
                    <TableCell numeric>
                      <Amount value={BigInt(row.netCashMinor)} currency={book} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>

      <Panel title={t.latest}>
        {data.latestMovements.length === 0 ? (
          <p className="text-control text-muted-foreground">{t.latestEmpty}</p>
        ) : (
          <MovementTable movements={data.latestMovements} bookCurrency={book} showProject />
        )}
      </Panel>

      <Panel title={t.topMaterials}>
        {data.topMaterials.length === 0 ? (
          <p className="text-control text-muted-foreground">{t.topMaterialsEmpty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{ar.movements.materials.columns.material}</TableHead>
                <TableHead numeric>{ar.movements.materials.columns.quantity}</TableHead>
                <TableHead numeric>{ar.movements.materials.columns.cost}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topMaterials.map((row) => (
                <TableRow key={row.material.id}>
                  <TableCell>{row.material.name}</TableCell>
                  <TableCell numeric>
                    <bdi dir="ltr">{row.quantity}</bdi> {row.unit}
                  </TableCell>
                  <TableCell numeric>
                    <Amount value={BigInt(row.bookMinor)} currency={book} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

/** The day's rates, or a prompt to record them before a movement in SYP or TRY. */
export function DayRatesSummary({
  rates,
  canRates,
  onRates,
}: {
  rates: DayRates;
  canRates: boolean;
  onRates: () => void;
}) {
  const r = ar.movements.rates;
  if (rates.missing) {
    return (
      <Callout
        tone="warning"
        icon={<CircleAlertIcon />}
        title={r.missing}
        action={
          canRates && (
            <Button size="sm" onClick={onRates}>
              {r.record}
            </Button>
          )
        }
      />
    );
  }
  return (
    <Card className="flex-row flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="font-medium">{r.title}</span>
        {rates.rates.map((rate) => (
          <span key={rate.quote} className="text-control">
            {ar.accounting.currencies[rate.quote]}:{' '}
            <bdi dir="ltr" className="font-bold tabular-nums">
              {rate.rate ?? r.none}
            </bdi>
            {rate.effectiveOn && rate.effectiveOn !== rates.date && (
              <span className="text-muted-foreground">
                {' '}
                ({r.since} {formatDay(rate.effectiveOn)})
              </span>
            )}
          </span>
        ))}
      </div>
      {canRates && (
        <Button variant="outline" size="sm" onClick={onRates}>
          {r.correct}
        </Button>
      )}
    </Card>
  );
}

function Panel({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        {action}
      </CardHeader>
      {children}
    </Card>
  );
}
