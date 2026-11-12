import { createFileRoute } from '@tanstack/react-router';
import {
  BalanceSheetPage,
  type BalanceSheetSearch,
} from '../../../../features/reports/balance-sheet-page';
import { dateParam, flagParam, ledgerParam } from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/balance-sheet')({
  validateSearch: (search: Record<string, unknown>): BalanceSheetSearch => ({
    asOf: dateParam(search.asOf),
    ledger: ledgerParam(search.ledger),
    compare: flagParam(search.compare),
    compareAsOf: dateParam(search.compareAsOf),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: BalanceSheetPage,
});
