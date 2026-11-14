import { createFileRoute, redirect } from '@tanstack/react-router';

/** S04's client statement moved to `/counterparties/:valueId` (S11 "Screens"): old links still work. */
export const Route = createFileRoute('/_app/_company/receivables/clients/$valueId')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/counterparties/$valueId', params, replace: true });
  },
});
