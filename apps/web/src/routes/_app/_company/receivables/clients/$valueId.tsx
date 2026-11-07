import { createFileRoute } from '@tanstack/react-router';
import { ClientStatementPage } from '../../../../../features/receivables/client-statement-page';
import { requirePermission } from '../../../../../lib/session';

export const Route = createFileRoute('/_app/_company/receivables/clients/$valueId')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'open_items.read'),
  component: ClientStatementPage,
});
