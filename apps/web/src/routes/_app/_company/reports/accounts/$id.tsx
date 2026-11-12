import { createFileRoute } from '@tanstack/react-router';
import {
  AccountStatementPage,
  type AccountStatementSearch,
} from '../../../../../features/reports/ledger-pages';
import { dateParam, ledgerParam } from '../../../../../features/reports/report-search';
import { requirePermission } from '../../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/accounts/$id')({
  validateSearch: (search: Record<string, unknown>): AccountStatementSearch => ({
    from: dateParam(search.from),
    to: dateParam(search.to),
    ledger: ledgerParam(search.ledger),
    currency:
      typeof search.currency === 'string' && /^[A-Z]{3}$/.test(search.currency)
        ? search.currency
        : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: AccountStatementPage,
});
