import { queryOptions } from '@tanstack/react-query';
import {
  type Ledger,
  periodDetailSchema,
  periodSummarySchema,
  revaluationPreviewSchema,
} from '@vertex-mizan/contracts';
import { api, listOf } from '../../lib/api';

/** `GET /api/periods`: the first period to the current month (S07 "API"). */
export function periodsQuery(companyId: string) {
  return queryOptions({
    queryKey: ['periods', companyId, 'list'],
    queryFn: () =>
      api('GET', '/periods', { company: companyId, schema: listOf(periodSummarySchema) }),
  });
}

/** `GET /api/periods/:period`: the month's state, history and checklist. */
export function periodQuery(companyId: string, period: string) {
  return queryOptions({
    queryKey: ['periods', companyId, 'period', period],
    queryFn: () =>
      api('GET', `/periods/${period}`, { company: companyId, schema: periodDetailSchema }),
    retry: false,
  });
}

/**
 * `GET /api/revaluation/:period?ledger=`: one ledger's preview. Under `periods`, so a close, a
 * reopen or a posting drops it with the month's other reads.
 */
export function revaluationQuery(companyId: string, period: string, ledger: Ledger) {
  return queryOptions({
    queryKey: ['periods', companyId, 'revaluation', period, ledger],
    queryFn: () =>
      api('GET', `/revaluation/${period}?ledger=${ledger}`, {
        company: companyId,
        schema: revaluationPreviewSchema,
      }),
    retry: false,
  });
}
