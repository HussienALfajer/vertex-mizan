import { createFileRoute } from '@tanstack/react-router';
import { JournalPage, type JournalSearch } from '../../../../features/reports/journal-pages';
import { dateParam, flagParam, ledgerParam } from '../../../../features/reports/report-search';
import { requirePermission } from '../../../../lib/session';

/** `print=true`: the journal book's print is open (the palette's "دفتر اليومية" opens it). */
export const Route = createFileRoute('/_app/_company/reports/journal')({
  validateSearch: (search: Record<string, unknown>): JournalSearch => ({
    from: dateParam(search.from),
    to: dateParam(search.to),
    ledger: ledgerParam(search.ledger),
    print: flagParam(search.print) === true ? true : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'reports.read'),
  component: JournalPage,
});
