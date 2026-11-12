import { createFileRoute } from '@tanstack/react-router';
import { uuidParam } from '../../../../features/reports/report-search';
import {
  REVENUE_VIEWS,
  RevenuePage,
  type RevenueView,
} from '../../../../features/revenue/revenue-page';
import { requirePermission } from '../../../../lib/session';

/** `view`: the tab, the schedules (the default) or the months; `contract`: the schedules' filter. */
export const Route = createFileRoute('/_app/_company/revenue/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: RevenueView | undefined; contract?: string | undefined } => ({
    view: REVENUE_VIEWS.includes(search.view as RevenueView)
      ? (search.view as RevenueView)
      : undefined,
    contract: uuidParam(search.contract),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'recognition.read'),
  component: RevenuePage,
});
