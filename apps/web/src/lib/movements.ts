import { infiniteQueryOptions, type QueryClient, queryOptions } from '@tanstack/react-query';
import {
  type CurrencyAmount,
  type CurrencyCode,
  dashboardSchema,
  dayRatesSchema,
  type MaterialPage,
  materialCostsSchema,
  materialPageSchema,
  movementPageSchema,
  type PartyType,
  type ProjectMovementKind,
  type ProjectState,
  partySchema,
  projectSchema,
} from '@vertex-mizan/contracts';
import { api, listOf } from './api';

/**
 * S13's reads (ADR 0024): the dashboard, the projects, the movements, the parties, the materials
 * and their costs, and the day's rates. Every key starts with `movements` and the company, so a
 * recorded or cancelled movement refreshes them all at once (`refreshBooks`).
 */
/** The currencies the company keeps (S13 "Currencies"): totals in USD, a box in each. */
export const MOVEMENT_CURRENCIES = ['USD', 'SYP', 'TRY'] as const satisfies readonly CurrencyCode[];

const key = (companyId: string, ...rest: unknown[]) => ['movements', companyId, ...rest];

/** Query text without the filters left empty. */
function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(name, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export function dashboardQuery(companyId: string) {
  return queryOptions({
    queryKey: key(companyId, 'dashboard'),
    queryFn: () => api('GET', '/dashboard', { company: companyId, schema: dashboardSchema }),
  });
}

export function projectsQuery(
  companyId: string,
  filters: { state?: ProjectState | undefined; search?: string | undefined } = {},
) {
  return queryOptions({
    queryKey: key(companyId, 'projects', filters),
    queryFn: () =>
      api('GET', `/project-books${query(filters)}`, {
        company: companyId,
        schema: listOf(projectSchema),
      }),
  });
}

export function projectQuery(companyId: string, projectId: string) {
  return queryOptions({
    queryKey: key(companyId, 'project', projectId),
    queryFn: () =>
      api('GET', `/project-books/${projectId}`, { company: companyId, schema: projectSchema }),
  });
}

export interface MovementFilters {
  project?: string | undefined;
  kind?: ProjectMovementKind | undefined;
  currency?: CurrencyCode | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export function movementsQuery(companyId: string, filters: MovementFilters) {
  return infiniteQueryOptions({
    queryKey: key(companyId, 'list', filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api('GET', `/movements${query({ ...filters, cursor: pageParam })}`, {
        company: companyId,
        schema: movementPageSchema,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function materialCostsQuery(companyId: string, project?: string) {
  return queryOptions({
    queryKey: key(companyId, 'material-costs', project ?? null),
    queryFn: () =>
      api('GET', `/material-costs${query({ project })}`, {
        company: companyId,
        schema: materialCostsSchema,
      }),
  });
}

export function partiesQuery(companyId: string, type: PartyType) {
  return queryOptions({
    queryKey: key(companyId, 'parties', type),
    queryFn: () =>
      api('GET', `/parties?type=${type}`, { company: companyId, schema: listOf(partySchema) }),
  });
}

/** The catalogue's materials, every page (tens of materials, S13 "Volume"). */
export function materialsQuery(companyId: string) {
  return queryOptions({
    queryKey: key(companyId, 'materials'),
    queryFn: async () => {
      const all = [];
      let cursor: string | null = null;
      do {
        const page: MaterialPage = await api(
          'GET',
          `/materials${query({ cursor: cursor ?? undefined })}`,
          {
            company: companyId,
            schema: materialPageSchema,
          },
        );
        all.push(...page.materials);
        cursor = page.nextCursor;
      } while (cursor !== null);
      return all;
    },
    staleTime: 60_000,
  });
}

/** A day's rates: today in Damascus by default, or the day a movement is dated. */
export function dayRatesQuery(companyId: string, date?: string) {
  return queryOptions({
    queryKey: key(companyId, 'day-rates', date ?? null),
    queryFn: () =>
      api('GET', `/day-rates${query({ date })}`, { company: companyId, schema: dayRatesSchema }),
  });
}

/** After a movement, a cancellation, a project or a rate: every S13 figure is read again. */
export function refreshBooks(queryClient: QueryClient, companyId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['movements', companyId] });
}

/** The amount in one currency of a list by currency, or none. */
export function inCurrency(
  amounts: readonly CurrencyAmount[],
  currency: CurrencyCode,
): CurrencyAmount | undefined {
  return amounts.find((amount) => amount.currency === currency && amount.amountMinor !== '0');
}
