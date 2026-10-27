import { queryOptions } from '@tanstack/react-query';
import {
  accountRoleAssignmentSchema,
  accountSchema,
  chartTemplateSummarySchema,
} from '@vertex-mizan/contracts';
import { api, listOf } from '../../lib/api';

/** `GET /api/accounts`: the whole tree, archived accounts on request (the chart page always asks). */
export function accountsQuery(companyId: string, includeArchived = false) {
  return queryOptions({
    queryKey: ['chart', companyId, 'accounts', includeArchived],
    queryFn: () =>
      api('GET', `/accounts${includeArchived ? '?includeArchived=true' : ''}`, {
        company: companyId,
        schema: listOf(accountSchema),
      }),
  });
}

/** `GET /api/chart/templates`: the templates a chart of the five roots alone can take. */
export function templatesQuery(companyId: string) {
  return queryOptions({
    queryKey: ['chart', companyId, 'templates'],
    queryFn: () =>
      api('GET', '/chart/templates', {
        company: companyId,
        schema: listOf(chartTemplateSummarySchema),
      }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** `GET /api/account-roles`: the six roles, each with its account or null. */
export function accountRolesQuery(companyId: string) {
  return queryOptions({
    queryKey: ['chart', companyId, 'roles'],
    queryFn: () =>
      api('GET', '/account-roles', {
        company: companyId,
        schema: listOf(accountRoleAssignmentSchema),
      }),
  });
}
