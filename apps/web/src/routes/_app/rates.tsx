import { createFileRoute } from '@tanstack/react-router';
import { RatesPage } from '../../features/movements/rates-page';

/** `/rates` (S13 screen 8). */
export const Route = createFileRoute('/_app/rates')({
  component: function Rates() {
    const { me, companyId } = Route.useRouteContext();
    return <RatesPage me={me} companyId={companyId} />;
  },
});
