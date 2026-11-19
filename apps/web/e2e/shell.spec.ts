import { ar } from '@vertex-mizan/i18n';
import { branded, expect, expectNoProductName, logoReply, signedIn, test, withLogo } from './test';

const status = ar.shell.status;

test.describe('system status', () => {
  test('shows a working system and when it was checked', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(status.ok)).toBeVisible();
    await expect(page.locator('time')).toHaveAttribute('datetime', '2026-10-21T09:30:00.000Z');
  });

  test.describe('database down', () => {
    test.use({
      health: {
        status: 503,
        body: {
          status: 'error',
          checks: { database: 'down' },
          timestamp: '2026-10-21T09:30:00.000Z',
        },
      },
    });

    test('names the database when the API answers 503', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText(status.error)).toBeVisible();
    });
  });

  test.describe('API unreachable', () => {
    test.use({ health: 'unreachable' });

    test('says the server does not answer', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText(status.unreachable)).toBeVisible();
    });
  });
});

test.describe('shell', () => {
  test('lets keyboard users skip to the content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: ar.shell.skipToContent });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('keeps the chosen theme across a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: ar.common.theme.toDark }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(page.getByRole('button', { name: ar.common.theme.toLight })).toBeVisible();
  });

  test('sets the density from the command palette', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: ar.commandPalette.title });
    await expect(palette).toBeVisible();
    const search = palette.getByRole('combobox', { name: ar.commandPalette.search });
    await expect(search).toBeFocused();
    await search.fill(ar.common.density.comfortable);
    await expect(palette.getByRole('option')).toHaveCount(1);
    await search.press('Enter');
    await expect(palette).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
  });

  test('closes the phone navigation when a page is chosen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/no-such-page');
    await page.getByRole('button', { name: ar.shell.openNav }).click();
    const sheet = page.getByRole('dialog', { name: ar.shell.navLabel });
    await sheet.getByRole('link', { name: ar.shell.nav.home }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
  });

  test('offers a way home from an unknown address', async ({ page }) => {
    await page.goto('/no-such-page');
    await page.getByRole('link', { name: ar.shell.notFound.backHome }).click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('company branding', () => {
  test("shows the company's display name in the shell and the tab, never the product", async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('aside').getByText(branded.displayName)).toBeVisible();
    await expect(page).toHaveTitle(branded.displayName);
    await expectNoProductName(page);
  });

  test.describe('with a logo', () => {
    test.use({ branding: withLogo, api: { 'GET /api/company/branding/logo': logoReply } });

    test('loads the logo by its version', async ({ page }) => {
      await page.goto('/');
      const logo = page.locator('aside [data-slot="company-logo"] img');
      await expect(logo).toHaveAttribute('src', '/api/company/branding/logo?v=v1');
      await expect(logo).toHaveJSProperty('complete', true);
    });
  });

  test('shows the company on a phone, beside the menu button', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    await expect(page.locator('header').getByText(branded.displayName)).toBeVisible();
  });
});

test.describe('account menu', () => {
  test('opens the settings and signs out', async ({ page }) => {
    let signedOut = false;
    await page.route('**/api/auth/sign-out', (route) => {
      signedOut = true;
      return route.fulfill({ status: 200, json: { success: true } });
    });
    await page.goto('/');
    const menu = page.getByRole('button', {
      name: `${ar.shell.account.open}: ${signedIn.person.name}`,
    });
    await menu.click();
    await page.getByRole('menuitem', { name: ar.shell.account.settings }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.settings.title);
    await page.route('**/api/me', (route) =>
      route.fulfill({
        status: 401,
        json: { statusCode: 401, code: 'UNAUTHENTICATED', message: 'UNAUTHENTICATED' },
      }),
    );
    await menu.click();
    await page.getByRole('menuitem', { name: ar.shell.account.signOut }).click();
    await expect(page).toHaveURL('/sign-in');
    expect(signedOut).toBe(true);
  });
});
