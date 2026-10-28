'use client';

import { CircleAlertIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from '../lib/cn';

/** What can take focus inside a field: its input, its select or combobox, its first OTP slot. */
const CONTROL =
  'input:not([type="hidden"]), textarea, select, button, [tabindex]:not([tabindex="-1"])';

interface ErrorSummaryItem {
  /** The `id` of the field's `Field`: its first control takes focus when the link is followed. */
  fieldId: string;
  message: ReactNode;
}

interface ErrorSummaryProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode;
  /** The form's errors in the order of its fields; nothing is shown without one. */
  errors: readonly ErrorSummaryItem[];
  /**
   * The count of refused submits: the summary shows from the first and takes focus at each, so
   * errors found on blur in between never move focus.
   */
  attempt: number;
}

/** Puts a field in view and focuses its first control. */
function focusField(fieldId: string): boolean {
  const field = document.getElementById(fieldId);
  const control = field?.querySelector<HTMLElement>(CONTROL);
  if (!field || !control) return false;
  field.scrollIntoView({ block: 'nearest' });
  control.focus({ preventScroll: true });
  return true;
}

/**
 * A refused submit's errors, listed above the form (ADR 0010 §4 "Errors"): it takes focus, so the
 * person and their screen reader land on it, and each message links to its field. The errors
 * stay beside their fields too.
 */
function ErrorSummary({ title, errors, attempt, className, ...props }: ErrorSummaryProps) {
  const ref = useRef<HTMLElement>(null);
  const focusedAttempt = useRef(0);
  const titleId = useId();
  const shown = attempt > 0 && errors.length > 0;

  useEffect(() => {
    if (shown && attempt !== focusedAttempt.current) {
      focusedAttempt.current = attempt;
      ref.current?.focus();
    }
  });

  if (!shown) return null;
  return (
    <section
      ref={ref}
      data-slot="error-summary"
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col gap-2 rounded-lg bg-status-danger px-4 py-3 text-status-danger-foreground',
        'focus:outline-2 focus:outline-offset-2 focus:outline-ring',
        className,
      )}
      {...props}
    >
      <p id={titleId} className="flex items-start gap-2 text-control font-medium">
        <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-icon shrink-0" />
        <span>{title}</span>
      </p>
      <ul className="flex list-disc flex-col gap-1 ps-10 text-control">
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              className="underline underline-offset-2"
              onClick={(event) => {
                if (focusField(error.fieldId)) event.preventDefault();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export { ErrorSummary, type ErrorSummaryItem, type ErrorSummaryProps };
