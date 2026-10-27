import { createFileRoute } from '@tanstack/react-router';
import { TwoFactorPage } from '../../../features/auth/two-factor-page';
import { type ReturnTo, returnTo } from '../../../lib/session';

export const Route = createFileRoute('/_auth/sign-in/two-factor')({
  validateSearch: (search): ReturnTo => returnTo(search),
  component: function TwoFactor() {
    return <TwoFactorPage redirect={Route.useSearch().redirect} />;
  },
});
