import { queryOptions } from '@tanstack/react-query';
import {
  reconciliationCountsSchema,
  reconciliationDaySchema,
  reconciliationMonthSchema,
} from '@vertex-mizan/contracts';
import { api } from '../../lib/api';
import { searchOf } from '../receivables/receivables-queries';

/** `GET /api/reconciliation/counts`: the ended days not clean in open months (the sidebar). */
export function reconciliationCountsQuery(companyId: string) {
  return queryOptions({
    queryKey: ['reconciliation', companyId, 'counts'],
    queryFn: () =>
      api('GET', '/reconciliation/counts', {
        company: companyId,
        schema: reconciliationCountsSchema,
      }),
    refetchInterval: 60_000,
  });
}

/** `GET /api/reconciliation/days?month=&client=`: the month's days with their states. */
export function reconciliationMonthQuery(
  companyId: string,
  month: string,
  client: string | undefined,
) {
  return queryOptions({
    queryKey: ['reconciliation', companyId, 'month', month, client ?? null],
    queryFn: () =>
      api('GET', `/reconciliation/days${searchOf({ month, client })}`, {
        company: companyId,
        schema: reconciliationMonthSchema,
      }),
  });
}

/** `GET /api/reconciliation/days/:date?client=`: the day in full, per client. */
export function reconciliationDayQuery(
  companyId: string,
  date: string,
  client: string | undefined,
) {
  return queryOptions({
    queryKey: ['reconciliation', companyId, 'day', date, client ?? null],
    queryFn: () =>
      api('GET', `/reconciliation/days/${date}${searchOf({ client })}`, {
        company: companyId,
        schema: reconciliationDaySchema,
      }),
    retry: false,
  });
}
