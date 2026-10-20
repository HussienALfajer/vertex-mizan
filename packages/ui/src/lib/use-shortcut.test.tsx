// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keymap } from './keymap';
import { useShortcut } from './use-shortcut';

afterEach(cleanup);

function Bound({ onRun, which }: { onRun: () => void; which: 'commandPalette' | 'today' }) {
  useShortcut(keymap[which], onRun);
  return <input aria-label="field" />;
}

describe('useShortcut', () => {
  it('runs a global shortcut from anywhere on the page and keeps it from the browser', () => {
    const onRun = vi.fn();
    render(<Bound which="commandPalette" onRun={onRun} />);
    const event = fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(event).toBe(false);
  });

  it('refuses a component shortcut, so a bare key never acts page-wide', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bound which="today" onRun={() => {}} />)).toThrow(/component shortcut/);
  });
});
