import { createFileRoute } from '@tanstack/react-router';
import {
  GeneralLedgerPage,
  type GeneralLedgerSearch,
} from '../../../../features/reports/ledger-pages';
import { codeParam, dateParam, ledgerParam } from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/general-ledger')({
  validateSearch: (search: Record<string, unknown>): GeneralLedgerSearch => ({
    from: dateParam(search.from),
    to: dateParam(search.to),
    ledger: ledgerParam(search.ledger),
    codeFrom: codeParam(search.codeFrom),
    codeTo: codeParam(search.codeTo),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: GeneralLedgerPage,
});
