import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ar, textDirection } from '@vertex-mizan/i18n';
import { palette } from '@vertex-mizan/tokens';
import type { HtmlTagDescriptor, Plugin } from 'vite';

/*
 * The installable web app: the manifest, its icons, an offline page and the service worker,
 * emitted by the build only. The service worker never answers `/api` or caches company data: an
 * accounting system shows the server's answer or nothing. It only replaces a failed page load
 * with the offline page; the hashed assets keep the browser's own year-long cache (nginx).
 */

// `.json`, not `.webmanifest`: the server's nginx maps no type to the latter (it would go out as
// `application/octet-stream`), and browsers read a manifest served as `application/json`.
export const manifestPath = 'manifest.json';
export const serviceWorkerPath = 'sw.js';
export const offlinePath = 'offline.html';

const brandFile = (file: string) =>
  readFileSync(new URL(`../../brand/logo/${file}`, import.meta.url));

const icons = [
  { file: 'png/icon-192.png', sizes: '192x192', purpose: 'any' },
  { file: 'png/icon-512.png', sizes: '512x512', purpose: 'any' },
  // The mark inside the safe zone (80% circle) of app-icon-maskable.svg.
  { file: 'png/icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' },
] as const;

const green = palette.green[800];
const sand = palette.gold[400];

/**
 * The page shown for a page load without a connection: self-contained (no script, no fetch), and
 * with no product name or mark (ADR 0024 §8).
 */
export function offlinePage(): string {
  const text = ar.common.app;
  return `<!doctype html>
<html lang="ar" dir="${textDirection}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="${green}">
<title>${text.offlineTitle} · ${ar.common.productName}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem;
  box-sizing: border-box; font-family: "Noto Kufi Arabic", system-ui, sans-serif;
  background: ${palette.white}; color: ${palette.neutral[900]}; text-align: center; }
@media (prefers-color-scheme: dark) {
  body { background: ${palette.neutral[950]}; color: ${palette.neutral[100]}; } }
main { max-inline-size: 26rem; }
h1 { font-size: 1.25rem; margin-block: 0 .75rem; }
p { margin-block: 0 1.5rem; line-height: 1.8; }
a { display: inline-block; padding-block: .625rem; padding-inline: 1.25rem; border-radius: .5rem;
  background: ${green}; color: ${palette.white}; text-decoration: none; }
a:focus-visible { outline: 2px solid ${sand}; outline-offset: 2px; }
</style>
</head>
<body>
<main>
<h1>${text.offlineTitle}</h1>
<p>${text.offlineBody}</p>
<a href="/">${ar.common.retry}</a>
</main>
</body>
</html>
`;
}

/** The service worker; `version` changes with the offline page, so a deploy that changes it installs again. */
export function serviceWorker(version: string): string {
  return `// Vertex Mizan's service worker (apps/web/pwa.ts). Never answers /api or caches company data.
const CACHE = 'mizan-offline-${version}';
const OFFLINE = '/${offlinePath}';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      return preloaded || (await fetch(event.request));
    } catch {
      return (await caches.match(OFFLINE)) || Response.error();
    }
  })());
});
`;
}

/** The build's manifest, offline page, icons and service worker, and their tags in index.html. */
export function vertexMizanPwa(): Plugin {
  let base = '/';
  const iconRefs: string[] = [];
  return {
    name: 'vertex-mizan-pwa',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    buildStart() {
      iconRefs.length = 0;
      for (const icon of icons) {
        const name = icon.file.slice(icon.file.lastIndexOf('/') + 1);
        iconRefs.push(this.emitFile({ type: 'asset', name, source: brandFile(icon.file) }));
      }
    },
    generateBundle() {
      const manifest = {
        id: base,
        name: ar.common.productName,
        short_name: ar.common.productName,
        description: ar.common.app.description,
        lang: 'ar',
        dir: textDirection,
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: green,
        theme_color: green,
        categories: ['business', 'finance', 'productivity'],
        icons: icons.map((icon, index) => ({
          src: `${base}${this.getFileName(iconRefs[index] as string)}`,
          sizes: icon.sizes,
          type: 'image/png',
          purpose: icon.purpose,
        })),
      };
      const page = offlinePage();
      const version = createHash('sha256').update(page).digest('hex').slice(0, 16);
      this.emitFile({
        type: 'asset',
        fileName: manifestPath,
        source: JSON.stringify(manifest, null, 2),
      });
      this.emitFile({ type: 'asset', fileName: offlinePath, source: page });
      this.emitFile({ type: 'asset', fileName: serviceWorkerPath, source: serviceWorker(version) });
    },
    transformIndexHtml() {
      const tags: HtmlTagDescriptor[] = [
        {
          tag: 'link',
          attrs: { rel: 'manifest', href: `${base}${manifestPath}` },
          injectTo: 'head',
        },
        { tag: 'meta', attrs: { name: 'theme-color', content: green }, injectTo: 'head' },
        {
          tag: 'meta',
          attrs: { name: 'mobile-web-app-capable', content: 'yes' },
          injectTo: 'head',
        },
        {
          tag: 'meta',
          attrs: { name: 'apple-mobile-web-app-title', content: ar.common.productName },
          injectTo: 'head',
        },
      ];
      return tags;
    },
  };
}
