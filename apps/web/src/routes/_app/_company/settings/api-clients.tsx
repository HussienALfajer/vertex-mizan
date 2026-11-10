import { createFileRoute } from '@tanstack/react-router';
import { ApiClientsPage } from '../../../../features/api-clients/api-clients-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/settings/api-clients')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'api_clients.read'),
  component: ApiClientsPage,
});
