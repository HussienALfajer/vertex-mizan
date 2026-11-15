import { createFileRoute } from '@tanstack/react-router';
import { CashPositionPage } from '../../../../features/cash/cash-position-page';
import { requirePermission } from '../../../../lib/session';

/** `asOf`: the position's date; `find=statement`, from the palette, opens the statement finder. */
export const Route = createFileRoute('/_app/_company/cash/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { asOf?: string | undefined; find?: 'statement' | undefined } => ({
    asOf:
      typeof search.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.asOf)
        ? search.asOf
        : undefined,
    find: search.find === 'statement' ? 'statement' : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: CashPositionPage,
});
