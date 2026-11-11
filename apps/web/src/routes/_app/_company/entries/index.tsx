import { createFileRoute } from '@tanstack/react-router';
import { ENTRY_SOURCES, type EntrySource } from '@vertex-mizan/contracts';
import { JournalPage } from '../../../../features/entries/journal-page';
import { requirePermission } from '../../../../lib/session';

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * `find=number`: the command palette's "go to entry number…" focuses the number filter.
 * `source`, `from` and `to` open the journal filtered: a month's releases from `/revenue` (S06).
 */
export const Route = createFileRoute('/_app/_company/entries/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    find?: 'number' | undefined;
    source?: EntrySource | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } => ({
    find: search.find === 'number' ? 'number' : undefined,
    source: ENTRY_SOURCES.includes(search.source as EntrySource)
      ? (search.source as EntrySource)
      : undefined,
    from: isDay(search.from) ? search.from : undefined,
    to: isDay(search.to) ? search.to : undefined,
  }),
  beforeLoad: ({ context }) => requirePermission(context.me, 'entries.read'),
  component: JournalPage,
});
