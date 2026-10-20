/**
 * Light or dark, as in Vertex Hub: the system's setting until the user presses the theme button,
 * then the choice, kept on the device. The density (ADR 0010 §2) likewise: `auto` until the person
 * chooses `compact` or `comfortable`. `themeInitScript` puts the `dark` class and the chosen
 * `data-density` on <html> before the first paint; `styles/theme.css` keys the tokens on them.
 */
export type Theme = 'light' | 'dark';

/** The `localStorage` key of the choice (Vertex Hub's). */
export const themeStorageKey = 'vertex-theme';

/** The `localStorage` key of the density choice; S01 moves it to the user's preferences. */
export const densityStorageKey = 'vertex-mizan-density';

/** The media query of the system's dark setting. */
export const systemDarkQuery = '(prefers-color-scheme: dark)';

/**
 * Runs synchronously from `<head>`, before the body is painted: a file the app serves from
 * `'self'` (`theme-init.js`), so a CSP can forbid inline scripts. Only `light` or `dark` counts as
 * a saved theme and only `compact` or `comfortable` as a saved density; without one, or when
 * storage is unavailable (blocked, private mode), the system setting and `auto` apply. The reads
 * fail separately.
 */
export const themeInitScript = `var saved = null;
try {
  saved = localStorage.getItem(${JSON.stringify(themeStorageKey)});
} catch (error) {}
var dark = false;
if (saved === 'light' || saved === 'dark') {
  dark = saved === 'dark';
} else {
  try {
    dark = matchMedia(${JSON.stringify(systemDarkQuery)}).matches;
  } catch (error) {}
}
document.documentElement.classList.toggle('dark', dark);
var density = null;
try {
  density = localStorage.getItem(${JSON.stringify(densityStorageKey)});
} catch (error) {}
if (density === 'compact' || density === 'comfortable') {
  document.documentElement.setAttribute('data-density', density);
}
`;

/** The path apps serve `themeInitScript` at. */
export const themeInitPath = '/theme-init.js';
