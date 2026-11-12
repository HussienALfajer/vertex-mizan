import { createFileRoute } from '@tanstack/react-router';
import { PrintsPage, type PrintsSearch } from '../../../../../features/reports/journal-pages';
import { requirePermission } from '../../../../../lib/session';

export const Route = createFileRoute('/_app/_company/reports/journal-book/prints')({
  validateSearch: (search: Record<string, unknown>): PrintsSearch => {
    const year = Number(search.fiscalYear);
    return {
      fiscalYear: Number.isInteger(year) && year >= 2000 && year <= 9999 ? year : undefined,
    };
  },
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: PrintsPage,
});
