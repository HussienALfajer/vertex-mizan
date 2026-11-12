import { createFileRoute } from '@tanstack/react-router';
import { ReportsPage } from '../../../../features/reports/reports-page';
import { requirePermission } from '../../../../lib/session';

/** `find=account`: the palette's "كشف حساب…" opens the account picker. */
export const Route = createFileRoute('/_app/_company/reports/')({
  validateSearch: (search: Record<string, unknown>): { find?: 'account' | undefined } => ({
    find: search.find === 'account' ? 'account' : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: ReportsPage,
});
