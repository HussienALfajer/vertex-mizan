# Vertex Mizan — Visual Identity

The single reference for how Vertex Mizan looks (ADR 0009, ADR 0010). It is the Vertex identity of Vertex Hub (`D:\vertex-hub\brand\identity.md`), copied and adapted; changes to the shared identity are made in Vertex Hub first and copied, so the Vertex systems do not drift apart. This repository only reads Vertex Hub (`AGENTS.md`): a shared change is a separate task in Vertex Hub that the owner authorises, then copied here. Mizan's adaptations for accounting work are §10. Derived from the Vertex logo (`brand/logo/`). `packages/tokens` implements these values and `packages/ui` uses them; if they disagree, this file wins until it is changed deliberately, and the token tests fail.

## 1. What the logo says

| Logo trait | Meaning | How the product uses it |
|---|---|---|
| A peak built from three parallel strokes | *Vertex* = the summit; progress upward | Progress and "reaching the goal" moments (an entry balanced, a period closed) |
| Strokes at a constant 60° angle, equal gaps | Order, rhythm, precision | The **60° diagonal** is the signature motif; a strict 4 px spacing grid |
| Sharp corners, flat fills, no gradients | Confident, architectural, calm | Small radii, flat surfaces, borders over shadows |
| Deep green + sand gold | Trust and growth + premium craft | Green carries structure and action; gold is a rare accent |
| Geometric sans wordmark, wide-tracked "MIZAN" | Modern, clean | Montserrat for Latin text; tracking only on Latin overlines |

## 2. Color

### Brand colors (sampled from the logo)

| Name | Hex | OKLCH | Role |
|---|---|---|---|
| **Vertex Green** | `#004139` | 0.337 0.061 181.4 | Primary: structure, navigation, primary actions |
| **Vertex Sand** | `#B9A87A` | 0.735 0.065 90.1 | Accent: highlights, active states, key moments |
| White | `#FFFFFF` | — | Surfaces |

### Tonal scales

Generated in OKLCH around the brand hues; the brand colors sit at `green-800` and `gold-400`.

| Step | green | gold | neutral (green-tinted) |
|---|---|---|---|
| 50 | `#E8FCF8` | `#FCF7E7` | `#F4F8F7` |
| 100 | `#DBF3EE` | `#F3EDDA` | `#E7EFED` |
| 200 | `#C2E1DA` | `#E1D9C1` | `#D4DBD9` |
| 300 | `#A0C7BF` | `#C8BD9E` | `#B8BFBE` |
| 400 | `#77AAA1` | **`#B9A87A`** | `#99A09F` |
| 500 | `#4E8E83` | `#907F4F` | `#7B8280` |
| 600 | `#307369` | `#766434` | `#616866` |
| 700 | `#235B52` | `#5D4E27` | `#4B5150` |
| 800 | **`#004139`** | `#433819` | `#353B39` |
| 900 | `#0B2D28` | `#2E260E` | `#222827` |
| 950 | `#031B17` | `#1B1505` | `#121716` |

### Status colors

Kept visibly distinct from the brand: success is a brighter emerald (not Vertex Green), warning is orange-amber (not Vertex Sand).

| Step | success | warning | danger | info |
|---|---|---|---|---|
| 50 | `#E5FFE9` | `#FFF5EE` | `#FFF4F2` | `#F0F8FF` |
| 100 | `#D4F8DA` | `#FEE8D8` | `#FEE7E3` | `#DEEFFE` |
| 500 | `#3C9555` | `#BB6814` | `#D54A43` | `#3786C3` |
| 600 | `#167A3A` | `#97520A` | `#B62926` | `#116BA7` |
| 700 | `#09602B` | `#783F04` | `#921B1A` | `#055485` |

### Semantic roles

| Role | Light theme | Dark theme |
|---|---|---|
| App background | neutral-50 `#F4F8F7` | green-950 `#031B17` |
| Surface (cards, panels) | white | green-900 `#0B2D28` |
| Text | neutral-900 `#222827` | neutral-100 `#E7EFED` |
| Muted text | neutral-600 `#616866` | neutral-300 `#B8BFBE` |
| Border | neutral-200 `#D4DBD9` | green-700 `#235B52` |
| Primary action | green-800 bg, white text | gold-400 bg, green-950 text |
| Accent | gold-400 | gold-400 |
| Accent as text | gold-700 `#5D4E27` | gold-300 `#C8BD9E` |
| Focus ring | gold-500 `#907F4F`, 2 px, 2 px offset | gold-400 |
| Sidebar | green-800 bg, neutral-100 text, gold-400 active marker | green-950 bg, same markers |

The dark theme is the logo's own inverse: sand on deep green.

### Measured contrast (WCAG 2.2)

| Pair | Ratio | Verdict |
|---|---|---|
| White on Vertex Green | 11.57 | AAA |
| Vertex Sand on Vertex Green | 4.93 | AA text |
| green-950 on Vertex Sand | 7.63 | AAA |
| neutral-900 on white | 14.99 | AAA |
| neutral-600 on white | 5.71 | AA |
| gold-700 on white | 8.13 | AAA |
| neutral-100 on green-950 | 15.32 | AAA |
| neutral-100 on green-800 (sidebar) | 9.90 | AAA |
| neutral-300 on green-900 (dark muted) | 7.90 | AAA |
| neutral-300 on green-800 (dark muted on muted surface) | 6.19 | AA |
| neutral-600 on neutral-100 (muted on muted surface, light) | 4.88 | AA |
| white on green-800 (pressed toggle, light) | 11.57 | AAA |
| gold-400 on green-900 (dark accent) | 6.30 | AA |
| gold-500 focus ring on neutral-50 | 3.68 | AA non-text (≥ 3) |
| **Vertex Sand on white** | **2.35** | **Fails — never use for text or icons on light surfaces** |

### Proportion

About 60% neutral surfaces, 30% green, 10% sand. Sand is precious: if everything is gold, nothing is.

### Status colors in the product

Status badges use the status tones (neutral, info, gold, warning, danger, success, brand) through `Badge`, always with an icon or text, never color alone. Which domain state gets which tone (a period, an entry, a held Hub event) is set by the spec that introduces it; the period badge is §10's. Reuse the same tone for the same meaning across the Vertex products.

## 3. Typography

| Script | Typeface | Source and license |
|---|---|---|
| Arabic | **Noto Kufi Arabic** | SIL OFL. The Vertex Arabic face (Hub ADR 0033). Used in the web app and the printed books. |
| Latin and digits | **Montserrat** | SIL OFL. Matches the geometric wordmark in the logo. |

Implementation rules:
- Both faces ship with the build (`@fontsource`); the imported Montserrat faces cover Latin and the imported Noto Kufi faces Arabic only, so Latin letters and digits render in Montserrat. (The Noto Kufi font itself also has Latin digits: a failed Montserrat load would change the digit font silently, so Montserrat's Latin faces are preloaded.)
- Stack: `"Montserrat", "Noto Kufi Arabic", system-ui, sans-serif`.
- Weights: 400 body, 500 labels and table headers, 700 headings.
- Never letter-space Arabic, never italicize Arabic, never justify Arabic UI text.
- Tabular figures (`font-variant-numeric: tabular-nums`) across the whole app: Montserrat's default digits are proportional (§10).
- Digits: Latin digits everywhere (`AGENTS.md`), in text and through `formatLocale`.

Scale (size / line height, px), Arabic-friendly line heights:

| Token | Size | Line height | Use |
|---|---|---|---|
| xs | 12 | 18 | Captions, meta |
| sm | 13 | 20 | Secondary text, table cells |
| base | 15 | 24 | Body, inputs |
| md | 16 | 26 | Emphasized body |
| lg | 18 | 28 | Section titles |
| xl | 20 | 30 | Card titles |
| 2xl | 24 | 34 | Page titles |
| 3xl | 30 | 40 | Dashboard figures |
| 4xl | 36 | 46 | Hero figures, login |

## 4. Shape, space and depth

- **Spacing:** 4 px grid (4, 8, 12, 16, 20, 24, 32, 40, 48, 64).
- **Radius:** sm 4 (badges, chips), md 6 (buttons, inputs), lg 8 (cards), xl 12 (dialogs, sheets). No pill-shaped buttons; full rounding only for avatars and status dots.
- **Depth:** borders define structure. Shadows only for floating layers (menus, popovers, dialogs), one soft green-tinted shadow.
- **Lines:** 1 px borders; 2 px for focus and active markers.

## 5. The signature motif: the 60° ascent

The logo's parallel strokes at 60° become the product's recognizable detail, used sparingly:
- A short sand diagonal bar at the start of page titles.
- Parallel 60° hairlines as a quiet pattern on the login screen and empty states.

Never animate it continuously, never use it as a full-page background behind content.

## 6. Iconography and motion

- Lucide icons, 1.75 px stroke, 20 px default, 16 px in dense tables. Directional icons mirror in RTL.
- Motion: 150 ms (hover, press), 200 ms (menus, popovers), 250 ms (dialogs, sheets), ease-out. Respect `prefers-reduced-motion`.

## 7. Logo usage

| Rule | Value |
|---|---|
| Clear space | One stroke width of the mark on every side (≈ 10% of the mark's width) |
| Minimum size | Full logo 96 px wide; mark 24 px; below that use the favicon |
| Approved colorways | Green on white or light surfaces; sand on Vertex Green; white on Vertex Green or dark photos; sand on white only at large sizes (≥ 160 px) |
| In the app | Sidebar: sand mark on green. Sign-in: full logo. Printed books, statements and reports: the **company's** name and logo lead the header; the footer carries "Powered by Vertex Mizan" with the mark (ADR 0009) |
| Don't | Recolor outside the palette, stretch, rotate, outline, add shadows or gradients, place on busy images, rebuild the wordmark in another font, replace MIZAN with another word outside the Vertex product set |

## 8. Patterns to avoid (to keep the product from looking generic)

Cream or beige page backgrounds · purple/blue gradients · glassmorphism · pill-shaped buttons · italic accent words in headings · numbered "01/02/03" section labels · monospace labels as decoration · emoji as icons · heavy drop shadows · gold text on light surfaces · letter-spaced Arabic.

Extend this list after each design review.

## 9. Voice (UI copy)

Modern Standard Arabic, clear and concise. Verbs on buttons ("احفظ", "رحّل القيد"). Numbers and dates formatted consistently. No exclamation marks in system messages.

- **Gender-neutral actors.** Users have no grammatical gender on record, so a sentence about someone's action uses the passive or a noun, then the name: "رُحّل القيد بواسطة ليان", "ملاحظة جديدة من سارة". Never a gendered verb before a name ("ليان أرسل").
- **Dismiss buttons** say "تراجع", so they never read like the destructive "اعكس القيد" beside them.
- **Dates** use one style, month names as read in Syria (أيلول، تشرين الأول), Latin digits, times in `Asia/Damascus`: "20 أيلول 2026، 1:00 م".
- **Counts** agree with their number: plural forms per count (`_one`, `_two`, `_few`, `_many`, `_other`), or a phrasing without a counted noun ("المنجز 3 من 12").
- **Tanween** is written after the alif: "أولًا", not "أولاً".

Glossary: one term per concept, in `docs/glossary.md`.

## 10. Accounting adaptations (ADR 0010)

Mizan keeps everything above and adapts density, figures and interaction for accountants. The evidence is `docs/research/design-system-for-accounting.md`.

### Densities

| Token | Compact | Comfortable |
|---|---|---|
| Control height | 32 | 44 |
| Row height | 28 | 44 |
| Cell padding | 8 | 12 |
| Control and cell text | 13 / 20 | 16 / 26 |
| Icon | 16 | 20 |
| Icon hit area | 24 | 44 |

Sizes in px. Compact is the default; comfortable applies when the primary pointer is coarse; the person's choice (`auto`, `compact`, `comfortable`) wins. Headings and figures outside tables keep the type scale of §3.

### Figures

- Tabular lining figures everywhere. Montserrat's tabular digits are 700 units wide in every weight; inside a bold figure the separators are set at 400, so bold totals align digit for digit with regular figures.
- Figures align to the physical right edge of their column (the column's start in RTL), with the same decimals per currency; never abbreviated or truncated.
- Every figure, with its sign and currency code, is one LTR isolate. The sign is an ASCII hyphen-minus, so copied figures paste into Excel as numbers.
- Negative figures: the minus sign and the `negative` color, `danger-600` on light surfaces and the mix of `danger-500` and `danger-100` on dark ones, at least 4.5:1 on every surface including the selection.
- Selection in tables and grids: `gold-100` on light surfaces, `gold-400` at 20% on dark ones; the active cell has a 2 px inset ring.

### Accounting status

| State | Tone | Icon |
|---|---|---|
| Period open | success | open lock |
| Period closed | neutral | lock |
| Period reopened | warning | rotate |
