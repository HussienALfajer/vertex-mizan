// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type StepData, StepList } from './step-list';

afterEach(cleanup);

const steps: StepData[] = [
  { id: 'hub', label: 'لقطة Hub', status: 'done', statusLabel: 'مكتملة', href: '#hub' },
  {
    id: 'records',
    label: 'أرصدة السجلات',
    status: 'attention',
    statusLabel: 'تحتاج إلى معالجة',
    href: '#records',
  },
  { id: 'review', label: 'المراجعة', status: 'pending', statusLabel: 'لم تكتمل', href: '#review' },
];

describe('StepList', () => {
  it('lists the steps in order under its name, each a link to its section', () => {
    render(<StepList steps={steps} label="الخطوات" />);
    const nav = screen.getByRole('navigation', { name: 'الخطوات' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#hub', '#records', '#review']);
    // The number is decoration: the order of the list says it.
    expect(within(nav).getAllByRole('listitem')).toHaveLength(3);
    expect(links[0]?.textContent).toBe('1لقطة Hubمكتملة');
  });

  it('names each status in words with its icon, never by color alone', () => {
    render(<StepList steps={steps} label="الخطوات" />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-status'))).toEqual([
      'done',
      'attention',
      'pending',
    ]);
    for (const [index, text] of ['مكتملة', 'تحتاج إلى معالجة', 'لم تكتمل'].entries()) {
      const status = items[index]?.querySelector('[data-slot="step-list-status"]');
      expect(status?.textContent).toBe(text);
      expect(status?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('marks the current step, and only it', () => {
    render(<StepList steps={steps} label="الخطوات" current="records" />);
    const current = screen.getByRole('link', { current: 'step' });
    expect(current.getAttribute('href')).toBe('#records');
    expect(
      screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current')),
    ).toHaveLength(1);
  });

  it('uses logical classes and reaches every step with Tab in reading order', () => {
    const { container } = render(<StepList steps={steps} label="الخطوات" dir="rtl" />);
    expect(container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
    const links = screen.getAllByRole('link');
    for (const link of links) expect(link.tabIndex).toBe(0);
  });
});
