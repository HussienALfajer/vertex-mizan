// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportMarks } from './report-marks';

afterEach(cleanup);

/** A link the table renders its figure into, as the app's router link. */
function Href({ children, ...props }: ComponentProps<'a'>) {
  return <a {...props}>{children}</a>;
}

const details = [
  { label: 'أُعدّ في', value: '2026-11-12 10:00' },
  { label: 'آخر قيد مشمول', value: '2026/45' },
];

describe('ReportMarks', () => {
  it('shows each column’s marks in words with their links, and the facts', () => {
    render(
      <ReportMarks
        aria-label="حالة التقرير"
        columns={[
          {
            key: 'current',
            marks: [
              {
                mark: 'period_open',
                label: 'غير نهائية: الفترة مفتوحة',
                link: <Href href="/periods/2026-11" />,
                linkLabel: 'صفحة الشهر',
              },
              {
                mark: 'before_revaluation',
                label: 'قبل إعادة التقييم',
                link: <Href href="/revaluation" />,
                linkLabel: 'إعادة التقييم',
              },
            ],
          },
          { key: 'compare', label: 'المقارنة', marks: [] },
        ]}
        details={details}
      />,
    );
    const section = screen.getByRole('region', { name: 'حالة التقرير' });
    const marks = within(section).getAllByRole('listitem');
    expect(marks.map((mark) => mark.getAttribute('data-mark'))).toEqual([
      'period_open',
      'before_revaluation',
    ]);
    expect(marks[0]?.textContent).toBe('غير نهائية: الفترة مفتوحةصفحة الشهر');
    expect(within(section).getByRole('link', { name: 'إعادة التقييم' }).getAttribute('href')).toBe(
      '/revaluation',
    );
    expect(section.textContent).toContain('آخر قيد مشمول:2026/45');
  });

  it('names the comparative column of a mark, and shows only the facts without marks', () => {
    const { rerender } = render(
      <ReportMarks
        columns={[
          {
            key: 'compare',
            label: 'المقارنة',
            marks: [{ mark: 'period_open', label: 'غير نهائية: الفترة مفتوحة' }],
          },
        ]}
        details={details}
      />,
    );
    expect(screen.getByRole('listitem').textContent).toBe('المقارنة:غير نهائية: الفترة مفتوحة');
    rerender(<ReportMarks columns={[{ key: 'current', marks: [] }]} details={details} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('2026/45')).toBeTruthy();
  });
});
