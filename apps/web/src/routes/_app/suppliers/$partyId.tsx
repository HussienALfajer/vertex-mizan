import { createFileRoute } from '@tanstack/react-router';
import { PartyPage } from '../../../features/movements/parties-page';

/** `/suppliers/:partyId` (S13 screen 6). */
export const Route = createFileRoute('/_app/suppliers/$partyId')({
  component: function Party() {
    const { me, companyId } = Route.useRouteContext();
    const { partyId } = Route.useParams();
    return (
      <PartyPage key={partyId} me={me} companyId={companyId} type="supplier" partyId={partyId} />
    );
  },
});
