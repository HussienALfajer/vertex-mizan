import { queryOptions } from '@tanstack/react-query';
import {
  type AgeingQuery,
  ageingReportSchema,
  type ClientFundsQuery,
  type ClientStatementQuery,
  clientFundsSchema,
  clientStatementSchema,
  type OpenItemQuery,
  openItemPageSchema,
  openItemSchema,
} from '@vertex-mizan/contracts';
import { api } from '../../lib/api';

/** A query's set parameters as a search string. */
export function searchOf(params: Readonly<Record<string, string | undefined>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/** `GET /api/receivables/ageing`: the ageing as of a date in one ledger (S04 rule 16). */
export function ageingQuery(companyId: string, query: Partial<AgeingQuery>) {
  return queryOptions({
    queryKey: ['receivables', companyId, 'ageing', query],
    queryFn: () =>
      api('GET', `/receivables/ageing${searchOf(query)}`, {
        company: companyId,
        schema: ageingReportSchema,
      }),
  });
}

/** `GET /api/open-items`: one page of items, as the picker and the finder read them. */
export function openItemsQuery(companyId: string, query: Partial<Omit<OpenItemQuery, 'cursor'>>) {
  return queryOptions({
    queryKey: ['receivables', companyId, 'items', query],
    queryFn: () =>
      api('GET', `/open-items${searchOf(query)}`, {
        company: companyId,
        schema: openItemPageSchema,
      }),
  });
}

/** `GET /api/open-items/:id`: the item with its movements and due dates. */
export function openItemQuery(companyId: string, id: string) {
  return queryOptions({
    queryKey: ['receivables', companyId, 'item', id],
    queryFn: () => api('GET', `/open-items/${id}`, { company: companyId, schema: openItemSchema }),
    retry: false,
  });
}

/** `GET /api/clients/:valueId/statement`: a client's statement (S04 "Reports"). */
export function clientStatementQuery(
  companyId: string,
  valueId: string,
  query: Partial<ClientStatementQuery>,
) {
  return queryOptions({
    queryKey: ['receivables', companyId, 'statement', valueId, query],
    queryFn: () =>
      api('GET', `/clients/${valueId}/statement${searchOf(query)}`, {
        company: companyId,
        schema: clientStatementSchema,
      }),
    retry: false,
  });
}

/** `GET /api/client-funds`: the running items as of a date (S04 rule 17). */
export function clientFundsQuery(companyId: string, query: Partial<ClientFundsQuery>) {
  return queryOptions({
    queryKey: ['receivables', companyId, 'funds', query],
    queryFn: () =>
      api('GET', `/client-funds${searchOf(query)}`, {
        company: companyId,
        schema: clientFundsSchema,
      }),
  });
}
