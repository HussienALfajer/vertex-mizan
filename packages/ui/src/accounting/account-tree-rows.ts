/** An account as the tree needs it: its place in the chart and its marks. */
export interface AccountTreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly code: string;
  readonly name: string;
  readonly kind: 'header' | 'postable';
  readonly blocked?: boolean;
  readonly archived?: boolean;
}

/** A row of the tree as shown: the account, its depth from the roots and whether it has children. */
export interface AccountTreeRow<Node extends AccountTreeNode> {
  readonly node: Node;
  /** 0 for a root; the tree indents by it. */
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

/**
 * The rows the tree shows, in reading order: each account under its parent, siblings by code.
 * Without `match`, a row shows when every ancestor is expanded. With `match`, the matching
 * accounts show with every ancestor, expanded, so a found account is never hidden in a closed
 * branch. An account whose parent is not among the nodes is a root.
 */
export function accountTreeRows<Node extends AccountTreeNode>(
  nodes: readonly Node[],
  expanded: ReadonlySet<string>,
  match?: (node: Node) => boolean,
): AccountTreeRow<Node>[] {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, Node[]>();
  for (const node of nodes) {
    const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(node);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }

  // With a filter: the matches and their ancestors, the ancestors open.
  let shown: Set<string> | undefined;
  if (match) {
    shown = new Set();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      if (!match(node)) continue;
      let current: Node | undefined = node;
      while (current && !shown.has(current.id)) {
        shown.add(current.id);
        current = current.parentId === null ? undefined : byId.get(current.parentId);
      }
    }
  }

  const rows: AccountTreeRow<Node>[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      if (shown && !shown.has(node.id)) continue;
      const kids = (children.get(node.id) ?? []).filter((kid) => !shown || shown.has(kid.id));
      const open = shown ? kids.length > 0 : expanded.has(node.id);
      rows.push({ node, depth, hasChildren: kids.length > 0, expanded: open });
      if (open) visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

/** The ids of every account with children: the tree fully expanded. */
export function allAccountParents(nodes: readonly AccountTreeNode[]): Set<string> {
  const ids = new Set(nodes.map((node) => node.id));
  return new Set(
    nodes.flatMap((node) =>
      node.parentId !== null && ids.has(node.parentId) ? [node.parentId] : [],
    ),
  );
}
