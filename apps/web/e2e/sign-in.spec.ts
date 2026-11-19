import { ar } from '@vertex-mizan/i18n';
import {
  branded,
  expect,
  expectNoProductName,
  fieldError,
  logoReply,
  refusal,
  signedIn,
  test,
  withLogo,
} from './test';

const t = ar.auth;

const exempt = {
  ...signedIn,
  person: { ...signedIn.person, twoFactorEnabled: false, twoFactorExempt: true },
};

test.describe('signed out', () => {
  test.use({ me: null });

  test('sends a signed-out person to sign-in and brings them back', async ({ page }) => {
    let session: typeof exempt | null = null;
    let sent: unknown;
    await page.route('**/api/me', (route) =>
      session ? route.fulfill({ status: 200, json: session }) : route.fulfill(refusalRoute()),
    );
    await page.route('**/api/auth/sign-in/email', (route) => {
      sent = route.request().postDataJSON();
      session = exempt;
      return route.fulfill({ status: 200, json: { twoFactorRequired: false } });
    });
    await page.goto('/settings');
    await expect(page).toHaveURL('/sign-in?redirect=%2Fsettings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.signIn.title);
    await page.getByLabel(t.fields.email).fill('owner@example.test');
    await page.getByLabel(t.fields.password, { exact: true }).fill(`pw-${Date.now()}-long`);
    await page.getByRole('button', { name: t.signIn.submit }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.settings.title);
    expect(sent).toMatchObject({ email: 'owner@example.test' });
  });

  test("shows the company's name above the card and in the tab, never the product", async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await expect(page.getByText(branded.displayName)).toBeVisible();
    await expect(page.locator('[data-slot="company-logo"] img')).toHaveCount(0);
    await expect(page).toHaveTitle(branded.displayName);
    await expectNoProductName(page);
  });

  test.describe('with a logo', () => {
    test.use({ branding: withLogo, api: { 'GET /api/branding/public/logo': logoReply } });

    test('shows the logo from the public branding', async ({ page }) => {
      await page.goto('/sign-in');
      const logo = page.locator('[data-slot="company-logo"] img');
      await expect(logo).toHaveAttribute('src', '/api/branding/public/logo?v=v1');
      await expect(logo).toHaveJSProperty('complete', true);
      // The tab's icon is the company's logo.
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
        'href',
        '/api/branding/public/logo?v=v1',
      );
      expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(
        0,
      );
    });
  });

  test.describe('without a company named for sign-in', () => {
    test.use({ branding: { displayName: '', hasLogo: false, logoVersion: null } });

    test('shows a generic title, never the product', async ({ page }) => {
      await page.goto('/sign-in');
      await expect(page.getByText(ar.common.productName, { exact: true })).toBeVisible();
      await expectNoProductName(page);
    });
  });

  test('checks the fields before sending', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: t.signIn.submit }).click();
    await expect(page.getByRole('region', { name: ar.common.errorSummary })).toBeFocused();
    await expect(fieldError(page, t.validation.required)).toHaveCount(2);
    await page.getByLabel(t.fields.email).fill('not-an-email');
    await page.getByRole('button', { name: t.signIn.submit }).click();
    await expect(fieldError(page, t.validation.email)).toBeVisible();
  });

  test.describe('wrong password', () => {
    test.use({ api: { 'POST /api/auth/sign-in/email': refusal(401, 'INVALID_CREDENTIALS') } });

    test('says so', async ({ page }) => {
      await page.goto('/sign-in');
      await page.getByLabel(t.fields.email).fill('owner@example.test');
      await page.getByLabel(t.fields.password, { exact: true }).fill(`pw-${Date.now()}-long`);
      await page.getByRole('button', { name: t.signIn.submit }).click();
      await expect(page.getByRole('alert')).toHaveText(ar.errors.INVALID_CREDENTIALS);
    });
  });

  test.describe('an account with two-factor', () => {
    test.use({
      api: { 'POST /api/auth/sign-in/email': { status: 200, json: { twoFactorRequired: true } } },
    });

    test('is told the app has no two-factor step', async ({ page }) => {
      await page.goto('/sign-in');
      await page.getByLabel(t.fields.email).fill('owner@example.test');
      await page.getByLabel(t.fields.password, { exact: true }).fill(`pw-${Date.now()}-long`);
      await page.getByRole('button', { name: t.signIn.submit }).click();
      await expect(page.getByRole('alert')).toHaveText(t.signIn.twoFactorUnavailable);
      await expectNoProductName(page);
      await expect(page).toHaveURL('/sign-in');
    });
  });
});

test('sends a signed-in person from sign-in to the app', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
});

function refusalRoute() {
  const reply = refusal(401, 'UNAUTHENTICATED');
  return { status: reply.status, json: reply.json };
}

// A crafted link never sends a person to another site (`safeRedirect`).
const hostile = [
  '//attacker.example/',
  'https://attacker.example/',
  '/\t/attacker.example/',
  '/.//attacker.example/',
];

test.describe('a hostile return address', () => {
  for (const target of hostile) {
    test(`is dropped when already signed in: ${JSON.stringify(target)}`, async ({ page }) => {
      await page.goto(`/sign-in?${new URLSearchParams({ redirect: target })}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
      expect(new URL(page.url()).pathname).toBe('/');
      expect(new URL(page.url()).host).not.toContain('attacker');
    });
  }

  test.describe('signing in', () => {
    test.use({ me: null });

    for (const target of hostile) {
      test(`is dropped after signing in: ${JSON.stringify(target)}`, async ({ page }) => {
        let session: typeof exempt | null = null;
        await page.route('**/api/me', (route) =>
          session ? route.fulfill({ status: 200, json: session }) : route.fulfill(refusalRoute()),
        );
        await page.route('**/api/auth/sign-in/email', (route) => {
          session = exempt;
          return route.fulfill({ status: 200, json: { twoFactorRequired: false } });
        });
        await page.goto(`/sign-in?${new URLSearchParams({ redirect: target })}`);
        await page.getByLabel(t.fields.email).fill('owner@example.test');
        await page.getByLabel(t.fields.password, { exact: true }).fill(`pw-${Date.now()}-long`);
        await page.getByRole('button', { name: t.signIn.submit }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
        expect(new URL(page.url()).pathname).toBe('/');
        expect(new URL(page.url()).host).not.toContain('attacker');
      });
    }
  });
});

test.describe('signed in without an active company', () => {
  test.use({ me: { ...signedIn, activeCompanyId: null } });

  test('says so and offers to sign out', async ({ page }) => {
    let signedOut = false;
    await page.route('**/api/auth/sign-out', (route) => {
      signedOut = true;
      return route.fulfill({ status: 200, json: { success: true } });
    });
    await page.goto('/settings');
    await expect(page).toHaveURL('/no-company');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.noCompany.title);
    await expectNoProductName(page);
    // Signing in again leads here too, never into a loop.
    await page.goto('/sign-in');
    await expect(page).toHaveURL('/no-company');
    await page.route('**/api/me', (route) => route.fulfill(refusalRoute()));
    await page.getByRole('button', { name: t.noCompany.signOut }).click();
    await expect(page).toHaveURL('/sign-in');
    expect(signedOut).toBe(true);
  });
});
