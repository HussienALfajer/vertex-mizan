import { createFileRoute } from '@tanstack/react-router';
import { MaterialsPage } from '../../features/movements/materials-page';

/** `/materials` (S13 screen 7). */
export const Route = createFileRoute('/_app/materials')({
  component: function Materials() {
    const { me, companyId } = Route.useRouteContext();
    return <MaterialsPage me={me} companyId={companyId} />;
  },
});
