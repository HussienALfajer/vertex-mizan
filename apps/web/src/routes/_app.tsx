import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { requireCompany, requireEnrolled } from '../lib/session';

/**
 * The signed-in app (S13): the person with the company they work in, in the shell under the
 * company's name and logo.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async (args) => {
    const me = await requireEnrolled(args);
    return { me, ...requireCompany(me) };
  },
  component: () => (
    <AppShell signedIn>
      <Outlet />
    </AppShell>
  ),
});
