import { fontFamily, lightColors, palette } from '@vertex-mizan/tokens';

/**
 * The print stylesheet (S09 rule 36): A4, right to left, the brand's faces, ink on white whatever
 * the screen's theme. Colors come from `@vertex-mizan/tokens`, sizes in print units. Logical
 * properties only, so the page reads right to left by its direction alone.
 */
export function printStyles(): string {
  const ink = lightColors.foreground;
  const muted = lightColors.mutedForeground;
  const rule = lightColors.border;
  const band = lightColors.muted;
  const negative = lightColors.negative;
  const brand = palette.green[800];
  const fonts = fontFamily.map((family) => (family.includes(' ') ? `"${family}"` : family));
  return `
@page { size: A4; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; }
html { direction: rtl; }
body {
  margin: 0;
  color: ${ink};
  background: ${palette.white};
  font-family: ${fonts.join(', ')};
  font-size: 8.5pt;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.report-head { margin-block-end: 4mm; border-block-end: 0.6pt solid ${brand}; padding-block-end: 2mm; }
.report-company { font-size: 10pt; font-weight: 700; color: ${brand}; }
.report-title { font-size: 13pt; font-weight: 700; margin-block: 1mm; }
.report-parameters { display: flex; flex-wrap: wrap; gap: 1mm 6mm; color: ${muted}; }
.report-parameters b { color: ${ink}; font-weight: 400; }
.report-marks { display: flex; flex-wrap: wrap; gap: 2mm; margin-block-start: 2mm; }
.report-mark { border: 0.6pt solid ${negative}; color: ${negative}; padding-inline: 2mm; font-weight: 700; }
table { inline-size: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { font-weight: 700; background: ${band}; border-block-end: 0.6pt solid ${ink}; padding: 1mm; text-align: start; vertical-align: bottom; }
th.group { text-align: center; border-block-end: 0.3pt solid ${rule}; }
td { padding: 0.6mm 1mm; border-block-end: 0.3pt solid ${rule}; vertical-align: top; overflow-wrap: anywhere; }
.num { direction: ltr; text-align: end; unicode-bidi: isolate; white-space: nowrap; }
th.num { text-align: end; }
.code { direction: ltr; unicode-bidi: isolate; text-align: start; }
.neg { color: ${negative}; }
tr.section td { font-weight: 700; background: ${band}; }
tr.subtotal td { font-weight: 700; border-block-start: 0.6pt solid ${ink}; }
tr.total td { font-weight: 700; border-block-start: 0.6pt solid ${ink}; border-block-end: 1.8pt double ${ink}; }
tr.note td { color: ${muted}; }
.draft { position: fixed; inset-block-start: 40%; inset-inline: 0; text-align: center; font-size: 40pt; font-weight: 700; color: ${negative}; opacity: 0.12; transform: rotate(-30deg); }
.book-page { block-size: 267mm; display: flex; flex-direction: column; break-after: page; }
.book-page:last-child { break-after: auto; }
.book-head { display: flex; justify-content: space-between; align-items: baseline; border-block-end: 0.6pt solid ${brand}; padding-block-end: 1.5mm; margin-block-end: 2mm; }
.book-rows { flex: 1; }
.book-rows td { white-space: nowrap; overflow: hidden; }
.book-rows tr.entry td { font-weight: 700; border-block-start: 0.3pt solid ${ink}; }
.book-rows tr.continued td { color: ${muted}; }
.book-foot { border-block-start: 0.6pt solid ${ink}; padding-block-start: 1mm; }
.book-foot td { border: 0; padding-block: 0.3mm; }
.book-order { color: ${muted}; font-size: 7.5pt; text-align: center; margin-block-start: 1mm; }
`;
}
