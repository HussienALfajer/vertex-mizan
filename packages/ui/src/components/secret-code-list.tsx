import { CheckIcon, CopyIcon, PrinterIcon } from 'lucide-react';
import { type ComponentProps, useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';

type SecretCodeListProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** The codes, shown once and in this order (backup codes, an authenticator secret). */
  codes: readonly string[];
  /** Accessible name of the list. */
  label: string;
  copyLabel: string;
  /** Shown on the copy button for a moment after a copy. */
  copiedLabel: string;
  /** With a print label, a print button prints the codes as a plain list under `label`. */
  printLabel?: string | undefined;
  columns?: 1 | 2;
};

const copiedFor = 2000;

/**
 * Codes a person must keep (backup codes, a two-factor secret): LTR with tabular figures, with a
 * button that copies them one per line and, optionally, one that prints them as a plain list.
 */
function SecretCodeList({
  codes,
  label,
  copyLabel,
  copiedLabel,
  printLabel,
  columns = 2,
  className,
  ...props
}: SecretCodeListProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), copiedFor);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
  }

  return (
    <div data-slot="secret-code-list" className={cn('flex flex-col gap-3', className)} {...props}>
      <ul
        aria-label={label}
        dir="ltr"
        className={cn(
          'grid gap-x-6 gap-y-1 rounded-md border border-border bg-muted px-4 py-3 text-control font-medium text-foreground',
          columns === 2 && 'grid-cols-2',
        )}
      >
        {codes.map((code) => (
          <li key={code} className="break-all tabular-nums">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
        </Button>
        {printLabel && (
          <Button type="button" variant="secondary" onClick={() => printCodes(label, codes)}>
            <PrinterIcon />
            {printLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Prints the codes as a plain list from a hidden frame, so the page around them is not printed. */
function printCodes(title: string, codes: readonly string[]) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'sr-only';
  document.body.append(frame);
  const page = frame.contentDocument;
  const view = frame.contentWindow;
  if (!page || !view) {
    frame.remove();
    return;
  }
  const heading = page.createElement('h1');
  heading.textContent = title;
  const list = page.createElement('pre');
  list.textContent = codes.join('\n');
  page.body.append(heading, list);
  view.addEventListener('afterprint', () => frame.remove(), { once: true });
  view.focus();
  view.print();
}

export { SecretCodeList, type SecretCodeListProps };
