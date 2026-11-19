import { createFileRoute } from '@tanstack/react-router';
import { PartiesPage } from '../../../features/movements/parties-page';

/** `/suppliers` (S13 screen 6). */
export const Route = createFileRoute('/_app/suppliers/')({
  component: function Parties() {
    const { me, companyId } = Route.useRouteContext();
    return <PartiesPage me={me} companyId={companyId} type="supplier" />;
  },
});
