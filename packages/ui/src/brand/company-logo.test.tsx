// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanyLogo } from './company-logo';

afterEach(cleanup);

describe('CompanyLogo', () => {
  it('shows the uploaded image under the company name', () => {
    render(<CompanyLogo src="/api/branding/public/logo?v=1" label="شركة تجريبية" />);
    const image = screen.getByRole('img', { name: 'شركة تجريبية' });
    expect(image.tagName).toBe('IMG');
    expect(image.getAttribute('src')).toBe('/api/branding/public/logo?v=1');
    expect(image.className).toContain('object-contain');
  });

  it('puts the image classes on the image only, never on the mark', () => {
    const { rerender } = render(<CompanyLogo src="/logo.png" imageClassName="bg-surface" />);
    expect(document.querySelector('img')?.className).toContain('bg-surface');
    rerender(<CompanyLogo imageClassName="bg-surface" />);
    expect(document.querySelector('svg')?.getAttribute('class')).not.toContain('bg-surface');
  });

  it('is decorative without a label, when the name is written beside it', () => {
    render(<CompanyLogo src="/logo.png" />);
    expect(document.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the mark when the company has no logo', () => {
    render(<CompanyLogo label="شركة تجريبية" size="lg" />);
    const mark = screen.getByRole('img', { name: 'شركة تجريبية' });
    expect(mark.tagName.toLowerCase()).toBe('svg');
  });

  it('falls back to the mark when the image fails, and tries a new address again', () => {
    const { rerender } = render(<CompanyLogo src="/broken.png" label="شركة" />);
    const image = document.querySelector('img');
    if (!image) throw new Error('No image');
    fireEvent.error(image);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'شركة' }).tagName.toLowerCase()).toBe('svg');
    rerender(<CompanyLogo src="/fixed.png" label="شركة" />);
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/fixed.png');
  });
});
