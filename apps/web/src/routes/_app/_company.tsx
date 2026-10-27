import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useRouter } from '@tanstack/react-router';
import { Fragment, useEffect } from 'react';
import { meQuery, requireCompany } from '../../lib/session';

/**
 * Every page of the active company (S01 rule 20); without one, `/companies`. When the session's
 * company changes (another tab switched, the member was removed), the pages load again in the new
 * one, and the forms of the old one are dropped rather than sent there.
 */
export const Route = createFileRoute('/_app/_company')({
  beforeLoad: ({ context }) => requireCompany(context.me),
  component: CompanyLayout,
});

function CompanyLayout() {
  const { companyId } = Route.useRouteContext();
  const router = useRouter();
  const me = useQuery(meQuery).data;
  const current = me === undefined ? companyId : me?.activeCompanyId;
  useEffect(() => {
    if (current !== companyId) void router.invalidate();
  }, [current, companyId, router]);
  return (
    <Fragment key={companyId}>
      <Outlet />
    </Fragment>
  );
}
