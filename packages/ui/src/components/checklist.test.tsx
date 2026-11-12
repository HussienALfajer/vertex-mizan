// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Checklist, type ChecklistItemData } from './checklist';

afterEach(cleanup);

const items: ChecklistItemData[] = [
  { id: 'a', status: 'passed', label: 'النشرات مسجلة', statusLabel: 'ناجح' },
  {
    id: 'b',
    status: 'failed',
    label: 'لا مسودات',
    statusLabel: 'غير ناجح',
    count: '2 مسودات',
    action: <a href="/drafts">افتح المسودات</a>,
  },
  {
    id: 'c',
    status: 'not_applicable',
    label: 'إعادة التقييم حالية',
    statusLabel: 'لا ينطبق',
    count: '9',
    description: 'الدفتر الموازي',
  },
];

describe('Checklist', () => {
  it('names each status in words with its icon, never by color alone', () => {
    render(<Checklist items={items} aria-label="قائمة التحقق" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual([
      'passed',
      'failed',
      'not_applicable',
    ]);
    for (const [index, text] of ['ناجح', 'غير ناجح', 'لا ينطبق'].entries()) {
      const badge = rows[index]?.querySelector('[data-slot="badge"]');
      expect(badge?.textContent).toBe(text);
      expect(badge?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    const tones = rows.map(
      (row) =>
        /bg-status-(\w+)/.exec(row.querySelector('[data-slot="badge"]')?.className ?? '')?.[1],
    );
    expect(tones).toEqual(['success', 'danger', 'neutral']);
  });

  it('shows the count of a failed item only, and the description under the label', () => {
    render(<Checklist items={items} />);
    const counts = document.querySelectorAll('[data-slot="checklist-count"]');
    expect([...counts].map((count) => count.textContent)).toEqual(['2 مسودات']);
    expect(screen.getByText('الدفتر الموازي')).toBeTruthy();
  });

  it('keeps each link in the tab order, in reading order', () => {
    render(
      <Checklist
        items={[
          ...items,
          {
            id: 'd',
            status: 'failed',
            label: 'x',
            statusLabel: 'غير ناجح',
            action: <a href="/x">ب</a>,
          },
        ]}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['افتح المسودات', 'ب']);
    for (const link of links) expect(link.getAttribute('tabindex')).toBeNull();
    links[0]?.focus();
    expect(document.activeElement).toBe(links[0]);
  });

  it('announces its summary politely', () => {
    render(<Checklist items={items} summary="1 من 3 ناجحة" />);
    const summary = screen.getByText('1 من 3 ناجحة');
    expect(summary.getAttribute('aria-live')).toBe('polite');
  });
});
