import { ArrowLeftIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** One changed field: its name, and its value before and after, as the app shows them. */
interface Change {
  /** Stable key: the field's name in the record. */
  id: string;
  label: ReactNode;
  before: ReactNode;
  after: ReactNode;
}

type ChangeListProps = Omit<ComponentProps<'dl'>, 'children'> & {
  changes: readonly Change[];
  /** The captions over each value, from i18n. */
  beforeLabel: string;
  afterLabel: string;
  /** Shown instead of the list when nothing changed. */
  empty?: ReactNode;
};

/**
 * What a change did, field by field: the value before and after (an audit entry, ADR 0005). The
 * app formats each value (a role's name, a currency, a date); this lays them out. On phones the
 * two values stack; from `sm` they sit side by side in reading order, before then after.
 */
function ChangeList({
  changes,
  beforeLabel,
  afterLabel,
  empty,
  className,
  ...props
}: ChangeListProps) {
  if (changes.length === 0) return empty ?? null;
  return (
    <dl data-slot="change-list" className={cn('flex flex-col gap-3', className)} {...props}>
      {changes.map((change) => (
        <div
          key={change.id}
          data-slot="change"
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <dt className="text-control font-medium text-foreground">{change.label}</dt>
          <dd className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
            <ChangeValue caption={beforeLabel} tone="before">
              {change.before}
            </ChangeValue>
            {/* Forward in reading order: the arrow points to the inline end (left in Arabic). */}
            <ArrowLeftIcon
              aria-hidden="true"
              className="hidden size-icon self-center text-muted-foreground sm:block ltr:rotate-180"
            />
            <ChangeValue caption={afterLabel} tone="after">
              {change.after}
            </ChangeValue>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ChangeValue({
  caption,
  tone,
  children,
}: {
  caption: string;
  tone: 'before' | 'after';
  children: ReactNode;
}) {
  return (
    <div
      data-slot={`change-${tone}`}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-sm px-cell py-1.5 text-control break-words',
        tone === 'before' ? 'bg-muted text-muted-foreground' : 'bg-status-info text-foreground',
      )}
    >
      <span className="text-xs text-muted-foreground">{caption}</span>
      <span>{children}</span>
    </div>
  );
}

export { type Change, ChangeList, type ChangeListProps };
