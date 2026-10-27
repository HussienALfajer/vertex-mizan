import { createFileRoute } from '@tanstack/react-router';
import { SignInPage } from '../../../features/auth/sign-in-page';
import { type ReturnTo, returnTo } from '../../../lib/session';

export const Route = createFileRoute('/_auth/sign-in/')({
  validateSearch: (search): ReturnTo => returnTo(search),
  component: function SignIn() {
    return <SignInPage redirect={Route.useSearch().redirect} />;
  },
});
