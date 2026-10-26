import { describe, expect, it } from 'vitest';
import { ariaKeyShortcuts, defineShortcut, matchesShortcut, shortcutKeys } from './shortcuts';

const press = (init: Partial<KeyboardEvent> & { key: string; code: string }) => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

const palette = defineShortcut({ key: 'K', mod: true });

describe('defineShortcut', () => {
  it('refuses a page-wide key without Ctrl/⌘ or Alt, Escape aside (WCAG 2.1.4)', () => {
    for (const key of ['?', 't', 'Enter', 'Delete', 'Backspace', 'ArrowDown', 'F8']) {
      expect(() => defineShortcut({ key }), key).toThrow(/Ctrl\/⌘ or Alt/);
      expect(() => defineShortcut({ key, shift: true }), key).toThrow(/Ctrl\/⌘ or Alt/);
    }
    expect(defineShortcut({ key: 'Escape' })).toEqual({ key: 'Escape' });
    expect(defineShortcut({ key: 'F8', scope: 'component' }).key).toBe('F8');
  });

  it('refuses the keys the browser keeps with Ctrl/⌘, and its features outside a component', () => {
    for (const key of ['n', 't', 'w', 'q']) {
      expect(() => defineShortcut({ key, mod: true, scope: 'component' }), key).toThrow(/browser/);
    }
    for (const key of ['l', 'd', 'f', 'p', 's']) {
      expect(() => defineShortcut({ key, mod: true }), key).toThrow(/outside a component/);
    }
    expect(defineShortcut({ key: 'n', alt: true })).toEqual({ key: 'n', alt: true });
  });

  it('refuses ⌘Space, which macOS keeps, and a shortcut naming both mod and ctrl', () => {
    expect(() => defineShortcut({ key: ' ', mod: true, scope: 'component' })).toThrow(/Spotlight/);
    expect(() => defineShortcut({ key: 'k', mod: true, ctrl: true })).toThrow(/both/);
  });

  it('allows a focused component its spreadsheet keys and its unmodified keys', () => {
    expect(defineShortcut({ key: 'D', mod: true, scope: 'component' }).key).toBe('d');
    expect(defineShortcut({ key: 't', scope: 'component' })).toEqual({
      key: 't',
      scope: 'component',
    });
  });
});

describe('matchesShortcut', () => {
  it('matches Ctrl on Windows and ⌘ on macOS, modifiers exactly', () => {
    expect(
      matchesShortcut(press({ key: 'k', code: 'KeyK', ctrlKey: true }), palette, 'other'),
    ).toBe(true);
    expect(matchesShortcut(press({ key: 'k', code: 'KeyK', metaKey: true }), palette, 'mac')).toBe(
      true,
    );
    expect(
      matchesShortcut(press({ key: 'k', code: 'KeyK', metaKey: true }), palette, 'other'),
    ).toBe(false);
    expect(
      matchesShortcut(
        press({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true }),
        palette,
        'other',
      ),
    ).toBe(false);
    expect(matchesShortcut(press({ key: 'k', code: 'KeyK' }), palette, 'other')).toBe(false);
  });

  it('works while an Arabic layout is active, through the physical key', () => {
    // Ctrl+K on an Arabic layout types "ن".
    expect(
      matchesShortcut(press({ key: 'ن', code: 'KeyK', ctrlKey: true }), palette, 'other'),
    ).toBe(true);
    const cheatSheet = defineShortcut({ key: '/', mod: true });
    expect(
      matchesShortcut(press({ key: 'ظ', code: 'Slash', ctrlKey: true }), cheatSheet, 'other'),
    ).toBe(true);
  });

  it('matches Option shortcuts on macOS, where Option makes a dead key', () => {
    const newEntry = defineShortcut({ key: 'n', alt: true });
    expect(
      matchesShortcut(press({ key: 'Dead', code: 'KeyN', altKey: true }), newEntry, 'mac'),
    ).toBe(true);
    expect(matchesShortcut(press({ key: '˜', code: 'KeyN', altKey: true }), newEntry, 'mac')).toBe(
      true,
    );
  });

  it('matches named keys such as F8 and Alt+ArrowDown', () => {
    expect(
      matchesShortcut(
        press({ key: 'F8', code: 'F8' }),
        defineShortcut({ key: 'F8', scope: 'component' }),
        'other',
      ),
    ).toBe(true);
    const lookup = defineShortcut({ key: 'ArrowDown', alt: true });
    expect(
      matchesShortcut(press({ key: 'ArrowDown', code: 'ArrowDown', altKey: true }), lookup),
    ).toBe(true);
  });

  it('matches ctrl as the Control key on every platform, never ⌘', () => {
    const columns = defineShortcut({ key: ' ', ctrl: true, scope: 'component' });
    const space = press({ key: ' ', code: 'Space' });
    expect(matchesShortcut({ ...space, ctrlKey: true }, columns, 'mac')).toBe(true);
    expect(matchesShortcut({ ...space, metaKey: true }, columns, 'mac')).toBe(false);
    expect(matchesShortcut({ ...space, ctrlKey: true }, columns, 'other')).toBe(true);
    expect(matchesShortcut({ ...space, metaKey: true }, columns, 'other')).toBe(false);
  });

  it('checks Shift on Space, so Space alone is not Shift+Space', () => {
    const rows = defineShortcut({ key: ' ', shift: true, scope: 'component' });
    const space = press({ key: ' ', code: 'Space' });
    expect(matchesShortcut({ ...space, shiftKey: true }, rows, 'other')).toBe(true);
    expect(matchesShortcut(space, rows, 'other')).toBe(false);
  });
});

describe('displayed keys', () => {
  it('name the keys per platform, and for assistive technology', () => {
    expect(shortcutKeys(palette, 'other')).toEqual(['Ctrl', 'K']);
    expect(shortcutKeys(palette, 'mac')).toEqual(['⌘', 'K']);
    expect(shortcutKeys(defineShortcut({ key: 'Enter', mod: true, shift: true }), 'other')).toEqual(
      ['Ctrl', 'Shift', 'Enter'],
    );
    expect(ariaKeyShortcuts(palette, 'other')).toBe('Control+K');
    expect(ariaKeyShortcuts(palette, 'mac')).toBe('Meta+K');
    const columns = defineShortcut({ key: ' ', ctrl: true, scope: 'component' });
    expect(shortcutKeys(columns, 'other')).toEqual(['Ctrl', 'Space']);
    expect(shortcutKeys(columns, 'mac')).toEqual(['⌃', 'Space']);
    expect(ariaKeyShortcuts(columns, 'other')).toBe('Control+Space');
    expect(ariaKeyShortcuts(columns, 'mac')).toBe('Control+Space');
  });
});
