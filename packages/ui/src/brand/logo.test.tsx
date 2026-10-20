// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { logoShape, markShape } from '@vertex-mizan/tokens';
import { afterEach, describe, expect, it } from 'vitest';
import { VertexMizanLogo, VertexMizanMark } from './logo';
import { PoweredBy } from './powered-by';

afterEach(cleanup);

describe('the MIZAN logo', () => {
  it('draws the approved shapes of packages/tokens in the current color', () => {
    const { container } = render(
      <>
        <VertexMizanLogo label="Vertex Mizan" />
        <VertexMizanMark />
      </>,
    );
    const [logo, mark] = container.querySelectorAll('svg');
    expect(logo?.getAttribute('viewBox')).toBe(logoShape.viewBox);
    expect(logo?.querySelector('path')?.getAttribute('d')).toBe(logoShape.d);
    expect(mark?.querySelector('path')?.getAttribute('d')).toBe(markShape.d);
    expect(mark?.querySelector('path')?.getAttribute('fill')).toBe('currentColor');
  });

  it('is named when labelled and hidden when decorative', () => {
    render(<VertexMizanLogo label="Vertex Mizan" />);
    expect(screen.getByRole('img', { name: 'Vertex Mizan' })).toBeTruthy();
    cleanup();
    const { container } = render(<VertexMizanMark />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('PoweredBy', () => {
  it('names the product in text, the mark beside it decorative', () => {
    const { container } = render(<PoweredBy label="بدعم من فيرتكس ميزان" />);
    expect(screen.getByText('بدعم من فيرتكس ميزان')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
