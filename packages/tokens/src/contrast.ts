/*
 * WCAG 2.2 contrast between two `#rrggbb` colors, and the two derived colors the web theme builds
 * with `color-mix()`: an OKLCH mix of two palette colors, and a translucent color over a surface.
 * The tests measure both against the surfaces they sit on.
 */

type Rgb = [number, number, number];

const channels = (hex: string): Rgb =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;

const toHex = (rgb: Rgb): string =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Relative luminance of a `#rrggbb` color. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two colors, from 1 to 21, whichever is lighter. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** sRGB to OKLCH (Björn Ottosson's OKLab), hue in degrees. */
function toOklch(hex: string): Rgb {
  const [r, g, b] = channels(hex).map(linear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function fromOklch([L, C, H]: Rgb): string {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return toHex(
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map(gamma) as Rgb,
  );
}

/** `color-mix(in oklch, a share, b)`: the shorter hue arc, as CSS interpolates it. */
export function mixOklch(a: string, b: string, share = 0.5): string {
  const [la, ca, ha] = toOklch(a);
  const [lb, cb, hb] = toOklch(b);
  const turn = hb - ha > 180 ? hb - 360 : ha - hb > 180 ? hb + 360 : hb;
  const at = (x: number, y: number) => x * share + y * (1 - share);
  return fromOklch([at(la, lb), at(ca, cb), (at(ha, turn) + 360) % 360]);
}

/** A color at `alpha` composited over an opaque surface, as the browser paints it. */
export function over(color: string, alpha: number, surface: string): string {
  const top = channels(color);
  const bottom = channels(surface);
  return toHex(top.map((c, i) => c * alpha + (bottom[i] ?? 0) * (1 - alpha)) as Rgb);
}
