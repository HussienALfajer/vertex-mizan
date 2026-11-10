import { createFileRoute } from '@tanstack/react-router';
import { EventPage } from '../../../../features/inbox/event-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/inbox/$id')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'events.read'),
  component: EventPage,
});
