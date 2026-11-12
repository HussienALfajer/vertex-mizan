import { createFileRoute } from '@tanstack/react-router';
import {
  RevenueSchedulePage,
  type RevenueScheduleSearch,
} from '../../../../features/reports/contracts-pages';
import { ledgerParam, monthParam } from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/revenue-schedule')({
  validateSearch: (search: Record<string, unknown>): RevenueScheduleSearch => ({
    from: monthParam(search.from),
    ledger: ledgerParam(search.ledger),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: RevenueSchedulePage,
});
