import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  type InboxQuery,
  inboxCountsSchema,
  inboxEventDetailSchema,
  inboxPageSchema,
} from '@vertex-mizan/contracts';
import { api } from '../../lib/api';
import { searchOf } from '../receivables/receivables-queries';

/** `GET /api/inbox/counts`: the held events in all and per reason (the sidebar's count). */
export function inboxCountsQuery(companyId: string) {
  return queryOptions({
    queryKey: ['inbox', companyId, 'counts'],
    queryFn: () => api('GET', '/inbox/counts', { company: companyId, schema: inboxCountsSchema }),
    refetchInterval: 60_000,
  });
}

/** `GET /api/inbox`: the events by filters, newest received first, 50 a page. */
export function inboxListQuery(companyId: string, query: Omit<InboxQuery, 'cursor'>) {
  return infiniteQueryOptions({
    queryKey: ['inbox', companyId, 'list', query],
    queryFn: ({ pageParam }) =>
      api('GET', `/inbox${searchOf({ ...query, cursor: pageParam })}`, {
        company: companyId,
        schema: inboxPageSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** `GET /api/inbox/:id`: the event, its payload as received and its history. */
export function inboxEventQuery(companyId: string, id: string) {
  return queryOptions({
    queryKey: ['inbox', companyId, 'event', id],
    queryFn: () =>
      api('GET', `/inbox/${id}`, { company: companyId, schema: inboxEventDetailSchema }),
    retry: false,
  });
}
