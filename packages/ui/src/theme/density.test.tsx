// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { densityStorageKey, themeInitScript } from './theme';
import { setDensity, useDensity } from './use-density';

const root = document.documentElement;
const runInitScript = () => new Function(themeInitScript)();

/** Stubs the pointer: a coarse primary pointer or a fine one. */
function pointerIsCoarse(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' ? coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function Probe() {
  const { preference, density } = useDensity();
  return <output>{`${preference}:${density}`}</output>;
}

beforeEach(() => {
  localStorage.clear();
  root.removeAttribute('data-density');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('density', () => {
  it('is auto until the person chooses, and theme-init.js applies a saved choice', () => {
    pointerIsCoarse(false);
    runInitScript();
    expect(root.hasAttribute('data-density')).toBe(false);
    localStorage.setItem(densityStorageKey, 'comfortable');
    runInitScript();
    expect(root.getAttribute('data-density')).toBe('comfortable');
  });

  it('ignores anything but compact or comfortable, and unavailable storage', () => {
    pointerIsCoarse(false);
    localStorage.setItem(densityStorageKey, 'tiny');
    runInitScript();
    expect(root.hasAttribute('data-density')).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(runInitScript).not.toThrow();
  });

  it('resolves auto to comfortable on a coarse pointer and compact otherwise', () => {
    pointerIsCoarse(true);
    render(<Probe />);
    expect(screen.getByRole('status').textContent).toBe('auto:comfortable');
    cleanup();
    pointerIsCoarse(false);
    render(<Probe />);
    expect(screen.getByRole('status').textContent).toBe('auto:compact');
  });

  it('applies and keeps a choice, and auto clears it', () => {
    pointerIsCoarse(true);
    render(<Probe />);
    act(() => setDensity('compact'));
    expect(root.getAttribute('data-density')).toBe('compact');
    expect(localStorage.getItem(densityStorageKey)).toBe('compact');
    expect(screen.getByRole('status').textContent).toBe('compact:compact');
    act(() => setDensity('auto'));
    expect(root.hasAttribute('data-density')).toBe(false);
    expect(localStorage.getItem(densityStorageKey)).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('auto:comfortable');
  });
});
