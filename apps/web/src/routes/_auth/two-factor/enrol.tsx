import { createFileRoute } from '@tanstack/react-router';
import { EnrolPage } from '../../../features/auth/enrol-page';
import { type ReturnTo, requireSession, returnTo } from '../../../lib/session';

/** Reached by any signed-in person: the not-enrolled reach nothing else (S01 rule 2). */
export const Route = createFileRoute('/_auth/two-factor/enrol')({
  validateSearch: (search): ReturnTo => returnTo(search),
  beforeLoad: async (args) => ({ me: await requireSession(args) }),
  component: function Enrol() {
    return <EnrolPage redirect={Route.useSearch().redirect} />;
  },
});
