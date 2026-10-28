import { createFileRoute } from '@tanstack/react-router';
import { DraftEditorPage } from '../../../../features/entries/entry-editor-page';
import { requirePermission } from '../../../../lib/session';

/** `open=preview`: a new draft saved for its preview opens with the preview asked. */
export const Route = createFileRoute('/_app/_company/drafts/$id')({
  validateSearch: (search: Record<string, unknown>): { open?: 'preview' | undefined } => ({
    open: search.open === 'preview' ? 'preview' : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'drafts.read'),
  component: DraftEditorPage,
});
