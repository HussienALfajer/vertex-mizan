import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { requireEnrolled } from '../lib/session';

/** Every page of the app: a signed-in person with two-factor enrolled (S01 rules 1–2). */
export const Route = createFileRoute('/_app')({
  beforeLoad: async (args) => ({ me: await requireEnrolled(args) }),
  component: () => (
    <AppShell signedIn>
      <Outlet />
    </AppShell>
  ),
});
