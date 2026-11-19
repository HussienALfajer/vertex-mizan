import { ar } from '@vertex-mizan/i18n';
import { expect, expectNoProductName, test } from './test';

/** The installable app (pwa.ts): the manifest, its icons, the service worker and the offline page. */

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

test.describe('installable app', () => {
  test.use({ serviceWorkers: 'allow' });

  test('links a manifest whose icons load', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.movements.dashboard.title);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/manifest.json');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#004139');

    const manifest = await (await request.get(href as string)).json();
    expect(manifest).toMatchObject({
      id: '/',
      name: ar.common.productName,
      lang: 'ar',
      dir: 'rtl',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    const icons = manifest.icons as ManifestIcon[];
    expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    for (const icon of icons) {
      const response = await request.get(icon.src);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()['content-type']).toBe('image/png');
    }
  });

  test('keeps only the offline page, ready for a page load without a connection', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.movements.dashboard.title);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // The page that registered the worker is not yet controlled by it: load once more.
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);

    // Playwright cannot drop the worker's own fetch (setOffline aborts the navigation before the
    // worker answers, and routes do not see its requests): check the page it answers with is in
    // its cache and nothing else is, then open that page.
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
      }
      return urls;
    });
    expect(cached).toEqual(['/offline.html']);

    await page.goto('/offline.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.common.app.offlineTitle);
    await expect(page.getByText(ar.common.app.offlineBody)).toBeVisible();
    await expectNoProductName(page);
    await page.getByRole('link', { name: ar.common.retry }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.movements.dashboard.title);
  });
});
