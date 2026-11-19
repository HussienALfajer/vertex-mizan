import { ar } from '@vertex-mizan/i18n';
import {
  expect,
  expectNoPageOverflow,
  logoReply,
  screenshot,
  signedIn,
  test,
  widths,
  withLogo,
} from './test';

// RTL screenshots of every screen in both themes at each width: the design review evidence.
for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of widths) {
    test.describe(`${colorScheme} theme, ${width} px`, () => {
      test.use({ colorScheme, viewport: { width, height: 800 } });

      test('home', async ({ page }, testInfo) => {
        await page.goto('/');
        const html = page.locator('html');
        await expect(html).toHaveAttribute('dir', 'rtl');
        await expect(html).toHaveAttribute('lang', 'ar');
        if (colorScheme === 'dark') await expect(html).toHaveClass(/\bdark\b/);
        else await expect(html).not.toHaveClass(/\bdark\b/);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
        await expect(page.getByText(ar.shell.status.ok)).toBeVisible();
        await expectNoPageOverflow(page);
        await screenshot(page, testInfo, `home-${colorScheme}-${width}`);
      });

      test('navigation', async ({ page }, testInfo) => {
        await page.goto('/');
        if (width < 768) {
          await page.getByRole('button', { name: ar.shell.openNav }).click();
          await expect(page.getByRole('dialog', { name: ar.shell.navLabel })).toBeVisible();
        }
        const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
        await expect(nav.getByRole('link', { name: ar.shell.nav.home })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await screenshot(page, testInfo, `navigation-${colorScheme}-${width}`, { fullPage: false });
      });

      test('design system', async ({ page }, testInfo) => {
        await page.goto('/design-system');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.designSystem.title);
        await expect(page.getByRole('grid', { name: ar.designSystem.grid.label })).toBeVisible();
        await expect(page.getByRole('img', { name: ar.designSystem.access.qr })).toBeVisible();
        // The error summary shown, as a refused submit leaves it.
        const sample = page.getByRole('form', { name: ar.designSystem.errorSummary.label });
        await sample.getByRole('button', { name: ar.designSystem.errorSummary.submit }).click();
        await expect(sample.getByRole('region', { name: ar.common.errorSummary })).toBeFocused();
        await expectNoPageOverflow(page);
        await screenshot(page, testInfo, `design-system-${colorScheme}-${width}`);
      });

      test('design system: sheet', async ({ page }, testInfo) => {
        await page.goto('/design-system');
        await page.getByRole('button', { name: ar.designSystem.sheet.open }).click();
        const sheet = page.getByRole('dialog', { name: ar.designSystem.sheet.heading });
        await expect(sheet).toBeVisible();
        await screenshot(page, testInfo, `sheet-${colorScheme}-${width}`, { fullPage: false });
        await sheet.getByRole('button', { name: ar.common.close }).click();
        await expect(sheet).toBeHidden();
      });

      test.describe('signed out', () => {
        test.use({
          me: null,
          branding: withLogo,
          api: { 'GET /api/branding/public/logo': logoReply },
        });

        test('sign-in', async ({ page }, testInfo) => {
          await page.goto('/sign-in');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.auth.signIn.title);
          await expect(page.getByText(withLogo.displayName)).toBeVisible();
          await expect(page.locator('[data-slot="company-logo"] img')).toHaveJSProperty(
            'complete',
            true,
          );
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `sign-in-${colorScheme}-${width}`);
        });
      });

      test.describe('with the logo and the setting', () => {
        test.use({
          me: { ...signedIn, permissions: ['company.read', 'company.settings'] },
          branding: withLogo,
          api: { 'GET /api/company/branding/logo': logoReply },
        });

        test('settings', async ({ page }, testInfo) => {
          await page.goto('/settings');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.settings.title);
          await expect(page.getByLabel(ar.settings.branding.displayName)).toHaveValue(
            withLogo.displayName,
          );
          await expect(page.getByRole('img', { name: withLogo.displayName })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `settings-${colorScheme}-${width}`);
        });
      });

      test('page not found', async ({ page }, testInfo) => {
        await page.goto('/no-such-page');
        await expect(page.getByText(ar.shell.notFound.title)).toBeVisible();
        await expectNoPageOverflow(page);
        await screenshot(page, testInfo, `not-found-${colorScheme}-${width}`);
      });
    });
  }
}
