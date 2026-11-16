import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { formatMinor, type Ledger } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  Amount,
  EmptyState,
  QuantityCell,
  SelectField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-mizan/ui';
import { damascusToday, formatDay } from '../../lib/format';
import { useCompany } from '../../lib/session';
import { companyQuery } from '../company/company-queries';
import { DateInput, ReportExport, ReportFrame, ReportState } from '../reports/report-parts';
import { monthStart } from '../reports/report-search';
import { paramsOf, searchOf } from '../reports/reports-queries';
import { useProjectCatalog, valueLabel } from './project-parts';
import { materialQuantitiesQuery, useMaterials } from './project-queries';

const t = ar.reports;
const c = ar.reports.project.columns;
const route = getRouteApi('/_app/_company/reports/material-quantities');

const ALL = 'all';

/** `/reports/material-quantities`'s search. */
export interface MaterialQuantitiesSearch {
  from?: string | undefined;
  to?: string | undefined;
  ledger?: Ledger | undefined;
  project?: string | undefined;
  material?: string | undefined;
}

/**
 * `/reports/material-quantities` (S12 "Screens", "Reports"): per project and material, in each
 * transaction currency, the quantities in and out and net, the amount and average unit cost, and
 * the ledger's amount, which opens its lines; the ledger's total equals the lines of the accounts
 * that require a material. Filters by project and material; Excel and PDF.
 */
export function MaterialQuantitiesPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/reports/material-quantities' });
  const { companyId } = useCompany();
  const company = useQuery(companyQuery(companyId)).data;
  const { projects } = useProjectCatalog(companyId);
  const materials = useMaterials(companyId).all;
  const from = search.from ?? monthStart();
  const to = search.to ?? damascusToday();
  const ledger: Ledger = search.ledger ?? 'book';
  const ordered = from <= to;
  const params = { from, to, ledger, contract: search.project, material: search.material };
  const report = useQuery({
    ...materialQuantitiesQuery(companyId, params),
    enabled: ordered && company !== undefined,
  });
  const set = (patch: Partial<MaterialQuantitiesSearch>) =>
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
  const data = report.data;
  const currency = data?.header.currency ?? 'USD';
  return (
    <ReportFrame
      report="material-quantities"
      search={search}
      title={t.names.material_quantities}
      description={`${formatDay(from)} – ${formatDay(to)}`}
      actions={
        <ReportExport
          disabled={!data}
          excelPath={`/reports/material-quantities/export${searchOf({ ...params, format: 'xlsx' })}`}
          pdf={{ report: 'material_quantities', params: paramsOf(params) }}
        />
      }
      ledger={
        company?.ledgers.parallel
          ? { value: ledger, onValueChange: (next) => set({ ledger: next }) }
          : undefined
      }
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
            label={ar.projects.register.project}
            value={search.project ?? ALL}
            options={[
              { value: ALL, label: ar.projects.register.allProjects },
              ...projects.map((project) => ({ value: project.id, label: valueLabel(project) })),
            ]}
            onValueChange={(value) => set({ project: value === ALL ? undefined : value })}
          />
          <SelectField
            label={c.material}
            value={search.material ?? ALL}
            options={[
              { value: ALL, label: ar.materials.title },
              ...materials.map((material) => ({
                value: material.id,
                label: `${material.code} ${material.name}`,
              })),
            ]}
            onValueChange={(value) => set({ material: value === ALL ? undefined : value })}
          />
        </>
      }
    >
      <ReportState query={report}>
        {data &&
          (data.rows.length === 0 ? (
            <EmptyState title={ar.projects.report.noRows} />
          ) : (
            <Table aria-label={t.names.material_quantities}>
              <TableHeader>
                <TableRow>
                  <TableHead>{ar.reports.project.project}</TableHead>
                  <TableHead>{c.material}</TableHead>
                  <TableHead numeric>{c.quantityIn}</TableHead>
                  <TableHead numeric>{c.quantityOut}</TableHead>
                  <TableHead numeric>{c.quantity}</TableHead>
                  <TableHead numeric>{c.amount}</TableHead>
                  <TableHead numeric>{c.average}</TableHead>
                  <TableHead numeric>{c.ledgerAmount}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={`${row.project?.id ?? 'none'}:${row.material.id}:${row.currency}`}>
                    <TableCell>
                      {row.project ? (
                        <Link
                          to="/projects/$valueId"
                          params={{ valueId: row.project.id }}
                          search={{ tab: 'materials' }}
                          className="underline-offset-4 hover:underline"
                        >
                          <bdi>{row.project.name}</bdi>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          {t.materialQuantities.unassigned}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span>
                        <bdi dir="ltr" className="font-medium">
                          {row.material.code}
                        </bdi>{' '}
                        <bdi>{row.material.name}</bdi>
                      </span>
                    </TableCell>
                    <TableCell numeric>
                      <QuantityCell quantity={row.quantityIn} unit={row.material.unit} />
                    </TableCell>
                    <TableCell numeric>
                      <QuantityCell quantity={row.quantityOut} unit={row.material.unit} />
                    </TableCell>
                    <TableCell numeric>
                      <QuantityCell quantity={row.quantity} unit={row.material.unit} strong />
                    </TableCell>
                    <TableCell numeric>
                      <Amount
                        value={BigInt(row.amountMinor)}
                        currency={row.currency}
                        showCurrency
                      />
                    </TableCell>
                    <TableCell numeric>
                      {row.average === null ? (
                        t.none
                      ) : (
                        <bdi
                          dir="ltr"
                          className="tabular-nums"
                        >{`${row.average} ${row.currency}`}</bdi>
                      )}
                    </TableCell>
                    <TableCell numeric>
                      <Link
                        to="/reports/lines"
                        search={{
                          ledger,
                          from,
                          to,
                          material: row.material.id,
                          contract: row.project?.id,
                        }}
                        aria-label={ar.projects.report.drill.replace(
                          '{figure}',
                          formatMinor(BigInt(row.ledgerAmount), currency),
                        )}
                        className="underline-offset-4 hover:underline"
                      >
                        <Amount value={BigInt(row.ledgerAmount)} currency={currency} />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold">
                  <TableCell colSpan={7}>{ar.projects.report.totals}</TableCell>
                  <TableCell numeric>
                    <Amount value={BigInt(data.ledgerTotal)} currency={currency} strong />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ))}
      </ReportState>
    </ReportFrame>
  );
}
