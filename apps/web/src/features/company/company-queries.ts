import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { companySchema, meSchema } from '@vertex-mizan/contracts';
import { api } from '../../lib/api';
import { meQuery } from '../../lib/session';

/** `GET /api/company`: the active company, keyed by the company the page works in. */
export function companyQuery(companyId: string) {
  return queryOptions({
    queryKey: ['company', companyId],
    // Named, so a switch in another tab refuses the read instead of answering for the other company.
    queryFn: () => api('GET', '/company', { company: companyId, schema: companySchema }),
  });
}

/**
 * Makes a company the session's active one (S01 rule 20) and opens its first page. Every query of
 * the previous company is dropped first, so no page shows one company's data under another's name.
 */
export function useSwitchCompany() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (companyId: string) =>
      api('POST', '/session/company', { body: { companyId }, schema: meSchema }),
    onSuccess: async (me) => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
      queryClient.setQueryData(meQuery.queryKey, me);
      await router.invalidate();
      await router.navigate({ to: '/' });
    },
  });
}
