import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AuthLayout } from '../components/auth-layout';

/** The pages before the app: signing in, two-factor, passwords, invitations, enrolment. */
export const Route = createFileRoute('/_auth')({
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
});
