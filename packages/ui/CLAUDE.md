# packages/ui

The Vertex Mizan design system for the web (ADR 0009, ADR 0010): Vertex Hub's components and Vertex Food's theme and tests, copied and adapted for accountants. shadcn/ui patterns on Base UI, Tailwind CSS v4 tokens, Arabic-first RTL, two densities. Read `brand/identity.md` (§10 for Mizan's adaptations) and ADR 0010 before changing anything visual. Exports TypeScript sources: Vite compiles them.

## Layout
- `src/styles/theme.css`: the only place colors, sizes and densities are defined (light and dark; compact, comfortable). Its values equal `packages/tokens` (`src/theme.test.ts`). `index.css` (what apps import after `tailwindcss` and `fonts.css`), `base.css` (density text, tabular figures everywhere, focus ring).
- `src/styles/fonts.css`: the nine faces of Montserrat and Noto Kufi Arabic from `@fontsource`, each with its `unicode-range` (`src/fonts.test.ts`: Montserrat draws the digits and U+2212). `src/vite.ts` (`vertexMizanWeb()`): serves and emits `theme-init.js` and preloads the first screen's fonts.
- `src/theme/`: `theme.ts` (`themeInitScript`: the `dark` class and the chosen `data-density` before the first paint), `use-theme.ts` (`useTheme`), `use-density.ts` (`useDensity`: `auto`, `compact` or `comfortable`; `auto` is comfortable on a coarse primary pointer).
- `src/components/<name>.tsx`: one component family per file, exported from `src/index.ts`. Pattern to copy: `src/components/button.tsx` (Base UI primitive + `cva` variants + `cn`).
- `src/components/sheet.tsx` (`Sheet`): a modal panel from the inline-start edge, the shell's navigation on phones (Hub's). `src/components/command-palette.tsx` (`CommandPalette`): Ctrl/⌘+K (`keymap.commandPalette`) or its visible button opens a dialog with Base UI's inline autocomplete (the WAI-ARIA combobox pattern); commands come in as data (`PaletteCommand`: label, group, keywords, shortcut, icon, `run`), labels from i18n `commandPalette`. A command's shortcut is only shown: the app binds it with `useShortcut`. `src/lib/command-search.ts` (`matchesCommand`): every query word in the label or keywords, ignoring Arabic diacritics, hamza forms, alef maqsura, taa marbuta and Arabic-Indic digits.
- Access (S01): `otp-field.tsx` (`OtpField`, Hub's: six LTR slots grouped 3 + 3, sized by density), `password-input.tsx` (`PasswordInput`, Hub's: LTR with a show/hide button), `qr-code.tsx` (`QrCode`: `qrcode.react`, dark on white in both themes so every scanner reads it), `secret-code-list.tsx` (`SecretCodeList`: codes kept once, LTR, copy one per line, print as a plain list from a hidden frame).
- `src/accounting/`: ADR 0010's Phase 0 components: `Amount`, `AmountInput`, `AccountLabel`, `LedgerSwitch`, `PeriodBadge`, each with its test.
- `src/lib/`: `cn` (tailwind-merge taught the density sizes: `text-control` is a font size), `shortcuts.ts` (`defineShortcut`, `matchesShortcut`, `shortcutKeys`, `ariaKeyShortcuts`), `keymap.ts` (ADR 0010's keyboard map, defined once), `use-shortcut.ts`, `motion.ts`. `Kbd` shows a shortcut's keys.
- `src/grid/`: the data grid's pure core (ADR 0010 §4), tested without a browser: `selection.ts` (positions in reading order, moves, range selection with an active cell always inside it), `grid-keys.ts` (`gridCommand`: navigation-mode keys as commands; arrows visual, through `keymap` for the shortcuts), `tsv.ts` (Excel's clipboard text, quote-aware), `cells.ts` (text and amount columns; `copyRange`, `planPaste`, `planFillDown`, `planClear` return every edit or every problem, never part: the app applies the edits), `summary.ts` (`summarizeSelection`: per kind of amount, then per currency, through `summarizeAmounts`). `grid.tsx` (`Grid`): the component on that core: a `<table role="grid">` with roving tabindex, navigation and editing modes, clipboard events, a sticky header, footer and start column (scroll padding reserves them), and the bar that shows a refusal (`describeProblem`, text from i18n `grid.problems`) and the selection summary (labels from i18n `grid.summary`). It never changes rows: `onEdit` receives checked edits, and `onEditError` hears when an editor holds refused text (never save or post until it reports `null`, as with `AmountInput`'s `onTextError`); without them it is read-only. An open editor follows its line by `rowKey` (keys must be stable), and the row keys of `keymap` (post, insert or delete a line, copy above, lookup) pressed in it commit first and reach the app's ancestor `onKeyDown` only after the app has rendered the edit.
- `src/brand/`: `VertexMizanLogo`, `VertexMizanMark` (path data from `@vertex-mizan/tokens`, pinned to `brand/logo/svg`), `PoweredBy` (the mark and "Powered by Vertex Mizan") and the 60° `AscentLines` motif.
- The design-system page is `apps/web`'s `/design-system` (`apps/web/src/features/design-system/design-system-page.tsx`, text from i18n `designSystem`); it replaced this package's preview page in PR 8.

## Rules the tests enforce
- `src/conventions.test.ts`, over `src/` and `apps/web/src`: logical directions only (no `ml-`/`pl-`/`left-`/`text-left`…, no physical CSS or inline styles), no color values outside `theme.css`, none of the patterns of `brand/identity.md` §8.
- `src/theme.test.ts`: the palette, roles, mixes, densities and scales equal `packages/tokens`; only brand tokens generate utilities; the density utilities exist.

## Density (ADR 0010 §2)
- Sizes come from the density utilities, never fixed heights: `h-control` (32 / 44), `h-row` and `size-row` (28 / 44), `px-cell` (8 / 12), `text-control` (13 / 16 px), `size-icon` (16 / 20), `size-hit` (24 / 44). A fixed size is allowed only for something that must not change with density (a 24 px badge).
- An element can set its own `data-density`: give it `text-control` too, so its own text follows.
- Icons inside rows keep a hit area of at least `size-hit`.

## Figures (ADR 0010 §3)
- `AmountInput` requires `onTextError`: keep the error beside the value, and never save or post while any amount input reports one (its last committed amount still stands behind the refused text). It refuses a paste of several cells or lines.
- Every amount goes through `Amount` (display) or `AmountInput` (entry), or a `Grid` cell, whose editor commits through the grid core (`planCellEdit`, which parses with `parseAmount`): never format, parse or compute an amount in a component; the money module of `packages/contracts` does it (`formatMinor`, `amountParts`, `parseAmount`, `summarizeAmounts`).
- Figure columns use `TableHead numeric` and `TableCell numeric` (aligned to the physical right edge). Totals use `Amount strong`. Rules: a single rule above a subtotal, a double rule under a grand total (the preview shows them).
- Codes and numbers are LTR isolates (`<bdi dir="ltr">`); names people typed are `<bdi>` (direction from their content).

## Keyboard (ADR 0010 §4)
- Define a shortcut once in `keymap.ts` with `defineShortcut` (it refuses browser-only keys and unmodified global keys); show it with `Kbd`, expose it with `ariaKeyShortcuts`, name it in i18n `shortcuts`. Global keys need Ctrl/⌘ or Alt (Escape aside) and bind with `useShortcut`; component keys (`scope: 'component'`) are handled in their component's own `onKeyDown`, and `useShortcut` refuses them. Keys match `code` when `key` is not Latin or is a dead key (macOS Option).

## A new component (ADR 0010 §7)
A screen that needs something this package lacks gets it here first, then uses it; never a one-off component or hand-styled control inside a screen. Before it is used:
1. Copy and adapt Vertex Hub's component if it has one; otherwise build on a Base UI primitive.
2. Make it general: named for its accounting purpose, data and labels as props (text from i18n in the app).
3. Both densities through the density utilities; figures through `Amount`/`AmountInput`; its keys in `keymap.ts`; focus, errors and RTL as ADR 0010 §3–§4.
4. Its own tests next to it: behaviour, keyboard, ARIA, RTL, negative figures where it shows any.
5. A place on the design-system page (`apps/web`, `/design-system`) and in its screenshot test, checked in light and dark, compact and comfortable, at 360, 768 and 1280 px.
6. Exported from `src/index.ts` and listed in this file.

## Rules to apply yourself
- Every app mounts `<DirectionProvider direction={textDirection}>` (from this package, `textDirection` from `@vertex-mizan/i18n`): Base UI reads the direction from it.
- Build on Base UI primitives, keep their accessibility, and use the `render` prop instead of wrapper elements.
- Every component sets `data-slot`, merges `className` with `cn`, and passes other props through. Variants through `cva` with semantic names mapped to semantic tokens.
- No user-facing text inside components: labels come in as props, so the app translates them.
- Responsive from 360 px: a wide table scrolls inside its own container, never the page; grid and flex children that hold tables get `min-w-0`.
- Copied now: the components ADR 0010 §6 lists. Hub's other components are copied with their first real use; the data grid foundation is `src/grid/` and the command palette `src/components/command-palette.tsx`; their commands and data come with their specs; the entry grid, pickers, report table and print layouts with their specs.

Run: `pnpm --filter @vertex-mizan/ui test` · `pnpm --filter @vertex-mizan/ui typecheck` · the design-system page: `pnpm --filter @vertex-mizan/web dev`, then `/design-system`.
