import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  accountStatementSchema,
  balanceSheetSchema,
  contractPositionSchema,
  generalLedgerSchema,
  incomeStatementSchema,
  journalBookPrintSchema,
  journalSchema,
  profitabilitySchema,
  reportFileSchema,
  reportLinesSchema,
  revenueReleaseScheduleSchema,
  serviceDepartmentHistorySchema,
  trialBalanceSchema,
} from '@vertex-mizan/contracts';
import { api, listOf } from '../../lib/api';

/** A report's parameters as the API reads them: strings, an unset one left out. */
export type ReportParams = Readonly<Record<string, string | undefined>>;

/** The set parameters as a search string, `?…` or nothing. */
export function searchOf(params: ReportParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/** The set parameters only, as `POST /api/reports/files` stores them. */
export function paramsOf(params: ReportParams): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );
}

const read = <T>(companyId: string, path: string, schema: { parse(value: unknown): T }) =>
  api('GET', path, { company: companyId, schema });

/** Every report read sits under `['reports', companyId, …]`. */
function reportQuery<T>(
  companyId: string,
  name: string,
  path: string,
  params: ReportParams,
  schema: { parse(value: unknown): T },
) {
  return queryOptions({
    queryKey: ['reports', companyId, name, params],
    queryFn: () => read(companyId, `${path}${searchOf(params)}`, schema),
    retry: false,
  });
}

/** A paged report (rules 10–12, 6): 200 lines a page, each page read by the last one's cursor. */
function pagedQuery<T extends { nextCursor: string | null }>(
  companyId: string,
  name: string,
  path: string,
  params: ReportParams,
  schema: { parse(value: unknown): T },
) {
  return infiniteQueryOptions({
    queryKey: ['reports', companyId, name, params],
    queryFn: ({ pageParam }) =>
      read(companyId, `${path}${searchOf({ ...params, cursor: pageParam })}`, schema),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
}

export const trialBalanceQuery = (companyId: string, params: ReportParams) =>
  reportQuery(companyId, 'trial-balance', '/reports/trial-balance', params, trialBalanceSchema);

export const generalLedgerQuery = (companyId: string, params: ReportParams) =>
  pagedQuery(companyId, 'general-ledger', '/reports/general-ledger', params, generalLedgerSchema);

export const accountStatementQuery = (companyId: string, account: string, params: ReportParams) =>
  pagedQuery(
    companyId,
    `statement-${account}`,
    `/reports/accounts/${account}/statement`,
    params,
    accountStatementSchema,
  );

export const journalQuery = (companyId: string, params: ReportParams) =>
  pagedQuery(companyId, 'journal', '/reports/journal', params, journalSchema);

export const incomeStatementQuery = (companyId: string, params: ReportParams) =>
  reportQuery(
    companyId,
    'income-statement',
    '/reports/income-statement',
    params,
    incomeStatementSchema,
  );

export const balanceSheetQuery = (companyId: string, params: ReportParams) =>
  reportQuery(companyId, 'balance-sheet', '/reports/balance-sheet', params, balanceSheetSchema);

export const profitabilityQuery = (companyId: string, params: ReportParams) =>
  reportQuery(companyId, 'profitability', '/reports/profitability', params, profitabilitySchema);

export const contractPositionQuery = (companyId: string, params: ReportParams) =>
  reportQuery(
    companyId,
    'contract-position',
    '/reports/contract-position',
    params,
    contractPositionSchema,
  );

export const revenueScheduleQuery = (companyId: string, params: ReportParams) =>
  reportQuery(
    companyId,
    'revenue-schedule',
    '/reports/revenue-schedule',
    params,
    revenueReleaseScheduleSchema,
  );

export const reportLinesQuery = (companyId: string, params: ReportParams) =>
  pagedQuery(companyId, 'lines', '/reports/lines', params, reportLinesSchema);

/** `GET /api/reports/journal-book/prints`: one fiscal year's register, newest first. */
export function journalBookPrintsQuery(companyId: string, fiscalYear: number) {
  return queryOptions({
    queryKey: ['reports', companyId, 'prints', fiscalYear],
    queryFn: () =>
      read(
        companyId,
        `/reports/journal-book/prints?fiscalYear=${fiscalYear}`,
        listOf(journalBookPrintSchema),
      ),
  });
}

/** How often a queued PDF's state is read again (the worker renders within a minute). */
export const FILE_POLL_MS = 2_000;

/** `GET /api/reports/files/:id`: one PDF and its state, read again while it is queued. */
export function reportFileQuery(companyId: string, id: string) {
  return queryOptions({
    queryKey: ['reports', companyId, 'file', id],
    queryFn: () => read(companyId, `/reports/files/${id}`, reportFileSchema),
    refetchInterval: (query) => (query.state.data?.state === 'queued' ? FILE_POLL_MS : false),
  });
}

/** `GET /api/dimension-values/:id/departments`: a service's department history (rule 32). */
export function serviceDepartmentsQuery(companyId: string, serviceId: string) {
  return queryOptions({
    queryKey: ['dimensions', companyId, 'departments', serviceId],
    queryFn: () =>
      read(companyId, `/dimension-values/${serviceId}/departments`, serviceDepartmentHistorySchema),
  });
}
