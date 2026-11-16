import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import {
  type CurrencyCode,
  formatMinor,
  type Ledger,
  type ProjectReport,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  BudgetVarianceBar,
  Button,
  Callout,
  Card,
  EmptyState,
  QuantityCell,
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
import { InfoIcon, SettingsIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { damascusToday, formatDay } from '../../lib/format';
import { can, useCompany } from '../../lib/session';
import { companyQuery } from '../company/company-queries';
import { useFiscalYearStartMonth } from '../entries/entry-parts';
import {
  DateInput,
  type LinesSearch,
  ReportExport,
  ReportFrame,
  ReportState,
} from '../reports/report-parts';
import { paramsOf, searchOf } from '../reports/reports-queries';
import { NewDocumentMenu } from './project-documents-page';
import {
  basisPointsText,
  DocumentNumberText,
  DocumentStateBadge,
  ProjectsBackLink,
} from './project-parts';
import { projectReportQuery } from './project-queries';

const t = ar.projects.report;
const c = ar.reports.project.columns;
const s = ar.reports.project.summary;
const route = getRouteApi('/_app/_company/projects/$valueId/');

export const PROJECT_REPORT_TABS = [
  'summary',
  'costs',
  'materials',
  'wages',
  'subcontracts',
  'billings',
] as const;

export type ProjectReportTab = (typeof PROJECT_REPORT_TABS)[number];

/** `/projects/:valueId`'s search. */
export interface ProjectReportSearch {
  from?: string | undefined;
  to?: string | undefined;
  ledger?: Ledger | undefined;
  tab?: ProjectReportTab | undefined;
}

/**
 * `/projects/:valueId` (S12 "Screens", "Reports"): the project report over a range in a ledger, in
 * tabs — summary, costs against the budget, materials, wages, subcontractors and billings —
 * every figure of the ledger opening the lines that make it and every billing its entry; Excel
 * and PDF. Without terms, a notice leads to them.
 */
export function ProjectReportPage() {
  const { valueId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/projects/$valueId/' });
  const { companyId, me, membership } = useCompany();
  const company = useQuery(companyQuery(companyId)).data;
  const startMonth = useFiscalYearStartMonth(companyId);
  const today = damascusToday();
  const from = search.from ?? `${today.slice(0, 4)}-01-01`;
  const to = search.to ?? today;
  const ledger: Ledger = search.ledger ?? 'book';
  const tab = search.tab ?? 'summary';
  const ordered = from <= to;
  const params = { from, to, ledger };
  const report = useQuery({
    ...projectReportQuery(companyId, valueId, params),
    enabled: ordered && company !== undefined,
  });
  const set = (patch: Partial<ProjectReportSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const data = report.data;
  const prepares = !membership.company.archived && can(me, 'drafts.manage');
  const lines = (extra: Partial<LinesSearch>): LinesSearch => ({
    ledger,
    from,
    to,
    contract: valueId,
    ...extra,
  });

  return (
    <ReportFrame
      report="project"
      search={search}
      back={<ProjectsBackLink />}
      title={
        <span>
          {`${t.title}: `}
          <bdi>{data?.project.name ?? ''}</bdi>
        </span>
      }
      description={`${formatDay(from)} – ${formatDay(to)}`}
      actions={
        <div className="flex flex-wrap items-start gap-2">
          {prepares && <NewDocumentMenu projectId={valueId} />}
          <Button
            variant="outline"
            render={<Link to="/projects/$valueId/terms" params={{ valueId }} />}
          >
            <SettingsIcon aria-hidden="true" />
            {t.terms}
          </Button>
          <ReportExport
            disabled={!data}
            excelPath={`/projects/${valueId}/report/export${searchOf({ ...params, format: 'xlsx' })}`}
            pdf={{ report: 'project_report', params: paramsOf({ contract: valueId, ...params }) }}
          />
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
          <DateInput
            label={ar.reports.filters.from}
            value={from}
            onValueChange={(v) => set({ from: v })}
          />
          <DateInput
            label={ar.reports.filters.to}
            value={to}
            invalid={!ordered}
            onValueChange={(v) => set({ to: v })}
          />
        </>
      }
    >
      <ReportState query={report}>
        {data && (
          <>
            {data.terms === null && (
              <Callout
                tone="warning"
                icon={<TriangleAlertIcon />}
                title={t.noTerms}
                description={
                  <Link
                    to="/projects/$valueId/terms"
                    params={{ valueId }}
                    className="text-primary underline underline-offset-4"
                  >
                    {t.setTerms}
                  </Link>
                }
              />
            )}
            <Tabs value={tab} onValueChange={(next) => set({ tab: next as ProjectReportTab })}>
              <TabsList aria-label={t.title} className="max-w-full overflow-x-auto">
                {PROJECT_REPORT_TABS.map((value) => (
                  <TabsTrigger key={value} value={value}>
                    {t.tabs[value]}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="summary">
                <Summary report={data} lines={lines} />
              </TabsContent>
              <TabsContent value="costs">
                <Costs report={data} lines={lines} />
              </TabsContent>
              <TabsContent value="materials">
                <Materials report={data} lines={lines} />
              </TabsContent>
              <TabsContent value="wages">
                <Wages report={data} lines={lines} />
              </TabsContent>
              <TabsContent value="subcontracts">
                <Subcontracts report={data} />
              </TabsContent>
              <TabsContent value="billings">
                <Billings report={data} startMonth={startMonth} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </ReportState>
    </ReportFrame>
  );
}

type LinesOf = (extra: Partial<LinesSearch>) => LinesSearch;

/** A figure linked to the lines that make it (S09 rule 6). */
function Figure({
  value,
  currency,
  link,
  strong = false,
}: {
  value: string;
  currency: CurrencyCode;
  link?: LinesSearch | undefined;
  strong?: boolean;
}) {
  const amount = <Amount value={BigInt(value)} currency={currency} strong={strong} />;
  if (!link) return amount;
  return (
    <Link
      to="/reports/lines"
      search={link}
      aria-label={t.drill.replace('{figure}', formatMinor(BigInt(value), currency))}
      className="rounded-sm underline-offset-4 hover:underline"
    >
      {amount}
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-control">{children}</dd>
    </div>
  );
}

function Summary({ report, lines }: { report: ProjectReport; lines: LinesOf }) {
  const { summary, terms, header } = report;
  const currency = header.currency;
  return (
    <Card className="p-4" data-slot="project-summary">
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {report.client && (
          <Fact label={ar.reports.project.client}>
            <bdi>{report.client.name}</bdi>
          </Fact>
        )}
        {terms && (
          <>
            <Fact label={s.contractValue}>
              <Amount
                value={BigInt(terms.contractValueMinor)}
                currency={terms.currency}
                showCurrency
              />
            </Fact>
            <Fact label={s.cumulative}>
              <Amount
                value={BigInt(summary.cumulativeMinor)}
                currency={terms.currency}
                showCurrency
              />
            </Fact>
            <Fact label={s.billed}>
              <bdi dir="ltr" className="tabular-nums">
                {summary.billed === null ? ar.reports.none : `${summary.billed}%`}
              </bdi>
            </Fact>
            <Fact label={ar.projects.terms.retentionRate}>
              <bdi dir="ltr">{`${basisPointsText(terms.retentionBp)}%`}</bdi>
            </Fact>
            <Fact label={ar.projects.terms.recoveryRate}>
              <bdi dir="ltr">{`${basisPointsText(terms.advanceRecoveryBp)}%`}</bdi>
            </Fact>
          </>
        )}
        <Fact label={s.revenue}>
          <Figure
            value={summary.revenue}
            currency={currency}
            link={lines({ statementLine: 'is.revenue' })}
          />
        </Fact>
        <Fact label={s.directCosts}>
          <Figure
            value={summary.directCosts}
            currency={currency}
            link={lines({ statementLine: 'is.direct_costs' })}
          />
        </Fact>
        <Fact label={s.contribution}>
          <Amount value={BigInt(summary.contribution)} currency={currency} strong />
        </Fact>
        <Fact label={s.margin}>
          <bdi dir="ltr" className="tabular-nums">
            {summary.margin === null ? ar.reports.none : `${summary.margin}%`}
          </bdi>
        </Fact>
        <Fact label={s.retentionReceivable}>
          <Amount value={BigInt(summary.retentionReceivable)} currency={currency} />
        </Fact>
        <Fact label={s.clientAdvance}>
          <Amount value={BigInt(summary.clientAdvance)} currency={currency} />
        </Fact>
        <Fact label={s.subcontractRetention}>
          <Amount value={BigInt(summary.subcontractRetention)} currency={currency} />
        </Fact>
        <Fact label={s.subcontractAdvance}>
          <Amount value={BigInt(summary.subcontractAdvance)} currency={currency} />
        </Fact>
      </dl>
    </Card>
  );
}

function NoRows() {
  return <EmptyState title={t.noRows} />;
}

function Costs({ report, lines }: { report: ProjectReport; lines: LinesOf }) {
  const { costs, terms, header } = report;
  const currency = header.currency;
  if (costs.rows.length === 0) return <NoRows />;
  const budgetCurrency = terms?.currency ?? currency;
  const compared = costs.totals.variance !== null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!compared && terms && (
        <Callout tone="info" icon={<InfoIcon />} title={t.marks.otherCurrency} />
      )}
      <Table aria-label={t.tabs.costs}>
        <TableHeader>
          <TableRow>
            <TableHead>{ar.projects.terms.budgetAccount}</TableHead>
            <TableHead numeric>{c.inRange}</TableHead>
            <TableHead numeric>{c.toDate}</TableHead>
            <TableHead className="min-w-64">{c.budget}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...costs.rows, null].map((row) => {
            const figures = row ?? costs.totals;
            const label = row ? `${row.account.code} ${row.account.name}` : t.totals;
            return (
              <TableRow key={row?.account.id ?? 'totals'} className={row ? undefined : 'font-bold'}>
                <TableCell>
                  {row ? (
                    <span>
                      <bdi dir="ltr">{row.account.code}</bdi> <bdi>{row.account.name}</bdi>
                    </span>
                  ) : (
                    t.totals
                  )}
                </TableCell>
                <TableCell numeric>
                  <Figure
                    value={figures.inRange}
                    currency={currency}
                    strong={!row}
                    link={row ? lines({ account: row.account.id }) : undefined}
                  />
                </TableCell>
                <TableCell numeric>
                  <Amount value={BigInt(figures.toDate)} currency={currency} strong={!row} />
                </TableCell>
                <TableCell>
                  {figures.variance !== null ? (
                    <BudgetVarianceBar
                      label={label}
                      currency={currency}
                      budgetMinor={BigInt(figures.budgetMinor)}
                      actualMinor={BigInt(figures.toDate)}
                      varianceMinor={BigInt(figures.variance)}
                      used={figures.used}
                      labels={t.budgetBar}
                    />
                  ) : (
                    <Amount
                      value={BigInt(figures.budgetMinor)}
                      currency={budgetCurrency}
                      showCurrency
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Materials({ report, lines }: { report: ProjectReport; lines: LinesOf }) {
  if (report.materials.length === 0) return <NoRows />;
  const currency = report.header.currency;
  return (
    <Table aria-label={t.tabs.materials}>
      <TableHeader>
        <TableRow>
          <TableHead>{c.material}</TableHead>
          <TableHead numeric>{c.quantity}</TableHead>
          <TableHead numeric>{c.amount}</TableHead>
          <TableHead numeric>{c.average}</TableHead>
          <TableHead numeric>{c.ledgerAmount}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.materials.map((row) => (
          <TableRow key={`${row.material.id}:${row.currency}`}>
            <TableCell>
              <span>
                <bdi dir="ltr" className="font-medium">
                  {row.material.code}
                </bdi>{' '}
                <bdi>{row.material.name}</bdi>
              </span>
            </TableCell>
            <TableCell numeric>
              <QuantityCell quantity={row.quantity} unit={row.material.unit} />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.amountMinor)} currency={row.currency} showCurrency />
            </TableCell>
            <TableCell numeric>
              {row.average === null ? (
                ar.reports.none
              ) : (
                <bdi dir="ltr" className="tabular-nums">{`${row.average} ${row.currency}`}</bdi>
              )}
            </TableCell>
            <TableCell numeric>
              <Figure
                value={row.ledgerAmount}
                currency={currency}
                link={lines({ material: row.material.id })}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Wages({ report, lines }: { report: ProjectReport; lines: LinesOf }) {
  if (report.wages.length === 0) return <NoRows />;
  const currency = report.header.currency;
  return (
    <Table aria-label={t.tabs.wages}>
      <TableHeader>
        <TableRow>
          <TableHead>{c.worker}</TableHead>
          <TableHead numeric>{c.days}</TableHead>
          <TableHead numeric>{c.lumpSum}</TableHead>
          <TableHead numeric>{c.amount}</TableHead>
          <TableHead numeric>{c.balance}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.wages.map((row) => (
          <TableRow key={row.worker.id}>
            <TableCell>
              <Link
                to="/counterparties/$valueId"
                params={{ valueId: row.worker.id }}
                className="underline-offset-4 hover:underline"
              >
                <bdi>{row.worker.name}</bdi>
              </Link>
            </TableCell>
            <TableCell numeric>
              <QuantityCell quantity={row.days} trim />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.lumpSum)} currency={currency} />
            </TableCell>
            <TableCell numeric>
              <Figure
                value={row.amount}
                currency={currency}
                link={lines({ statementLine: 'is.direct_costs', dims: row.worker.id })}
              />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.balance)} currency={currency} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Subcontracts({ report }: { report: ProjectReport }) {
  if (report.subcontracts.length === 0) return <NoRows />;
  const currency = report.header.currency;
  return (
    <Table aria-label={t.tabs.subcontracts}>
      <TableHeader>
        <TableRow>
          <TableHead>{c.supplier}</TableHead>
          <TableHead numeric>{c.subcontractValue}</TableHead>
          <TableHead numeric>{c.cumulative}</TableHead>
          <TableHead numeric>{c.retention}</TableHead>
          <TableHead numeric>{c.advance}</TableHead>
          <TableHead numeric>{c.paid}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.subcontracts.map((row) => (
          <TableRow key={row.subcontractId}>
            <TableCell>
              <Link
                to="/counterparties/$valueId"
                params={{ valueId: row.supplier.id }}
                className="underline-offset-4 hover:underline"
              >
                <bdi>{row.supplier.name}</bdi>
              </Link>
            </TableCell>
            <TableCell numeric>
              {row.valueMinor === null ? (
                ar.reports.none
              ) : (
                <Amount value={BigInt(row.valueMinor)} currency={row.currency} showCurrency />
              )}
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.cumulativeMinor)} currency={row.currency} showCurrency />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.retention)} currency={currency} />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.advance)} currency={currency} />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.paid)} currency={currency} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Billings({ report, startMonth }: { report: ProjectReport; startMonth: number }) {
  if (report.billings.length === 0 || !report.terms) return <NoRows />;
  const currency = report.terms.currency;
  return (
    <Table aria-label={t.tabs.billings}>
      <TableHeader>
        <TableRow>
          <TableHead>{c.number}</TableHead>
          <TableHead>{ar.projects.register.columns.date}</TableHead>
          <TableHead numeric>{c.cumulative}</TableHead>
          <TableHead numeric>{c.previous}</TableHead>
          <TableHead numeric>{c.period}</TableHead>
          <TableHead numeric>{c.retention}</TableHead>
          <TableHead numeric>{c.recovery}</TableHead>
          <TableHead numeric>{c.net}</TableHead>
          <TableHead numeric>{c.outstanding}</TableHead>
          <TableHead>{c.state}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.billings.map((row) => (
          <TableRow key={row.documentId}>
            <TableCell>
              <span className="flex flex-col gap-0.5">
                <Link
                  to="/entries/$id"
                  params={{ id: row.entryId }}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  <DocumentNumberText
                    document={{ ...row, kind: 'progress_billing' }}
                    startMonth={startMonth}
                    kind={false}
                  />
                </Link>
                <span className="text-xs text-muted-foreground">
                  {ar.reports.projectDocument.billingNumber.replace(
                    '{number}',
                    String(row.projectSequence),
                  )}
                </span>
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap">{formatDay(row.documentDate)}</TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.cumulativeMinor)} currency={currency} />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.previousMinor)} currency={currency} />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.periodMinor)} currency={currency} />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.retentionMinor)} currency={currency} />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.advanceMinor)} currency={currency} />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.netMinor)} currency={currency} strong />
            </TableCell>
            <TableCell numeric>
              <Amount value={BigInt(row.outstandingMinor)} currency={currency} />
            </TableCell>
            <TableCell>
              <DocumentStateBadge cancelled={row.state === 'cancelled'} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
