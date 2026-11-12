import { createFileRoute } from '@tanstack/react-router';
import { ReconciliationDayPage } from '../../../../features/reconciliation/day-page';
import { clientParam } from '../../../../features/reconciliation/reconciliation-parts';
import { requirePermission } from '../../../../lib/session';

/** `client`: one client's day; every client's by default. */
export const Route = createFileRoute('/_app/_company/reconciliation/$date')({
  validateSearch: (search: Record<string, unknown>): { client?: string | undefined } => ({
    client: clientParam(search.client),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reconciliation.read'),
  component: ReconciliationDayPage,
});
