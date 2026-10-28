import { defineShortcut } from './shortcuts';

/*
 * The keyboard map of ADR 0010 §4, defined once: components bind these, tooltips and the cheat
 * sheet show them, and their names are in i18n (`shortcuts`). The entry keys are S03's: Ctrl+Enter
 * adds a line, Ctrl+Shift+Enter posts or submits, Ctrl+S saves the draft.
 */
export const keymap = {
  /** Global: anywhere on the page. */
  commandPalette: defineShortcut({ key: 'k', mod: true }),
  cheatSheet: defineShortcut({ key: '/', mod: true }),
  newEntry: defineShortcut({ key: 'n', alt: true }),
  /** Grids, while focused. */
  editCell: defineShortcut({ key: 'F2', scope: 'component' }),
  selectAll: defineShortcut({ key: 'a', mod: true, scope: 'component' }),
  selectRows: defineShortcut({ key: ' ', shift: true, scope: 'component' }),
  // Ctrl+Space on every platform: ⌘Space is Spotlight on macOS.
  selectColumns: defineShortcut({ key: ' ', ctrl: true, scope: 'component' }),
  fillDown: defineShortcut({ key: 'd', mod: true, scope: 'component' }),
  copyAbove: defineShortcut({ key: 'F8', scope: 'component' }),
  insertLine: defineShortcut({ key: 'Insert', mod: true, scope: 'component' }),
  deleteLine: defineShortcut({ key: 'Delete', mod: true, scope: 'component' }),
  lookup: defineShortcut({ key: 'ArrowDown', alt: true, scope: 'component' }),
  addLine: defineShortcut({ key: 'Enter', mod: true, scope: 'component' }),
  post: defineShortcut({ key: 'Enter', mod: true, shift: true, scope: 'component' }),
  /** Entry screens, anywhere in the entry: Ctrl+S is the browser's elsewhere. */
  save: defineShortcut({ key: 's', mod: true, scope: 'component' }),
  /** Date fields, while focused. */
  today: defineShortcut({ key: 't', scope: 'component' }),
} as const;

export type KeymapAction = keyof typeof keymap;
