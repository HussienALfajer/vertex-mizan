import { queryOptions } from '@tanstack/react-query';
import { apiClientSchema } from '@vertex-mizan/contracts';
import { api, listOf } from '../../lib/api';

/** `GET /api/api-clients`: the clients with their keys (never a secret) and document types. */
export function apiClientsQuery(companyId: string) {
  return queryOptions({
    queryKey: ['apiClients', companyId],
    queryFn: () =>
      api('GET', '/api-clients', { company: companyId, schema: listOf(apiClientSchema) }),
  });
}
