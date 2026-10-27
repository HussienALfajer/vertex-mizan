// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QrCode } from './qr-code';

afterEach(cleanup);

const uri = 'otpauth://totp/Vertex%20Mizan:owner%40example.test?secret=JBSWY3DPEHPK3PXP';

describe('QrCode', () => {
  it('draws the value as a named image', () => {
    render(<QrCode value={uri} label="رمز QR لتطبيق المصادقة" />);
    const image = screen.getByRole('img', { name: 'رمز QR لتطبيق المصادقة' });
    expect(image.tagName.toLowerCase()).toBe('svg');
    expect(image.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('stays dark on white in both themes', () => {
    render(<QrCode value={uri} label="QR" />);
    const figure = screen.getByRole('img', { name: 'QR' }).closest('[data-slot="qr-code"]');
    expect(figure?.className).toContain('bg-white');
    expect(figure?.className).toContain('text-neutral-950');
  });

  it('changes with its value', () => {
    const { rerender } = render(<QrCode value={uri} label="QR" />);
    const before = screen.getByRole('img', { name: 'QR' }).innerHTML;
    rerender(<QrCode value={`${uri}A`} label="QR" />);
    expect(screen.getByRole('img', { name: 'QR' }).innerHTML).not.toBe(before);
  });
});
