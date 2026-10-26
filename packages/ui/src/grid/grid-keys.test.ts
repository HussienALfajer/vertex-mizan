import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type GridCommand, gridCommand } from './grid-keys';

const press = (init: Partial<KeyboardEvent> & { key: string }) => ({
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

const move = (name: string, extend = false): GridCommand => ({
  type: 'move',
  move: name as never,
  extend,
});

describe('gridCommand', () => {
  it('moves visually: Left is the next column in RTL and the previous one in LTR', () => {
    expect(gridCommand(press({ key: 'ArrowLeft' }), 'rtl', 'other')).toEqual(move('forward'));
    expect(gridCommand(press({ key: 'ArrowRight' }), 'rtl', 'other')).toEqual(move('backward'));
    expect(gridCommand(press({ key: 'ArrowLeft' }), 'ltr', 'other')).toEqual(move('backward'));
    expect(gridCommand(press({ key: 'ArrowRight' }), 'ltr', 'other')).toEqual(move('forward'));
  });

  it('mirrors every horizontal arrow between RTL and LTR, and nothing else (property)', () => {
    const keys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Tab',
    ];
    const mirror: Record<string, string> = { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' };
    fc.assert(
      fc.property(
        fc.constantFrom(...keys),
        fc.boolean(),
        fc.boolean(),
        (key, shiftKey, ctrlKey) => {
          const rtl = gridCommand(press({ key, shiftKey, ctrlKey }), 'rtl', 'other');
          const ltr = gridCommand(
            press({ key: mirror[key] ?? key, shiftKey, ctrlKey }),
            'ltr',
            'other',
          );
          expect(rtl).toEqual(ltr);
        },
      ),
    );
  });

  it('reads Tab in reading order and never as a range', () => {
    expect(gridCommand(press({ key: 'Tab' }), 'rtl', 'other')).toEqual(move('next'));
    expect(gridCommand(press({ key: 'Tab', shiftKey: true }), 'rtl', 'other')).toEqual(
      move('previous'),
    );
  });

  it('moves down on Enter and up on Shift+Enter, as a spreadsheet, never extending', () => {
    expect(gridCommand(press({ key: 'Enter' }), 'rtl', 'other')).toEqual(move('down'));
    expect(gridCommand(press({ key: 'Enter', shiftKey: true }), 'rtl', 'other')).toEqual(
      move('up'),
    );
  });

  it('extends with Shift and jumps with Ctrl (⌘ on macOS)', () => {
    expect(gridCommand(press({ key: 'ArrowDown', shiftKey: true }), 'rtl', 'other')).toEqual(
      move('down', true),
    );
    expect(gridCommand(press({ key: 'Home', ctrlKey: true }), 'rtl', 'other')).toEqual(
      move('gridStart'),
    );
    expect(gridCommand(press({ key: 'End', metaKey: true, shiftKey: true }), 'rtl', 'mac')).toEqual(
      move('gridEnd', true),
    );
    expect(gridCommand(press({ key: 'End', ctrlKey: true }), 'rtl', 'mac')).toBeUndefined();
    expect(gridCommand(press({ key: 'PageDown' }), 'rtl', 'other')).toEqual(move('pageDown'));
  });

  it('selects all, rows and columns, edits, fills down and clears through the keymap', () => {
    const command = (init: Parameters<typeof press>[0]) => gridCommand(press(init), 'rtl', 'other');
    expect(command({ key: 'a', code: 'KeyA', ctrlKey: true })).toEqual({ type: 'selectAll' });
    // Ctrl+A with the Arabic layout types "ش" on the same key.
    expect(command({ key: 'ش', code: 'KeyA', ctrlKey: true })).toEqual({ type: 'selectAll' });
    expect(command({ key: ' ', code: 'Space', shiftKey: true })).toEqual({ type: 'selectRows' });
    expect(command({ key: ' ', code: 'Space', ctrlKey: true })).toEqual({ type: 'selectColumns' });
    expect(command({ key: 'F2', code: 'F2' })).toEqual({ type: 'edit' });
    expect(command({ key: 'd', code: 'KeyD', ctrlKey: true })).toEqual({ type: 'fillDown' });
    expect(command({ key: 'Delete', code: 'Delete' })).toEqual({ type: 'clear' });
  });

  it('leaves alone the keys that are not its own', () => {
    for (const init of [
      { key: ' ', code: 'Space' },
      { key: 'ArrowDown', altKey: true },
      { key: 'ArrowLeft', ctrlKey: true },
      { key: 'Delete', ctrlKey: true },
      { key: 'Enter', ctrlKey: true },
      { key: 'x' },
    ]) {
      expect(gridCommand(press(init), 'rtl', 'other'), init.key).toBeUndefined();
    }
  });
});
