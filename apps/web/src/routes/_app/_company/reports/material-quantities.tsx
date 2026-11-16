import { createFileRoute } from '@tanstack/react-router';
import {
  MaterialQuantitiesPage,
  type MaterialQuantitiesSearch,
} from '../../../../features/projects/material-quantities-page';
import { dateParam, ledgerParam, uuidParam } from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/material-quantities')({
  validateSearch: (search: Record<string, unknown>): MaterialQuantitiesSearch => ({
    from: dateParam(search.from),
    to: dateParam(search.to),
    ledger: ledgerParam(search.ledger),
    project: uuidParam(search.project),
    material: uuidParam(search.material),
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: MaterialQuantitiesPage,
});
