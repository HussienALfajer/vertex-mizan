// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonViewer } from './json-viewer';

afterEach(cleanup);

const labels = { copy: 'نسخ JSON', copied: 'نُسخ', collapse: 'طيّ', expand: 'فتح' };

const payload = {
  invoice: { id: 'inv-1', number: 'INV-2026-0012' },
  amount: -12_345,
  paid: true,
  note: null,
  lines: [{ service: { name: 'تصميم' } }],
  tags: [],
};

describe('JsonViewer', () => {
  it('shows the document left to right, keys quoted, every scalar as JSON writes it', () => {
    render(<JsonViewer value={payload} labels={labels} openDepth={5} />);
    const box = document.querySelector('[data-slot="json-viewer"] [dir="ltr"]');
    expect(box).not.toBeNull();
    const text = box?.textContent ?? '';
    for (const part of [
      '"invoice": {',
      '"number": "INV-2026-0012"',
      '"amount": -12345,',
      '"paid": true,',
      '"note": null,',
      '"name": "تصميم"',
      '"tags": []',
    ]) {
      expect(text).toContain(part);
    }
  });

  it('opens branches to its depth, and each branch opens and closes by its button', async () => {
    render(<JsonViewer value={payload} labels={labels} openDepth={1} />);
    const invoice = screen.getByRole('button', { name: 'فتح invoice' });
    expect(invoice.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('"INV-2026-0012"')).toBeNull();
    expect(invoice.parentElement?.textContent).toContain('… 2');
    await act(async () => {
      fireEvent.click(invoice);
    });
    expect(screen.getByRole('button', { name: 'طيّ invoice' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByText('"INV-2026-0012"')).toBeTruthy();
    // The root stays open even at depth zero.
    cleanup();
    render(<JsonViewer value={payload} labels={labels} openDepth={0} />);
    expect(screen.getAllByRole('button', { name: /^طيّ$/ })).toHaveLength(1);
  });

  it('copies the whole document indented by two spaces', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<JsonViewer value={payload} labels={labels} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'نسخ JSON' }));
    });
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
    expect(screen.getByRole('button', { name: 'نُسخ' })).toBeTruthy();
  });

  it('shows a scalar document', () => {
    render(<JsonViewer value="نص" labels={labels} />);
    expect(document.querySelector('[dir="ltr"]')?.textContent).toBe('"نص"');
  });
});
