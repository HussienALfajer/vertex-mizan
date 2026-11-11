import { createFileRoute } from '@tanstack/react-router';
import { SchedulePage } from '../../../../features/revenue/schedule-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/revenue/$id')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'recognition.read'),
  component: SchedulePage,
});
