// @vitest-environment jsdom
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountTree, type AccountTreeNode } from './account-tree';

afterEach(cleanup);

const labels = {
  label: 'دليل الحسابات',
  account: 'الحساب',
  header: 'حساب رئيسي',
  blocked: 'موقوف',
  archived: 'مؤرشف',
  expand: 'افتح',
  collapse: 'أغلق',
  actions: 'الإجراءات',
};

const nodes: AccountTreeNode[] = [
  { id: 'a1', parentId: null, code: '1', name: 'الأصول', kind: 'header' },
  { id: 'a11', parentId: 'a1', code: '11', name: 'الأصول المتداولة', kind: 'header' },
  { id: 'a111', parentId: 'a11', code: '111', name: 'النقد', kind: 'header' },
  { id: 'a111001', parentId: 'a111', code: '111001', name: 'الصندوق', kind: 'postable' },
  {
    id: 'a111002',
    parentId: 'a111',
    code: '111002',
    name: 'المصرف',
    kind: 'postable',
    blocked: true,
  },
  {
    id: 'a111003',
    parentId: 'a111',
    code: '111003',
    name: 'المحفظة Wise',
    kind: 'postable',
    archived: true,
  },
  { id: 'a2', parentId: null, code: '2', name: 'الخصوم', kind: 'header' },
];

function renderTree(
  props: Partial<Parameters<typeof AccountTree>[0]> = {},
  direction: 'rtl' | 'ltr' = 'rtl',
) {
  return render(
    <DirectionProvider direction={direction}>
      <AccountTree
        nodes={nodes}
        labels={labels}
        columns={[{ id: 'kind', header: 'النوع', cell: (node) => node.kind }]}
        {...props}
      />
    </DirectionProvider>,
  );
}

const row = (code: string) =>
  screen
    .getAllByRole('row')
    .find((r) => r.querySelector('bdi')?.textContent === code) as HTMLElement;

describe('AccountTree', () => {
  it('is a tree grid of every account by code, with levels and open branches', () => {
    renderTree();
    const grid = screen.getByRole('treegrid', { name: 'دليل الحسابات' });
    const rows = within(grid).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('bdi')?.textContent)).toEqual([
      '1',
      '11',
      '111',
      '111001',
      '111002',
      '111003',
      '2',
    ]);
    expect(row('111').getAttribute('aria-level')).toBe('3');
    expect(row('111').getAttribute('aria-expanded')).toBe('true');
    expect(row('111001').hasAttribute('aria-expanded')).toBe(false);
    expect(row('2').hasAttribute('aria-expanded')).toBe(false);
    // The code is an LTR isolate, first.
    expect(row('111001').querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
  });

  it('marks headers, blocked and archived accounts with text', () => {
    renderTree();
    expect(within(row('111')).getByText('حساب رئيسي')).toBeTruthy();
    expect(within(row('111002')).getByText('موقوف')).toBeTruthy();
    expect(within(row('111003')).getByText('مؤرشف')).toBeTruthy();
    expect(within(row('111001')).queryByText('موقوف')).toBeNull();
  });

  it('closes and opens a branch with its button', () => {
    renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'أغلق: 111' }));
    expect(screen.queryByText('الصندوق')).toBeNull();
    expect(row('111').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'افتح: 111' }));
    expect(screen.getByText('الصندوق')).toBeTruthy();
  });

  it('moves with the arrows, opens inward in Arabic with the left arrow, and opens on Enter', () => {
    const onOpen = vi.fn();
    renderTree({ onOpen });
    // One row is in the tab order: the first.
    expect(row('1').tabIndex).toBe(0);
    expect(row('11').tabIndex).toBe(-1);
    row('1').focus();
    fireEvent.keyDown(row('1'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(row('11'));
    fireEvent.keyDown(row('11'), { key: 'ArrowDown' });
    // The right arrow is outward in RTL: it closes the open branch.
    fireEvent.keyDown(row('111'), { key: 'ArrowRight' });
    expect(row('111').getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(row('111'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(row('11'));
    fireEvent.keyDown(row('11'), { key: 'ArrowDown' });
    fireEvent.keyDown(row('111'), { key: 'ArrowLeft' });
    expect(row('111').getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(row('111'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(row('111001'));
    fireEvent.keyDown(row('111001'), { key: 'End' });
    expect(document.activeElement).toBe(row('2'));
    fireEvent.keyDown(row('2'), { key: 'Home' });
    expect(document.activeElement).toBe(row('1'));
    fireEvent.keyDown(row('1'), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(nodes[0]);
  });

  it('opens inward with the right arrow in a left-to-right page', () => {
    renderTree({}, 'ltr');
    fireEvent.click(screen.getByRole('button', { name: 'أغلق: 111' }));
    fireEvent.keyDown(row('111'), { key: 'ArrowRight' });
    expect(row('111').getAttribute('aria-expanded')).toBe('true');
  });

  it('shows only the matches with their ancestors', () => {
    renderTree({ match: (node) => node.name.includes('Wise') });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('bdi')?.textContent)).toEqual([
      '1',
      '11',
      '111',
      '111003',
    ]);
  });

  it('opens a new parent when a first child arrives', () => {
    const { rerender } = renderTree();
    const added = [
      ...nodes,
      { id: 'a21', parentId: 'a2', code: '21', name: 'الخصوم المتداولة', kind: 'header' as const },
    ];
    rerender(
      <DirectionProvider direction="rtl">
        <AccountTree nodes={added} labels={labels} />
      </DirectionProvider>,
    );
    expect(screen.getByText('الخصوم المتداولة')).toBeTruthy();
  });

  it('renders the actions of each row and leaves their keys to them', () => {
    const onOpen = vi.fn();
    renderTree({
      onOpen,
      actions: (node) => <button type="button">{`تعديل ${node.code}`}</button>,
    });
    const button = screen.getByRole('button', { name: 'تعديل 111001' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('columnheader', { name: 'الإجراءات' })).toBeTruthy();
  });
});
