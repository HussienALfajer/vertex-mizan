import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { ar } from '@vertex-mizan/i18n';
import { Button, EmptyState } from '@vertex-mizan/ui';
import { AppShell } from '../components/app-shell';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

function Root() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function RootError() {
  return (
    <EmptyState
      title={ar.common.errorTitle}
      description={ar.common.errorDescription}
      action={<Button onClick={() => window.location.reload()}>{ar.shell.reload}</Button>}
    />
  );
}

function NotFound() {
  const t = ar.shell.notFound;
  return (
    <EmptyState
      title={t.title}
      description={t.description}
      action={<Button render={<Link to="/" />}>{t.backHome}</Button>}
    />
  );
}
