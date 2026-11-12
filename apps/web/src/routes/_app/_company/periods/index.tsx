import { createFileRoute } from '@tanstack/react-router';
import { PeriodsPage } from '../../../../features/periods/periods-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/periods/')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'periods.read'),
  component: PeriodsPage,
});
