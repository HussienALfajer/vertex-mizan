# 0010 — Design system for accountants: densities, figures, accounting components and the keyboard

Status: Proposed · Date: 2026-10-21 · Amends ADR 0009

## Context
ADR 0009 gave Mizan the Vertex identity and named the accounting components. Vertex Hub's design system, which 0009 copies, was made for a general management app: 36–40 px controls, 40–44 px table rows and 15 px body text. Accountants live in dense tables of figures, enter entries from the keyboard and compare columns of numbers. The owner asked for a design system built for them, keeping the Vertex identity and adapting everything else, and delegated every design-system decision (2026-10-21). Accounting and business decisions stay with the owner.

The evidence is in `docs/research/design-system-for-accounting.md` (the research): leading accounting products, density modes in design systems, WCAG 2.2, spreadsheet behaviour and grid libraries, number presentation, Arabic RTL with LTR figures, keyboard entry and print. Section numbers below (R§n) point to it.

## Decision

### 1. Identity: unchanged
The colors, tonal and status scales, typefaces (Noto Kufi Arabic and Montserrat), the 60° motif, the 4 px grid, the radii, the light and dark themes and the logo family of ADR 0009 stay as they are. `brand/identity.md` copies Hub's identity; Mizan's adaptations are its §10, which points here. Nothing below adds a color or a typeface.

### 2. Densities
Two densities, set on `<html>` as `data-density` and read by every component through CSS variables:

| Token | Compact | Comfortable | Why |
|---|---|---|---|
| Control height (buttons, inputs, selects) | 32 px | 44 px | SAP compact 32 / cozy 44, Fluent 44 touch (R§3.1) |
| Row height (tables, grids, header row) | 28 px | 44 px | Holds Noto Kufi's 1.9 em content area at 13 px (24.7 px) with room to spare (R§5.1); ≥ 24 px target (R§3.3) |
| Cell padding (inline) | 8 px | 12 px | 4 px grid |
| Control and cell text | 13 / 20 px | 16 / 26 px | Hub's `sm` and `md`; 16 px stops iOS from zooming into inputs (R§3.3) |
| Icon in controls and rows | 16 px | 20 px | Hub's dense-table icon size |
| Hit area of an icon inside a row | ≥ 24 × 24 px | ≥ 44 × 44 px | WCAG 2.5.8 AA; 2.5.5 AAA in comfortable |

- **Compact is the default** on desktop. **Comfortable applies automatically** when the primary pointer is coarse (`@media (pointer: coarse)`), unless the person chose otherwise.
- **The person's choice wins:** `auto`, `compact` or `comfortable`, kept with the user's preferences (S01; until then in the browser). Pointer detection is unreliable on hybrid devices (R§3.2), so the choice is always offered.
- Headings, page titles and figures keep Hub's type scale in both densities. Font sizes of data do not change with zoom or density inside one screen, so columns keep their widths.
- No third, denser mode now: 28 px rows already exceed Hub's density by a third; a denser mode would clip Arabic (R§5.1).

### 3. Figures
- **Tabular lining figures everywhere:** `font-variant-numeric: tabular-nums` on the whole app. Montserrat's shipped default digits are proportional; its `tnum` digits are 700 units in every weight (R§5.1).
- **Weights:** 400 for figures and body, 500 for labels and column headers, 700 for totals and headings (the identity's weights). **Inside a bold figure the separators are set at 400**, so a bold total is exactly as wide as a regular figure and every digit of a column aligns (R§5.1).
- **Alignment:** figures align to the physical right edge of their column in both directions, because the units digit of an LTR number is at its right (R§5.2). In the RTL interface that edge is the column's start. Columns of one currency show the same number of decimals, which aligns the decimal points.
- **Never abbreviated or truncated** on screens and ledgers: no `…`, no `K`/`M`, no `###`. Columns are sized for the widest realistic figure (a 13-digit SYP amount), and a table scrolls inside itself, never the page (ADR 0009). Only a statement may scale, with the unit in its header (IAS 1.51; with S09).
- **Negative** (ADR 0009, unchanged): an ASCII hyphen-minus and the `negative` color. ASCII, because copied figures must paste into Excel as numbers (R§6.1). The `negative` color is `danger-600` in the light theme and Hub's dangerous-text mix of `danger-500` and `danger-100` in the dark theme, at least 4.5:1 on every surface it can sit on, including the selection (tested in `packages/tokens`).
- **Zero** shows as `0.00`; a dash for zero is an option of the Amount component that the statements spec (S09) may choose. **Debit and credit columns** of entry grids show unsigned magnitudes, as ADR 0009 says.
- **Isolation:** every figure, with its sign and its currency code, is one LTR isolate (`<bdi dir="ltr">`). Account codes are LTR isolates too; names entered by people are `dir="auto"` (R§6.1).
- **Variance** (when a report shows one): the sign and red keep their meaning (negative); favourability, if shown, is an icon or a label, never a second meaning of red (R§5.3).

### 4. Interaction and keyboard
- **One shortcut registry** in `packages/ui`: each shortcut is defined once, and its tooltip text, the cheat sheet and `aria-keyshortcuts` come from that definition. Keys are matched on `KeyboardEvent.key` when it is Latin and on `KeyboardEvent.code` otherwise, so shortcuts work with the Arabic layout active (R§8). macOS shows ⌘ where Windows shows Ctrl.
- **Global keys:** Ctrl/⌘+K command palette (with a visible button as a second route); Ctrl/⌘+/ the shortcut cheat sheet; Esc closes the top layer. Never bound: Ctrl+N, T, W, L, D, F, P, S and the browser's other reserved keys (R§8). A key without a modifier works only inside the focused component that owns it (WCAG 2.1.4).
- **Grids** follow the WAI-ARIA grid pattern and Excel (R§4.1, R§4.2):
  - navigation mode: arrows move visually (Left moves to the next column in RTL), Tab and Shift+Tab move in reading order and wrap rows, Home/End, Ctrl+Home/End, Page Up/Down; Shift+arrows, Shift+click, Ctrl+A and Shift/Ctrl+Space select ranges;
  - editing mode: typing replaces, F2 edits with the caret at the end, Enter commits and moves down (an entry grid may move to the next cell instead), Esc cancels, Delete clears;
  - Ctrl+C copies the selection as TSV (and an HTML table), Ctrl+V pastes TSV with every cell validated before anything changes (no partial paste), Ctrl+D fills down;
  - a selection summary bar shows count, sum, average, minimum and maximum of the selected figures, per currency and per kind of amount (transaction, book, parallel), computed by the money module: a transaction amount in USD and a parallel amount in USD are never added together;
  - entry grids add F8 copy the cell above, Ctrl+Insert and Ctrl+Delete insert and delete a line, Alt+Down opens a lookup and Ctrl+Enter posts (S03 confirms the set).
- **Amount input:** typed in major units; accepts Latin and Arabic-Indic digits and the Arabic decimal and thousands separators, so an Arabic keyboard layout works; more decimals than the currency allows are refused, never rounded; an expression starting with `=` (`+ − × ÷` and parentheses) is evaluated exactly and rounded once, half away from zero, when committed, and the expression itself is not stored (as QuickBooks' QuickMath, R§2). Parsing and evaluation live in the money module (ADR 0007).
- **A refused amount blocks saving:** while an amount input shows refused text, its last committed amount still stands behind it, so a form or grid never posts or saves while any of its amount inputs reports an error (S03 tests it on the entry grid).
- **Focus:** the identity's 2 px ring. In grids the active cell has a 2 px inset ring so it never overlaps a neighbour; sticky headers and totals reserve scroll padding so they never hide the focused cell (WCAG 2.4.11).
- **Errors:** validated on commit (blur, Enter, Tab), never while typing; next to the field with an icon and text, never color alone; `aria-invalid` and `aria-describedby`; on submit an error summary takes focus and links to each field. Running balances are announced through a polite live region on commit. Entered data is never cleared by an error (R§8).

### 5. The accounting component catalogue

| Component | Behaviour | When |
|---|---|---|
| **Amount** | §3: from `bigint` minor units and a currency, Latin tabular digits, grouping, the currency's exponent, sign and `negative` color, LTR isolate, optional code, zero option, bold without drift, never truncated | Phase 0 (PR 6) |
| **Amount input** | §4: major units to minor through the money module, Arabic-Indic digits accepted, no rounding of typed decimals, `=` expressions, `allowNegative` off for debit and credit cells | Phase 0 (PR 6) |
| **Account label** | The account code as an LTR isolate before the name in `dir="auto"`; a blocked or header account is marked with an icon and text | Phase 0 (PR 6) |
| **Ledger switch** | Book (SYP) or parallel (USD): a two-option toggle with the currency code, keyboard and screen-reader ready; the labels come from i18n | Phase 0 (PR 6) |
| **Period badge** | Open, closed or reopened, with icon and text (lock for closed), never color alone | Phase 0 (PR 6) |
| **Keyboard key and shortcut registry** | §4; the `Kbd` chip shows the platform's keys | Phase 0 (PR 6) |
| **Data grid foundation** | §4 grids: APG roles, roving focus, range selection, copy and paste with Excel, fill down, the selection summary bar, a sticky header, footer and start column; data wiring is the specs' | Phase 0 (PR 6b) |
| **Command palette** | Ctrl/⌘+K, combobox pattern, actions and navigation with their shortcuts | Phase 0 (PR 6b); its commands arrive with each spec |
| **Entry grid** | The grid foundation with debit and credit, the running difference in each ledger, the entry keys | S03 |
| **Account picker, dimension picker** | Search by code or name, blocked and header accounts not selectable; required dimensions | S02, S03 |
| **Date input** | `t` today, `+`/`−` a day, typed formats, the period badge beside it | S03 |
| **Report table** | The grid foundation read-only, with TanStack Table for grouping and pinning and TanStack Virtual for long reports; rules above subtotals and double rules under grand totals; drill-down from any figure | S09 |
| **Print layouts** | A4 Arabic, paginated on the server so each page's carried-forward totals are exact, company header, "Powered by Vertex Mizan" footer with the print date and page *n* of *m* (Chromium margin boxes) | S09 |

**Build, not buy, for the grid** (R§4.3): the libraries that have range selection, clipboard and a summary bar charge for them (AG Grid Enterprise, MUI X Premium), are proprietary (Handsontable) or draw on canvas without documented RTL (Glide). The grid's logic (navigation, selection, clipboard parsing, fill, summaries) is a pure module tested without a browser; its React component renders DOM cells with logical CSS.

### 6. Copied from Hub, and adapted
- **Copied:** the theme (`theme.css`, `base.css`, `fonts.css`), `cn`, motion, and the general components the catalogue and the first specs use: button, icon button, input, field, textarea, select, checkbox, switch, tabs, toggle group, tooltip, popover, dialog, alert dialog, dropdown menu, badge, callout, card, table, skeleton, empty state, page header, toast, the logo and the ascent lines.
- **Adapted:** every size reads the density variables (§2) instead of fixed heights; tables use the row height and tabular figures; icon buttons keep a 24 px hit area in compact.
- **Not copied:** Hub's workflow-specific components (platform mark, OTP field, radio card, meter, progress, color swatch, calendar grid, password input, multi-combobox, autocomplete). A spec that needs one copies it then.
- `packages/tokens` follows Food's structure (palette, semantic roles, scales, contrast) plus the densities, and is the single source the theme is tested against.

### 7. A missing component is built in the design system first (owner, 2026-10-21)
When a screen needs something the design system does not have, it is not drawn inside the screen. It is built first in `packages/ui` as a general component, then the screen uses it:
- **General:** named and shaped for what it does in accounting work (an account picker, a period range), not for the screen that asked for it; its data and labels come in as props, so the next screen reuses it.
- **Built for accountants:** both densities through the density utilities; figures only through `Amount` and `AmountInput`; keyboard-complete with its keys in the keymap; focus, error and RTL rules of §3 and §4; Base UI primitives where one exists.
- **Tested and shown:** its own tests (behaviour, keyboard, accessibility, RTL), and a place on the design-system page (the preview until `apps/web`), so the owner and reviewers see it in both themes and densities.
- **Hub first:** if Vertex Hub has the component, it is copied and adapted (§6) rather than written anew.
- **Composition stays in the app:** a screen arranges design-system components and binds them to data; it does not style controls of its own. A pattern that two screens repeat moves into `packages/ui`.

The `reviewer` checks it on every front-end change, and `/feature-slice` builds the missing components before the screens.

## Consequences
- ADR 0009's component table is refined by §5; its decisions on identity, negatives, company branding and the UI rules stand.
- Phase 0's brand and design-system item is split: PR 6 brings the research, this ADR, `brand/`, `packages/tokens`, `packages/i18n`, `packages/ui` with the densities and the PR 6 components, and a preview; PR 6b brings the data grid foundation and the command palette.
- The money module gains formatting, parsing, exact expression evaluation and summaries of amounts (ADR 0007's "one money module"), so no screen does arithmetic on amounts.
- Decisions left to their specs, not guessed here: zero as a dash and column order in statements (S09), the Syrian legal content of printed books (S09), the entry grid's final key set and Enter behaviour (S03).
