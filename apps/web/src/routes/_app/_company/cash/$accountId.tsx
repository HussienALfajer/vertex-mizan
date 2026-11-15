import { createFileRoute } from '@tanstack/react-router';
import { CashStatementPage } from '../../../../features/cash/cash-statement-page';
import { requirePermission } from '../../../../lib/session';

const day = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

/** The statement's range and ledger columns in the address (S11 rule 17). */
export const Route = createFileRoute('/_app/_company/cash/$accountId')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { from?: string | undefined; to?: string | undefined; ledgers?: string | undefined } => ({
    from: day(search.from),
    to: day(search.to),
    ledgers:
      typeof search.ledgers === 'string' &&
      /^(book|parallel)(,(book|parallel))?$/.test(search.ledgers)
        ? search.ledgers
        : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: CashStatementPage,
});
