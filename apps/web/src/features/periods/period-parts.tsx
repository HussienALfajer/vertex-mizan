import { Link } from '@tanstack/react-router';
import type {
  ChecklistItem,
  ChecklistItemName,
  Ledger,
  Me,
  PeriodState,
} from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { Button, type ChecklistItemData, PeriodBadge } from '@vertex-mizan/ui';
import { ArrowRightIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { addDays } from '../../lib/format';
import { can } from '../../lib/session';
import { formatMonth } from '../revenue/revenue-parts';

const t = ar.periods;

/** A period's state as the period screens name it (مفتوحة · مقفلة · معاد فتحها). */
export function PeriodStateBadge({ state }: { state: PeriodState }) {
  return <PeriodBadge state={state} label={t.states[state] ?? t.states.open} className="w-fit" />;
}

/** The first and last days of a month, `YYYY-MM-DD`. */
export function monthDays(period: string): { first: string; last: string } {
  const first = `${period}-01`;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { first, last: addDays(next, -1) };
}

/** The month before a month, `YYYY-MM`. */
export function previousMonth(period: string): string {
  return addDays(`${period}-01`, -1).slice(0, 7);
}

/** A month as a heading names it: its name, its year and `YYYY-MM`. */
export function PeriodName({ period }: { period: string }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {formatMonth(period)}
      <bdi dir="ltr" className="text-muted-foreground text-sm tabular-nums">
        {period}
      </bdi>
    </span>
  );
}

/** A month, linked to its page. */
export function PeriodLink({ period }: { period: string }) {
  return (
    <Link
      to="/periods/$period"
      params={{ period }}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {formatMonth(period)}
    </Link>
  );
}

/** The way back to `/periods`, above a month's title. */
export function PeriodsBackLink() {
  return (
    <Button variant="ghost" size="sm" className="w-fit" render={<Link to="/periods" />}>
      <ArrowRightIcon aria-hidden="true" />
      {t.detail.back}
    </Button>
  );
}

/** An item's name in Arabic, with a neutral word for one this build does not know (S08 appends). */
export function checklistItemLabel(name: ChecklistItemName | string): string {
  return name in t.checklist.items
    ? t.checklist.items[name as ChecklistItemName]
    : t.checklist.unknownItem;
}

/**
 * The link to the page that fixes an item (S07 "Screens"), when the person may open it: the rate
 * calendar, the month's revaluation, the drafts, the integrity check, the month's held events,
 * the revenue months.
 */
function itemLink(item: ChecklistItem, period: string, me: Me): ReactNode {
  if (!(item.item in t.checklist.links)) return null;
  const name = item.item as ChecklistItemName;
  const label = t.checklist.links[name];
  const ledger: Ledger = item.ledgers[0] ?? 'book';
  const { first, last } = monthDays(period);
  const link = (element: ReactElement) => (
    <Button variant="link" size="sm" render={element}>
      {label}
    </Button>
  );
  switch (name) {
    case 'bulletins_recorded':
      return can(me, 'rates.read') ? link(<Link to="/rates/calendar" />) : null;
    case 'closing_rates_recorded':
    case 'revaluation_current':
      return link(<Link to="/revaluation" search={{ period, ledger }} />);
    case 'no_drafts':
      return can(me, 'drafts.read') ? link(<Link to="/drafts" />) : null;
    case 'open_items_agree':
      return can(me, 'integrity.read') ? link(<Link to="/integrity" />) : null;
    case 'no_held_events':
      return can(me, 'events.read')
        ? link(<Link to="/inbox" search={{ view: 'held', from: first, to: last }} />)
        : null;
    case 'releases_posted':
      return can(me, 'recognition.read')
        ? link(<Link to="/revenue" search={{ view: 'months' }} />)
        : null;
  }
}

/** The checklist's items as `Checklist` shows them: words, the count, the ledgers and the link. */
export function checklistItems(
  checklist: readonly ChecklistItem[],
  period: string,
  me: Me,
): ChecklistItemData[] {
  return checklist.map((item) => {
    const name = item.item as ChecklistItemName;
    const known = item.item in t.checklist.counts;
    return {
      id: item.item,
      status: item.result,
      label: checklistItemLabel(item.item),
      statusLabel: t.checklist.results[item.result] ?? item.result,
      ...(known
        ? { count: `${t.checklist.counts[name]}: ${item.count}` }
        : { count: String(item.count) }),
      ...(item.ledgers.length > 0
        ? {
            description: `${t.checklist.ledgers} ${item.ledgers
              .map((ledger) => ar.revaluation.ledgers[ledger])
              .join(ar.common.listSeparator)}`,
          }
        : {}),
      ...(item.result === 'failed' ? { action: itemLink(item, period, me) } : {}),
    };
  });
}
