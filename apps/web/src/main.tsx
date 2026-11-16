import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { ar, textDirection } from '@vertex-mizan/i18n';
import { DirectionProvider } from '@vertex-mizan/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, hasCode } from './lib/api';
import { meQuery } from './lib/session';
import { routeTree } from './routeTree.gen';
import './styles.css';

/**
 * A company request that finds no active company (the member was removed, S01 edge case 7), or a
 * read that finds another one (a switch in another tab, rule 22): the person loads again, and the
 * company pages follow (`_app/_company.tsx`) or send them to `/companies`. A refused write keeps
 * its form and says to reload, so typed values are not dropped unseen.
 */
function reloadPerson() {
  void queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A refusal (4xx) answers the same again: only a network or server failure is retried.
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status < 500) && failures < 3,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (hasCode(error, 'COMPANY_NOT_SELECTED') || hasCode(error, 'COMPANY_SWITCHED')) {
        reloadPerson();
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (hasCode(error, 'COMPANY_NOT_SELECTED')) reloadPerson();
    },
  }),
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

document.title = ar.common.productName;

// The installable app (apps/web/pwa.ts): the build's service worker, which only shows the offline
// page for a page load without a connection. A failed registration leaves the app as it was.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <DirectionProvider direction={textDirection}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </DirectionProvider>
  </StrictMode>,
);
