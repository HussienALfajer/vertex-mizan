// @vitest-environment jsdom

import { DirectionProvider } from '@base-ui/react/direction-provider';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ar } from '@vertex-mizan/i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keymap } from '../lib/keymap';
import { CommandPalette, type PaletteCommand } from './command-palette';

afterEach(cleanup);

const labels = ar.commandPalette;

function commands(run: (id: string) => void): PaletteCommand[] {
  return [
    {
      id: 'new-entry',
      label: 'قيد جديد',
      group: 'القيود',
      keywords: ['journal entry'],
      shortcut: keymap.newEntry,
      run: () => run('new-entry'),
    },
    {
      id: 'trial-balance',
      label: 'ميزان المراجعة',
      group: 'التقارير',
      run: () => run('trial-balance'),
    },
    { id: 'close-period', label: 'إقفال الفترة', group: 'الفترات', run: () => run('close-period') },
  ];
}

function renderPalette(run: (id: string) => void = () => {}) {
  return render(
    <DirectionProvider direction="rtl">
      <CommandPalette commands={commands(run)} labels={labels} platform="other" />
    </DirectionProvider>,
  );
}

const openWithKeys = () =>
  act(() => {
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
  });
const input = () => screen.getByRole('combobox', { name: labels.search });
const options = () => screen.queryAllByRole('option').map((option) => option.textContent);

describe('CommandPalette', () => {
  it('has a visible button with its shortcut, as a second route to Ctrl+K', () => {
    renderPalette();
    const trigger = screen.getByRole('button', { name: /الأوامر/ });
    expect(trigger.getAttribute('aria-keyshortcuts')).toBe('Control+K');
    expect(trigger.querySelector('[data-slot="kbd"]')?.textContent).toBe('CtrlK');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: labels.title })).toBeTruthy();
  });

  it('opens on Ctrl+K with focus in the search box and every command listed', async () => {
    renderPalette();
    await openWithKeys();
    expect(screen.getByRole('dialog', { name: labels.title })).toBeTruthy();
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    expect(options()).toEqual(['قيد جديدAltN', 'ميزان المراجعة', 'إقفال الفترة']);
    expect(screen.getByText('القيود')).toBeTruthy();
  });

  it('filters as people type Arabic, without hamza or diacritics, and by keywords', async () => {
    renderPalette();
    await openWithKeys();
    fireEvent.change(input(), { target: { value: 'اقفال' } });
    expect(options()).toEqual(['إقفال الفترة']);
    fireEvent.change(input(), { target: { value: 'journal' } });
    expect(options()).toEqual(['قيد جديدAltN']);
    fireEvent.change(input(), { target: { value: 'لا شيء' } });
    expect(options()).toEqual([]);
    expect(screen.getByText(labels.empty)).toBeTruthy();
  });

  it('runs the highlighted command on Enter and closes', async () => {
    const run = vi.fn();
    renderPalette(run);
    await openWithKeys();
    fireEvent.change(input(), { target: { value: 'ميزان' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(run).toHaveBeenCalledWith('trial-balance');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('runs a command on click', async () => {
    const run = vi.fn();
    renderPalette(run);
    await openWithKeys();
    fireEvent.click(screen.getByRole('option', { name: 'إقفال الفترة' }));
    expect(run).toHaveBeenCalledWith('close-period');
  });

  it('closes on Escape without running anything', async () => {
    const run = vi.fn();
    renderPalette(run);
    await openWithKeys();
    fireEvent.keyDown(input(), { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(run).not.toHaveBeenCalled();
  });
});
