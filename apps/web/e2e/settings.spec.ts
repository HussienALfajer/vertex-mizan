import type { Me } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { branded, expect, fieldError, logoReply, refusal, signedIn, test, withLogo } from './test';

const t = ar.settings;
const owner: Me = { ...signedIn, permissions: ['company.read', 'company.settings'] };
const companyId = signedIn.activeCompanyId ?? '';

test.describe('an owner', () => {
  test.use({ me: owner });

  test('saves the display name with the company header', async ({ page }) => {
    let sent: { body: unknown; company: string | undefined } | undefined;
    await page.route('**/api/company/branding', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      sent = {
        body: route.request().postDataJSON(),
        company: route.request().headers()['x-mizan-company'],
      };
      return route.fulfill({
        status: 200,
        json: { ...branded, displayName: 'شركة جديدة للمقاولات' },
      });
    });
    await page.goto('/settings');
    const name = page.getByLabel(t.branding.displayName);
    await expect(name).toHaveValue(branded.displayName);
    await name.fill('شركة جديدة للمقاولات');
    await page.getByRole('button', { name: t.branding.save }).click();
    await expect(page.getByRole('status').filter({ hasText: t.branding.saved })).toBeVisible();
    expect(sent).toEqual({ body: { displayName: 'شركة جديدة للمقاولات' }, company: companyId });
    // The shell shows the new name at once.
    await expect(page.locator('aside').getByText('شركة جديدة للمقاولات')).toBeVisible();
  });

  test('refuses an empty name before sending', async ({ page }) => {
    await page.goto('/settings');
    await page.getByLabel(t.branding.displayName).fill('  ');
    await page.getByRole('button', { name: t.branding.save }).click();
    await expect(fieldError(page, ar.auth.validation.required)).toBeVisible();
  });

  test.describe('uploading', () => {
    let uploaded = false;
    test.use({
      api: {
        'POST /api/company/branding/logo': () => {
          uploaded = true;
          return { status: 200, json: withLogo };
        },
        'GET /api/company/branding/logo': logoReply,
      },
    });

    test('uploads a logo and shows it', async ({ page }) => {
      await page.goto('/settings');
      await expect(page.getByText(t.branding.noLogo)).toBeVisible();
      await page.locator('input[type="file"]').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: logoReply.body ?? Buffer.alloc(0),
      });
      await expect(page.getByRole('status').filter({ hasText: t.branding.uploaded })).toBeVisible();
      expect(uploaded).toBe(true);
      const preview = page.getByRole('img', { name: branded.displayName });
      await expect(preview).toHaveAttribute('src', '/api/company/branding/logo?v=v1');
      await expect(preview).toHaveJSProperty('complete', true);
      await expect(page.getByRole('button', { name: t.branding.replace })).toBeVisible();
    });
  });

  test('refuses a logo of another type or too large before sending', async ({ page }) => {
    await page.goto('/settings');
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg/>'),
    });
    await expect(page.getByRole('alert')).toHaveText(t.branding.logoType);
    await input.setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(1024 * 1024 + 1),
    });
    await expect(page.getByRole('alert')).toHaveText(t.branding.logoTooLarge);
  });

  test.describe('refused by the API', () => {
    test.use({ api: { 'POST /api/company/branding/logo': refusal(415, 'ATTACHMENT_TYPE') } });

    test('shows the refusal', async ({ page }) => {
      await page.goto('/settings');
      await page
        .locator('input[type="file"]')
        .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('x') });
      await expect(page.getByRole('alert')).toHaveText(ar.errors.ATTACHMENT_TYPE);
    });
  });

  test('changes the password, then signs in again', async ({ page }) => {
    let sent: unknown;
    await page.route('**/api/me/password', (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({ status: 204 });
    });
    const current = `old-${Date.now()}-password`;
    const next = `new-${Date.now()}-password`;
    await page.goto('/settings');
    await page.getByLabel(ar.auth.fields.currentPassword).fill(current);
    await page.getByLabel(ar.auth.fields.newPassword).fill(next);
    await page.getByLabel(ar.auth.fields.confirmPassword).fill(`${next}-other`);
    await page.getByRole('button', { name: t.password.submit }).click();
    await expect(fieldError(page, ar.auth.validation.passwordMismatch)).toBeVisible();
    await page.getByLabel(ar.auth.fields.confirmPassword).fill(next);
    // Signed out after the change: the sign-in page answers for no session.
    await page.route('**/api/me', (route) => route.fulfill(refusalJson()));
    await page.getByRole('button', { name: t.password.submit }).click();
    await expect(page).toHaveURL('/sign-in');
    expect(sent).toEqual({ currentPassword: current, newPassword: next });
  });
});

test('a person without the setting sees the branding without changing it', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText(t.branding.readOnly)).toBeVisible();
  await expect(page.getByLabel(t.branding.displayName)).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: t.branding.save })).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.branding.upload })).toHaveCount(0);
});

test.describe('the branding cannot be read', () => {
  test.use({ api: { 'GET /api/company/branding': refusal(404, 'NOT_FOUND') } });

  test('says so and offers a reload', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(ar.common.errorTitle)).toBeVisible();
    await expect(page.getByRole('button', { name: ar.shell.reload })).toBeVisible();
  });
});

function refusalJson() {
  const reply = refusal(401, 'UNAUTHENTICATED');
  return { status: reply.status, json: reply.json };
}
