import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import {
  type InboxPreviewQuery,
  inboxActionPreviewSchema,
  type RevenueScheduleQuery,
  revenueMonthSchema,
  revenuePreviewSchema,
  revenueScheduleDetailSchema,
  revenueSchedulePageSchema,
} from '@vertex-mizan/contracts';
import { api, listOf } from '../../lib/api';
import { searchOf } from '../receivables/receivables-queries';

/** `GET /api/revenue/schedules`: the schedules by state, client, contract and month, a page each. */
export function revenueSchedulesQuery(
  companyId: string,
  query: Omit<RevenueScheduleQuery, 'cursor'>,
) {
  return infiniteQueryOptions({
    queryKey: ['revenue', companyId, 'schedules', query],
    queryFn: ({ pageParam }) =>
      api('GET', `/revenue/schedules${searchOf({ ...query, cursor: pageParam })}`, {
        company: companyId,
        schema: revenueSchedulePageSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** `GET /api/revenue/schedules/:id`: the schedule, its movements with entries and its months. */
export function revenueScheduleQuery(companyId: string, id: string) {
  return queryOptions({
    queryKey: ['revenue', companyId, 'schedule', id],
    queryFn: () =>
      api('GET', `/revenue/schedules/${id}`, {
        company: companyId,
        schema: revenueScheduleDetailSchema,
      }),
    retry: false,
  });
}

/** `GET /api/revenue/months`: each month's releases, what is missing and the decisions held. */
export function revenueMonthsQuery(companyId: string, range: { from: string; to: string }) {
  return queryOptions({
    queryKey: ['revenue', companyId, 'months', range],
    queryFn: () =>
      api('GET', `/revenue/months${searchOf(range)}`, {
        company: companyId,
        schema: listOf(revenueMonthSchema),
      }),
  });
}

/** `GET /api/revenue/preview`: the releases the job would post for a month. */
export function revenuePreviewQuery(companyId: string, month: string) {
  return queryOptions({
    queryKey: ['revenue', companyId, 'preview', month],
    queryFn: () =>
      api('GET', `/revenue/preview${searchOf({ month })}`, {
        company: companyId,
        schema: revenuePreviewSchema,
      }),
  });
}

/**
 * `GET /api/inbox/:id/preview`: what an action of S06 rule 16 would post, attempted and rolled
 * back. Under `inbox`, so an action taken on the event drops it with the event's other reads.
 */
export function inboxActionPreviewQuery(companyId: string, id: string, query: InboxPreviewQuery) {
  return queryOptions({
    queryKey: ['inbox', companyId, 'preview', id, query],
    queryFn: () =>
      api('GET', `/inbox/${id}/preview${searchOf(query)}`, {
        company: companyId,
        schema: inboxActionPreviewSchema,
      }),
    retry: false,
    placeholderData: keepPreviousData,
  });
}
