import { createFileRoute, redirect } from '@tanstack/react-router';
import { SignInPage } from '../../features/auth/sign-in-page';
import { isEnrolled, meQuery, type ReturnTo, returnTo } from '../../lib/session';

export const Route = createFileRoute('/_auth/sign-in')({
  validateSearch: (search): ReturnTo => returnTo(search),
  // Already signed in: straight back, or home.
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (me && isEnrolled(me)) throw redirect({ href: search.redirect ?? '/' });
  },
  component: function SignIn() {
    return <SignInPage redirect={Route.useSearch().redirect} />;
  },
});
