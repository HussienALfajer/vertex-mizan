import type { ReconciliationDayState } from '@vertex-mizan/contracts';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  ClockIcon,
  FileWarningIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Badge, type BadgeProps } from '../components/badge';
import { cn } from '../lib/cn';

const tones: Record<ReconciliationDayState, NonNullable<BadgeProps['tone']>> = {
  matched: 'success',
  differences: 'danger',
  missing: 'warning',
  pending: 'info',
  not_required: 'neutral',
};

const icons: Record<ReconciliationDayState, ReactNode> = {
  matched: <CircleCheckIcon aria-hidden="true" />,
  differences: <TriangleAlertIcon aria-hidden="true" />,
  missing: <FileWarningIcon aria-hidden="true" />,
  pending: <ClockIcon aria-hidden="true" />,
  not_required: <CircleMinusIcon aria-hidden="true" />,
};

type ReconciliationDayBadgeProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The day's state for a client or the company (S08 rule 10). */
  state: ReconciliationDayState;
  /** The state's name ("فيه فروق"), from the app's i18n. */
  label: string;
  /** What the day holds in words ("3 فروق", "بعد الإقفال"), shown beside the state. */
  detail?: string | null | undefined;
};

/**
 * A reconciliation day's state (S08 "Screens", ADR 0010 §7), on `EventStateBadge`'s pattern: the
 * state's icon, tone and name, never color alone, and a detail in words beside it. A state the
 * app does not know yet shows as neutral with a dashed icon (ADR 0006).
 */
function ReconciliationDayBadge({
  state,
  label,
  detail,
  className,
  ...props
}: ReconciliationDayBadgeProps) {
  return (
    <span
      data-slot="reconciliation-day-badge"
      data-state={state}
      className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}
      {...props}
    >
      <Badge tone={tones[state] ?? 'neutral'}>
        {icons[state] ?? <CircleDashedIcon aria-hidden="true" />}
        {label}
      </Badge>
      {detail && <span className="text-muted-foreground text-xs">{detail}</span>}
    </span>
  );
}

export { ReconciliationDayBadge, type ReconciliationDayBadgeProps };
