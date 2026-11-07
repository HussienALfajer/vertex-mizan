import { createFileRoute } from '@tanstack/react-router';
import { ReceivablesPage } from '../../../../features/receivables/receivables-page';
import { requirePermission } from '../../../../lib/session';

/** `find`: the palette's "client statement…" (`client`) or "go to item…" (`item`) finder. */
export const Route = createFileRoute('/_app/_company/receivables/')({
  validateSearch: (search: Record<string, unknown>): { find?: 'client' | 'item' | undefined } => ({
    find: search.find === 'client' || search.find === 'item' ? search.find : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'open_items.read'),
  component: ReceivablesPage,
});
