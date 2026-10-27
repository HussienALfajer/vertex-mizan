import { createFileRoute } from '@tanstack/react-router';
import { ChartPage } from '../../../../features/chart/chart-page';
import { requirePermission } from '../../../../lib/session';

/** `new`: the command palette's "new account" opens the account sheet. */
export const Route = createFileRoute('/_app/_company/chart/')({
  validateSearch: (search: Record<string, unknown>): { new?: boolean | undefined } => ({
    new: search.new === true || search.new === 'true' ? true : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'accounts.read'),
  component: ChartPage,
});
