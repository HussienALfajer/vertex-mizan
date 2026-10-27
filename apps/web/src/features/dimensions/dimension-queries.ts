import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { dimensionTypeSchema, dimensionValuePageSchema } from '@vertex-mizan/contracts';
import { api, listOf } from '../../lib/api';

/** `GET /api/dimension-types`: every type, archived ones included, by position. */
export function dimensionTypesQuery(companyId: string) {
  return queryOptions({
    queryKey: ['dimensions', companyId, 'types'],
    queryFn: () =>
      api('GET', '/dimension-types', { company: companyId, schema: listOf(dimensionTypeSchema) }),
  });
}

/** `GET /api/dimension-values`: one type's values in cursor pages, searched by code or name. */
export function dimensionValuesQuery(
  companyId: string,
  typeId: string,
  { q = '', includeArchived = false }: { q?: string; includeArchived?: boolean } = {},
) {
  return infiniteQueryOptions({
    queryKey: ['dimensions', companyId, 'values', typeId, q, includeArchived],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ typeId });
      if (q !== '') search.set('q', q);
      if (includeArchived) search.set('includeArchived', 'true');
      if (pageParam) search.set('cursor', pageParam);
      return api('GET', `/dimension-values?${search}`, {
        company: companyId,
        schema: dimensionValuePageSchema,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
