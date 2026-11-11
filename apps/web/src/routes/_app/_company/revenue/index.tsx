import { createFileRoute } from '@tanstack/react-router';
import {
  REVENUE_VIEWS,
  RevenuePage,
  type RevenueView,
} from '../../../../features/revenue/revenue-page';
import { requirePermission } from '../../../../lib/session';

/** `view`: the tab, the schedules (the default) or the months. */
export const Route = createFileRoute('/_app/_company/revenue/')({
  validateSearch: (search: Record<string, unknown>): { view?: RevenueView | undefined } => ({
    view: REVENUE_VIEWS.includes(search.view as RevenueView)
      ? (search.view as RevenueView)
      : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'recognition.read'),
  component: RevenuePage,
});
