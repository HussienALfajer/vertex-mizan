import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Where a step of a task stands: done, needing attention, or not reached yet. */
type StepStatus = 'done' | 'attention' | 'pending';

type StepData = {
  /** A stable key for the step. */
  id: string;
  /** The step's name ("أرصدة السجلات"), from the app's i18n. */
  label: ReactNode;
  status: StepStatus;
  /** The status in words ("تحتاج إلى معالجة"): a status is never shown by color or icon alone. */
  statusLabel: string;
  /** Where the step's section is on the page (`#records`), or its own page. */
  href: string;
};

type StepListProps = Omit<ComponentProps<'nav'>, 'children'> & {
  steps: readonly StepData[];
  /** The list's accessible name ("خطوات الأرصدة الافتتاحية"), from the app's i18n. */
  label: string;
  /** The step the person is on, marked `aria-current="step"`. */
  current?: string | undefined;
};

const looks = {
  done: { Icon: CircleCheckIcon, tone: 'text-status-success-foreground bg-status-success' },
  attention: { Icon: CircleAlertIcon, tone: 'text-status-warning-foreground bg-status-warning' },
  pending: { Icon: CircleDashedIcon, tone: 'text-status-neutral-foreground bg-status-neutral' },
} as const satisfies Record<StepStatus, { Icon: typeof CircleCheckIcon; tone: string }>;

/**
 * A task's steps in order (S10 "Screens", ADR 0010 §7), such as the opening's four steps on one
 * page: each numbered, with its status as an icon and words, linking to its section. A row of
 * steps from tablet width, a column on a phone, so nothing scrolls sideways. Labels and links come
 * from the app; the step the person is on carries `aria-current="step"`.
 */
function StepList({ steps, label, current, className, ...props }: StepListProps) {
  return (
    <nav aria-label={label} data-slot="step-list" className={cn('min-w-0', className)} {...props}>
      <ol className="flex flex-col gap-2 md:flex-row md:gap-3">
        {steps.map((step, index) => {
          const { Icon, tone } = looks[step.status];
          return (
            <li
              key={step.id}
              data-slot="step-list-item"
              data-status={step.status}
              className="flex-1"
            >
              <a
                href={step.href}
                aria-current={current === step.id ? 'step' : undefined}
                className="flex min-h-row items-center gap-3 rounded-lg border border-border bg-surface px-cell py-2 text-control transition-colors duration-150 ease-out hover:bg-muted aria-[current=step]:border-primary"
              >
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{step.label}</span>
                  <span
                    data-slot="step-list-status"
                    className={cn(
                      'inline-flex w-fit items-center gap-1 rounded-sm px-1.5 text-xs [&>svg]:size-3.5',
                      tone,
                    )}
                  >
                    <Icon aria-hidden="true" />
                    {step.statusLabel}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { type StepData, StepList, type StepListProps, type StepStatus };
