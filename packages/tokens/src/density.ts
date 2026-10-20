import { fontSize } from './scale.js';

/*
 * The two densities of ADR 0010 §2 (brand/identity.md §10), in px. Compact is the desktop default;
 * comfortable applies when the primary pointer is coarse, and the person's choice wins. Headings and
 * figures outside tables keep the type scale in both.
 */

export const DENSITIES = ['compact', 'comfortable'] as const;

export type Density = (typeof DENSITIES)[number];

/** What a person can choose: a density, or `auto` (comfortable on a coarse primary pointer). */
export type DensityPreference = Density | 'auto';

export interface DensityTokens {
  /** Buttons, inputs and selects. */
  readonly control: number;
  /** Table and grid rows, the header row included. */
  readonly row: number;
  /** Inline padding of a cell. */
  readonly cellPadding: number;
  /** Text of controls and cells. */
  readonly text: { readonly size: number; readonly lineHeight: number };
  /** Icons in controls and rows. */
  readonly icon: number;
  /** The smallest hit area of an icon inside a row (WCAG 2.5.8; 2.5.5 in comfortable). */
  readonly hitArea: number;
}

export const densities: { readonly [D in Density]: DensityTokens } = {
  compact: { control: 32, row: 28, cellPadding: 8, text: fontSize.sm, icon: 16, hitArea: 24 },
  comfortable: { control: 44, row: 44, cellPadding: 12, text: fontSize.md, icon: 20, hitArea: 44 },
};

/**
 * Noto Kufi Arabic's content area in em (ascent 1282 + descent 615 per 1000, measured in the
 * shipped `@fontsource` files): a cell that clips must be at least this many times its text size,
 * or Arabic marks are cut (docs/research/design-system-for-accounting.md §5.1).
 */
export const arabicContentArea = 1.897;

/** The density a preference resolves to, given whether the primary pointer is coarse. */
export function resolveDensity(preference: DensityPreference, coarsePointer: boolean): Density {
  if (preference !== 'auto') return preference;
  return coarsePointer ? 'comfortable' : 'compact';
}
