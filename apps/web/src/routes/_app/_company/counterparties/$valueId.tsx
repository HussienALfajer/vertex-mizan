import { createFileRoute } from '@tanstack/react-router';
import { CounterpartyStatementPage } from '../../../../features/receivables/counterparty-statement-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/counterparties/$valueId')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'open_items.read'),
  component: CounterpartyStatementPage,
});
