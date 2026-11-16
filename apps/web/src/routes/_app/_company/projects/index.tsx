import { createFileRoute } from '@tanstack/react-router';
import { ProjectsPage, type ProjectsSearch } from '../../../../features/projects/projects-page';
import { dateParam, flagParam, ledgerParam } from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

/** The projects list (S12 "Screens"): its date, ledger and archived projects in the address. */
export const Route = createFileRoute('/_app/_company/projects/')({
  validateSearch: (search: Record<string, unknown>): ProjectsSearch => ({
    asOf: dateParam(search.asOf),
    ledger: ledgerParam(search.ledger),
    archived: flagParam(search.archived),
    find: search.find === 'project' ? 'project' : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: ProjectsPage,
});
