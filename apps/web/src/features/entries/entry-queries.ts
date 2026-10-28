import { infiniteQueryOptions, queryOptions, useQueries, useQuery } from '@tanstack/react-query';
import {
  accountLinesPageSchema,
  type DimensionValue,
  type DraftQuery,
  dimensionValuePageSchema,
  draftPageSchema,
  draftSchema,
  type EntryQuery,
  entryPageSchema,
  entrySchema,
} from '@vertex-mizan/contracts';
import { api } from '../../lib/api';
import { dimensionTypesQuery } from '../dimensions/dimension-queries';

/** The journal's filters, as `GET /api/entries` takes them. */
export type EntryFilters = Omit<EntryQuery, 'cursor'>;

/** `GET /api/entries`: the journal, newest first, in cursor pages. */
export function entriesQuery(companyId: string, filters: EntryFilters) {
  return infiniteQueryOptions({
    queryKey: ['entries', companyId, 'list', filters],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) search.set(key, String(value));
      }
      if (pageParam) search.set('cursor', pageParam);
      return api('GET', `/entries?${search}`, { company: companyId, schema: entryPageSchema });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** `GET /api/entries/:id`: an entry with its lines, conversions, attachments and links. */
export function entryQuery(companyId: string, id: string) {
  return queryOptions({
    queryKey: ['entries', companyId, 'entry', id],
    queryFn: () => api('GET', `/entries/${id}`, { company: companyId, schema: entrySchema }),
    retry: false,
  });
}

/** `GET /api/accounts/:id/lines`: an account's lines with running balances, oldest first. */
export function accountLinesQuery(
  companyId: string,
  accountId: string,
  filters: { from?: string; to?: string; currency?: string; dims?: readonly string[] },
) {
  return infiniteQueryOptions({
    queryKey: ['entries', companyId, 'account-lines', accountId, filters],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams();
      if (filters.from) search.set('from', filters.from);
      if (filters.to) search.set('to', filters.to);
      if (filters.currency) search.set('currency', filters.currency);
      if (filters.dims && filters.dims.length > 0) search.set('dims', filters.dims.join(','));
      if (pageParam) search.set('cursor', pageParam);
      return api('GET', `/accounts/${accountId}/lines?${search}`, {
        company: companyId,
        schema: accountLinesPageSchema,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
}

/** `GET /api/rates/:id/entries`: the entries whose conversions used a rate row (S02 rule 15). */
export function rateEntriesQuery(companyId: string, rateId: string) {
  return infiniteQueryOptions({
    queryKey: ['entries', companyId, 'rate-entries', rateId],
    queryFn: ({ pageParam }) =>
      api('GET', `/rates/${rateId}/entries${pageParam ? `?cursor=${pageParam}` : ''}`, {
        company: companyId,
        schema: entryPageSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** `GET /api/drafts`: one tab of drafts, the most recently changed first. */
export function draftsQuery(companyId: string, view: DraftQuery['view']) {
  return infiniteQueryOptions({
    queryKey: ['drafts', companyId, 'list', view],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ view });
      if (pageParam) search.set('cursor', pageParam);
      return api('GET', `/drafts?${search}`, { company: companyId, schema: draftPageSchema });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** `GET /api/drafts/:id`: a draft with its lines and attachments. */
export function draftQuery(companyId: string, id: string) {
  return queryOptions({
    queryKey: ['drafts', companyId, 'draft', id],
    queryFn: () => api('GET', `/drafts/${id}`, { company: companyId, schema: draftSchema }),
    retry: false,
  });
}

/** Every value of one dimension type, archived ones included, read page by page. */
function allDimensionValuesQuery(companyId: string, typeId: string) {
  return queryOptions({
    queryKey: ['dimensions', companyId, 'all-values', typeId],
    queryFn: async () => {
      const values: DimensionValue[] = [];
      let cursor: string | null = null;
      do {
        const search = new URLSearchParams({ typeId, includeArchived: 'true' });
        if (cursor) search.set('cursor', cursor);
        const page = await api('GET', `/dimension-values?${search}`, {
          company: companyId,
          schema: dimensionValuePageSchema,
        });
        values.push(...page.values);
        cursor = page.nextCursor;
      } while (cursor);
      return values;
    },
  });
}

/**
 * The company's dimension types with every value of each, for showing the values a line carries
 * and finding one by its code. The API names lines' values by id only.
 */
export function useDimensionCatalog(companyId: string) {
  const types = useQuery(dimensionTypesQuery(companyId));
  const values = useQueries({
    queries: (types.data ?? []).map((type) => allDimensionValuesQuery(companyId, type.id)),
  });
  const byId = new Map<string, DimensionValue>();
  for (const result of values) for (const value of result.data ?? []) byId.set(value.id, value);
  return {
    types: types.data ?? [],
    valuesOf: (typeId: string) =>
      values[(types.data ?? []).findIndex((type) => type.id === typeId)]?.data ?? [],
    byId,
    isPending: types.isPending || values.some((result) => result.isPending),
    error: types.error ?? values.find((result) => result.error)?.error ?? null,
  };
}
