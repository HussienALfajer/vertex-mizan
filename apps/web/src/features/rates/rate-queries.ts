import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  type CurrencyCode,
  type RateType,
  rateCalendarSchema,
  ratePageSchema,
  ratePairSchema,
} from '@vertex-mizan/contracts';
import { api, listOf } from '../../lib/api';

/** `GET /api/rate-pairs`: every pair with its one orientation. */
export function ratePairsQuery(companyId: string) {
  return queryOptions({
    queryKey: ['rates', companyId, 'pairs'],
    queryFn: () =>
      api('GET', '/rate-pairs', { company: companyId, schema: listOf(ratePairSchema) }),
  });
}

/** `GET /api/rates`: a pair's rows of one type, newest first, in cursor pages. */
export function ratesQuery(
  companyId: string,
  pair: { base: CurrencyCode; quote: CurrencyCode },
  type: RateType,
  range: { from?: string; to?: string } = {},
) {
  return infiniteQueryOptions({
    queryKey: ['rates', companyId, 'rows', pair.base, pair.quote, type, range],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ base: pair.base, quote: pair.quote, type });
      if (range.from) search.set('from', range.from);
      if (range.to) search.set('to', range.to);
      if (pageParam) search.set('cursor', pageParam);
      return api('GET', `/rates?${search}`, { company: companyId, schema: ratePageSchema });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** `GET /api/rate-calendar`: the weekly days off and the holidays. */
export function rateCalendarQuery(companyId: string) {
  return queryOptions({
    queryKey: ['rates', companyId, 'calendar'],
    queryFn: () => api('GET', '/rate-calendar', { company: companyId, schema: rateCalendarSchema }),
  });
}
