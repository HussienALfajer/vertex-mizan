// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ErrorSummary } from './error-summary';
import { Field, FieldError, FieldLabel } from './field';
import { Input } from './input';

afterEach(cleanup);
beforeAll(() => {
  // jsdom lays nothing out.
  Element.prototype.scrollIntoView = () => {};
});

const errors = [
  { fieldId: 'name', message: 'الاسم مطلوب' },
  { fieldId: 'note', message: 'مذكرة السياسة مطلوبة' },
];

function Form({ attempt, shown = errors }: { attempt: number; shown?: typeof errors }) {
  return (
    <form>
      <ErrorSummary title="راجع الحقول التالية" errors={shown} attempt={attempt} />
      <Field id="name" invalid>
        <FieldLabel>الاسم</FieldLabel>
        <Input />
        <FieldError match>الاسم مطلوب</FieldError>
      </Field>
      <Field id="note" invalid>
        <FieldLabel>مذكرة السياسة</FieldLabel>
        <Input />
        <FieldError match>مذكرة السياسة مطلوبة</FieldError>
      </Field>
    </form>
  );
}

describe('ErrorSummary', () => {
  it('shows nothing before a refused submit or without errors', () => {
    const { rerender } = render(<Form attempt={0} />);
    expect(screen.queryByRole('region')).toBeNull();
    rerender(<Form attempt={1} shown={[]} />);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('takes focus at each refused submit, named by its title', () => {
    const { rerender } = render(<Form attempt={1} />);
    const summary = screen.getByRole('region', { name: 'راجع الحقول التالية' });
    expect(document.activeElement).toBe(summary);
    screen.getByRole('textbox', { name: 'الاسم' }).focus();
    rerender(<Form attempt={1} />);
    expect(document.activeElement).not.toBe(summary);
    rerender(<Form attempt={2} />);
    expect(document.activeElement).toBe(summary);
  });

  it('links each error to its field, in order, and focuses the field’s control', () => {
    render(<Form attempt={1} />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['الاسم مطلوب', 'مذكرة السياسة مطلوبة']);
    expect(links[1]?.getAttribute('href')).toBe('#note');
    fireEvent.click(links[1] as HTMLElement);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'مذكرة السياسة' }));
  });
});
