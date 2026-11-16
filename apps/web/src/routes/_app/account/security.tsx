import { createFileRoute } from '@tanstack/react-router';
import { AccountSecurityPage } from '../../../features/auth/account-security-page';

export const Route = createFileRoute('/_app/account/security')({
  component: function AccountSecurity() {
    const { person } = Route.useRouteContext().me;
    return <AccountSecurityPage email={person.email} enrolled={person.twoFactorEnabled} />;
  },
});
