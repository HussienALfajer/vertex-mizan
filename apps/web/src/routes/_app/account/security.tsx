import { createFileRoute } from '@tanstack/react-router';
import { AccountSecurityPage } from '../../../features/auth/account-security-page';

export const Route = createFileRoute('/_app/account/security')({
  component: function AccountSecurity() {
    return <AccountSecurityPage email={Route.useRouteContext().me.person.email} />;
  },
});
