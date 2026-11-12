import { createFileRoute } from '@tanstack/react-router';
import { PeriodPage } from '../../../../features/periods/period-page';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/periods/$period')({
  beforeLoad: ({ context }) => requirePermission(context.me, 'periods.read'),
  component: PeriodPage,
});
