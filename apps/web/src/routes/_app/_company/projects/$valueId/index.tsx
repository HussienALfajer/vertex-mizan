import { createFileRoute } from '@tanstack/react-router';
import {
  PROJECT_REPORT_TABS,
  ProjectReportPage,
  type ProjectReportSearch,
  type ProjectReportTab,
} from '../../../../../features/projects/project-report-page';
import { dateParam, ledgerParam } from '../../../../../features/reports/report-search';
import { requirePermission } from '../../../../../lib/session';

/** A project's report (S12 "Reports"): its range, ledger and tab in the address. */
export const Route = createFileRoute('/_app/_company/projects/$valueId/')({
  validateSearch: (search: Record<string, unknown>): ProjectReportSearch => ({
    from: dateParam(search.from),
    to: dateParam(search.to),
    ledger: ledgerParam(search.ledger),
    tab: PROJECT_REPORT_TABS.includes(search.tab as ProjectReportTab)
      ? (search.tab as ProjectReportTab)
      : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: ProjectReportPage,
});
