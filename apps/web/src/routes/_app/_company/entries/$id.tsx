import { createFileRoute } from '@tanstack/react-router';
import { EntryPage } from '../../../../features/entries/entry-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/entries/$id')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'entries.read'),
  component: EntryPage,
});
