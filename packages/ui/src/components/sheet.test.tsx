// @vitest-environment jsdom

import { DirectionProvider } from '@base-ui/react/direction-provider';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from './sheet';

afterEach(cleanup);

function renderSheet() {
  return render(
    <DirectionProvider direction="rtl">
      <Sheet>
        <SheetTrigger>القائمة</SheetTrigger>
        <SheetContent>
          <SheetTitle>التنقل</SheetTitle>
          <SheetClose>إغلاق</SheetClose>
        </SheetContent>
      </Sheet>
    </DirectionProvider>,
  );
}

describe('Sheet', () => {
  it('opens as a modal dialog named by its title, at the inline start', () => {
    renderSheet();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'القائمة' }));
    const sheet = screen.getByRole('dialog', { name: 'التنقل' });
    expect(sheet.getAttribute('data-slot')).toBe('sheet-content');
    expect(sheet.className).toMatch(/\bstart-0\b/);
    expect(sheet.className).toContain('rtl:data-starting-style:translate-x-full');
  });

  it('closes with Escape and returns the focus to its trigger', async () => {
    renderSheet();
    const trigger = screen.getByRole('button', { name: 'القائمة' });
    trigger.focus();
    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'التنقل' });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes with its close button', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'القائمة' }));
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
