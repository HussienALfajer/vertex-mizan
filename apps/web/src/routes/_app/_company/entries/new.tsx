import { createFileRoute } from '@tanstack/react-router';
import { NewEntryPage } from '../../../../features/entries/entry-editor-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/entries/new')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'drafts.manage'),
  component: NewEntryPage,
});
