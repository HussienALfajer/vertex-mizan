import { createFileRoute } from '@tanstack/react-router';
import { RateCalendarPage } from '../../../../features/rates/rate-calendar-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/rates/calendar')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'rates.read'),
  component: RateCalendarPage,
});
