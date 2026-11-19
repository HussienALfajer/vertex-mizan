import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '../../features/settings/settings-page';

export const Route = createFileRoute('/_app/settings')({
  component: function Settings() {
    const { me, companyId } = Route.useRouteContext();
    return <SettingsPage me={me} companyId={companyId} />;
  },
});
