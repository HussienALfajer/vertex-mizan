import { mixOklch } from './contrast.js';
import { palette } from './palette.js';

/*
 * Semantic roles (brand/identity.md §2 and §10), light and dark. The dark theme is the logo's own
 * inverse: sand on deep green. `packages/ui` declares the same roles as CSS variables (its test
 * compares them); the two mixed dark roles are written there as the same `color-mix()`.
 */

const { green, gold, neutral, danger } = palette;

export const lightColors = {
  background: neutral[50],
  foreground: neutral[900],
  surface: palette.white,
  surfaceForeground: neutral[900],
  muted: neutral[100],
  mutedForeground: neutral[600],
  border: neutral[200],
  /** Form controls need 3:1 against the surface (WCAG 1.4.11), stronger than structural borders. */
  input: neutral[500],
  primary: green[800],
  primaryHover: green[700],
  primaryForeground: palette.white,
  secondary: neutral[100],
  secondaryHover: neutral[200],
  secondaryForeground: neutral[900],
  accent: gold[400],
  accentForeground: green[950],
  accentText: gold[700],
  destructive: danger[600],
  destructiveHover: danger[700],
  destructiveForeground: palette.white,
  destructiveText: danger[700],
  ring: gold[500],
  /** Negative figures: with the minus sign, never alone (ADR 0009, ADR 0010 §3). */
  negative: danger[600],
  /** Selected cells and rows in tables and grids. */
  selection: gold[100],
} as const;

export type SemanticColors = { [Role in keyof typeof lightColors]: string };

/** The dark roles mixed from two palette colors, written as `color-mix(in oklch, …)` in CSS. */
export const darkMixes = {
  // Hub's dangerous text on dark surfaces: half danger-500, half danger-100.
  negative: { from: danger[500], to: danger[100], share: 0.5 },
  selection: { from: gold[400], to: green[900], share: 0.2 },
} as const;

const mixed = (role: keyof typeof darkMixes) => {
  const { from, to, share } = darkMixes[role];
  return mixOklch(from, to, share);
};

export const darkColors: SemanticColors = {
  background: green[950],
  foreground: neutral[100],
  surface: green[900],
  surfaceForeground: neutral[100],
  muted: green[800],
  // neutral-300: muted text also sits on the muted surface (table heads, toggles).
  mutedForeground: neutral[300],
  border: green[700],
  input: green[500],
  primary: gold[400],
  primaryHover: gold[300],
  primaryForeground: green[950],
  secondary: green[800],
  secondaryHover: green[700],
  secondaryForeground: neutral[100],
  accent: gold[400],
  accentForeground: green[950],
  accentText: gold[300],
  destructive: danger[600],
  destructiveHover: danger[700],
  destructiveForeground: palette.white,
  destructiveText: mixed('negative'),
  ring: gold[400],
  negative: mixed('negative'),
  selection: mixed('selection'),
};
