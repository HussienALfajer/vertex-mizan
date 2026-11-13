'use client';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import {
  BookOpenIcon,
  CalendarClockIcon,
  CalendarIcon,
  LandmarkIcon,
  LockOpenIcon,
  ScaleIcon,
} from 'lucide-react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * A status mark of a report (S09 rule 4): `period_open` ("غير نهائية: الفترة مفتوحة") or
 * `before_revaluation` ("قبل إعادة التقييم"), and S10's `opening_entry`, `before_books_start` and
 * `pre_opening_result_in_equity`; its words, and the page that explains or fixes it (the month's
 * period page, the revaluation) as an element such as a router link, with its words.
 */
export interface ReportMarkItem {
  readonly mark:
    | 'period_open'
    | 'before_revaluation'
    | 'opening_entry'
    | 'before_books_start'
    | 'pre_opening_result_in_equity';
  readonly label: string;
  readonly link?: ReactElement | undefined;
  readonly linkLabel?: string | undefined;
}

/** One column's marks: the report's own (no label), or the comparative's ("المقارنة"). */
export interface ReportMarksColumn {
  readonly key: string;
  readonly label?: string | undefined;
  readonly marks: readonly ReportMarkItem[];
}

/** A fact of the header: when the report was produced, the latest entry it includes. */
export interface ReportMarksDetail {
  readonly label: string;
  readonly value: ReactNode;
}

const icons = {
  period_open: LockOpenIcon,
  before_revaluation: ScaleIcon,
  opening_entry: BookOpenIcon,
  before_books_start: CalendarIcon,
  pre_opening_result_in_equity: LandmarkIcon,
} as const;

/**
 * A report's marks (S09 rule 4, "Screens"): each column's marks in words with an icon, never
 * color alone, each with its link, and the header's facts beside them (produced at, the latest
 * entry). A report with no mark shows its facts only. Labels and links come in as props.
 */
function ReportMarks({
  columns,
  details,
  className,
  ...props
}: Omit<ComponentProps<'section'>, 'children'> & {
  columns: readonly ReportMarksColumn[];
  details: readonly ReportMarksDetail[];
}) {
  const marked = columns.filter((column) => column.marks.length > 0);
  return (
    <section
      data-slot="report-marks"
      className={cn('flex min-w-0 flex-col gap-2', className)}
      {...props}
    >
      {marked.length > 0 && (
        <ul className="flex flex-col gap-2">
          {marked.flatMap((column) =>
            column.marks.map((item) => {
              const Icon = icons[item.mark];
              return (
                <li
                  key={`${column.key}-${item.mark}`}
                  data-slot="report-mark"
                  data-mark={item.mark}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-status-warning px-3 py-2 text-control text-status-warning-foreground"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Icon aria-hidden="true" className="size-icon shrink-0" />
                    {column.label && <span>{column.label}:</span>}
                    <span>{item.label}</span>
                  </span>
                  {item.link && item.linkLabel && (
                    <MarkLink link={item.link}>{item.linkLabel}</MarkLink>
                  )}
                </li>
              );
            }),
          )}
        </ul>
      )}
      {details.length > 0 && (
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <CalendarClockIcon aria-hidden="true" className="size-icon shrink-0" />
          {details.map((detail) => (
            <div key={detail.label} className="flex gap-1">
              <dt>{detail.label}:</dt>
              <dd className="text-foreground">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function MarkLink({ link, children }: { link: ReactElement; children: ReactNode }) {
  return useRender({
    render: link,
    props: mergeProps<'a'>({ className: 'font-medium underline underline-offset-4' }, { children }),
  });
}

export { ReportMarks };
