import { createFileRoute } from '@tanstack/react-router';
import { HOLD_REASONS, type HoldReason } from '@vertex-mizan/contracts';
import { INBOX_VIEWS, InboxPage, type InboxView } from '../../../../features/inbox/inbox-page';
import { requirePermission } from '../../../../lib/session';

/**
 * `view`: the tab; `document`: one Hub document's events; `find=document`, from the palette's
 * "حدث…", opens the finder that asks for the document's number; `reason` opens the held events
 * filtered by a hold reason (the recognition decisions, from `/revenue`); `from` and `to` filter the
 * accounting dates (a month's held events, from `/periods/:period`).
 */
export const Route = createFileRoute('/_app/_company/inbox/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    view?: InboxView | undefined;
    document?: string | undefined;
    find?: 'document' | undefined;
    reason?: HoldReason | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } => ({
    view: INBOX_VIEWS.includes(search.view as InboxView) ? (search.view as InboxView) : undefined,
    document:
      typeof search.document === 'string' && search.document.trim() !== ''
        ? search.document.trim().slice(0, 100)
        : undefined,
    find: search.find === 'document' ? 'document' : undefined,
    reason: HOLD_REASONS.includes(search.reason as HoldReason)
      ? (search.reason as HoldReason)
      : undefined,
    from: isDay(search.from) ? search.from : undefined,
    to: isDay(search.to) ? search.to : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'events.read'),
  component: InboxPage,
});

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
