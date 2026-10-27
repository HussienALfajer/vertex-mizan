import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { ar, textDirection } from '@vertex-mizan/i18n';
import { DirectionProvider } from '@vertex-mizan/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { hasCode } from './lib/api';
import { meQuery } from './lib/session';
import { routeTree } from './routeTree.gen';
import './styles.css';

/**
 * A company request that finds no active company (the member was removed, S01 edge case 7):
 * the person loads again, and the company pages send them to `/companies`.
 */
function onCompanyLost(error: unknown) {
  if (hasCode(error, 'COMPANY_NOT_SELECTED')) {
    void queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onCompanyLost }),
  mutationCache: new MutationCache({ onError: onCompanyLost }),
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
