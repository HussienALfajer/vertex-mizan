import { createFileRoute } from '@tanstack/react-router';
import { NewEntryPage } from '../../../../features/entries/entry-editor-page';
import { requirePermission } from '../../../../lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `client`: a new receipt from a client statement, its open items ready to pick (S04). */
export const Route = createFileRoute('/_app/_company/entries/new')({
  validateSearch: (search: Record<string, unknown>): { client?: string | undefined } => ({
    client:
      typeof search.client === 'string' && UUID.test(search.client) ? search.client : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'drafts.manage'),
  component: NewEntryPage,
});
