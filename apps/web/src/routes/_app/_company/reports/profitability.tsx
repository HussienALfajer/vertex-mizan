import { createFileRoute } from '@tanstack/react-router';
import {
  ProfitabilityPage,
  type ProfitabilitySearch,
} from '../../../../features/reports/profitability-page';
import {
  byParam,
  dateParam,
  flagParam,
  ledgerParam,
} from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/profitability')({
  validateSearch: (search: Record<string, unknown>): ProfitabilitySearch => ({
    by: byParam(search.by),
    from: dateParam(search.from),
    to: dateParam(search.to),
    ledger: ledgerParam(search.ledger),
    compare: flagParam(search.compare),
    compareFrom: dateParam(search.compareFrom),
    compareTo: dateParam(search.compareTo),
    sort: search.sort === 'margin' || search.sort === 'contribution' ? search.sort : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: ProfitabilityPage,
});
