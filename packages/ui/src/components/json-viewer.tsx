import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react';
import { type ComponentProps, useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { IconButton } from './icon-button';

/** The viewer's labels, from the app's i18n. */
export interface JsonViewerLabels {
  /** The copy button's name ("نسخ JSON"). */
  readonly copy: string;
  /** Shown on the copy button for a moment after a copy. */
  readonly copied: string;
  /** A branch's button when open ("طيّ") and when closed ("فتح"). */
  readonly collapse: string;
  readonly expand: string;
}

type JsonViewerProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** A JSON value as parsed (an event's payload); no `bigint` or `undefined` inside. */
  value: unknown;
  labels: JsonViewerLabels;
  /** Branches deeper than this start closed; the root is always open. */
  openDepth?: number;
};

const copiedFor = 2000;

const punctuation = 'text-muted-foreground';

function Scalar({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    return <span className="break-all text-foreground">{JSON.stringify(value)}</span>;
  }
  return <span className="font-medium text-foreground">{JSON.stringify(value) ?? 'null'}</span>;
}

function Key({ name }: { name: string | number | null }) {
  if (name === null || typeof name === 'number') return null;
  return (
    <>
      <span className="text-muted-foreground">{JSON.stringify(name)}</span>
      <span className={punctuation}>: </span>
    </>
  );
}

function Branch({
  name,
  value,
  depth,
  openDepth,
  labels,
  last,
}: {
  name: string | number | null;
  value: unknown;
  depth: number;
  openDepth: number;
  labels: JsonViewerLabels;
  last: boolean;
}) {
  const [open, setOpen] = useState(depth < openDepth);
  const comma = last ? null : <span className={punctuation}>,</span>;
  if (value === null || typeof value !== 'object') {
    return (
      <li className="ps-hit">
        <Key name={name} />
        <Scalar value={value} />
        {comma}
      </li>
    );
  }
  const array = Array.isArray(value);
  const children: [string | number, unknown][] = array
    ? value.map((item, index) => [index, item])
    : Object.entries(value as Record<string, unknown>);
  const [start, end] = array ? ['[', ']'] : ['{', '}'];
  if (children.length === 0) {
    return (
      <li className="ps-hit">
        <Key name={name} />
        <span className={punctuation}>{`${start}${end}`}</span>
        {comma}
      </li>
    );
  }
  return (
    <li data-open={open || undefined}>
      <span className="flex items-start">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? labels.collapse : labels.expand}${typeof name === 'string' ? ` ${name}` : ''}`}
          onClick={() => setOpen((was) => !was)}
          className="flex size-hit shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              'size-icon transition-transform duration-150 ease-out motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
        </button>
        <span className="min-w-0 py-0.5">
          <Key name={name} />
          <span className={punctuation}>{start}</span>
          {!open && (
            <>
              <span className={punctuation}>{` … ${children.length} `}</span>
              <span className={punctuation}>{end}</span>
              {comma}
            </>
          )}
        </span>
      </span>
      {open && (
        <>
          <ul className="ms-3 border-border border-s ps-1">
            {children.map(([key, child], index) => (
              <Branch
                key={key}
                name={key}
                value={child}
                depth={depth + 1}
                openDepth={openDepth}
                labels={labels}
                last={index === children.length - 1}
              />
            ))}
          </ul>
          <span className="block ps-hit">
            <span className={punctuation}>{end}</span>
            {comma}
          </span>
        </>
      )}
    </li>
  );
}

/**
 * A JSON document as received (S05 "Screens": an event's raw payload, ADR 0010 §7): LTR, its
 * branches opened and closed by their buttons (`aria-expanded`), and a button that copies the
 * whole document, indented by two spaces, from its bar above the document. The brand has no monospace face (brand/identity.md §8),
 * so tabular figures keep the digits in step, as in `Digest`. It scrolls inside its own box.
 */
function JsonViewer({ value, labels, openDepth = 2, className, ...props }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), copiedFor);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div
      data-slot="json-viewer"
      className={cn('flex min-w-0 flex-col rounded-md border border-border bg-muted', className)}
      {...props}
    >
      <div className="flex justify-end border-border border-b p-1">
        <IconButton
          label={copied ? labels.copied : labels.copy}
          onClick={async () => {
            await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
            setCopied(true);
          }}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        </IconButton>
      </div>
      <div dir="ltr" className="overflow-x-auto p-cell text-start text-control tabular-nums">
        <ul>
          <Branch
            name={null}
            value={value}
            depth={0}
            openDepth={Math.max(openDepth, 1)}
            labels={labels}
            last
          />
        </ul>
      </div>
    </div>
  );
}

export { JsonViewer, type JsonViewerProps };
