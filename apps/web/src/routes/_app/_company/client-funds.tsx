import { createFileRoute } from '@tanstack/react-router';
import { ClientFundsPage } from '../../../features/receivables/client-funds-page';
import { requirePermission } from '../../../lib/session';

export const Route = createFileRoute('/_app/_company/client-funds')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'open_items.read'),
  component: ClientFundsPage,
});
