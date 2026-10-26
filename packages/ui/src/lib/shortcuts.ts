/*
 * The shortcut registry (ADR 0010 §4): a shortcut is defined once, and its matching, its displayed
 * keys and its `aria-keyshortcuts` come from that definition. `mod` is Ctrl on Windows and Linux
 * and ⌘ on macOS; `ctrl` is the Control key itself on every platform. Keys match `KeyboardEvent.key` when it is Latin, and the physical key
 * (`KeyboardEvent.code`) otherwise, so a shortcut works while an Arabic layout is active.
 */

export interface Shortcut {
  /** A letter, digit or punctuation key (`k`, `/`), or a named key (`Enter`, `F8`, `ArrowDown`). */
  readonly key: string;
  readonly mod?: boolean;
  /**
   * The Control key on every platform (⌃ on macOS), for what macOS keeps under ⌘: ⌘Space is
   * Spotlight, so a grid selects columns with Ctrl+Space everywhere, as Excel for Mac does.
   */
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  /**
   * `global` (the default) works anywhere on the page; `component` only while the component that
   * owns it has focus, such as a grid's Ctrl+D or a date field's `t`.
   */
  readonly scope?: 'global' | 'component';
}

export type Platform = 'mac' | 'other';

/** The keyboard event fields a match reads. */
type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** Ctrl/⌘ keys a page can never take from the browser: new window, new tab, close, quit. */
const BROWSER_ONLY = new Set(['n', 't', 'w', 'q']);

/**
 * Ctrl/⌘ keys of browser features a page can take but should not globally (address bar,
 * bookmark, find, print, save, reload, history, downloads). A focused component may use one with
 * the meaning people know from spreadsheets (Ctrl+D fills down).
 */
const BROWSER_FEATURES = new Set(['l', 'd', 'f', 'p', 's', 'r', 'h', 'j']);

/** Values of `key` that name no key: a dead key, an input method composing, an unknown key. */
const COMPOSING_KEYS = new Set(['Dead', 'Process', 'Unidentified']);

/** Physical keys of punctuation, for layouts that type another character on them. */
const PUNCTUATION_CODES: Record<string, string> = {
  Slash: '/',
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

/**
 * A shortcut, checked when it is defined: a key without Ctrl/⌘ or Alt only inside its component
 * (WCAG 2.1.4), Escape aside; Ctrl/⌘ with a key the browser keeps never, and with a browser feature's
 * key only inside a component; never ⌘ with a key macOS keeps (⌘Space).
 */
export function defineShortcut(shortcut: Shortcut): Shortcut {
  const key = shortcut.key.length === 1 ? shortcut.key.toLowerCase() : shortcut.key;
  const global = shortcut.scope !== 'component';
  if (shortcut.mod && shortcut.ctrl) {
    throw new Error(`"${key}" names both mod and ctrl: on Windows they are the same key`);
  }
  if (global && !shortcut.mod && !shortcut.ctrl && !shortcut.alt && key !== 'Escape') {
    // A bare key page-wide would take `t` from every input or Enter from every form.
    throw new Error(`A global shortcut on "${key}" needs Ctrl/⌘ or Alt (WCAG 2.1.4)`);
  }
  if (shortcut.mod && key === ' ') {
    throw new Error('⌘Space belongs to macOS (Spotlight): use ctrl for Ctrl+Space');
  }
  const plainMod = (shortcut.mod || shortcut.ctrl) && !shortcut.alt;
  if (plainMod && BROWSER_ONLY.has(key)) {
    throw new Error(`Ctrl/⌘+${key.toUpperCase()} belongs to the browser`);
  }
  if (global && plainMod && !shortcut.shift && BROWSER_FEATURES.has(key)) {
    throw new Error(`Ctrl/⌘+${key.toUpperCase()} is the browser's outside a component`);
  }
  return { ...shortcut, key };
}

/** The key an event stands for: its character when Latin, else the physical key's character. */
function eventKey({ key, code }: KeyEvent): string {
  // macOS's Option makes dead keys (Option+N is `Dead`): those fall back to the physical key.
  if (key.length > 1 && !COMPOSING_KEYS.has(key)) return key;
  if (/^[\x20-\x7e]$/.test(key)) return key.toLowerCase();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return PUNCTUATION_CODES[code] ?? key;
}

/** Whether a keyboard event is this shortcut on this platform, modifiers exactly. */
export function matchesShortcut(
  event: KeyEvent,
  shortcut: Shortcut,
  platform: Platform = detectPlatform(),
): boolean {
  const mac = platform === 'mac';
  const meta = mac && Boolean(shortcut.mod);
  const ctrl = mac ? Boolean(shortcut.ctrl) : Boolean(shortcut.mod || shortcut.ctrl);
  return (
    eventKey(event) === shortcut.key &&
    event.metaKey === meta &&
    event.ctrlKey === ctrl &&
    event.altKey === Boolean(shortcut.alt) &&
    // Shift is part of a punctuation key's character (`?` is Shift+/): only checked for letters,
    // digits, Space and named keys (Shift+Space selects rows, Space alone does not).
    (shortcut.key.length > 1 || /[a-z\d ]/.test(shortcut.key)
      ? event.shiftKey === Boolean(shortcut.shift)
      : true)
  );
}

const NAMED: Record<string, [mac: string, other: string]> = {
  ArrowUp: ['↑', '↑'],
  ArrowDown: ['↓', '↓'],
  ArrowLeft: ['←', '←'],
  ArrowRight: ['→', '→'],
  Enter: ['↩', 'Enter'],
  Escape: ['Esc', 'Esc'],
  Delete: ['⌦', 'Delete'],
  Backspace: ['⌫', 'Backspace'],
  Insert: ['Insert', 'Insert'],
  ' ': ['Space', 'Space'],
};

/** The keys to show, in order: `['Ctrl', 'K']` on Windows, `['⌘', 'K']` on macOS. */
export function shortcutKeys(shortcut: Shortcut, platform: Platform = detectPlatform()): string[] {
  const mac = platform === 'mac';
  const keys: string[] = [];
  if (shortcut.mod) keys.push(mac ? '⌘' : 'Ctrl');
  if (shortcut.ctrl) keys.push(mac ? '⌃' : 'Ctrl');
  if (shortcut.alt) keys.push(mac ? '⌥' : 'Alt');
  if (shortcut.shift) keys.push(mac ? '⇧' : 'Shift');
  const named = NAMED[shortcut.key];
  keys.push(named ? named[mac ? 0 : 1] : shortcut.key.toUpperCase());
  return keys;
}

/** The `aria-keyshortcuts` value: `Control+K` or `Meta+K`. */
export function ariaKeyShortcuts(
  shortcut: Shortcut,
  platform: Platform = detectPlatform(),
): string {
  const keys: string[] = [];
  if (shortcut.mod) keys.push(platform === 'mac' ? 'Meta' : 'Control');
  if (shortcut.ctrl) keys.push('Control');
  if (shortcut.alt) keys.push('Alt');
  if (shortcut.shift) keys.push('Shift');
  if (shortcut.key === ' ') keys.push('Space');
  else keys.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return keys.join('+');
}

/** macOS or anything else, from the browser; `other` outside one. */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return /mac/i.test(data?.platform ?? navigator.platform ?? '') ? 'mac' : 'other';
}
