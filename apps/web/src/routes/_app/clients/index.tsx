import { createFileRoute } from '@tanstack/react-router';
import { PartiesPage } from '../../../features/movements/parties-page';

/** `/clients` (S13 screen 6). */
export const Route = createFileRoute('/_app/clients/')({
  component: function Parties() {
    const { me, companyId } = Route.useRouteContext();
    return <PartiesPage me={me} companyId={companyId} type="client" />;
  },
});
