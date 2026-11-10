import { queryOptions } from '@tanstack/react-query';
import { postingRuleSchema } from '@vertex-mizan/contracts';
import { api, listOf } from '../../lib/api';

/** `GET /api/posting-rules`: every slot, a payment method's once per Hub currency. */
export function postingRulesQuery(companyId: string) {
  return queryOptions({
    queryKey: ['postingRules', companyId],
    queryFn: () =>
      api('GET', '/posting-rules', { company: companyId, schema: listOf(postingRuleSchema) }),
  });
}
