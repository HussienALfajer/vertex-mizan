'use client';

import { useDirection } from '@base-ui/react/direction-provider';
import { ArchiveIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Badge } from '../components/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table';
import { cn } from '../lib/cn';
import { AccountLabel } from './account-label';
import {
  type AccountTreeNode,
  type AccountTreeRow,
  accountTreeRows,
  allAccountParents,
} from './account-tree-rows';

/** A column after the account: its header and its cell for an account. */
export interface AccountTreeColumn<Node extends AccountTreeNode> {
  readonly id: string;
  readonly header: ReactNode;
  readonly cell: (node: Node) => ReactNode;
  /** Hidden below this width, so the code and the name keep the phone's row. */
  readonly hideBelow?: 'sm' | 'md' | 'lg';
}

/** The tree's labels, from the app's i18n. */
export interface AccountTreeLabels {
  /** The table's accessible name. */
  readonly label: string;
  readonly account: string;
  readonly header: string;
  readonly blocked: string;
  readonly archived: string;
  readonly expand: string;
  readonly collapse: string;
  readonly actions: string;
}

type AccountTreeProps<Node extends AccountTreeNode> = Omit<ComponentProps<'table'>, 'children'> & {
  nodes: readonly Node[];
  columns?: readonly AccountTreeColumn<Node>[];
  labels: AccountTreeLabels;
  /** Shows the matching accounts with their ancestors, expanded; every account without it. */
  match?: ((node: Node) => boolean) | undefined;
  /** The row's last cell: a menu of what can be done to the account. */
  actions?: ((node: Node) => ReactNode) | undefined;
  /** Enter on a row, or a double click: open the account. */
  onOpen?: ((node: Node) => void) | undefined;
};

// Static classes, so the styles exist: one indent step per level (four levels, ADR 0011).
const indents = ['ps-0', 'ps-5', 'ps-10', 'ps-15'] as const;
const hidden = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden' } as const;

/**
 * The chart of accounts as accountants read it (S02, ADR 0010 §7): a WAI-ARIA tree grid of
 * headers and their accounts, ordered by code, each row indented by level with its code first
 * (`AccountLabel`), blocked and archived accounts marked with an icon and text. A row is focused
 * as a whole (roving tabindex): the up and down arrows move, Home and End go to the first and last
 * row, the inline arrows (visual, so the left arrow opens in Arabic) open, close or step into and
 * out of a branch, Enter opens the account. Every branch starts open; with `match`, the matches
 * show inside their open branches.
 */
function AccountTree<Node extends AccountTreeNode>({
  nodes,
  columns = [],
  labels,
  match,
  actions,
  onOpen,
  className,
  ...props
}: AccountTreeProps<Node>) {
  const direction = useDirection();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => allAccountParents(nodes));
  // A parent that arrives later (a new child) opens; one the person closed stays closed.
  const known = useRef<ReadonlySet<string>>(new Set(expanded));
  const parents = allAccountParents(nodes);
  const added = [...parents].filter((id) => !known.current.has(id));
  if (added.length > 0) {
    known.current = new Set([...known.current, ...added]);
    setExpanded(new Set([...expanded, ...added]));
  }
  const rows = useMemo(() => accountTreeRows(nodes, expanded, match), [nodes, expanded, match]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = rows.some((row) => row.node.id === activeId)
    ? activeId
    : (rows[0]?.node.id ?? null);
  const body = useRef<HTMLTableSectionElement>(null);

  function toggle(id: string, open: boolean) {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function focusRow(id: string) {
    setActiveId(id);
    body.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: AccountTreeRow<Node>) {
    // Keys pressed inside a row's buttons and menus are theirs.
    if (event.target !== event.currentTarget) return;
    const index = rows.indexOf(row);
    const inward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const outward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let target: AccountTreeRow<Node> | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = rows[index + 1];
        break;
      case 'ArrowUp':
        target = rows[index - 1];
        break;
      case 'Home':
        target = rows[0];
        break;
      case 'End':
        target = rows.at(-1);
        break;
      case inward:
        if (row.hasChildren && !row.expanded && !match) toggle(row.node.id, true);
        else if (row.expanded) target = rows[index + 1];
        break;
      case outward:
        if (row.expanded && !match) toggle(row.node.id, false);
        else target = rows.find((other) => other.node.id === row.node.parentId);
        break;
      case 'Enter':
        if (!onOpen) return;
        onOpen(row.node);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target) focusRow(target.node.id);
  }

  const Closed = direction === 'rtl' ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <Table
      role="treegrid"
      aria-label={labels.label}
      data-slot="account-tree"
      className={className}
      {...props}
    >
      <TableHeader>
        <TableRow>
          <TableHead>{labels.account}</TableHead>
          {columns.map((column) => (
            <TableHead key={column.id} className={column.hideBelow && hidden[column.hideBelow]}>
              {column.header}
            </TableHead>
          ))}
          {actions && (
            <TableHead>
              <span className="sr-only">{labels.actions}</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody ref={body}>
        {rows.map((row) => {
          const { node } = row;
          return (
            <TableRow
              key={node.id}
              data-row-id={node.id}
              data-archived={node.archived || undefined}
              aria-level={row.depth + 1}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              tabIndex={node.id === active ? 0 : -1}
              onFocus={(event) => {
                if (event.target === event.currentTarget) setActiveId(node.id);
              }}
              onKeyDown={(event) => onKeyDown(event, row)}
              onDoubleClick={onOpen && (() => onOpen(node))}
              className={cn(
                'outline-none focus-visible:bg-selection',
                node.archived && 'text-muted-foreground',
              )}
            >
              <TableCell className="max-w-0 min-w-56 w-full">
                <span
                  className={cn('flex min-w-0 items-center gap-1', indents[Math.min(row.depth, 3)])}
                >
                  {row.hasChildren && !match ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`${row.expanded ? labels.collapse : labels.expand}: ${node.code}`}
                      onClick={() => toggle(node.id, !row.expanded)}
                      className="inline-flex size-hit shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                    >
                      {row.expanded ? (
                        <ChevronDownIcon aria-hidden="true" />
                      ) : (
                        <Closed aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <span aria-hidden="true" className="size-hit shrink-0" />
                  )}
                  {node.kind === 'header' ? (
                    <AccountLabel
                      code={node.code}
                      name={node.name}
                      kind="header"
                      kindLabel={labels.header}
                    />
                  ) : node.blocked ? (
                    <AccountLabel
                      code={node.code}
                      name={node.name}
                      kind="blocked"
                      kindLabel={labels.blocked}
                    />
                  ) : (
                    <AccountLabel code={node.code} name={node.name} />
                  )}
                  {node.archived && (
                    <Badge tone="outline" className="ms-1">
                      <ArchiveIcon aria-hidden="true" />
                      {labels.archived}
                    </Badge>
                  )}
                </span>
              </TableCell>
              {columns.map((column) => (
                <TableCell key={column.id} className={column.hideBelow && hidden[column.hideBelow]}>
                  {column.cell(node)}
                </TableCell>
              ))}
              {actions && <TableCell className="text-end">{actions(node)}</TableCell>}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export {
  AccountTree,
  type AccountTreeNode,
  type AccountTreeProps,
  type AccountTreeRow,
  accountTreeRows,
  allAccountParents,
};
