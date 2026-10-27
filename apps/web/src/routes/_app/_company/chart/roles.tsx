import { createFileRoute } from '@tanstack/react-router';
import { AccountRolesPage } from '../../../../features/chart/account-roles-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/chart/roles')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'accounts.read'),
  component: AccountRolesPage,
});
