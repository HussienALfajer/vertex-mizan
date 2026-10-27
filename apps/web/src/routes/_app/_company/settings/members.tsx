import { createFileRoute } from '@tanstack/react-router';
import { MembersPage } from '../../../../features/members/members-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/settings/members')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'members.read'),
  component: MembersPage,
});
