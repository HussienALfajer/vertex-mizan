import { createFileRoute } from '@tanstack/react-router';
import {
  IncomeStatementPage,
  type IncomeStatementSearch,
} from '../../../../features/reports/income-statement-page';
import { dateParam, flagParam, ledgerParam } from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/income-statement')({
  validateSearch: (search: Record<string, unknown>): IncomeStatementSearch => ({
    from: dateParam(search.from),
    to: dateParam(search.to),
    ledger: ledgerParam(search.ledger),
    compare: flagParam(search.compare),
    compareFrom: dateParam(search.compareFrom),
    compareTo: dateParam(search.compareTo),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: IncomeStatementPage,
});
