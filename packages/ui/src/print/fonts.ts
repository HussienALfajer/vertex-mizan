import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

/** The weights a printed report uses: regular text and bold headings and totals. */
const PRINT_WEIGHTS = new Set(['400', '700']);

/**
 * The brand's faces for a printed report (S09 rule 36: the fonts embedded), from the design
 * system's own `fonts.css`: each `@font-face` of a printed weight, its file inlined as a data URL,
 * so Chromium renders the PDF without reaching any network. Node only (the worker).
 */
export function printFontFaces(): string {
  const require = createRequire(import.meta.url);
  const sheet = require.resolve('@vertex-mizan/ui/fonts.css');
  const css = readFileSync(sheet, 'utf8');
  const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
  return faces
    .filter((face) => PRINT_WEIGHTS.has(/font-weight:\s*(\d+)/.exec(face)?.[1] ?? ''))
    .map((face) =>
      face
        .replace(/font-display:\s*swap;/, 'font-display: block;')
        .replace(/url\("([^"]+)"\)/, (_match, path: string) => {
          const file = readFileSync(resolve(dirname(sheet), path));
          return `url("data:font/woff2;base64,${file.toString('base64')}")`;
        }),
    )
    .join('\n');
}
