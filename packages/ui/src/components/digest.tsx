import { CheckIcon, CopyIcon } from 'lucide-react';
import { type ComponentProps, useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { IconButton } from './icon-button';

type DigestProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The digest in lowercase hex (an entry's hash, a chain head, a file's SHA-256). */
  value: string;
  /** What the digest is, for the copy button's name ("copy the hash"). */
  copyLabel: string;
  /** Shown on the copy button for a moment after a copy. */
  copiedLabel: string;
  /** How many leading characters are shown; the whole digest is copied and read out. */
  length?: number;
};

const copiedFor = 2000;

/**
 * A digest as accountants check it (S03 rule 18): its first characters, LTR with tabular figures,
 * and a button that copies the whole value. The brand has no monospace face (brand/identity.md
 * §8), so tabular figures keep the characters in step. Screen readers hear the whole digest.
 */
function Digest({ value, copyLabel, copiedLabel, length = 12, className, ...props }: DigestProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), copiedFor);
    return () => clearTimeout(timer);
  }, [copied]);
  const shown = value.length > length ? `${value.slice(0, length)}…` : value;
  return (
    <span data-slot="digest" className={cn('inline-flex items-center gap-1', className)} {...props}>
      <bdi dir="ltr" className="tabular-nums">
        <span aria-hidden="true">{shown}</span>
        <span className="sr-only">{value}</span>
      </bdi>
      <IconButton
        label={copied ? copiedLabel : copyLabel}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </IconButton>
    </span>
  );
}

export { Digest, type DigestProps };
