import { queryOptions } from '@tanstack/react-query';
import { openingViewSchema } from '@vertex-mizan/contracts';
import { api } from '../../lib/api';

/**
 * `GET /api/opening` (S10 rule 20): the opening's state, Hub's snapshot, the records' lines and
 * figures, the agreement, the preview, the checks and the fingerprint. A refusal (`NO_BOOKS_START`)
 * is the page's state, so it is not retried.
 */
export function openingQuery(companyId: string) {
  return queryOptions({
    queryKey: ['opening', companyId],
    queryFn: () => api('GET', '/opening', { company: companyId, schema: openingViewSchema }),
    retry: false,
  });
}
