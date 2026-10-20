import { defineShortcut } from './shortcuts';

/*
 * The keyboard map of ADR 0010 §4, defined once: components bind these, tooltips and the cheat
 * sheet show them, and their names are in i18n (`shortcuts`). Entry keys are confirmed with S03.
 */
export const keymap = {
  /** Global: anywhere on the page. */
  commandPalette: defineShortcut({ key: 'k', mod: true }),
  cheatSheet: defineShortcut({ key: '/', mod: true }),
  newEntry: defineShortcut({ key: 'n', alt: true }),
  /** Grids, while focused. */
  editCell: defineShortcut({ key: 'F2', scope: 'component' }),
  fillDown: defineShortcut({ key: 'd', mod: true, scope: 'component' }),
  copyAbove: defineShortcut({ key: 'F8', scope: 'component' }),
  insertLine: defineShortcut({ key: 'Insert', mod: true, scope: 'component' }),
  deleteLine: defineShortcut({ key: 'Delete', mod: true, scope: 'component' }),
  lookup: defineShortcut({ key: 'ArrowDown', alt: true, scope: 'component' }),
  post: defineShortcut({ key: 'Enter', mod: true, scope: 'component' }),
  /** Date fields, while focused. */
  today: defineShortcut({ key: 't', scope: 'component' }),
} as const;

export type KeymapAction = keyof typeof keymap;
