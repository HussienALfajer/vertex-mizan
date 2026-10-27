import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { DesignSystemPage } from '../features/design-system/design-system-page';

/** Open without signing in: a developer gallery with synthetic data only. */
export const Route = createFileRoute('/design-system')({
  component: () => (
    <AppShell>
      <DesignSystemPage />
    </AppShell>
  ),
});
