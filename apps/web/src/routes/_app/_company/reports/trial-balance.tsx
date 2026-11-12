import { createFileRoute } from '@tanstack/react-router';
import {
  codeParam,
  dateParam,
  flagParam,
  ledgerParam,
  levelParam,
} from '../../../../features/reports/report-search';
import {
  TrialBalancePage,
  type TrialBalanceSearch,
} from '../../../../features/reports/trial-balance-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/trial-balance')({
  validateSearch: (search: Record<string, unknown>): TrialBalanceSearch => ({
    from: dateParam(search.from),
    to: dateParam(search.to),
    ledger: ledgerParam(search.ledger),
    level: levelParam(search.level),
    codeFrom: codeParam(search.codeFrom),
    codeTo: codeParam(search.codeTo),
    nonZero: flagParam(search.nonZero),
    compare: flagParam(search.compare),
    compareFrom: dateParam(search.compareFrom),
    compareTo: dateParam(search.compareTo),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: TrialBalancePage,
});
