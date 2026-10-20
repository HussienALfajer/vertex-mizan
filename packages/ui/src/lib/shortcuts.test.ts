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
  it('refuses a printable key without a modifier (WCAG 2.1.4)', () => {
    expect(() => defineShortcut({ key: '?' })).toThrow(/modifier/);
    expect(() => defineShortcut({ key: 't' })).toThrow(/modifier/);
    expect(defineShortcut({ key: 'F8' })).toEqual({ key: 'F8' });
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

  it('matches named keys such as F8 and Alt+ArrowDown', () => {
    expect(
      matchesShortcut(press({ key: 'F8', code: 'F8' }), defineShortcut({ key: 'F8' }), 'other'),
    ).toBe(true);
    const lookup = defineShortcut({ key: 'ArrowDown', alt: true });
    expect(
      matchesShortcut(press({ key: 'ArrowDown', code: 'ArrowDown', altKey: true }), lookup),
    ).toBe(true);
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
  });
});
