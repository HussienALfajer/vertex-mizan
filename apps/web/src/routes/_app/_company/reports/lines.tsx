import { createFileRoute } from '@tanstack/react-router';
import { LinesPage, type LinesSearch } from '../../../../features/reports/lines-page';
import {
  byParam,
  damascusTodayParam,
  dateParam,
  ledgerParam,
  uuidParam,
} from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/lines')({
  validateSearch: (search: Record<string, unknown>): LinesSearch => ({
    ledger: ledgerParam(search.ledger),
    from: dateParam(search.from),
    to: dateParam(search.to) ?? damascusTodayParam(),
    account: uuidParam(search.account),
    statementLine:
      typeof search.statementLine === 'string' && /^[a-z_.]{1,64}$/.test(search.statementLine)
        ? search.statementLine
        : undefined,
    side: search.side === 'debit' || search.side === 'credit' ? search.side : undefined,
    client: uuidParam(search.client),
    contract: uuidParam(search.contract),
    profitabilityBy: byParam(search.profitabilityBy),
    profitabilityValue: uuidParam(search.profitabilityValue),
    openingEntry:
      search.openingEntry === 'true' || search.openingEntry === true ? 'true' : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: LinesPage,
});
