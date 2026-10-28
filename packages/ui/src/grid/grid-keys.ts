import { keymap } from '../lib/keymap';
import { detectPlatform, matchesShortcut, type Platform } from '../lib/shortcuts';
import type { GridMove } from './selection';

/*
 * The keys of a grid in navigation mode (ADR 0010 §4), as commands the grid applies. Arrows move
 * visually, as APG describes them: Left is the next column in RTL and the previous one in LTR.
 * Editing mode (typing, Enter, Escape while a cell is edited) belongs to the cell's editor.
 */

export type GridCommand =
  | { readonly type: 'move'; readonly move: GridMove; readonly extend: boolean }
  | { readonly type: 'selectAll' }
  | { readonly type: 'selectRows' }
  | { readonly type: 'selectColumns' }
  | { readonly type: 'edit' }
  | { readonly type: 'clear' }
  | { readonly type: 'fillDown' };

/**
 * Where Enter goes: `down` the column as in a spreadsheet, or to the `next` cell in reading order
 * as on an entry screen, where a line is typed from its account to its memo (S03).
 */
export type EnterMove = 'down' | 'next';

/** The move of Enter, or of Shift+Enter (`back`). */
export function enterMove(enterMoves: EnterMove, back: boolean): GridMove {
  if (enterMoves === 'next') return back ? 'previous' : 'next';
  return back ? 'up' : 'down';
}

/** The keyboard event fields a command reads. */
type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

const VERTICAL: Record<string, GridMove> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
};

/**
 * The command for a key, or `undefined` when the grid leaves the key alone (the browser's, an
 * entry grid's own keys, Ctrl+arrows). `direction` is the grid's text direction.
 */
export function gridCommand(
  event: KeyEvent,
  direction: 'rtl' | 'ltr',
  platform: Platform = detectPlatform(),
  { enterMoves = 'down' }: { enterMoves?: EnterMove } = {},
): GridCommand | undefined {
  for (const [type, shortcut] of [
    ['selectAll', keymap.selectAll],
    ['selectRows', keymap.selectRows],
    ['selectColumns', keymap.selectColumns],
    ['edit', keymap.editCell],
    ['fillDown', keymap.fillDown],
  ] as const) {
    if (matchesShortcut(event, shortcut, platform)) return { type };
  }
  const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const other = platform === 'mac' ? event.ctrlKey : event.metaKey;
  if (event.altKey || other) return undefined;
  const extend = event.shiftKey;
  if (event.key === 'Tab' && !mod) {
    return { type: 'move', move: event.shiftKey ? 'previous' : 'next', extend: false };
  }
  if (event.key === 'Delete' && !mod && !extend) return { type: 'clear' };
  if (event.key === 'Home') return { type: 'move', move: mod ? 'gridStart' : 'rowStart', extend };
  if (event.key === 'End') return { type: 'move', move: mod ? 'gridEnd' : 'rowEnd', extend };
  if (mod) return undefined;
  // Enter moves down and Shift+Enter up, as in a spreadsheet, or along the line in an entry grid;
  // F2 or typing edits.
  if (event.key === 'Enter')
    return { type: 'move', move: enterMove(enterMoves, extend), extend: false };
  const vertical = VERTICAL[event.key];
  if (vertical) return { type: 'move', move: vertical, extend };
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const towardsEnd = (event.key === 'ArrowLeft') === (direction === 'rtl');
    return { type: 'move', move: towardsEnd ? 'forward' : 'backward', extend };
  }
  return undefined;
}
