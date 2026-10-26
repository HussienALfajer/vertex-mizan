import { ar } from '@vertex-mizan/i18n';
import { expect, expectNoPageOverflow, screenshot, test, widths } from './test';

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
        await screenshot(page, testInfo, `navigation-${colorScheme}-${width}`);
      });

      test('design system', async ({ page }, testInfo) => {
        await page.goto('/design-system');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.designSystem.title);
        await expect(page.getByRole('grid', { name: ar.designSystem.grid.label })).toBeVisible();
        await expectNoPageOverflow(page);
        await screenshot(page, testInfo, `design-system-${colorScheme}-${width}`);
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
