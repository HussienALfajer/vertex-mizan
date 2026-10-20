import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { type Platform, type Shortcut, shortcutKeys } from '../lib/shortcuts';

type KbdProps = Omit<ComponentProps<'kbd'>, 'children'> & {
  shortcut: Shortcut;
  /** Fixed in tests and previews; detected from the browser otherwise. */
  platform?: Platform;
};

/** A shortcut's keys as small chips, in the platform's names (ADR 0010 §4). Left to right. */
function Kbd({ shortcut, platform, className, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      dir="ltr"
      className={cn('inline-flex items-center gap-0.5 font-sans', className)}
      {...props}
    >
      {shortcutKeys(shortcut, platform).map((key) => (
        <kbd
          key={key}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-muted px-1 text-xs font-medium text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </kbd>
  );
}

export { Kbd, type KbdProps };
