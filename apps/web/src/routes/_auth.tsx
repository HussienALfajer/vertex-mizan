import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AuthLayout } from '../components/auth-layout';

/** The pages before the app: signing in (S13 screen 1), under the company's name and logo. */
export const Route = createFileRoute('/_auth')({
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
});
