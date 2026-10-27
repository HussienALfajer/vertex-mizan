import { describe, expect, it } from 'vitest';
import { type AccountTreeNode, accountTreeRows, allAccountParents } from './account-tree-rows';

const node = (id: string, parentId: string | null, kind: 'header' | 'postable' = 'header') =>
  ({ id, parentId, code: id, name: `حساب ${id}`, kind }) satisfies AccountTreeNode;

// Given out of order on purpose: the tree orders siblings by code.
const chart = [
  node('2', null),
  node('11', '1'),
  node('1', null),
  node('112', '11'),
  node('111', '11'),
  node('111002', '111', 'postable'),
  node('111001', '111', 'postable'),
  node('21', '2'),
];

const codes = (rows: { node: AccountTreeNode }[]) => rows.map((row) => row.node.code);

describe('accountTreeRows', () => {
  it('lists every account under its parent, siblings by code, when every branch is open', () => {
    const rows = accountTreeRows(chart, allAccountParents(chart));
    expect(codes(rows)).toEqual(['1', '11', '111', '111001', '111002', '112', '2', '21']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3, 3, 2, 0, 1]);
    expect(rows.find((row) => row.node.code === '111')).toMatchObject({
      hasChildren: true,
      expanded: true,
    });
    expect(rows.find((row) => row.node.code === '112')).toMatchObject({
      hasChildren: false,
      expanded: false,
    });
  });

  it('hides the accounts of a closed branch', () => {
    const open = allAccountParents(chart);
    open.delete('11');
    expect(codes(accountTreeRows(chart, open))).toEqual(['1', '11', '2', '21']);
    expect(codes(accountTreeRows(chart, new Set()))).toEqual(['1', '2']);
  });

  it('shows the matches with their ancestors, open, whatever was closed', () => {
    const rows = accountTreeRows(chart, new Set(), (account) => account.code === '111002');
    expect(codes(rows)).toEqual(['1', '11', '111', '111002']);
    expect(rows.slice(0, 3).every((row) => row.expanded)).toBe(true);
    expect(accountTreeRows(chart, new Set(), () => false)).toEqual([]);
  });

  it('makes an account whose parent is missing a root', () => {
    const rows = accountTreeRows(
      [node('111', '11'), node('111001', '111', 'postable')],
      new Set(['111']),
    );
    expect(codes(rows)).toEqual(['111', '111001']);
    expect(rows[0]?.depth).toBe(0);
  });
});
