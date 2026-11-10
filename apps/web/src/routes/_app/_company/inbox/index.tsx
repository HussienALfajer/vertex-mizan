import { createFileRoute } from '@tanstack/react-router';
import { INBOX_VIEWS, InboxPage, type InboxView } from '../../../../features/inbox/inbox-page';
import { requirePermission } from '../../../../lib/session';

/**
 * `view`: the tab; `document`: one Hub document's events; `find=document`, from the palette's
 * "حدث…", opens the finder that asks for the document's number.
 */
export const Route = createFileRoute('/_app/_company/inbox/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    view?: InboxView | undefined;
    document?: string | undefined;
    find?: 'document' | undefined;
  } => ({
    view: INBOX_VIEWS.includes(search.view as InboxView) ? (search.view as InboxView) : undefined,
    document:
      typeof search.document === 'string' && search.document.trim() !== ''
        ? search.document.trim().slice(0, 100)
        : undefined,
    find: search.find === 'document' ? 'document' : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'events.read'),
  component: InboxPage,
});
