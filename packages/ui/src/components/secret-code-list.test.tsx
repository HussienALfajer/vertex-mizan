// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretCodeList } from './secret-code-list';

const codes = ['a1b2-c3d4', 'e5f6-g7h8', 'i9j0-k1l2'];
const writeText = vi.fn(async () => {});

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  writeText.mockClear();
  vi.useRealTimers();
});

function renderList(printLabel?: string) {
  render(
    <SecretCodeList
      codes={codes}
      label="الرموز الاحتياطية"
      copyLabel="نسخ الرموز"
      copiedLabel="نُسخت"
      printLabel={printLabel}
    />,
  );
}

describe('SecretCodeList', () => {
  it('lists the codes in order, left to right', () => {
    renderList();
    const list = screen.getByRole('list', { name: 'الرموز الاحتياطية' });
    expect(list.getAttribute('dir')).toBe('ltr');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(codes);
  });

  it('copies them one per line and says so for a moment', async () => {
    vi.useFakeTimers();
    renderList();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'نسخ الرموز' }));
    });
    expect(writeText).toHaveBeenCalledWith(codes.join('\n'));
    expect(screen.getByRole('button', { name: 'نُسخت' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('button', { name: 'نسخ الرموز' })).toBeTruthy();
  });

  it('prints them as a plain list under the label, only when asked to offer printing', () => {
    renderList();
    expect(screen.queryByRole('button', { name: 'طباعة' })).toBeNull();
    cleanup();
    renderList('طباعة');
    const print = vi.fn();
    const append = document.body.append.bind(document.body);
    vi.spyOn(document.body, 'append').mockImplementation((...nodes) => {
      append(...nodes);
      const frame = nodes[0] as HTMLIFrameElement;
      if (frame.contentWindow) frame.contentWindow.print = print;
    });
    fireEvent.click(screen.getByRole('button', { name: 'طباعة' }));
    expect(print).toHaveBeenCalledOnce();
    const frame = document.querySelector('iframe');
    expect(frame?.contentDocument?.querySelector('h1')?.textContent).toBe('الرموز الاحتياطية');
    expect(frame?.contentDocument?.querySelector('pre')?.textContent).toBe(codes.join('\n'));
    vi.restoreAllMocks();
  });
});
