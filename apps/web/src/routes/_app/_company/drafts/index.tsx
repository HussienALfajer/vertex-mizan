import { createFileRoute } from '@tanstack/react-router';
import { DRAFT_VIEWS } from '@vertex-mizan/contracts';
import { DraftsPage } from '../../../../features/entries/drafts-page';
import { requirePermission } from '../../../../lib/session';

type View = (typeof DRAFT_VIEWS)[number];

/** `view`: the tab, `awaiting` from the palette's "drafts awaiting approval". */
export const Route = createFileRoute('/_app/_company/drafts/')({
  validateSearch: (search: Record<string, unknown>): { view?: View | undefined } => ({
    view: DRAFT_VIEWS.includes(search.view as View) ? (search.view as View) : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'drafts.read'),
  component: DraftsPage,
});
