import { createFileRoute, redirect } from '@tanstack/react-router';
import { NoCompanyPage } from '../../features/auth/no-company-page';
import { activeMembership, requireSession } from '../../lib/session';

/** A signed-in person without an active company (S01 rule 20; one company per person, ADR 0024). */
export const Route = createFileRoute('/_auth/no-company')({
  beforeLoad: async (args) => {
    const me = await requireSession(args);
    if (activeMembership(me)) throw redirect({ to: '/' });
  },
  component: NoCompanyPage,
});
