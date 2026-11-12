import { CircleCheckIcon, CircleMinusIcon, CircleXIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Badge, type BadgeProps } from './badge';

/** What a checklist item answers. */
type ChecklistStatus = 'passed' | 'failed' | 'not_applicable';

type ChecklistItemData = {
  /** A stable key for the item. */
  id: string;
  status: ChecklistStatus;
  /** What the item checks ("لا مسودات"), from the app's i18n. */
  label: ReactNode;
  /** The status in words ("ناجح"), from the app's i18n: the status is never shown by color alone. */
  statusLabel: string;
  /** How many things fail it, shown beside a failed item ("3 مسودات"), already in words. */
  count?: ReactNode;
  /** More about the item, under its label (the ledgers it fails in). */
  description?: ReactNode;
  /** The link to the page that fixes it: a link or button element, reached with Tab. */
  action?: ReactNode;
};

type ChecklistProps = Omit<ComponentProps<'ul'>, 'children'> & {
  items: readonly ChecklistItemData[];
  /** The summary above the list ("5 من 7 ناجحة"), from the app's i18n; announced politely. */
  summary?: ReactNode;
};

const looks = {
  passed: { tone: 'success', Icon: CircleCheckIcon },
  failed: { tone: 'danger', Icon: CircleXIcon },
  not_applicable: { tone: 'neutral', Icon: CircleMinusIcon },
} as const satisfies Record<
  ChecklistStatus,
  { tone: NonNullable<BadgeProps['tone']>; Icon: typeof CircleCheckIcon }
>;

/**
 * A list of checks, each passed, failed or not applicable (S07 "Screens", ADR 0010 §7): the status
 * as an icon and words, never color alone, a failing item's count, and a link to what fixes it,
 * reachable from the keyboard in reading order. Labels and links come from the app; a summary
 * above the list counts what passed. The count and the description sit under the label, and the
 * link wraps below on a phone, so nothing scrolls sideways.
 */
function Checklist({ items, summary, className, ...props }: ChecklistProps) {
  return (
    <div data-slot="checklist" className="flex min-w-0 flex-col gap-2">
      {summary && (
        <p data-slot="checklist-summary" aria-live="polite" className="text-control font-medium">
          {summary}
        </p>
      )}
      <ul
        className={cn(
          'flex flex-col divide-y divide-border rounded-lg border border-border bg-surface',
          className,
        )}
        {...props}
      >
        {items.map((item) => {
          const { tone, Icon } = looks[item.status];
          return (
            <li
              key={item.id}
              data-slot="checklist-item"
              data-status={item.status}
              className="flex min-h-row flex-wrap items-center gap-x-3 gap-y-2 px-cell py-2"
            >
              <Badge tone={tone} className="shrink-0">
                <Icon aria-hidden="true" />
                {item.statusLabel}
              </Badge>
              <div className="flex min-w-40 flex-1 flex-col gap-0.5">
                <span className="text-control font-medium">{item.label}</span>
                {item.status === 'failed' && item.count !== undefined && (
                  <span data-slot="checklist-count" className="text-sm tabular-nums">
                    {item.count}
                  </span>
                )}
                {item.description && (
                  <span className="text-muted-foreground text-xs">{item.description}</span>
                )}
              </div>
              {item.action && <span className="flex shrink-0 items-center">{item.action}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { Checklist, type ChecklistItemData, type ChecklistProps, type ChecklistStatus };
