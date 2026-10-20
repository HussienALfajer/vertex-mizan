import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { arabicContentArea, DENSITIES, densities, resolveDensity } from './density.js';
import { fontSize } from './scale.js';

const identity = readFileSync(new URL('../../../brand/identity.md', import.meta.url), 'utf8');

/** The rows of identity §10 "Densities": token → [compact, comfortable]. */
function identityDensities(): Record<string, [string, string]> {
  const section = identity.slice(identity.indexOf('### Densities'));
  const table = section.slice(section.indexOf('|'), section.indexOf('\n\n', section.indexOf('|')));
  return Object.fromEntries(
    table.split('\n').map((line) => {
      const [, token = '', compact = '', comfortable = ''] = line.split('|').map((c) => c.trim());
      return [token, [compact, comfortable]];
    }),
  );
}

describe('densities', () => {
  it('match the table of brand/identity.md §10', () => {
    const table = identityDensities();
    DENSITIES.forEach((density, i) => {
      const d = densities[density];
      expect(table['Control height']?.[i]).toBe(`${d.control}`);
      expect(table['Row height']?.[i]).toBe(`${d.row}`);
      expect(table['Cell padding']?.[i]).toBe(`${d.cellPadding}`);
      expect(table['Control and cell text']?.[i]).toBe(`${d.text.size} / ${d.text.lineHeight}`);
      expect(table.Icon?.[i]).toBe(`${d.icon}`);
      expect(table['Icon hit area']?.[i]).toBe(`${d.hitArea}`);
    });
  });

  it('stay on the 4 px grid and on the type scale', () => {
    const steps = Object.values(fontSize);
    for (const d of Object.values(densities)) {
      for (const px of [d.control, d.row, d.cellPadding, d.icon, d.hitArea]) {
        expect(px % 4).toBe(0);
      }
      expect(steps).toContainEqual(d.text);
    }
  });

  it('meet WCAG 2.5.8 in compact and 2.5.5 in comfortable', () => {
    const { compact, comfortable } = densities;
    for (const px of [compact.control, compact.row, compact.hitArea]) {
      expect(px).toBeGreaterThanOrEqual(24);
    }
    for (const px of [comfortable.control, comfortable.row, comfortable.hitArea]) {
      expect(px).toBeGreaterThanOrEqual(44);
    }
  });

  it('give rows room for Arabic and touch inputs a size iOS does not zoom', () => {
    for (const d of Object.values(densities)) {
      expect(d.row).toBeGreaterThanOrEqual(Math.ceil(arabicContentArea * d.text.size));
      expect(d.row).toBeGreaterThanOrEqual(d.text.lineHeight);
    }
    expect(densities.comfortable.text.size).toBeGreaterThanOrEqual(16);
  });

  it('resolve auto to comfortable on a coarse pointer only, and keep a chosen density', () => {
    expect(resolveDensity('auto', false)).toBe('compact');
    expect(resolveDensity('auto', true)).toBe('comfortable');
    expect(resolveDensity('compact', true)).toBe('compact');
    expect(resolveDensity('comfortable', false)).toBe('comfortable');
  });
});
