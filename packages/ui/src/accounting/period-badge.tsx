import { LockIcon, LockOpenIcon, RotateCcwIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Badge } from '../components/badge';

type PeriodState = 'open' | 'closed' | 'reopened';

type PeriodBadgeProps = Omit<ComponentProps<typeof Badge>, 'tone' | 'children'> & {
  state: PeriodState;
  /** The state's text, from i18n (`accounting.period`). */
  label: string;
};

const looks = {
  open: { tone: 'success', Icon: LockOpenIcon },
  closed: { tone: 'neutral', Icon: LockIcon },
  reopened: { tone: 'warning', Icon: RotateCcwIcon },
} as const;

/** A period's state wherever a date is chosen (ADR 0009): icon and text, never color alone. */
function PeriodBadge({ state, label, ...props }: PeriodBadgeProps) {
  const { tone, Icon } = looks[state];
  return (
    <Badge data-slot="period-badge" data-state={state} tone={tone} {...props}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

export { PeriodBadge, type PeriodBadgeProps, type PeriodState };
