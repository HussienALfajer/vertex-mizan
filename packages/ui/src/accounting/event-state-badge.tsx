import type { EventState } from '@vertex-mizan/contracts';
import {
  BanIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  FilePenLineIcon,
  NotebookPenIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Badge, type BadgeProps } from '../components/badge';
import { cn } from '../lib/cn';

const tones: Record<EventState, NonNullable<BadgeProps['tone']>> = {
  posted: 'success',
  recorded: 'info',
  held: 'warning',
  resolved: 'brand',
  dismissed: 'neutral',
};

const icons: Record<EventState, ReactNode> = {
  posted: <CircleCheckIcon aria-hidden="true" />,
  recorded: <NotebookPenIcon aria-hidden="true" />,
  held: <CirclePauseIcon aria-hidden="true" />,
  resolved: <FilePenLineIcon aria-hidden="true" />,
  dismissed: <BanIcon aria-hidden="true" />,
};

type EventStateBadgeProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The event's state in the inbox (ADR 0014). */
  state: EventState;
  /** The state's name ("معلّق"), from the app's i18n. */
  label: string;
  /** A held event's reason in words ("سعر غير موجود"), shown beside the state. */
  reason?: string | null | undefined;
};

/**
 * An event's state in the inbox (S05 "Screens", ADR 0010 §7): a badge with the state's icon, color
 * and name, never color alone, and a held event's reason in words beside it. A state the app does
 * not know yet shows as neutral (ADR 0006: clients accept a state they do not know).
 */
function EventStateBadge({ state, label, reason, className, ...props }: EventStateBadgeProps) {
  return (
    <span
      data-slot="event-state-badge"
      data-state={state}
      className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}
      {...props}
    >
      <Badge tone={tones[state] ?? 'neutral'}>
        {icons[state]}
        {label}
      </Badge>
      {reason && <span className="text-muted-foreground text-xs">{reason}</span>}
    </span>
  );
}

export { EventStateBadge, type EventStateBadgeProps };
