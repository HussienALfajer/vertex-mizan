# Brand assets

Single source for the Vertex Mizan brand assets (ADR 0009, ADR 0010). Apps and packages reference files from here (the design system pins its copy of the path data with a test); don't keep other copies of the logo in the repository.

Visual identity rules: [identity.md](identity.md).

## Logo files

| Path | Contents | Use |
|---|---|---|
| `logo/svg/vertex-mizan-logo.svg` | Full logo (mark + wordmark), `fill="currentColor"` | UI: inherits text color, works in both themes |
| `logo/svg/vertex-mizan-mark.svg` | Mark only, `currentColor` | Sidebar, "Powered by Vertex Mizan", loaders |
| `logo/svg/vertex-mizan-{logo,mark}-{green,gold,white}.svg` | Fixed-color variants | Printed books, PDFs, anywhere CSS color is unavailable |
| `logo/svg/favicon.svg` | Sand mark on a green rounded square | Browser favicon |
| `logo/svg/app-icon.svg` | Sand mark on a Vertex Green square | Source of the home-screen icons (the platform rounds the corners) |
| `logo/png/vertex-mizan-logo-{green,gold,white}.png` | 1024 px wide, transparent | Tools that don't support SVG |
| `logo/png/vertex-mizan-mark-{green,gold,white}.png` | 512 px wide, transparent | Same |
| `logo/png/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | `app-icon.svg` at 192, 512 and 180 px | Home-screen icons of the web app (PR 8) |

## Provenance

- The logo is the Vertex Hub logo (`D:\vertex-hub\brand\logo\`, traced from the designer's raster at 99.3% pixel overlap) with one change: the knockout word **MEDIA** on the mark's left stroke is replaced by **MIZAN**, as Vertex Shifa and Vertex Food replaced it by SHIFA and FOOD. The bottom wordmark "VERTEX" and the strokes are unchanged. The owner approved it on 2026-10-21.
- MIZAN is set in Montserrat Medium (OFL), as the traced MEDIA is, on the same 60° baseline at the same cap height. The transform (scale 0.0538 of the font units, the 60° rotation) was measured from Shifa's five letters by a least-squares fit of each glyph's outline (largest error 0.06 units). The letters keep SHIFA's and FOOD's constant gap between their outlines (1418.6 font units, MEDIA's average), and the word is centred where MEDIA was (218.5, 288.0 in the mark's coordinates); MIZAN's length nearly equals MEDIA's.
- The SVG paths were generated with fontTools from `@fontsource/montserrat` 5.3.0 (`montserrat-latin-500-normal.woff`), rounded to 0.1 unit, into the Shifa files' structure; the PNGs are rendered from the SVGs in Chromium. When the designer delivers vector originals with MIZAN, replace the SVGs and render the PNGs again.
- The Vertex Media source rasters are not copied: they carry MEDIA.

## Fonts

- Montserrat and Noto Kufi Arabic (SIL OFL) come from `@fontsource` packages in `packages/ui`.
- Commercial font files are never committed: this repository is public.
