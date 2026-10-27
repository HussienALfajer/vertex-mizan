'use client';

import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { SearchIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { cn } from '../lib/cn';
import { matchesCommand } from '../lib/command-search';
import { keymap } from '../lib/keymap';
import { dialogMotion, overlayMotion } from '../lib/motion';
import { ariaKeyShortcuts, detectPlatform, type Platform, type Shortcut } from '../lib/shortcuts';
import { useShortcut } from '../lib/use-shortcut';
import { Button } from './button';
import { Kbd } from './kbd';

/** One command: an action or a place to go. Its text comes from i18n in the app. */
export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  /** The group it is listed under (navigation, entries, reports…). */
  readonly group: string;
  /** Other words it is found by: an English name, a code, a synonym. */
  readonly keywords?: readonly string[];
  /** Its keymap shortcut, shown beside it; the app binds the shortcut itself. */
  readonly shortcut?: Shortcut;
  readonly icon?: ReactNode;
  readonly run: () => void;
}

/** The palette's labels, from i18n `commandPalette`. */
export interface CommandPaletteLabels {
  readonly title: string;
  readonly open: string;
  readonly search: string;
  readonly placeholder: string;
  readonly empty: string;
  readonly hint: string;
  readonly close: string;
}

interface CommandGroup {
  readonly value: string;
  readonly items: readonly PaletteCommand[];
}

/** Commands under their groups, each group where its first command is. */
function groupCommands(commands: readonly PaletteCommand[]): CommandGroup[] {
  const groups = new Map<string, PaletteCommand[]>();
  for (const command of commands) {
    const items = groups.get(command.group) ?? [];
    items.push(command);
    groups.set(command.group, items);
  }
  return [...groups].map(([value, items]) => ({ value, items }));
}

type CommandPaletteProps = {
  commands: readonly PaletteCommand[];
  labels: CommandPaletteLabels;
  /** Fixed in tests and previews; detected from the browser otherwise. */
  platform?: Platform;
  className?: string;
};

/**
 * The command palette (ADR 0010 §4): Ctrl/⌘+K anywhere, or its visible button, opens a dialog
 * whose input filters the commands (the WAI-ARIA combobox pattern: focus stays in the input, the
 * highlighted command is its active descendant). Enter or a click runs a command and closes the
 * palette; Escape closes it. Search ignores Arabic diacritics and hamza forms
 * (`matchesCommand`).
 */
function CommandPalette({
  commands,
  labels,
  platform = detectPlatform(),
  className,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const hintId = useId();
  useShortcut(keymap.commandPalette, () => setOpen((current) => !current));
  const groups = groupCommands(commands);

  function run(command: PaletteCommand) {
    setOpen(false);
    command.run();
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={<Button variant="outline" size="sm" className={cn('gap-2', className)} />}
        aria-keyshortcuts={ariaKeyShortcuts(keymap.commandPalette, platform)}
        data-slot="command-palette-trigger"
      >
        <SearchIcon aria-hidden="true" />
        {/* On phones only the icon shows, leaving the top bar to the page; no keyboard, no keys. */}
        <span className="max-sm:sr-only">{labels.open}</span>
        <Kbd shortcut={keymap.commandPalette} platform={platform} className="max-sm:hidden" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className={cn('fixed inset-0 z-50 bg-overlay', overlayMotion)} />
        <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-start justify-center overflow-hidden px-4 pt-[12vh] pb-4">
          <DialogPrimitive.Popup
            data-slot="command-palette"
            aria-label={labels.title}
            className={cn(
              'flex max-h-[min(36rem,calc(100dvh-4rem))] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface text-surface-foreground shadow-float outline-none',
              dialogMotion,
            )}
          >
            <Autocomplete.Root
              open
              inline
              items={groups}
              filter={(command: PaletteCommand, query: string) => matchesCommand(command, query)}
              itemToStringValue={(command: PaletteCommand) => command.label}
              autoHighlight="always"
              keepHighlight
            >
              <div className="flex items-center gap-2 border-b border-border px-cell">
                <SearchIcon
                  aria-hidden="true"
                  className="size-icon shrink-0 text-muted-foreground"
                />
                <Autocomplete.Input
                  data-slot="command-palette-input"
                  aria-label={labels.search}
                  aria-describedby={hintId}
                  placeholder={labels.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-control w-full min-w-0 bg-transparent text-control text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
              <DialogPrimitive.Close className="sr-only">{labels.close}</DialogPrimitive.Close>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-py-1">
                <Autocomplete.Empty>
                  <p className="px-cell py-6 text-center text-muted-foreground">{labels.empty}</p>
                </Autocomplete.Empty>
                <Autocomplete.List data-slot="command-palette-list" className="py-1">
                  {(group: CommandGroup) => (
                    <Autocomplete.Group
                      key={group.value}
                      items={group.items}
                      className="not-last:mb-1"
                    >
                      <Autocomplete.GroupLabel className="flex h-row items-center px-cell text-xs font-medium text-muted-foreground select-none">
                        {group.value}
                      </Autocomplete.GroupLabel>
                      <Autocomplete.Collection>
                        {(command: PaletteCommand) => (
                          <Autocomplete.Item
                            key={command.id}
                            value={command}
                            data-slot="command-palette-item"
                            onClick={() => run(command)}
                            className="mx-1 flex min-h-row cursor-default items-center gap-2 rounded-md px-cell outline-none select-none data-highlighted:bg-selection [&_svg]:size-icon [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
                          >
                            {command.icon}
                            <span className="min-w-0 flex-1 truncate">{command.label}</span>
                            {command.shortcut && (
                              <Kbd shortcut={command.shortcut} platform={platform} />
                            )}
                          </Autocomplete.Item>
                        )}
                      </Autocomplete.Collection>
                    </Autocomplete.Group>
                  )}
                </Autocomplete.List>
              </div>
              <p
                id={hintId}
                className="border-t border-border bg-muted px-cell py-1 text-xs text-muted-foreground"
              >
                {labels.hint}
              </p>
            </Autocomplete.Root>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { CommandPalette, type CommandPaletteProps };
