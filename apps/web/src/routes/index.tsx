import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { HomePage } from '../features/home/home-page';

/** The first page: the product and the system's health, until the new screens arrive. */
export const Route = createFileRoute('/')({
  component: () => (
    <AppShell>
      <HomePage />
    </AppShell>
  ),
});
