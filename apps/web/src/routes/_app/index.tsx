import { createFileRoute } from '@tanstack/react-router';
import { DashboardPage } from '../../features/movements/dashboard-page';

/** `/` (S13 screen 2): the dashboard. */
export const Route = createFileRoute('/_app/')({
  component: function Dashboard() {
    const { me, companyId } = Route.useRouteContext();
    return <DashboardPage me={me} companyId={companyId} />;
  },
});
