# Research: a design system for accountants

- **Date:** 2026-10-21
- **Purpose:** ground the design-system decisions of ADR 0010 (which amends ADR 0009): density, type for data, the accounting components, keyboard and focus rules, the data grid, and print. The owner delegated every design-system decision (2026-10-21); accounting and business decisions stay with the owner.
- **Method:** five parallel desk-research passes (web search, vendor documentation, W3C and WAI specifications, library repositories and bundle data), the read-only references `D:\vertex-hub` and `D:\vertex-food`, and our own measurements of the shipped font files with fontTools (§5.1). No user interviews yet.
- **Labels** (as in `market-syria.md`):

| Label | Meaning here |
|---|---|
| **CONFIRMED** | Read in a specification, official documentation, source code, or measured by us. |
| **REPORTED** | Several consistent secondary sources, or an official page read only through a search summary. |
| **UNVERIFIED** | One weak source, inference or memory. Nothing is built on it without a test or an owner decision. |

---

## 1. Summary

1. **Accountants want density and the keyboard, not decoration.** The strongest entry experience among the products studied is Business Central's: Tab across cells, a key to copy the cell above (F8), insert and delete line keys, a lookup key, paste of rows from Excel, `t` for today in date fields. Xero and QuickBooks users complain about exactly what is missing there: Tab order, inserting a line in the middle, keyboard dates (§2).
2. **Density is a mode, chosen per device with a user override.** SAP Fiori separates *cozy* (touch, 44 px targets) from *compact* (mouse and keyboard, 32 px rows), keeps the font size constant across modes, and states that compact does not support touch. Salesforce lets each user switch. Pointer media queries are a reasonable default but unreliable on hybrid devices, so the setting must be explicit (§3).
3. **A 28 px compact row conforms to WCAG 2.2.** SC 2.5.8 asks for 24 × 24 CSS px targets; a cell 28 px high meets it with no exception. Only icons inside rows need their hit area enlarged to 24 px (§3.3).
4. **Montserrat's default digits are proportional in the shipped files.** We measured `@fontsource/montserrat` 5.3.0: the `1` is 361 units wide and the `0` 662. The `tnum` feature exists and its digits are 700 units wide in every weight, 400 to 700. Columns of numbers align only if `tabular-nums` is applied, and Hub never applies it (§5.1).
5. **Bold totals drift by their separators, not their digits.** Tabular digits keep 700 units across weights, but the comma and the full stop grow from 212 (400) to 262 (700) units. A bold `1,250,000,000.00` therefore sits about 2.6 px off a regular one at 13 px. Rendering separators at the regular weight inside bold figures removes the drift (§5.1).
6. **Negative numbers break in RTL without isolation.** A leading minus is a bidi neutral, so `-1,250.00` renders as `1,250.00-` in an Arabic paragraph. The whole signed string must sit in one LTR isolate (§6.1).
7. **No grid library fits.** The features accountants expect from a grid (range selection, clipboard, fill, status bar) are paid tiers in AG Grid and MUI X; Handsontable is proprietary; Glide is canvas-based with no documented RTL. A DOM grid built to the WAI-ARIA grid pattern, with our own keyboard, selection and clipboard layer, fits ADR 0002 and the RTL rules (§4).
8. **Print legal books from the server.** Chromium 131 supports `@page` margin boxes with `counter(page)` and `counter(pages)`, but carried-forward totals per page cannot be computed in CSS. Deterministic server-side pagination with explicit carried-forward rows is the safe route (§7).

---

## 2. How accounting and ERP products serve accountants

| Product | What we found | Label |
|---|---|---|
| **Dynamics 365 Business Central** | Alt+N new line in an editable list; Ctrl+Insert / Ctrl+Delete insert and delete document and journal lines; **F8 copies the cell above** ("F8, then Tab" to fill a repeated line); Alt+Down opens a lookup; Alt+Up shows the field's error; F2 toggles select-all and caret-at-end; Ctrl+Enter save and close, Alt+Shift+N "OK & New"; F9 posts; `t` today and `w` work date in date fields; Quick Entry: Enter moves to the next quick-entry field; Ctrl+C / Ctrl+V copy rows to and from Excel; action tooltips show the shortcut; shortcuts refer to the US layout. [MS Learn, keyboard shortcuts](https://learn.microsoft.com/en-us/dynamics365/business-central/keyboard-shortcuts) | CONFIRMED |
| **Tally Prime** | Ctrl+A accepts the screen, Esc goes back, F2 changes the voucher date, Alt+C creates a master during entry, Alt+2 duplicates a voucher, a calculator panel from an amount field. [Tally help](https://help.tallysolutions.com/tally-prime/welcome-to-tally-prime/keyboard-shortcuts-tally-prime). Enter-to-advance and auto-balancing were not confirmed. | CONFIRMED (keys) · UNVERIFIED (auto-balance) |
| **Odoo 17** | Ctrl/Cmd+K command palette; Alt-based shortcuts on Windows, Ctrl on Mac; holding Alt overlays every element's shortcut. [Odoo docs](https://www.odoo.com/documentation/17.0/applications/essentials/keyboard_shortcuts.html). Marketplace add-ons that add arrow-key navigation to editable lists suggest the stock lists are weak. | CONFIRMED · UNVERIFIED (weakness) |
| **QuickBooks Online** | Date fields: `+` / `-` next and previous day, `T` today; Alt+Down opens the calendar; amount fields accept a formula resolved on Tab and not stored ("QuickMath"). [Intuit](https://quickbooks.intuit.com/learn-support/en-us/help-article/small-business-processes/use-shortcuts-quickmath-keyboard-shortcuts/L7PH4ia1K_US_en_US). Users report slower entry after tab-order changes. | REPORTED |
| **Xero** | Manual journals are Tab-driven; users ask for Enter to the next cell, inserting a line anywhere, and keyboard dates. [Xero ideas 1](https://productideas.xero.com/forums/967133-reports-tax/suggestions/51721248-new-manual-journals-use-enter-for-keyboard-nav), [2](https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/45752707-manual-journal-ability-to-add-a-line-anywhere), [3](https://productideas.xero.com/forums/967133-reports-tax/suggestions/51238225-keyboard-shortcuts-improve-data-input-speed) | REPORTED |
| **Sage Intacct** | Alt+S save, Alt+W save and new, Alt+P pick list. [Intacct help](https://www.intacct.com/ia/docs/en_ZA/help_action/Intacct_basics/Data_entry/shortcut-keys.htm) | CONFIRMED |
| **Zoho Books** | Navigation shortcuts (Shift+J journals), customisable keys. [Zoho](https://www.zoho.com/uk/books/help/getting-started/keyboard-shortcuts.html) | REPORTED |
| **NetSuite / Oracle Redwood** | Users asked for a compact Redwood theme "to see more data without browser zoom" ([FR-2937](https://apexapps.oracle.com/pls/apex/apex_pm/fr/r/FR-2937)); Oracle SCM added an opt-in compact mode ([readiness](https://docs.oracle.com/en/cloud/saas/readiness/scm/25c/demand25c/25C-demand-wn-f38235.htm)). | REPORTED |

Not found for any product: published row heights, font sizes, or rules for negatives and totals. We did not guess them.

**Patterns to adopt:** Tab and Enter advance through cells; copy the cell above with one key; insert and delete line keys; save-and-new; a lookup opened from the keyboard; date keys inside date fields only; a formula in an amount field resolved on commit; paste from Excel; shortcuts shown in tooltips. **Not a found convention:** an auto-balancing last line: if Mizan offers it, it is an explicit key, never silent.

## 3. Density and touch targets

### 3.1 Design systems

| System | Values | Rule for choosing | Label |
|---|---|---|---|
| **SAP Fiori** | Cozy targets 2.75 rem (44 px); compact rows and toolbars 2 rem (32 px); condensed only together with compact; font size unchanged across modes | Cozy on touch, compact on mouse and keyboard, set explicitly; the Launchpad offers a user setting on hybrids; "compact and condensed do not support touch" | REPORTED ([cozy/compact](https://www.sap.com/design-system/fiori-design-web/v1-151/foundations/visual/cozy-compact), [tree table](https://www.sap.com/design-system/fiori-design-web/v1-139/ui-elements/tree-table/usage)) |
| **IBM Carbon** | Data-table rows xs 24, sm 32, md 40, lg 48, xl 64 px; row text 14 px; the header row matches the row size | Sizes only, no switching rule | CONFIRMED ([Carbon](https://carbondesignsystem.com/components/data-table/style/)) |
| **Material 3 / MDC** | Density 0 to −3 in 4 px steps (height = baseline + 4 × scale); density disables the touch target; minimum touch target 48 dp | Per component | CONFIRMED ([MDC density](https://github.com/material-components/material-components-web/blob/v14.0.0/packages/mdc-density/README.md)) |
| **Fluent 2** | Icon buttons 24 / 32 / 40 px; 4 px spacing base; 44 px touch target on web and iOS | Per component | CONFIRMED ([Fluent source](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/react-components/react-button/library/src/components/Button/useButtonStyles.styles.ts), [layout](https://fluent2.microsoft.design/layout)) |
| **Salesforce Lightning** | Comfy (labels above) and Compact (labels beside, half the card padding) | Org default, each user switches | REPORTED ([Winter '19](https://developer.salesforce.com/blogs/2018/08/new-density-settings-for-the-lightning-experience-ui-in-winter-19)) |
| **Atlassian** | 8 px base unit; density described as a future goal | — | CONFIRMED ([spacing](https://atlassian.design/foundations/spacing)) |

### 3.2 Pointer detection

`pointer` describes the primary input only; `any-pointer` can match both `coarse` and `fine` on hybrids ([MDN](https://developer.mozilla.org/docs/Web/CSS/@media/any-pointer), CONFIRMED). On iPad, a WebKit bug reported `pointer: fine` false even with a mouse ([WebKit 210024](https://bugs.webkit.org/show_bug.cgi?id=210024), UNVERIFIED for today). **Conclusion:** `(pointer: coarse)` is a default, never the decision; an explicit user setting wins.

### 3.3 Touch targets (WCAG 2.2)

- **SC 2.5.8 Target Size (Minimum), AA:** 24 × 24 CSS px, or the 24 px spacing circle, or an equivalent control, or inline, user-agent or essential exceptions. Its own examples: 24 px high menu items pass, 18 px fail. ([Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), CONFIRMED)
- **SC 2.5.5 Target Size (Enhanced), AAA:** 44 × 44, with no spacing exception. ([Understanding 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), CONFIRMED)
- **Consequence:** a 28 px row or a 32 px control conforms to AA directly. A 16 px icon inside a row needs a 24 px hit area (padding or a pseudo-element), or 8 px between neighbours. The comfortable mode's 44 px meets AAA.
- **iOS zooms into inputs below 16 px** when they receive focus (UNVERIFIED here; widely known). Touch inputs therefore use 16 px text.

## 4. Spreadsheet-grade grids

### 4.1 Excel behaviour accountants expect

From [Excel keyboard shortcuts](https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-excel-1798d9d5-842a-42b8-9c99-9b7213f0040f) (CONFIRMED unless marked): arrows move one cell; Ctrl+Arrow to the edge of the data region; Tab one cell forward; Enter completes and moves down, Shift+Enter up; F2 edits with the caret at the end; typing replaces the content; Esc cancels; Delete clears; Home to the row start, Ctrl+Home to A1; Shift+Arrow extends the selection; Ctrl+Space column, Shift+Space row; Ctrl+A all; Ctrl+D fills down; Ctrl+; today. Ctrl+R fill right and Enter wrapping inside a selection: UNVERIFIED for Windows.

- **Status bar:** Sum, Count, Average, Min, Max over numeric cells; AG Grid implements the same five ([AG Grid](https://www.ag-grid.com/javascript-data-grid/status-bar/), CONFIRMED for AG Grid; REPORTED for Excel).
- **Clipboard:** Excel writes `text/plain` as tab-separated values, one row per line; a cell holding a tab or a newline is quoted "often but not always", so a reader must accept both ([MS Q&A](https://learn.microsoft.com/en-us/answers/a/11523854), REPORTED). The Windows "HTML Format" is a UTF-8 fragment with byte offsets ([CF_HTML](https://learn.microsoft.com/en-us/windows/win32/dataxchg/html-clipboard-format), CONFIRMED); browsers expose it as `text/html`.
- **RTL sheets:** whether Excel's arrows are visual or logical in a right-to-left sheet: UNVERIFIED (one unresolved Microsoft Q&A thread). Handsontable documents Tab as "next column, one cell to the left" in RTL ([Handsontable](https://handsontable.com/docs/javascript-data-grid/keyboard-shortcuts/), CONFIRMED for Handsontable).

### 4.2 The WAI-ARIA grid pattern

From [APG grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) (CONFIRMED): roles `grid`, `row`, `columnheader`, `rowheader`, `gridcell`; one cell in the tab sequence (roving tabindex in the examples); `aria-rowcount` and 1-based `aria-rowindex` when rows are virtualised; `aria-selected` on selected cells; **navigation mode** (arrows, Home/End, Ctrl+Home/End, Page Up/Down, Shift+Arrow) and **editing mode** (Enter or F2 to edit, Esc back). APG describes arrows visually ("Right Arrow moves focus one cell to the right").

### 4.3 Libraries

| Library | Licence | Size (min+gz) | RTL | Grid features | Label |
|---|---|---|---|---|---|
| AG Grid Community / Enterprise | MIT / commercial | ≈ 377 KB | `enableRtl`, initial only | Range selection, clipboard, fill, status bar, grouping: **Enterprise** | CONFIRMED ([licensing](https://www.ag-grid.com/javascript-data-grid/licensing/)) |
| Handsontable | Proprietary since 7.0 | ≈ 353 KB | `layoutDirection: 'rtl'` (12.0+) | Full spreadsheet; commercial use needs a paid licence | CONFIRMED ([licence](https://handsontable.com/docs/javascript-data-grid/software-license/)) |
| Glide Data Grid | MIT | ≈ 64 KB | Not documented | Canvas: no DOM text, Arabic shaping and print are our problem | CONFIRMED ([repo](https://github.com/glideapps/glide-data-grid)) |
| MUI X Data Grid | MIT / Pro / Premium | ≈ 125 KB | Not checked | Range selection and clipboard paste: **Premium** | CONFIRMED ([licensing](https://mui.com/x/introduction/licensing/)) |
| react-data-grid | MIT | ≈ 21 KB | `direction="rtl"` | Frozen columns, summary rows, copy and paste callbacks; no range selection; still `7.0.0-beta` | CONFIRMED ([repo](https://github.com/adazzle/react-data-grid)) |
| RevoGrid | MIT + Pro | ≈ 64 KB | Yes | Web components; multi-range is Pro | CONFIRMED ([repo](https://github.com/revolist/revogrid)) |
| TanStack Table + Virtual | MIT | ≈ 32 + 10 KB | Headless | Column model, pinning, grouping and aggregation as state; no markup, keyboard or clipboard | CONFIRMED ([overview](https://tanstack.com/table/latest/docs/overview), [Virtual](https://tanstack.com/virtual/latest/docs/introduction)) |

Sizes from the Bundlephobia API (REPORTED: main asset, not tree-shaken).

**Verdict:** build the grid. Keyboard, selection, clipboard and the summary are a few hundred lines of pure logic that we can test exhaustively; the libraries that have them charge for them, draw on canvas, or bring a second styling system. TanStack Table and Virtual remain the choice when the report table needs a column model, grouping and virtualisation (S09).

### 4.4 Virtualisation and sticky parts

- A journal entry rarely exceeds 200 lines: no virtualisation there. General-ledger and account-statement reports run to tens of thousands of rows: virtualised, with `aria-rowcount` and `aria-rowindex` (APG). The thresholds are our estimate (UNVERIFIED).
- Sticky header and footer use `top` / `bottom`; pinned columns use `inset-inline-start` so they flip with `dir` (CSS logical properties, CONFIRMED by specification).
- In RTL, `scrollLeft` is 0 at the start (right) and negative towards the end ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollLeft), CONFIRMED).

## 5. Presenting financial numbers

### 5.1 Our measurements of the shipped fonts

Measured with fontTools on `@fontsource/montserrat` 5.3.0 and `@fontsource/noto-kufi-arabic` 5.3.0 (CONFIRMED, reproducible):

| Font file | Finding |
|---|---|
| Montserrat latin 400 / 500 / 700 | GSUB features: `ccmp dnom frac liga locl numr pnum tnum`. No `lnum`/`onum`: the default figures are lining. **Default digits are proportional**: `0` 662, `1` 361, `4` 661 units (400). |
| Montserrat `tnum` digits | **700 units in every weight** (400, 500, 600, 700): tabular figures align across weights. |
| Montserrat separators | `,` and `.`: 212 (400), 227 (500), 244 (600), 262 (700) units. Hyphen-minus 382–386. U+2212 is covered. |
| Montserrat metrics | 1000 units per em, ascent 968, descent −251, cap height 700, x-height 525. |
| Noto Kufi Arabic (arabic and latin subsets) | Ascent 1282, descent −615: **the content area is 1.9 em**, 24.7 px at 13 px. It also covers Latin and digits, so a failed Montserrat load would silently change the digit font. |

Consequences:
- `font-variant-numeric: tabular-nums` must be applied wherever numbers stack; it is not the default (an explorer source said the opposite about the upstream font: our measurement of the shipped files wins).
- A bold figure is wider than a regular one only by its separators: 50 units per separator at 700. Four separators at 13 px misalign the leading digits by ≈ 2.6 px. Setting the separators of a bold figure at weight 400 makes both widths identical.
- A cell that clips (`overflow: hidden`) must be at least 1.9 em high for Arabic, or diacritics and descenders are cut: 28 px holds 13 px text with 1.6 px to spare on each side.

### 5.2 Practice

- **Alignment:** numbers right-aligned with the same number of decimals per column, so decimals align without a decimal-align mechanism ([Masnick](https://maxmasnick.nfshost.com/projects/datatips/guidelines/alignment-in-tables), [Roselli](https://adrianroselli.com/2013/05/my-kingdom-for-decimal-alignment-on.html); REPORTED). Because the least significant digit is at the right of an LTR number, decimal alignment requires the **physical right edge** in an RTL page too (our reasoning). Arabic statement practice: UNVERIFIED (no authoritative source found; Manager.io mirrors the whole layout).
- **Negatives:** Excel's Accounting format uses parentheses and shows zero as a dash ([Microsoft](https://support.microsoft.com/en-us/excel/format-numbers-as-currency-in-excel-for-the-web), CONFIRMED). The owner chose a minus sign and red everywhere (ADR 0009), so `currencySign: "accounting"` is never used and Excel exports carry a custom format.
- **Zero:** `0.00` in ledgers and grids; a dash is common in statements (REPORTED for Excel; UNVERIFIED as statement practice). It is a presentation choice for the statements spec (S09).
- **Totals:** a single rule above a subtotal, a double rule under a grand total, bold (REPORTED: [1](https://thebricks.com/resources/how-to-apply-double-accounting-underline-format-in-excel), [2](https://techaccountingpro.substack.com/p/opinionated-guide-on-financial-statement)).
- **Scaling:** IAS 1.51 requires the presentation currency and the level of rounding to be shown prominently; thousands or millions are acceptable when disclosed (REPORTED, third-party copy of the text). Screens and ledgers show full figures; only a statement may scale, with the unit in its header.
- **Large numbers:** SYP amounts reach 13 digits. Never abbreviate or truncate a figure; size columns to the widest realistic value and scroll the table, not the page (our rule; no product source found).
- **WCAG:** 1.4.1 forbids colour as the only cue: the minus sign satisfies it ([Understanding 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)); 1.4.3 needs 4.5:1 for the red text on every surface it appears on ([Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)). CONFIRMED.

### 5.3 IBCS

IBCS (aligned with ISO 24896; full text paywalled, [ibcs.com](https://www.ibcs.com/standards/), CONFIRMED that it exists) uses scenario labels AC, PY, PL, FC; solid, outlined and hatched marks; and **red and green for unfavourable and favourable variances only**, with an explicit `+` on positive variances ([Zebra BI](https://zebrabi.com/?p=4236), REPORTED). Its red collides with Mizan's red-for-negative: a cost decrease is a negative variance that is favourable. Mizan keeps red for the sign (owner rule) and, where a report shows favourability (management reports, later phases), marks it with an icon or a label, never with a second meaning of red. IBCS is relevant to management reporting, not to the statutory books of phase 1.

## 6. Arabic RTL with LTR numbers

### 6.1 Bidi

- A leading `-` or U+2212 is not between two numbers, so UAX #9 rules W4/W6 make it a neutral that resolves to the RTL embedding: `-1,250.00` renders `1,250.00-` ([UAX #9](https://www.unicode.org/reports/tr9/), [W3C](https://www.w3.org/International/articles/inline-bidi-markup/uba-basics); CONFIRMED rules, our application).
- `<bdi dir="ltr">` and `<span dir="ltr">` with isolation are equivalent; CSS `unicode-bidi` alone is discouraged because direction belongs in markup ([MDN bdi](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/bdi), [W3C](https://www.w3.org/International/questions/qa-html-dir); CONFIRMED).
- Plain-text outputs (CSV, PDF text, clipboard) have no markup: they use U+2066–U+2069 isolates only where needed, and ASCII hyphen-minus for the sign, because Excel is reported not to parse U+2212 as negative ([SDMX docs](https://fmrwiki.sdmx.io/12.2.0/admin/configuration/MinusSymbolsInTheRegistry/), REPORTED; untested).
- `ar-SY` defaults to Arabic-Indic digits in ICU: every formatter forces `-u-nu-latn` (Food's `formatLocale`). Money is formatted by the money module, not by `Intl`.
- Account names mixing scripts ("مصاريف Google Ads") are user content: `dir="auto"` or `<bdi>`; codes and numbers are explicitly LTR.
- **Input:** Arabic keyboards type Arabic-Indic digits (٠–٩) and the Arabic decimal and thousands separators (U+066B, U+066C); an amount input that accepts only ASCII forces the user to switch layout (our inference from the key layout; UNVERIFIED as a measured complaint).

### 6.2 Fonts

- Hub's stack `"Montserrat", "Noto Kufi Arabic", system-ui, sans-serif` makes Montserrat draw every Latin letter and digit (CONFIRMED in `D:\vertex-hub\packages\ui\src\styles\theme.css`). Hub's identity says Noto Kufi's faces cover "Arabic only": true of the subsets Hub imports, not of the font (§5.1).
- Arabic needs line heights of 1.5–1.8; Hub's scale uses 1.5–1.6 (REPORTED practice). No authoritative minimum size for Noto Kufi Arabic was found; we keep Arabic at 12 px or more and data at 13 px (UNVERIFIED as a standard; consistent with Hub's `sm` table text).
- `text-box-trim` became Baseline in August 2026 ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/text-box-trim), CONFIRMED); useful for optical centring of single-line labels, not for Arabic paragraphs or print.

### 6.3 Layout

- `dir="rtl"` and `lang="ar"` on `<html>`; logical properties only (CONFIRMED, W3C).
- Mirror directional icons (arrows, chevrons, back/forward, indent); never checkmarks, plus/minus, clocks, play controls or logos (common practice, UNVERIFIED for Lucide).
- Arrow keys in RTL grids: APG is visual; we follow it (our decision, §4.2).

## 7. Print layouts for legal books

- **Chromium 131** added `@page` margin boxes (16 boxes such as `@top-center`, `@bottom-center`) with `counter(page)` and `counter(pages)` in print and PDF ([Chrome blog](https://developer.chrome.com/blog/print-margins), CONFIRMED). `size: A4` is 210 × 297 mm ([CSS Paged Media 3](https://www.w3.org/TR/css-page-3/), CONFIRMED). Not supported: `string-set`, `target-counter`.
- **Playwright `page.pdf()`** accepts `headerTemplate` / `footerTemplate` with `pageNumber` and `totalPages`; templates run no script and see no page styles ([Playwright](https://playwright.dev/docs/api/class-page#page-pdf), CONFIRMED).
- **Carried-forward totals** ("رصيد منقول" / "ما قبله") cannot be computed in CSS, which does not know where pages break. Report tools compute them in a page event ([Stimulsoft forum](https://forum.stimulsoft.com/viewtopic.php?p=5415), REPORTED). For exact books: paginate on the server with a known row height, compute each page's totals in `packages/ledger`, and emit one section per page with explicit carried-forward rows (our recommendation).
- Repeating `<thead>` and `break-inside: avoid` on rows in Chromium PDFs, and Arabic font embedding: UNVERIFIED, to test in the print pipeline (S09).
- **Syrian practice** for the journal (دفتر اليومية) and the general ledger (دفتر الأستاذ): sequential page numbers and a company header are common Arab practice; Syrian legal requirements for printed books: **UNVERIFIED**. The print layout's legal content is an owner decision with S09.

## 8. Keyboard, command palette, focus and errors

- **Command palette:** the WAI-ARIA combobox pattern (`role=combobox`, `aria-activedescendant`, focus stays in the input; [APG combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/), CONFIRMED). Ctrl+K focuses the browser's search bar in Chrome, Edge and Firefox unless the page prevents it; Odoo and GitHub use it anyway, with a visible button as a second route (REPORTED).
- **Reserved browser keys:** Ctrl+N, T, W, Shift+N, Shift+T, Tab cannot be reliably intercepted (UNVERIFIED list; treated as unusable).
- **Keyboard layouts:** `KeyboardEvent.key` is the character after the layout, `code` the physical key ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code), CONFIRMED). With an Arabic layout active, Ctrl+K arrives with an Arabic `key`; matching `key` when it is Latin and falling back to `code` when it is not keeps shortcuts working (PeerTube's fix, REPORTED).
- **WCAG 2.1.4 (A):** single-character shortcuts must be remappable, switchable off, or active only while their component has focus ([Understanding 2.1.4](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html), CONFIRMED). Date keys inside a focused date field qualify; a global `?` needs an alternative.
- **Focus:** 2.4.7 Focus Visible (AA); 2.4.11 Focus Not Obscured (AA): sticky headers and totals must not hide the focused cell, so scroll padding equals their height; 2.4.13 Focus Appearance (AAA): a 2 px perimeter with 3:1 change (CONFIRMED, WCAG 2.2).
- **Errors:** validate on blur or commit, never while typing; keep the message next to the field; icon plus text, never colour alone; NN/g discourages tooltip-only errors ([NN/g](https://www.nngroup.com/articles/errors-forms-design-guidelines/), CONFIRMED). On submit, an error summary that takes focus and links to each field ([GOV.UK](https://design-system.service.gov.uk/components/error-summary/), CONFIRMED). `aria-invalid` with `aria-describedby`; a polite live region for running balances, announced on commit (UNVERIFIED as a cited rule; standard ARIA).
- **Discoverability:** `aria-keyshortcuts` only exposes a shortcut to assistive technology ([MDN](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-keyshortcuts), CONFIRMED); tooltips and a cheat sheet must display them. Define each shortcut once and derive the tooltip, the cheat sheet and the ARIA attribute from it.

## 9. Not confirmed, and where we looked

- Excel's arrow direction in an RTL sheet, its exact clipboard quoting, Enter inside a selection, Ctrl+R on Windows (Microsoft support pages, Q&A; to test in Excel when the entry grid is wired, S03).
- Excel and U+2212 (one technical source): exports use ASCII hyphen-minus until tested.
- Row heights and fonts of Xero, QuickBooks, NetSuite, Odoo, Zoho (not published).
- Syrian legal requirements for printed books (owner decision with S09).
- Arabic statement column practice (owner review of a sample with S09).
- Chromium's `<thead>` repetition and Arabic font embedding in PDFs (test in S09).
