import { CheckIcon, CopyIcon, TriangleAlertIcon } from 'lucide-react';
import { type ComponentProps, useEffect, useId, useState } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Callout } from './callout';
import { Checkbox } from './checkbox';

type SecretRevealProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** The secret, shown this once (an API key). */
  secret: string;
  /** Accessible name of the secret. */
  label: string;
  /** The warning above it: the secret is never shown again. */
  warning: string;
  copyLabel: string;
  /** Shown on the copy button for a moment after a copy. */
  copiedLabel: string;
  /** The confirmation the person ticks once the secret is kept. */
  confirmLabel: string;
  doneLabel: string;
  /** Called by the done button, enabled only once the confirmation is ticked. */
  onDone: () => void;
};

const copiedFor = 2000;

/**
 * A secret shown once (S05: an API key): the warning that it is never shown again, the secret
 * LTR and selectable whole, a copy button, and a done button enabled only after the person
 * confirms they kept it.
 */
function SecretReveal({
  secret,
  label,
  warning,
  copyLabel,
  copiedLabel,
  confirmLabel,
  doneLabel,
  onDone,
  className,
  ...props
}: SecretRevealProps) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const labelId = useId();
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), copiedFor);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
  }

  return (
    <div data-slot="secret-reveal" className={cn('flex flex-col gap-4', className)} {...props}>
      <Callout tone="warning" icon={<TriangleAlertIcon />} title={warning} />
      <div className="flex flex-col gap-1.5">
        <span id={labelId} className="text-control font-medium text-foreground">
          {label}
        </span>
        <output
          aria-labelledby={labelId}
          dir="ltr"
          className="block select-all break-all rounded-md border border-border bg-muted px-4 py-3 text-control font-medium text-foreground tabular-nums"
        >
          {secret}
        </output>
      </div>
      <Button type="button" variant="secondary" className="w-fit" onClick={copy}>
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
      </Button>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox is the control. */}
      <label className="flex items-center gap-3 text-control text-foreground">
        <Checkbox checked={saved} onCheckedChange={setSaved} />
        {confirmLabel}
      </label>
      <Button type="button" className="w-fit" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}

export { SecretReveal, type SecretRevealProps };
