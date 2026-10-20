'use client';

import { useEffect, useRef } from 'react';
import { matchesShortcut, type Shortcut } from './shortcuts';

/**
 * Runs `handler` when the shortcut is pressed anywhere on the page (a global key such as the
 * command palette's). A component shortcut (`scope: 'component'`) is refused: its component
 * handles it in its own `onKeyDown`, so it never acts outside that component.
 */
export function useShortcut(
  shortcut: Shortcut,
  handler: (event: KeyboardEvent) => void,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  if (shortcut.scope === 'component') {
    throw new Error(`"${shortcut.key}" is a component shortcut: handle it in its component`);
  }
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesShortcut(event, shortcut)) return;
      event.preventDefault();
      latest.current(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shortcut, enabled]);
}
