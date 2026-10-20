# packages/tokens

The Vertex design tokens in TypeScript (ADR 0009, ADR 0010): the single source `packages/ui` is tested against. Values come from `brand/identity.md`; if they disagree, the identity wins and the tests fail. Food's `packages/tokens` structure, fed from Hub's identity, plus Mizan's densities.

## Layout
- `src/palette.ts`: the tonal scales (green, gold, neutral) and the status scales (success, warning, danger, info). Vertex Green is `green[800]`, Vertex Sand `gold[400]`.
- `src/semantic.ts`: `lightColors` and `darkColors`, the semantic roles (background, surface, primary, accent, destructive, ring, and Mizan's `negative` and `selection`). Two dark roles are OKLCH mixes of palette colors (`darkMixes`), written as the same `color-mix()` in `packages/ui`'s theme; Hub's dangerous-text mix is the dark `negative`.
- `src/density.ts`: `densities` (compact, comfortable: control, row, cell padding, text, icon, hit area), `resolveDensity()` and `arabicContentArea` (Noto Kufi's measured 1.897 em).
- `src/scale.ts`: `space` (4 px grid), `radius`, `fontSize` with line heights, `fontWeight`, `fontFamily`, `motion` (px and ms).
- `src/logo.ts`: `logoShape` and `markShape`, the path data of `brand/logo/svg/vertex-mizan-{logo,mark}.svg` (MIZAN knocked out of the mark's left stroke), for `packages/ui`'s logo components.
- `src/contrast.ts`: `luminance` and `contrast` (WCAG 2.2), `mixOklch` (as Chromium's `color-mix(in oklch)`, pinned by a test) and `over` (alpha compositing).
- Tests: `tokens.test.ts` (palette equals the identity's tables, measured contrast, semantic roles in both themes, negative figures readable on every surface including the selection, scales), `density.test.ts` (the identity §10 table, the 4 px grid, WCAG 2.5.8 and 2.5.5, room for Arabic, iOS's 16 px), `logo.test.ts` (the shapes equal the logo files; every file uses them, in the identity's colorways).

## Rules
- Change the identity first (`brand/identity.md`; a change to the shared identity is made in Vertex Hub first, in a task the owner authorises), then these values, then `packages/ui/src/styles/theme.css`; the tests of both packages hold them together. Mizan's own adaptations (§10) change with ADR 0010.
- Apps never import palette steps for UI: they use semantic roles (`bg-primary`, `text-negative`).
- Plain values only: no React, no platform code. Built to `dist/`.

Run: `pnpm --filter @vertex-mizan/tokens test`.
