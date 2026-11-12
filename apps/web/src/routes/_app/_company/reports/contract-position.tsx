import { createFileRoute } from '@tanstack/react-router';
import {
  ContractPositionPage,
  type ContractPositionSearch,
} from '../../../../features/reports/contracts-pages';
import { dateParam, ledgerParam } from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/contract-position')({
  validateSearch: (search: Record<string, unknown>): ContractPositionSearch => ({
    asOf: dateParam(search.asOf),
    ledger: ledgerParam(search.ledger),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: ContractPositionPage,
});
