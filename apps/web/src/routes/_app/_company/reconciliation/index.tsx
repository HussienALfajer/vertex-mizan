import { createFileRoute } from '@tanstack/react-router';
import { ReconciliationPage } from '../../../../features/reconciliation/reconciliation-page';
import { clientParam } from '../../../../features/reconciliation/reconciliation-parts';
import { requirePermission } from '../../../../lib/session';

/** `month`: the month shown, the current one in Damascus by default; `client`: one client's days. */
export const Route = createFileRoute('/_app/_company/reconciliation/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { month?: string | undefined; client?: string | undefined } => ({
    month:
      typeof search.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month)
        ? search.month
        : undefined,
    client: clientParam(search.client),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reconciliation.read'),
  component: ReconciliationPage,
});
