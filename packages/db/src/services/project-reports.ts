import {
  type CurrencyCode,
  DAYS_UNIT,
  DomainError,
  type Ledger,
  type MaterialQuantities,
  type MaterialQuantitiesQuery,
  type ProjectDocumentKind,
  type ProjectList,
  type ProjectListQuery,
  type ProjectReport,
  type ProjectReportQuery,
  type ProjectReportTerms,
  type ReportMaterial,
  type ReportValue,
} from '@vertex-mizan/contracts';
import {
  averageUnitCost,
  basisPointsText,
  billingNet,
  onItsSide,
  type ProfitabilityAmount,
  percentOf,
  profitability,
  projectCosts,
  quantityText,
  showsVariance,
} from '@vertex-mizan/ledger';
import { type SQL, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { companySettings } from '../schema/companies.js';
import { ledgersOf } from './companies.js';
import {
  builtinDimensionTypeId,
  readReportChart,
  reportContextOf,
  reportHeaderOf,
  reportValuesById,
} from './reports.js';

/**
 * The project reads of S12 "Reports" (`docs/scenarios/reports/project-report.md`): the projects
 * list, the project report and the material quantities. Every amount is a sum of stored ledger
 * amounts in SQL, in the ledger asked (the book by default), nothing converted; the variances,
 * shares and averages come from `packages/ledger`. A project's figures are its lines, those whose
 * dimension set carries the project's contract value.
 */

/** The accounts of `contracting@1` the report reads by code (S12 "Accounting treatment"). */
const CODES = {
  receivable: '112001',
  retention: '113002',
  advancePaid: '114002',
  payable: '211002',
  subcontractRetention: '211006',
  wages: '211007',
  clientAdvance: '212002',
} as const;

type Code = keyof typeof CODES;

const ledgerAmount = (ledger: Ledger) =>
  ledger === 'book' ? sql.raw('l.book_minor') : sql.raw('coalesce(l.parallel_minor, 0)');

const ids = (values: readonly string[]) => sql`${`{${values.join(',')}}`}::uuid[]`;

const big = (text: string | null | undefined) => BigInt(text ?? '0');

const thousandths = (column: SQL) => sql`(coalesce(sum(${column}), 0) * 1000)::bigint::text`;

const plainValue = (value: ReportValue & { contractKind: string | null }): ReportValue => ({
  id: value.id,
  typeCode: value.typeCode,
  code: value.code,
  name: value.name,
  archived: value.archived,
});

interface Chart {
  /** The account of each code the report reads, absent when the chart lacks it. */
  readonly byCode: Partial<Record<Code, string>>;
  readonly revenue: readonly string[];
  readonly directCosts: readonly string[];
  readonly rows: Awaited<ReturnType<typeof readReportChart>>;
}

async function chartOf(tx: Transaction): Promise<Chart> {
  const rows = await readReportChart(tx);
  const byCode: Partial<Record<Code, string>> = {};
  for (const [key, code] of Object.entries(CODES) as [Code, string][]) {
    const account = rows.find((row) => row.code === code && row.postable);
    if (account !== undefined) byCode[key] = account.id;
  }
  const on = (line: string) =>
    rows.filter((row) => row.postable && row.statementLine === line).map((row) => row.id);
  return { byCode, revenue: on('is.revenue'), directCosts: on('is.direct_costs'), rows };
}

/**
 * The net debit of some accounts per account and contract value over a range (`from` null: the
 * start of the books), optionally of some projects only.
 */
async function contractSums(
  tx: Transaction,
  ledger: Ledger,
  range: { readonly from: string | null; readonly to: string },
  accountIds: readonly string[],
  contractType: string,
  contracts?: readonly string[],
): Promise<{ accountId: string; contractId: string; net: bigint }[]> {
  if (accountIds.length === 0 || contracts?.length === 0) return [];
  const rows = await tx.execute<{ account_id: string; contract_id: string; net: string }>(sql`
    select l.account_id, v.value_id as contract_id, sum(${ledgerAmount(ledger)})::text as net
    from journal_lines l
    join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    join dimension_set_values v on v.company_id = l.company_id
      and v.set_id = l.dimension_set_id and v.type_id = ${contractType}::uuid
    where l.account_id = any(${ids(accountIds)})
      and ${range.from === null ? sql`true` : sql`e.entry_date >= ${range.from}`}
      and e.entry_date <= ${range.to}
      and ${contracts === undefined ? sql`true` : sql`v.value_id = any(${ids(contracts)})`}
    group by l.account_id, v.value_id`);
  return rows.rows.map((row) => ({
    accountId: row.account_id,
    contractId: row.contract_id,
    net: BigInt(row.net),
  }));
}

/** The figures of S09's profitability by contract, per project. */
function figuresByProject(
  chart: Chart,
  sums: readonly { accountId: string; contractId: string; net: bigint }[],
) {
  const revenue = new Set(chart.revenue);
  const amounts: ProfitabilityAmount[] = sums
    .filter((row) => revenue.has(row.accountId) || chart.directCosts.includes(row.accountId))
    .map((row) => ({
      statementLine: revenue.has(row.accountId) ? 'is.revenue' : 'is.direct_costs',
      valueId: row.contractId,
      current: row.net,
      compare: 0n,
    }));
  const report = profitability({ amounts, compared: false });
  return (contractId: string) => {
    const row = report.rows.find((candidate) => candidate.valueId === contractId);
    const figures = row?.current ?? {
      revenue: 0n,
      directCosts: 0n,
      contribution: 0n,
      margin: null,
    };
    return {
      revenue: figures.revenue.toString(),
      directCosts: figures.directCosts.toString(),
      contribution: figures.contribution.toString(),
      margin: figures.margin,
    };
  };
}

/** The net debit of one account for one project in `sums`. */
const netOf = (
  sums: readonly { accountId: string; contractId: string; net: bigint }[],
  accountId: string | undefined,
  contractId: string,
) =>
  sums
    .filter((row) => row.accountId === accountId && row.contractId === contractId)
    .reduce((total, row) => total + row.net, 0n);

/** The projects of the company: values of the built-in `contract` type of kind `project`. */
async function projectRows(
  tx: Transaction,
  contractType: string,
  options: { readonly id?: string; readonly archived: boolean },
) {
  const rows = await tx.execute<{
    id: string;
    parent_value_id: string | null;
    currency: string | null;
    contract_value_minor: string | null;
    retention_bp: number | null;
    advance_recovery_bp: number | null;
    budget: string | null;
  }>(sql`
    select v.id, v.parent_value_id, t.currency, t.contract_value_minor::text, t.retention_bp,
      t.advance_recovery_bp,
      (select sum(b.amount_minor)::text from project_budgets b where b.company_id = v.company_id
        and b.contract_value_id = v.id and b.archived_at is null) as budget
    from dimension_values v
    left join project_terms t on t.company_id = v.company_id and t.contract_value_id = v.id
      and t.archived_at is null
    where v.type_id = ${contractType}::uuid and v.contract_kind = 'project'
      and ${options.id === undefined ? sql`true` : sql`v.id = ${options.id}::uuid`}
      and ${options.archived || options.id !== undefined ? sql`true` : sql`v.archived_at is null`}
    order by v.code nulls last, v.name, v.id`);
  return rows.rows.map((row) => ({
    id: row.id,
    clientId: row.parent_value_id,
    budget: row.budget,
    terms:
      row.currency === null
        ? null
        : ({
            currency: row.currency as CurrencyCode,
            contractValueMinor: row.contract_value_minor ?? '0',
            retentionBp: row.retention_bp ?? 0,
            advanceRecoveryBp: row.advance_recovery_bp ?? 0,
          } satisfies ProjectReportTerms),
  }));
}

/** A reversal dated on or before `to` cancels a document's entry (S12 rule 22). */
const cancelledBy = (to: string) => sql`exists (select 1 from journal_entries r
  where r.company_id = d.company_id and r.reverses_entry_id = d.entry_id and r.entry_date <= ${to})`;

/**
 * The cumulative of each project's (or subcontract's) latest standing billing of a kind dated on
 * or before `to`, keyed `<contract>` or `<contract>/<counterparty>`.
 */
async function latestCumulatives(
  tx: Transaction,
  kind: 'progress_billing' | 'subcontract_billing',
  to: string,
): Promise<Map<string, string>> {
  const rows = await tx.execute<{ contract: string; party: string | null; cumulative: string }>(sql`
    select distinct on (d.contract_value_id, d.counterparty_value_id)
      d.contract_value_id as contract, d.counterparty_value_id as party,
      d.cumulative_minor::text as cumulative
    from project_documents d
    where d.kind = ${kind} and d.document_date <= ${to} and not ${cancelledBy(to)}
    order by d.contract_value_id, d.counterparty_value_id, d.project_sequence desc`);
  return new Map(
    rows.rows.map((row) => [
      kind === 'progress_billing' ? row.contract : `${row.contract}/${row.party}`,
      row.cumulative,
    ]),
  );
}

/** The cumulative's share of the contract value (S12 "Reports"). */
const billedShare = (cumulative: string, terms: ProjectReportTerms | null) =>
  terms === null ? null : percentOf(big(cumulative), big(terms.contractValueMinor));

/** The contract balances of the projects at `to`, each positive on its own side. */
function balancesOf(
  chart: Chart,
  sums: readonly { accountId: string; contractId: string; net: bigint }[],
  contractId: string,
) {
  return {
    retentionReceivable: onItsSide(
      netOf(sums, chart.byCode.retention, contractId),
      'debit',
    ).toString(),
    clientAdvance: onItsSide(
      netOf(sums, chart.byCode.clientAdvance, contractId),
      'credit',
    ).toString(),
  };
}

const balanceAccounts = (chart: Chart) =>
  [chart.byCode.retention, chart.byCode.clientAdvance].filter(
    (id): id is string => id !== undefined,
  );

// ——— The projects list ———

/** `GET /api/projects`: each project's life-to-date figures at `asOf` (S12 "Screens", `/projects`). */
export async function readProjectList(
  tx: Transaction,
  query: ProjectListQuery,
  today: string,
  now: Date,
): Promise<ProjectList> {
  const asOf = query.asOf ?? today;
  const context = await reportContextOf(tx, query.ledger);
  const chart = await chartOf(tx);
  const contractType = await builtinDimensionTypeId(tx, 'contract');
  const projects = await projectRows(tx, contractType, { archived: query.archived });
  const projectIds = projects.map((project) => project.id);
  const range = { from: null, to: asOf };
  const results = await contractSums(
    tx,
    context.ledger,
    range,
    [...chart.revenue, ...chart.directCosts],
    contractType,
    projectIds,
  );
  const balances = await contractSums(
    tx,
    context.ledger,
    range,
    balanceAccounts(chart),
    contractType,
    projectIds,
  );
  const figures = figuresByProject(chart, results);
  const cumulatives = await latestCumulatives(tx, 'progress_billing', asOf);
  const values = await reportValuesById(tx, [
    ...projectIds,
    ...projects.flatMap((project) => (project.clientId === null ? [] : [project.clientId])),
  ]);
  return {
    header: await reportHeaderOf(tx, context, range, null, now),
    projects: projects.flatMap((project) => {
      const value = values.get(project.id);
      if (value === undefined) return [];
      const client = project.clientId === null ? undefined : values.get(project.clientId);
      const cumulative = cumulatives.get(project.id) ?? '0';
      return [
        {
          project: plainValue(value),
          client: client === undefined ? null : plainValue(client),
          terms: project.terms,
          cumulativeMinor: cumulative,
          billed: billedShare(cumulative, project.terms),
          ...figures(project.id),
          ...balancesOf(chart, balances, project.id),
          budgetMinor: project.terms === null ? null : (project.budget ?? '0'),
        },
      ];
    }),
  };
}

// ——— The project report ———

/** The materials named by id, archived marked. */
async function materialsById(
  tx: Transaction,
  materialIds: readonly string[],
): Promise<Map<string, ReportMaterial>> {
  if (materialIds.length === 0) return new Map();
  const rows = await tx.execute<{
    id: string;
    code: string;
    name: string;
    unit: string;
    archived: boolean;
  }>(sql`
    select id, code, name, unit, archived_at is not null as archived from materials
    where id = any(${ids([...new Set(materialIds)])})`);
  return new Map(rows.rows.map((row) => [row.id, { ...row }]));
}

/** The range's lines of a project on the accounts that require a material, per material and currency. */
async function projectMaterials(
  tx: Transaction,
  ledger: Ledger,
  range: { readonly from: string; readonly to: string },
  contractType: string,
  projectId: string,
) {
  const rows = await tx.execute<{
    material_id: string;
    currency: string;
    quantity: string;
    amount: string;
    ledger_amount: string;
  }>(sql`
    select q.material_id, l.currency, ${thousandths(sql`q.quantity`)} as quantity,
      sum(l.amount_minor)::text as amount, sum(${ledgerAmount(ledger)})::text as ledger_amount
    from journal_lines l
    join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    join chart_accounts a on a.company_id = l.company_id and a.id = l.account_id
    join line_quantities q on q.company_id = l.company_id and q.line_id = l.id
    join dimension_set_values v on v.company_id = l.company_id
      and v.set_id = l.dimension_set_id and v.type_id = ${contractType}::uuid
    where a.requires_material and q.material_id is not null and v.value_id = ${projectId}::uuid
      and e.entry_date between ${range.from} and ${range.to}
    group by q.material_id, l.currency`);
  const materials = await materialsById(
    tx,
    rows.rows.map((row) => row.material_id),
  );
  return rows.rows
    .map((row) => {
      const material = materials.get(row.material_id);
      if (material === undefined) throw new Error('A quantity names a material that is not there');
      const currency = row.currency as CurrencyCode;
      return {
        material,
        currency,
        quantity: quantityText(BigInt(row.quantity)),
        amountMinor: row.amount,
        ledgerAmount: row.ledger_amount,
        average: averageUnitCost(BigInt(row.amount), currency, BigInt(row.quantity)),
      };
    })
    .sort((a, b) =>
      a.material.code === b.material.code
        ? a.currency.localeCompare(b.currency)
        : a.material.code.localeCompare(b.material.code),
    );
}

/**
 * The workers with a wage-sheet line on the project in the range (its cost lines, or their
 * reversal's): days, lump sums and amount, and each worker's running balance at `to` on `211007`.
 */
async function projectWages(
  tx: Transaction,
  ledger: Ledger,
  range: { readonly from: string; readonly to: string },
  projectId: string,
  wagesAccount: string | undefined,
) {
  const workerType = await builtinDimensionTypeId(tx, 'worker');
  const amount = ledgerAmount(ledger);
  const rows = await tx.execute<{
    worker_id: string;
    days: string;
    lump_sum: string;
    amount: string;
  }>(sql`
    select w.value_id as worker_id,
      ${thousandths(sql`case when q.unit = ${DAYS_UNIT} and q.material_id is null then q.quantity end`)} as days,
      coalesce(sum(case when q.id is null then ${amount} end), 0)::text as lump_sum,
      sum(${amount})::text as amount
    from journal_lines l
    join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    join project_documents d on d.company_id = l.company_id and d.kind = 'wage_sheet'
      and d.contract_value_id = ${projectId}::uuid
      and (d.entry_id = e.id or d.entry_id = e.reverses_entry_id)
    join chart_accounts a on a.company_id = l.company_id and a.id = l.account_id
    join dimension_set_values w on w.company_id = l.company_id
      and w.set_id = l.dimension_set_id and w.type_id = ${workerType}::uuid
    left join line_quantities q on q.company_id = l.company_id and q.line_id = l.id
    where a.statement_line = 'is.direct_costs'
      and e.entry_date between ${range.from} and ${range.to}
    group by w.value_id`);
  const workerIds = rows.rows.map((row) => row.worker_id);
  const balances =
    wagesAccount === undefined || workerIds.length === 0
      ? []
      : (
          await tx.execute<{ worker_id: string; net: string }>(sql`
            select w.value_id as worker_id, sum(${amount})::text as net
            from journal_lines l
            join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
            join dimension_set_values w on w.company_id = l.company_id
              and w.set_id = l.dimension_set_id and w.type_id = ${workerType}::uuid
            where l.account_id = ${wagesAccount}::uuid and e.entry_date <= ${range.to}
              and w.value_id = any(${ids(workerIds)})
            group by w.value_id`)
        ).rows;
  const values = await reportValuesById(tx, workerIds);
  return rows.rows
    .map((row) => {
      const worker = values.get(row.worker_id);
      if (worker === undefined) throw new Error('A line names a worker that is not there');
      const net = balances.find((balance) => balance.worker_id === row.worker_id)?.net;
      return {
        worker: plainValue(worker),
        days: quantityText(BigInt(row.days)),
        lumpSum: row.lump_sum,
        amount: row.amount,
        balance: onItsSide(big(net), 'credit').toString(),
      };
    })
    .sort((a, b) => (a.worker.code ?? a.worker.name).localeCompare(b.worker.code ?? b.worker.name));
}

/**
 * Each subcontract of the project: its value and cumulative to `to`, the retention held and the
 * advance carried for the project at `to` (lines with the project and the supplier), and the
 * supplier's payments in the range: the clearing movements of its running payable, reversals
 * left out.
 */
async function projectSubcontracts(
  tx: Transaction,
  ledger: Ledger,
  range: { readonly from: string; readonly to: string },
  chart: Chart,
  contractType: string,
  projectId: string,
) {
  const supplierType = await builtinDimensionTypeId(tx, 'supplier');
  const subcontracts = (
    await tx.execute<{
      id: string;
      supplier_value_id: string;
      currency: string;
      value_minor: string | null;
    }>(sql`
      select id, supplier_value_id, currency, value_minor::text from subcontracts
      where contract_value_id = ${projectId}::uuid order by created_at, id`)
  ).rows;
  if (subcontracts.length === 0) return [];
  const amount = ledgerAmount(ledger);
  const accounts = [chart.byCode.subcontractRetention, chart.byCode.advancePaid].filter(
    (id): id is string => id !== undefined,
  );
  const held =
    accounts.length === 0
      ? []
      : (
          await tx.execute<{ account_id: string; supplier_id: string; net: string }>(sql`
            select l.account_id, s.value_id as supplier_id, sum(${amount})::text as net
            from journal_lines l
            join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
            join dimension_set_values v on v.company_id = l.company_id
              and v.set_id = l.dimension_set_id and v.type_id = ${contractType}::uuid
            join dimension_set_values s on s.company_id = l.company_id
              and s.set_id = l.dimension_set_id and s.type_id = ${supplierType}::uuid
            where l.account_id = any(${ids(accounts)}) and v.value_id = ${projectId}::uuid
              and e.entry_date <= ${range.to}
            group by l.account_id, s.value_id`)
        ).rows;
  const movement =
    ledger === 'book' ? sql.raw('m.book_minor') : sql.raw('coalesce(m.parallel_minor, 0)');
  const paid =
    chart.byCode.payable === undefined
      ? []
      : (
          await tx.execute<{ supplier_id: string; paid: string }>(sql`
            select i.counterparty_value_id as supplier_id, sum(${movement})::text as paid
            from open_item_movements m
            join open_items i on i.company_id = m.company_id and i.id = m.item_id
            join journal_entries e on e.company_id = m.company_id and e.id = m.entry_id
            where i.account_id = ${chart.byCode.payable}::uuid and m.kind = 'clear'
              and m.entry_date between ${range.from} and ${range.to}
              -- A reversed payment nets out with its reversal; a document of the project (a
              -- billing crediting a debit balance) or its reversal is no payment.
              and not exists (select 1 from project_documents d
                where d.company_id = e.company_id
                  and (d.entry_id = e.id or d.entry_id = e.reverses_entry_id))
            group by i.counterparty_value_id`)
        ).rows;
  const cumulatives = await latestCumulatives(tx, 'subcontract_billing', range.to);
  const values = await reportValuesById(
    tx,
    subcontracts.map((row) => row.supplier_value_id),
  );
  const heldOn = (accountId: string | undefined, supplierId: string) =>
    big(held.find((row) => row.account_id === accountId && row.supplier_id === supplierId)?.net);
  return subcontracts.map((row) => {
    const supplier = values.get(row.supplier_value_id);
    if (supplier === undefined) throw new Error('A subcontract names a supplier that is not there');
    return {
      subcontractId: row.id,
      supplier: plainValue(supplier),
      currency: row.currency as CurrencyCode,
      valueMinor: row.value_minor,
      cumulativeMinor: cumulatives.get(`${projectId}/${row.supplier_value_id}`) ?? '0',
      retention: onItsSide(
        heldOn(chart.byCode.subcontractRetention, row.supplier_value_id),
        'credit',
      ).toString(),
      advance: onItsSide(
        heldOn(chart.byCode.advancePaid, row.supplier_value_id),
        'debit',
      ).toString(),
      paid: paid.find((candidate) => candidate.supplier_id === row.supplier_value_id)?.paid ?? '0',
    };
  });
}

/**
 * Every client's billing of the project dated on or before `to`, in its sequence, with what
 * remains of its receivable on `112001` at `to` (the item its entry opened).
 */
async function projectBillings(tx: Transaction, to: string, chart: Chart, projectId: string) {
  const receivable = chart.byCode.receivable;
  const rows = await tx.execute<{
    id: string;
    entry_id: string;
    project_sequence: number;
    fiscal_year: number;
    number: number;
    document_date: string;
    cumulative: string;
    previous: string;
    retention: string;
    advance: string;
    cancelled: boolean;
    outstanding: string | null;
  }>(sql`
    select d.id, d.entry_id, d.project_sequence, d.fiscal_year, d.number,
      to_char(d.document_date, 'YYYY-MM-DD') as document_date,
      d.cumulative_minor::text as cumulative, d.previous_minor::text as previous,
      coalesce(d.retention_minor, 0)::text as retention, coalesce(d.advance_minor, 0)::text as advance,
      ${cancelledBy(to)} as cancelled,
      ${
        receivable === undefined
          ? sql`null`
          : sql`(select sum(m.amount_minor)::text from open_items i
              join open_item_movements m on m.company_id = i.company_id and m.item_id = i.id
              where i.company_id = d.company_id and i.opened_by_entry_id = d.entry_id
                and i.account_id = ${receivable}::uuid and m.entry_date <= ${to})`
      } as outstanding
    from project_documents d
    where d.kind = 'progress_billing' and d.contract_value_id = ${projectId}::uuid
      and d.document_date <= ${to}
    order by d.project_sequence`);
  return rows.rows.map((row) => {
    const { period, net } = billingNet({
      cumulative: BigInt(row.cumulative),
      previous: BigInt(row.previous),
      retention: BigInt(row.retention),
      advance: BigInt(row.advance),
    });
    return {
      documentId: row.id,
      entryId: row.entry_id,
      projectSequence: row.project_sequence,
      fiscalYear: row.fiscal_year,
      number: row.number,
      documentDate: row.document_date,
      cumulativeMinor: row.cumulative,
      previousMinor: row.previous,
      periodMinor: period.toString(),
      retentionMinor: row.retention,
      advanceMinor: row.advance,
      netMinor: net.toString(),
      state: row.cancelled ? ('cancelled' as const) : ('posted' as const),
      // A cancelled billing's receivable is reversed with it.
      outstandingMinor: row.cancelled ? '0' : (row.outstanding ?? '0'),
    };
  });
}

/** `GET /api/projects/:valueId/report` (S12 "Reports"; `NOT_FOUND` for anything but a project). */
export async function readProjectReport(
  tx: Transaction,
  projectId: string,
  query: ProjectReportQuery,
  now: Date,
): Promise<ProjectReport> {
  const context = await reportContextOf(tx, query.ledger);
  const contractType = await builtinDimensionTypeId(tx, 'contract');
  const [project] = await projectRows(tx, contractType, { id: projectId, archived: true });
  if (project === undefined) throw new DomainError('NOT_FOUND', 'No such project');
  const chart = await chartOf(tx);
  const range = { from: query.from, to: query.to };
  const toDate = { from: null, to: query.to };
  const inRange = await contractSums(
    tx,
    context.ledger,
    range,
    [...chart.revenue, ...chart.directCosts],
    contractType,
    [projectId],
  );
  const toDateCosts = await contractSums(
    tx,
    context.ledger,
    toDate,
    chart.directCosts,
    contractType,
    [projectId],
  );
  const balanceIds = [
    ...balanceAccounts(chart),
    ...[chart.byCode.subcontractRetention, chart.byCode.advancePaid].filter(
      (id): id is string => id !== undefined,
    ),
  ];
  const balances = await contractSums(tx, context.ledger, toDate, balanceIds, contractType, [
    projectId,
  ]);
  const budget = (
    await tx.execute<{ account_id: string; amount: string }>(sql`
      select account_id, amount_minor::text as amount from project_budgets
      where contract_value_id = ${projectId}::uuid and archived_at is null`)
  ).rows;
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  // Each direct-cost account with a budget or a line of the project to `to`, by code.
  const costAccounts = chart.rows.filter(
    (account) =>
      chart.directCosts.includes(account.id) &&
      (budget.some((row) => row.account_id === account.id) ||
        toDateCosts.some((row) => row.accountId === account.id) ||
        inRange.some((row) => row.accountId === account.id)),
  );
  const costs = projectCosts(
    costAccounts.map((account) => ({
      account: account.report,
      inRange: netOf(inRange, account.id, projectId),
      toDate: netOf(toDateCosts, account.id, projectId),
      budget: big(budget.find((row) => row.account_id === account.id)?.amount),
    })),
    showsVariance({
      termsCurrency: project.terms?.currency ?? null,
      bookCurrency: ledgersOf(settings).book.currency,
      ledger: context.ledger,
    }),
  );
  const costFigures = (row: (typeof costs)['totals']) => ({
    inRange: row.inRange.toString(),
    toDate: row.toDate.toString(),
    budgetMinor: row.budget.toString(),
    variance: row.variance === null ? null : row.variance.toString(),
    used: row.used,
  });
  const cumulative =
    (await latestCumulatives(tx, 'progress_billing', query.to)).get(projectId) ?? '0';
  const values = await reportValuesById(tx, [
    projectId,
    ...(project.clientId === null ? [] : [project.clientId]),
  ]);
  const value = values.get(projectId);
  if (value === undefined) throw new DomainError('NOT_FOUND', 'No such project');
  const client = project.clientId === null ? undefined : values.get(project.clientId);
  return {
    header: await reportHeaderOf(tx, context, range, null, now),
    project: plainValue(value),
    client: client === undefined ? null : plainValue(client),
    terms: project.terms,
    summary: {
      cumulativeMinor: cumulative,
      billed: billedShare(cumulative, project.terms),
      ...figuresByProject(chart, inRange)(projectId),
      ...balancesOf(chart, balances, projectId),
      subcontractRetention: onItsSide(
        netOf(balances, chart.byCode.subcontractRetention, projectId),
        'credit',
      ).toString(),
      subcontractAdvance: onItsSide(
        netOf(balances, chart.byCode.advancePaid, projectId),
        'debit',
      ).toString(),
    },
    costs: {
      rows: costs.rows.map((row) => ({ account: row.account, ...costFigures(row) })),
      totals: costFigures(costs.totals),
    },
    materials: await projectMaterials(tx, context.ledger, range, contractType, projectId),
    wages: await projectWages(tx, context.ledger, range, projectId, chart.byCode.wages),
    subcontracts: await projectSubcontracts(
      tx,
      context.ledger,
      range,
      chart,
      contractType,
      projectId,
    ),
    billings: await projectBillings(tx, query.to, chart, projectId),
  };
}

// ——— Material quantities ———

/**
 * `GET /api/reports/material-quantities` (S12 "Reports"): per project and material in each
 * transaction currency, the range's lines with a quantity on the accounts that require a material.
 */
export async function readMaterialQuantities(
  tx: Transaction,
  query: MaterialQuantitiesQuery,
  now: Date,
): Promise<MaterialQuantities> {
  const context = await reportContextOf(tx, query.ledger);
  const contractType = await builtinDimensionTypeId(tx, 'contract');
  const amount = ledgerAmount(context.ledger);
  const rows = await tx.execute<{
    project_id: string | null;
    material_id: string;
    currency: string;
    quantity_in: string;
    quantity_out: string;
    quantity: string;
    amount: string;
    ledger_amount: string;
  }>(sql`
    select v.value_id as project_id, q.material_id, l.currency,
      ${thousandths(sql`greatest(q.quantity, 0)`)} as quantity_in,
      ${thousandths(sql`least(q.quantity, 0)`)} as quantity_out,
      ${thousandths(sql`q.quantity`)} as quantity,
      sum(l.amount_minor)::text as amount, sum(${amount})::text as ledger_amount
    from journal_lines l
    join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    join chart_accounts a on a.company_id = l.company_id and a.id = l.account_id
    join line_quantities q on q.company_id = l.company_id and q.line_id = l.id
    left join dimension_set_values v on v.company_id = l.company_id
      and v.set_id = l.dimension_set_id and v.type_id = ${contractType}::uuid
    where a.requires_material and q.material_id is not null
      and e.entry_date between ${query.from} and ${query.to}
      and ${query.contract === undefined ? sql`true` : sql`v.value_id = ${query.contract}::uuid`}
      and ${query.material === undefined ? sql`true` : sql`q.material_id = ${query.material}::uuid`}
    group by v.value_id, q.material_id, l.currency`);
  const [total] = (
    await tx.execute<{ total: string }>(sql`
      select coalesce(sum(${amount}), 0)::text as total
      from journal_lines l
      join journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
      join chart_accounts a on a.company_id = l.company_id and a.id = l.account_id
      join line_quantities q on q.company_id = l.company_id and q.line_id = l.id
      where a.requires_material and q.material_id is not null
        and e.entry_date between ${query.from} and ${query.to}
        and ${
          query.contract === undefined
            ? sql`true`
            : sql`exists (select 1 from dimension_set_values v where v.company_id = l.company_id
                and v.set_id = l.dimension_set_id and v.value_id = ${query.contract}::uuid)`
        }
        and ${query.material === undefined ? sql`true` : sql`q.material_id = ${query.material}::uuid`}`)
  ).rows;
  const materials = await materialsById(
    tx,
    rows.rows.map((row) => row.material_id),
  );
  const values = await reportValuesById(
    tx,
    rows.rows.flatMap((row) => (row.project_id === null ? [] : [row.project_id])),
  );
  const sortKey = (row: {
    project: ReportValue | null;
    material: ReportMaterial;
    currency: string;
  }) =>
    `${row.project === null ? '￿' : (row.project.code ?? row.project.name)}\u0000${row.material.code}\u0000${row.currency}`;
  return {
    header: await reportHeaderOf(tx, context, { from: query.from, to: query.to }, null, now),
    rows: rows.rows
      .map((row) => {
        const material = materials.get(row.material_id);
        if (material === undefined)
          throw new Error('A quantity names a material that is not there');
        const project = row.project_id === null ? undefined : values.get(row.project_id);
        const currency = row.currency as CurrencyCode;
        return {
          project: project === undefined ? null : plainValue(project),
          material,
          currency,
          quantityIn: quantityText(BigInt(row.quantity_in)),
          quantityOut: quantityText(BigInt(row.quantity_out)),
          quantity: quantityText(BigInt(row.quantity)),
          amountMinor: row.amount,
          average: averageUnitCost(BigInt(row.amount), currency, BigInt(row.quantity)),
          ledgerAmount: row.ledger_amount,
        };
      })
      .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
    ledgerTotal: total?.total ?? '0',
  };
}

// ——— A project document as it prints ———

/** A line of a printed project document: a purchase's or a sheet's line, or a released retention. */
export interface ProjectDocumentPrintLine {
  readonly lineNo: number;
  readonly account: { readonly code: string; readonly name: string };
  readonly currency: CurrencyCode;
  /** A magnitude for a released retention; the line's signed amount otherwise. */
  readonly amountMinor: string;
  readonly material: { readonly code: string; readonly name: string } | null;
  readonly worker: string | null;
  readonly quantity: string | null;
  readonly unit: string | null;
  readonly unitPrice: string | null;
  /** A lump sum's description, or a line's memo. */
  readonly memo: string | null;
  /** The open item a released retention clears. */
  readonly item: string | null;
}

/**
 * A project document as it prints (S12 "Printing and legal books"): its kind and numbers, its
 * project, client and counterparty by name, its figures (a billing's cumulative, previous, period,
 * deductions and net), the rates of its terms or subcontract, its lines, its entry, who prepared
 * and approved it, and the reversal that cancelled it.
 */
export interface ProjectDocumentPrint {
  readonly id: string;
  readonly kind: ProjectDocumentKind;
  readonly fiscalYear: number;
  readonly number: number;
  readonly projectSequence: number | null;
  readonly documentDate: string;
  readonly currency: CurrencyCode;
  readonly project: { readonly code: string | null; readonly name: string };
  readonly client: { readonly code: string | null; readonly name: string } | null;
  readonly counterparty: { readonly code: string | null; readonly name: string } | null;
  readonly side: 'client' | 'supplier' | null;
  readonly supplierReference: string | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  /** The contract's (or subcontract's) value and rates, for a billing. */
  readonly contractValueMinor: string | null;
  readonly retentionBp: number | null;
  readonly advanceRecoveryBp: number | null;
  /** The two rates as printed percentages ("10", "12.5"). */
  readonly retentionRate: string | null;
  readonly advanceRecoveryRate: string | null;
  readonly totalMinor: string;
  readonly cumulativeMinor: string | null;
  readonly previousMinor: string | null;
  readonly retentionMinor: string | null;
  readonly advanceMinor: string | null;
  /** What the document comes to: a billing's net due, the total otherwise. */
  readonly netMinor: string;
  readonly lines: readonly ProjectDocumentPrintLine[];
  /** A wage sheet's total per worker, in the order of their first line. */
  readonly workerTotals: readonly { readonly worker: string; readonly amountMinor: string }[];
  readonly entry: { readonly fiscalYear: number; readonly number: number };
  readonly cancelledBy: { readonly fiscalYear: number; readonly number: number } | null;
  readonly preparedBy: string | null;
  readonly approvedBy: string | null;
}

/** The document `id` as it prints (`NOT_FOUND` for none in the company). */
export async function readProjectDocumentPrint(
  tx: Transaction,
  id: string,
): Promise<ProjectDocumentPrint> {
  const [row] = (
    await tx.execute<{
      id: string;
      kind: ProjectDocumentKind;
      fiscal_year: number;
      number: number;
      project_sequence: number | null;
      document_date: string;
      currency: string;
      contract_value_id: string;
      counterparty_value_id: string | null;
      side: 'client' | 'supplier' | null;
      supplier_reference: string | null;
      period_from: string | null;
      period_to: string | null;
      total: string;
      cumulative: string | null;
      previous: string | null;
      retention: string | null;
      advance: string | null;
      entry_id: string;
      entry_fiscal_year: number;
      entry_number: number;
      prepared_by: string | null;
      approved_by: string | null;
      reversal_fiscal_year: number | null;
      reversal_number: number | null;
      terms_value: string | null;
      terms_retention: number | null;
      terms_recovery: number | null;
    }>(sql`
      select d.id, d.kind, d.fiscal_year, d.number, d.project_sequence,
        to_char(d.document_date, 'YYYY-MM-DD') as document_date, d.currency, d.contract_value_id,
        d.counterparty_value_id, d.side, d.supplier_reference,
        to_char(d.period_from, 'YYYY-MM-DD') as period_from,
        to_char(d.period_to, 'YYYY-MM-DD') as period_to,
        d.total_minor::text as total, d.cumulative_minor::text as cumulative,
        d.previous_minor::text as previous, d.retention_minor::text as retention,
        d.advance_minor::text as advance, d.entry_id,
        e.fiscal_year as entry_fiscal_year, e.number as entry_number,
        (select u.name from public.users u where u.id = e.prepared_by_user_id) as prepared_by,
        (select u.name from public.users u where u.id = e.approved_by_user_id) as approved_by,
        r.fiscal_year as reversal_fiscal_year, r.number as reversal_number,
        -- The terms the billing was posted under (0075); none on a billing posted before.
        d.contract_value_minor::text as terms_value, d.retention_bp as terms_retention,
        d.advance_recovery_bp as terms_recovery
      from project_documents d
      join journal_entries e on e.company_id = d.company_id and e.id = d.entry_id
      left join journal_entries r on r.company_id = d.company_id and r.reverses_entry_id = d.entry_id
      where d.id = ${id}::uuid`)
  ).rows;
  if (row === undefined) throw new DomainError('NOT_FOUND', 'No such project document');
  const workerType = await builtinDimensionTypeId(tx, 'worker');
  const lines = (
    await tx.execute<{
      line_no: number;
      code: string;
      name: string;
      is_control: boolean;
      currency: string;
      amount: string;
      magnitude: string;
      memo: string | null;
      worker: string | null;
      material_code: string | null;
      material_name: string | null;
      quantity: string | null;
      unit: string | null;
      unit_price: string | null;
      item: string | null;
    }>(sql`
      select l.line_no, a.code, a.name, a.is_control, l.currency, l.amount_minor::text as amount,
        abs(l.amount_minor)::text as magnitude, l.memo,
        (select v.name from dimension_set_values w
          join dimension_values v on v.company_id = w.company_id and v.id = w.value_id
          where w.company_id = l.company_id and w.set_id = l.dimension_set_id
            and w.type_id = ${workerType}::uuid) as worker,
        m.code as material_code, m.name as material_name, q.quantity::text as quantity, q.unit,
        q.unit_price::text as unit_price,
        (select i.reference from open_item_movements mv
          join open_items i on i.company_id = mv.company_id and i.id = mv.item_id
          where mv.company_id = l.company_id and mv.line_id = l.id) as item
      from journal_lines l
      join chart_accounts a on a.company_id = l.company_id and a.id = l.account_id
      left join line_quantities q on q.company_id = l.company_id and q.line_id = l.id
      left join materials m on m.company_id = q.company_id and m.id = q.material_id
      where l.entry_id = ${row.entry_id}::uuid and l.kind not in ('difference', 'rounding')
      order by l.line_no`)
  ).rows;
  // A purchase's and a sheet's own lines are its costs; a release's, the retentions it clears.
  const released = new Set([CODES.retention, CODES.subcontractRetention] as string[]);
  const printed = lines.filter((line) =>
    row.kind === 'purchase' || row.kind === 'wage_sheet'
      ? !line.is_control
      : row.kind === 'retention_release'
        ? released.has(line.code)
        : false,
  );
  const values = await reportValuesById(
    tx,
    [row.contract_value_id, row.counterparty_value_id].filter((value) => value !== null),
  );
  const named = (valueId: string | null) => {
    const value = valueId === null ? undefined : values.get(valueId);
    return value === undefined ? null : { code: value.code, name: value.name };
  };
  const project = named(row.contract_value_id);
  if (project === null) throw new Error('A document of a project that is not there');
  const [parent] = (
    await tx.execute<{ parent_value_id: string | null }>(sql`
      select parent_value_id from dimension_values where id = ${row.contract_value_id}::uuid`)
  ).rows;
  const clientId = parent?.parent_value_id ?? null;
  const client =
    clientId === null ? null : ((await reportValuesById(tx, [clientId])).get(clientId) ?? null);
  const billing = row.kind === 'progress_billing' || row.kind === 'subcontract_billing';
  const workerTotals =
    row.kind !== 'wage_sheet'
      ? []
      : (
          await tx.execute<{ worker: string; amount: string }>(sql`
            select v.name as worker, sum(l.amount_minor)::text as amount
            from journal_lines l
            join chart_accounts a on a.company_id = l.company_id and a.id = l.account_id
            join dimension_set_values w on w.company_id = l.company_id
              and w.set_id = l.dimension_set_id and w.type_id = ${workerType}::uuid
            join dimension_values v on v.company_id = w.company_id and v.id = w.value_id
            where l.entry_id = ${row.entry_id}::uuid and not a.is_control
              and l.kind not in ('difference', 'rounding')
            group by v.id, v.name
            order by min(l.line_no)`)
        ).rows.map((total) => ({ worker: total.worker, amountMinor: total.amount }));
  return {
    id: row.id,
    kind: row.kind,
    fiscalYear: row.fiscal_year,
    number: row.number,
    projectSequence: row.project_sequence,
    documentDate: row.document_date,
    currency: row.currency as CurrencyCode,
    project,
    client: client === null ? null : { code: client.code, name: client.name },
    counterparty: named(row.counterparty_value_id),
    side: row.side,
    supplierReference: row.supplier_reference,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    contractValueMinor: billing ? row.terms_value : null,
    retentionBp: billing ? row.terms_retention : null,
    advanceRecoveryBp: billing ? row.terms_recovery : null,
    retentionRate:
      billing && row.terms_retention !== null ? basisPointsText(row.terms_retention) : null,
    advanceRecoveryRate:
      billing && row.terms_recovery !== null ? basisPointsText(row.terms_recovery) : null,
    totalMinor: row.total,
    cumulativeMinor: row.cumulative,
    previousMinor: row.previous,
    retentionMinor: row.retention,
    advanceMinor: row.advance,
    netMinor: billing
      ? billingNet({
          cumulative: big(row.cumulative),
          previous: big(row.previous),
          retention: big(row.retention),
          advance: big(row.advance),
        }).net.toString()
      : row.total,
    lines: printed.map((line) => ({
      lineNo: Number(line.line_no),
      account: { code: line.code, name: line.name },
      currency: line.currency as CurrencyCode,
      amountMinor: row.kind === 'retention_release' ? line.magnitude : line.amount,
      material:
        line.material_code === null || line.material_name === null
          ? null
          : { code: line.material_code, name: line.material_name },
      worker: line.worker,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unit_price,
      memo: line.memo,
      item: line.item,
    })),
    workerTotals,
    entry: { fiscalYear: row.entry_fiscal_year, number: row.entry_number },
    cancelledBy:
      row.reversal_fiscal_year === null || row.reversal_number === null
        ? null
        : { fiscalYear: row.reversal_fiscal_year, number: row.reversal_number },
    preparedBy: row.prepared_by,
    approvedBy: row.approved_by,
  };
}
