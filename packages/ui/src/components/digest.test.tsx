// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Digest } from './digest';

afterEach(cleanup);

const hash = 'ab'.repeat(32);

describe('Digest', () => {
  it('shows the first characters LTR, and gives screen readers the whole digest', () => {
    render(<Digest value={hash} copyLabel="نسخ البصمة" copiedLabel="نُسخت" />);
    const isolate = document.querySelector('[data-slot="digest"] bdi');
    expect(isolate?.getAttribute('dir')).toBe('ltr');
    expect(isolate?.querySelector('[aria-hidden="true"]')?.textContent).toBe('abababababab…');
    expect(isolate?.querySelector('.sr-only')?.textContent).toBe(hash);
  });

  it('copies the whole digest and says so on its button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Digest value={hash} copyLabel="نسخ البصمة" copiedLabel="نُسخت" length={8} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'نسخ البصمة' }));
    });
    expect(writeText).toHaveBeenCalledWith(hash);
    expect(screen.getByRole('button', { name: 'نُسخت' })).toBeTruthy();
  });

  it('shows a short value whole, without an ellipsis', () => {
    render(<Digest value="abc123" copyLabel="نسخ" copiedLabel="نُسخت" />);
    expect(document.querySelector('[aria-hidden="true"]')?.textContent).toBe('abc123');
  });
});
