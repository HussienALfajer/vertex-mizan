import { ar } from '@vertex-mizan/i18n';
import { expect, test } from './test';

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
