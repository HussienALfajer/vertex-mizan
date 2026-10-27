// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangeList } from './change-list';

afterEach(cleanup);

const changes = [
  { id: 'role', label: 'الدور', before: 'القارئ', after: 'المحاسب' },
  { id: 'canClosePeriods', label: 'صلاحية الفترات', before: 'لا', after: 'نعم' },
];

describe('ChangeList', () => {
  it('names each field and shows its value before, then after', () => {
    render(<ChangeList changes={changes} beforeLabel="قبل" afterLabel="بعد" />);
    const terms = screen.getAllByRole('term');
    expect(terms.map((term) => term.textContent)).toEqual(['الدور', 'صلاحية الفترات']);
    const [first] = screen.getAllByRole('definition');
    if (!first) throw new Error('No value');
    const before = first.querySelector('[data-slot="change-before"]');
    const after = first.querySelector('[data-slot="change-after"]');
    expect(before?.textContent).toBe('قبلالقارئ');
    expect(after?.textContent).toBe('بعدالمحاسب');
    // Before comes first in reading order.
    expect(before?.compareDocumentPosition(after as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps the arrow away from assistive technology', () => {
    render(<ChangeList changes={changes} beforeLabel="قبل" afterLabel="بعد" />);
    const [first] = screen.getAllByRole('definition');
    expect(within(first as HTMLElement).queryByRole('img')).toBeNull();
    expect(first?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the empty content when nothing changed, or nothing at all', () => {
    const { container, rerender } = render(
      <ChangeList changes={[]} beforeLabel="قبل" afterLabel="بعد" />,
    );
    expect(container.querySelector('dl')).toBeNull();
    rerender(
      <ChangeList changes={[]} beforeLabel="قبل" afterLabel="بعد" empty={<p>لا تغييرات</p>} />,
    );
    expect(screen.getByText('لا تغييرات')).toBeTruthy();
  });

  it('passes props through to the list', () => {
    render(
      <ChangeList changes={changes} beforeLabel="قبل" afterLabel="بعد" aria-label="التغييرات" />,
    );
    expect(screen.getByLabelText('التغييرات').tagName).toBe('DL');
  });
});
