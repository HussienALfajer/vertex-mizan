import { queryOptions } from '@tanstack/react-query';
import { invitationSchema, memberSchema } from '@vertex-mizan/contracts';
import { api, listOf } from '../../lib/api';

/** `GET /api/members`: the active members of the company the page works in. */
export function membersQuery(companyId: string) {
  return queryOptions({
    queryKey: ['members', companyId, 'list'],
    queryFn: () => api('GET', '/members', { schema: listOf(memberSchema) }),
  });
}

/** `GET /api/invitations`: its pending invitations. */
export function invitationsQuery(companyId: string) {
  return queryOptions({
    queryKey: ['members', companyId, 'invitations'],
    queryFn: () => api('GET', '/invitations', { schema: listOf(invitationSchema) }),
  });
}
