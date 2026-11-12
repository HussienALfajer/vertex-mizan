import { createFileRoute } from '@tanstack/react-router';
import type { Ledger } from '@vertex-mizan/contracts';
import { RevaluationPage } from '../../../features/periods/revaluation-page';
import { requirePermission } from '../../../lib/session';

/** `period`: the month, the last ended month by default; `ledger`: the book ledger by default. */
export const Route = createFileRoute('/_app/_company/revaluation')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { period?: string | undefined; ledger?: Ledger | undefined } => ({
    period:
      typeof search.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.period)
        ? search.period
        : undefined,
    ledger: search.ledger === 'parallel' ? 'parallel' : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'periods.read'),
  component: RevaluationPage,
});
