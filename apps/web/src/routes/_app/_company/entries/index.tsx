import { createFileRoute } from '@tanstack/react-router';
import { JournalPage } from '../../../../features/entries/journal-page';
import { requirePermission } from '../../../../lib/session';

/** `find=number`: the command palette's "go to entry number…" focuses the number filter. */
export const Route = createFileRoute('/_app/_company/entries/')({
  validateSearch: (search: Record<string, unknown>): { find?: 'number' | undefined } => ({
    find: search.find === 'number' ? 'number' : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'entries.read'),
  component: JournalPage,
});
