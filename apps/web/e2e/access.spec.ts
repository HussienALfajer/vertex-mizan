import type { Request } from '@playwright/test';
import { ar } from '@vertex-mizan/i18n';
import { linkToken, newPersonInvitation, notEnrolled, setup, signIns } from './access-mocks';
import { expect, refusal, signedIn, test } from './test';

/*
 * S01's access flows in the browser, the API mocked: signing in with both steps, the guards,
 * enrolment, password reset, invitations, re-authentication and the security page.
 */

const t = ar.auth;
const password = 'a-long-enough-passphrase';

/** The JSON body a mocked endpoint received. */
function bodyOf(request: Request): Record<string, unknown> {
  return request.postDataJSON() as Record<string, unknown>;
}

test.describe('sign-in', () => {
  test.describe('both steps', () => {
    let session = false;
    const sent: Record<string, unknown>[] = [];
    test.use({
      api: {
        'GET /api/me': () =>
          session ? { status: 200, json: signedIn } : refusal(401, 'UNAUTHENTICATED'),
        'POST /api/auth/sign-in/email': (request) => {
          sent.push(bodyOf(request));
          return { status: 200, json: { twoFactorRequired: true } };
        },
        'POST /api/auth/two-factor/verify-totp': (request) => {
          sent.push(bodyOf(request));
          session = true;
          return { status: 204 };
        },
        'GET /api/me/sign-ins': { status: 200, json: signIns },
      },
    });

    test('email and password, then the code, then back to the page asked for', async ({ page }) => {
      await page.goto('/account/security');
      await expect(page).toHaveURL(/\/sign-in\?redirect=%2Faccount%2Fsecurity/);
      await page.getByLabel(t.fields.email).fill('  Owner@Example.test ');
      await page.getByLabel(t.fields.password, { exact: true }).fill(password);
      await page.getByRole('button', { name: t.signIn.submit }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.twoFactor.title);
      await page.getByRole('textbox').first().click();
      await page.keyboard.type('123456');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.security.title);
      expect(sent).toEqual([{ email: 'Owner@Example.test', password }, { code: '123456' }]);
    });
  });

  test.describe('refused', () => {
    test.use({
      me: null,
      api: { 'POST /api/auth/sign-in/email': refusal(401, 'INVALID_CREDENTIALS') },
    });

    test('says why in Arabic, the same for every refusal', async ({ page }) => {
      await page.goto('/sign-in');
      await page.getByLabel(t.fields.email).fill('owner@example.test');
      await page.getByLabel(t.fields.password, { exact: true }).fill('wrong');
      await page.getByRole('button', { name: t.signIn.submit }).click();
      await expect(page.getByRole('alert')).toHaveText(ar.errors.INVALID_CREDENTIALS);
    });
  });

  test.describe('too many attempts', () => {
    test.use({
      me: null,
      api: { 'POST /api/auth/sign-in/email': refusal(429, 'RATE_LIMITED') },
    });

    test('says to wait (S01 rule 8)', async ({ page }) => {
      await page.goto('/sign-in');
      await page.getByLabel(t.fields.email).fill('owner@example.test');
      await page.getByLabel(t.fields.password, { exact: true }).fill(password);
      await page.getByRole('button', { name: t.signIn.submit }).click();
      await expect(page.getByRole('alert')).toHaveText(ar.errors.RATE_LIMITED);
    });
  });

  test.describe('checked in the browser first', () => {
    test.use({ me: null });

    test('an invalid email and an empty password never reach the API', async ({ page }) => {
      await page.goto('/sign-in');
      await page.getByLabel(t.fields.email).fill('not-an-email');
      await page.getByRole('button', { name: t.signIn.submit }).click();
      await expect(page.getByText(t.validation.email)).toBeVisible();
      await expect(page.getByText(t.validation.required)).toBeVisible();
    });
  });

  test.describe('a crafted return address', () => {
    test.use({
      me: null,
      api: {
        'POST /api/auth/sign-in/email': { status: 200, json: { twoFactorRequired: true } },
        'POST /api/auth/two-factor/verify-totp': { status: 204 },
      },
    });

    // `//host`, a backslash, a tab the browser drops, and dot segments that resolve to `//host`.
    for (const crafted of [
      '%2F%2Fevil.example%2F',
      '%2F%5Cevil.example',
      '%2F%09%2Fevil.example',
      '%2F.%2F%2Fevil.example',
      '%2Fx%2F..%2F%2Fevil.example',
    ]) {
      test(`never leaves the app: ${crafted}`, async ({ page }) => {
        await page.goto(`/sign-in/two-factor?redirect=${crafted}`);
        await page.route('**/api/me', (route) => route.fulfill({ json: signedIn }));
        await page.getByRole('textbox').first().click();
        await page.keyboard.type('123456');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
        expect(new URL(page.url()).pathname).toBe('/');
      });
    }
  });

  test.describe('with a backup code', () => {
    let received: unknown;
    test.use({
      me: null,
      api: {
        'POST /api/auth/two-factor/verify-backup-code': (request) => {
          received = bodyOf(request);
          return { status: 204 };
        },
      },
    });

    test('signs in when the phone is lost (S01 rule 7)', async ({ page }) => {
      await page.goto('/sign-in/two-factor');
      await page.getByRole('button', { name: t.twoFactor.useBackup }).click();
      await page.getByLabel(t.fields.backupCode).fill(' k7q2-m9xw ');
      await page.route('**/api/me', (route) => route.fulfill({ json: signedIn }));
      await page.getByRole('button', { name: t.twoFactor.submit }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
      expect(received).toEqual({ code: 'k7q2-m9xw' });
    });
  });

  test.describe('second step', () => {
    test.use({
      me: null,
      api: {
        'POST /api/auth/two-factor/verify-totp': refusal(401, 'INVALID_TWO_FACTOR_CODE'),
        // The API answers an expired first step with the same code as a wrong one.
        'POST /api/auth/two-factor/verify-backup-code': refusal(401, 'INVALID_TWO_FACTOR_CODE'),
      },
    });

    test('a wrong code is refused and cleared', async ({ page }) => {
      await page.goto('/sign-in/two-factor');
      await page.getByRole('textbox').first().click();
      await page.keyboard.type('000000');
      await expect(page.getByRole('alert')).toHaveText(ar.errors.INVALID_TWO_FACTOR_CODE);
      await expect(page.getByRole('textbox').first()).toHaveValue('');
    });

    test('a refused backup code leaves the way back to sign-in', async ({ page }) => {
      await page.goto('/sign-in/two-factor?redirect=%2Faccount%2Fsecurity');
      await page.getByRole('button', { name: t.twoFactor.useBackup }).click();
      await page.getByLabel(t.fields.backupCode).fill('k7q2-m9xw');
      await page.getByRole('button', { name: t.twoFactor.submit }).click();
      await expect(page.getByRole('alert')).toHaveText(ar.errors.INVALID_TWO_FACTOR_CODE);
      await page.getByRole('link', { name: t.twoFactor.backToSignIn }).click();
      await expect(page).toHaveURL(/\/sign-in\?redirect=%2Faccount%2Fsecurity$/);
    });
  });
});

test.describe('guards', () => {
  test.describe('a person without two-factor', () => {
    test.use({ me: notEnrolled });

    test('reaches only enrolment', async ({ page }) => {
      await page.goto('/account/security');
      await expect(page).toHaveURL(/\/two-factor\/enrol\?redirect=%2Faccount%2Fsecurity/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.enrol.title);
    });
  });

  test.describe('no session', () => {
    test.use({ me: null });

    test('enrolment asks to sign in', async ({ page }) => {
      await page.goto('/two-factor/enrol');
      await expect(page).toHaveURL(/\/sign-in\?redirect=%2Ftwo-factor%2Fenrol/);
    });
  });
});

test.describe('enrolment', () => {
  test.use({
    me: notEnrolled,
    api: {
      'POST /api/auth/two-factor/enable': { status: 200, json: setup },
      'POST /api/auth/two-factor/verify-totp': { status: 204 },
    },
  });

  test('QR code and secret, a first code, then the backup codes once', async ({ page }) => {
    await page.goto('/two-factor/enrol');
    await page.getByLabel(t.fields.password, { exact: true }).fill(password);
    await page.getByRole('button', { name: t.enrol.start }).click();
    await expect(page.getByRole('img', { name: t.enrol.qr })).toBeVisible();
    await expect(page.getByRole('list', { name: t.enrol.secret })).toHaveText('JBSWY3DPEHPK3PXP');
    await page.getByRole('textbox').first().click();
    await page.keyboard.type('123456');

    const codes = page.getByRole('list', { name: t.enrol.backupCodes });
    await expect(codes.getByRole('listitem')).toHaveText(setup.backupCodes);
    const finish = page.getByRole('button', { name: t.enrol.finish });
    await expect(finish).toBeDisabled();
    await page.getByRole('checkbox').click();
    await page.route('**/api/me', (route) => route.fulfill({ json: signedIn }));
    await finish.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
  });

  test.describe('a wrong first code', () => {
    test.use({
      api: {
        'POST /api/auth/two-factor/enable': { status: 200, json: setup },
        'POST /api/auth/two-factor/verify-totp': refusal(401, 'INVALID_TWO_FACTOR_CODE'),
      },
    });

    test('is refused and the backup codes stay hidden', async ({ page }) => {
      await page.goto('/two-factor/enrol');
      await page.getByLabel(t.fields.password, { exact: true }).fill(password);
      await page.getByRole('button', { name: t.enrol.start }).click();
      await page.getByRole('textbox').first().click();
      await page.keyboard.type('000000');
      await expect(page.getByRole('alert')).toHaveText(ar.errors.INVALID_TWO_FACTOR_CODE);
      await expect(page.getByRole('img', { name: t.enrol.qr })).toBeVisible();
      await expect(page.getByRole('list', { name: t.enrol.backupCodes })).toHaveCount(0);
    });
  });

  test.describe('again, after signing in with a backup code', () => {
    let enables = 0;
    let reauthCode: unknown;
    test.use({
      me: signedIn,
      api: {
        'GET /api/me/sign-ins': { status: 200, json: signIns },
        'POST /api/auth/two-factor/enable': () => {
          enables += 1;
          return enables === 1
            ? refusal(403, 'REAUTHENTICATION_REQUIRED')
            : { status: 200, json: setup };
        },
        'POST /api/auth/reauthenticate': (request) => {
          reauthCode = bodyOf(request).code;
          return { status: 204 };
        },
        'POST /api/auth/two-factor/verify-totp': { status: 204 },
      },
    });

    test('confirms with a backup code, then shows the new codes (S01 rules 3, 7)', async ({
      page,
    }) => {
      await page.goto('/account/security');
      await page.getByRole('link', { name: t.security.authenticator.action }).click();
      await page.getByLabel(t.fields.password, { exact: true }).fill(password);
      await page.getByRole('button', { name: t.enrol.start }).click();
      const dialog = page.getByRole('dialog', { name: t.reauth.title });
      await dialog.getByRole('button', { name: t.twoFactor.useBackup }).click();
      await dialog.getByLabel(t.fields.backupCode).fill('p3vd-h8tn');
      await dialog.getByRole('button', { name: t.reauth.submit }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('img', { name: t.enrol.qr })).toBeVisible();
      expect(reauthCode).toBe('p3vd-h8tn');
      expect(enables).toBe(2);
      await page.getByRole('textbox').first().click();
      await page.keyboard.type('123456');
      await expect(
        page.getByRole('list', { name: t.enrol.backupCodes }).getByRole('listitem'),
      ).toHaveText(setup.backupCodes);
      await page.getByRole('checkbox').click();
      await page.getByRole('button', { name: t.enrol.finish }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.security.title);
    });
  });
});

test.describe('password reset', () => {
  test.use({ me: null });

  test.describe('request', () => {
    test.use({ api: { 'POST /api/auth/request-password-reset': { status: 204 } } });

    test('answers the same whatever the email', async ({ page }) => {
      await page.goto('/forgot-password');
      await page.getByLabel(t.fields.email).fill('anyone@example.test');
      await page.getByRole('button', { name: t.forgot.submit }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.forgot.sentTitle);
      await expect(page.getByText(t.forgot.sentBody)).toBeVisible();
    });
  });

  test.describe('new password', () => {
    let received: Record<string, unknown> | undefined;
    test.use({
      api: {
        'POST /api/auth/reset-password': (request) => {
          received = bodyOf(request);
          return { status: 204 };
        },
      },
    });

    test('reads the token from the fragment, removes it, and sets the password', async ({
      page,
    }) => {
      await page.goto(`/reset-password#token=${linkToken}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.reset.title);
      expect(new URL(page.url()).hash).toBe('');
      await page.getByLabel(t.fields.newPassword).fill('short');
      await page.getByRole('button', { name: t.reset.submit }).click();
      await expect(page.getByText(t.validation.passwordLength)).toBeVisible();
      await page.getByLabel(t.fields.newPassword).fill(password);
      await page.getByLabel(t.fields.confirmPassword).fill(`${password}x`);
      await page.getByRole('button', { name: t.reset.submit }).click();
      await expect(page.getByText(t.validation.passwordMismatch)).toBeVisible();
      await page.getByLabel(t.fields.confirmPassword).fill(password);
      await page.getByRole('button', { name: t.reset.submit }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.reset.doneTitle);
      expect(received).toEqual({ token: linkToken, password });
    });
  });

  test.describe('used link', () => {
    test.use({ api: { 'POST /api/auth/reset-password': refusal(410, 'LINK_INVALID') } });

    test('offers a new link', async ({ page }) => {
      await page.goto(`/reset-password#token=${linkToken}`);
      await page.getByLabel(t.fields.newPassword).fill(password);
      await page.getByLabel(t.fields.confirmPassword).fill(password);
      await page.getByRole('button', { name: t.reset.submit }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.errors.LINK_INVALID);
      await expect(page.getByRole('link', { name: t.reset.requestNew })).toBeVisible();
    });
  });

  test('a link without its token says so', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.reset.missingTitle);
  });
});

test.describe('invitation', () => {
  test.describe('a new person', () => {
    const calls: [string, Record<string, unknown>][] = [];
    test.use({
      me: null,
      api: {
        'POST /api/invitations/lookup': (request) => {
          calls.push(['lookup', bodyOf(request)]);
          return { status: 200, json: newPersonInvitation };
        },
        'POST /api/invitations/accept': (request) => {
          calls.push(['accept', bodyOf(request)]);
          return {
            status: 200,
            json: { ...signedIn.memberships[0], role: newPersonInvitation.role },
          };
        },
        'POST /api/auth/sign-in/email': (request) => {
          calls.push(['sign-in', bodyOf(request)]);
          return { status: 200, json: { twoFactorRequired: false } };
        },
      },
    });

    test('sets a name and a password, then signs in and enrols', async ({ page }) => {
      await page.goto(`/invitation#token=${linkToken}`);
      await expect(page.getByText(newPersonInvitation.companyName)).toBeVisible();
      await expect(page.getByText(ar.roles.accountant)).toBeVisible();
      await page.getByLabel(t.fields.name).fill('موظف جديد');
      await page.getByLabel(t.fields.newPassword).fill(newPersonInvitation.email);
      await page.getByLabel(t.fields.confirmPassword).fill(newPersonInvitation.email);
      await page.getByRole('button', { name: t.invitation.accept }).click();
      await expect(page.getByText(t.validation.passwordIsEmail)).toBeVisible();
      await page.getByLabel(t.fields.newPassword).fill(password);
      await page.getByLabel(t.fields.confirmPassword).fill(password);
      await page.route('**/api/me', (route) => route.fulfill({ json: notEnrolled }));
      await page.getByRole('button', { name: t.invitation.accept }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.enrol.title);
      expect(calls).toEqual([
        ['lookup', { token: linkToken }],
        ['accept', { token: linkToken, name: 'موظف جديد', password }],
        ['sign-in', { email: newPersonInvitation.email, password }],
      ]);
    });
  });

  test.describe('an existing person, signed out', () => {
    let session = false;
    const accepted: unknown[] = [];
    test.use({
      api: {
        'GET /api/me': () =>
          session ? { status: 200, json: signedIn } : refusal(401, 'UNAUTHENTICATED'),
        'POST /api/invitations/lookup': {
          status: 200,
          json: { ...newPersonInvitation, personExists: true },
        },
        'POST /api/auth/sign-in/email': { status: 200, json: { twoFactorRequired: true } },
        'POST /api/auth/two-factor/verify-totp': () => {
          session = true;
          return { status: 204 };
        },
        'POST /api/invitations/accept': (request) => {
          accepted.push(bodyOf(request));
          return { status: 200, json: signedIn.memberships[0] };
        },
      },
    });

    test('signs in with both steps, comes back to the invitation and accepts it', async ({
      page,
    }) => {
      await page.goto(`/invitation#token=${linkToken}`);
      await expect(page.getByText(t.invitation.existingPerson)).toBeVisible();
      await page.getByRole('link', { name: t.invitation.signInToAccept }).click();
      await expect(page).toHaveURL(/\/sign-in\?redirect=%2Finvitation/);
      await page.getByLabel(t.fields.email).fill(newPersonInvitation.email);
      await page.getByLabel(t.fields.password, { exact: true }).fill(password);
      await page.getByRole('button', { name: t.signIn.submit }).click();
      await page.getByRole('textbox').first().click();
      await page.keyboard.type('123456');
      // Back without the fragment: the token waited in this tab's session storage.
      await expect(page).toHaveURL(/\/invitation$/);
      await page.getByRole('button', { name: t.invitation.accept }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
      expect(accepted).toEqual([{ token: linkToken }]);
      expect(
        await page.evaluate(() => sessionStorage.getItem('mizan.pendingInvitation')),
      ).toBeNull();
    });
  });

  test.describe('an expired link', () => {
    test.use({ me: null, api: { 'POST /api/invitations/lookup': refusal(410, 'LINK_INVALID') } });

    test('says it cannot be used', async ({ page }) => {
      await page.goto(`/invitation#token=${linkToken}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.invitation.invalidTitle);
      await expect(page.getByText(ar.errors.LINK_INVALID)).toBeVisible();
    });
  });

  test.describe('signed in as another person', () => {
    test.use({
      api: {
        'POST /api/invitations/lookup': {
          status: 200,
          json: { ...newPersonInvitation, personExists: true },
        },
        'POST /api/invitations/accept': refusal(403, 'INVITATION_EMAIL_MISMATCH'),
      },
    });

    test('is refused with the reason', async ({ page }) => {
      await page.goto(`/invitation#token=${linkToken}`);
      await page.getByRole('button', { name: t.invitation.accept }).click();
      await expect(page.getByRole('alert')).toHaveText(ar.errors.INVITATION_EMAIL_MISMATCH);
    });
  });
});

test.describe('account security', () => {
  test.describe('change password', () => {
    let attempts = 0;
    let code: unknown;
    test.use({
      api: {
        'GET /api/me/sign-ins': { status: 200, json: signIns },
        'POST /api/me/password': () => {
          attempts += 1;
          return attempts === 1 ? refusal(403, 'REAUTHENTICATION_REQUIRED') : { status: 204 };
        },
        'POST /api/auth/reauthenticate': (request) => {
          code = bodyOf(request).code;
          return { status: 204 };
        },
      },
    });

    test('asks for a fresh code, runs again, then signs the person out', async ({ page }) => {
      await page.goto('/account/security');
      await page.getByLabel(t.fields.currentPassword).fill('the-old-passphrase');
      await page.getByLabel(t.fields.newPassword).fill(password);
      await page.getByLabel(t.fields.confirmPassword).fill(password);
      await page.getByRole('button', { name: t.security.password.submit }).click();
      const dialog = page.getByRole('dialog', { name: t.reauth.title });
      await expect(dialog).toBeVisible();
      await page.route('**/api/me', (route) =>
        route.fulfill({
          status: 401,
          json: { statusCode: 401, code: 'UNAUTHENTICATED', message: '' },
        }),
      );
      await dialog.getByRole('textbox').first().click();
      await page.keyboard.type('654321');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.signIn.title);
      expect(code).toBe('654321');
      expect(attempts).toBe(2);
    });
  });

  test.describe('re-authentication cancelled', () => {
    test.use({
      api: {
        'GET /api/me/sign-ins': { status: 200, json: signIns },
        'POST /api/auth/two-factor/generate-backup-codes': refusal(
          403,
          'REAUTHENTICATION_REQUIRED',
        ),
      },
    });

    test('does nothing and shows no error', async ({ page }) => {
      await page.goto('/account/security');
      await page.getByRole('button', { name: t.security.backupCodes.regenerate }).click();
      const dialog = page.getByRole('dialog', { name: t.reauth.title });
      await dialog.getByRole('button', { name: t.reauth.cancel }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: t.security.backupCodes.regenerate }),
      ).toBeVisible();
    });
  });

  test.describe('other sessions', () => {
    let attempts = 0;
    let signInLists = 0;
    test.use({
      api: {
        'GET /api/me/sign-ins': () => {
          signInLists += 1;
          return { status: 200, json: signIns };
        },
        'POST /api/me/sessions/revoke-others': () => {
          attempts += 1;
          return attempts === 1 ? refusal(403, 'REAUTHENTICATION_REQUIRED') : { status: 204 };
        },
        'POST /api/auth/reauthenticate': { status: 204 },
      },
    });

    test('asks for a fresh code, ends them, keeps this session and lists the action', async ({
      page,
    }) => {
      await page.goto('/account/security');
      await page.getByRole('button', { name: t.security.otherSessions.action }).click();
      const dialog = page.getByRole('dialog', { name: t.reauth.title });
      await dialog.getByRole('textbox').first().click();
      await page.keyboard.type('654321');
      await expect(
        page.getByRole('status').filter({ hasText: t.security.otherSessions.done }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.security.title);
      expect(attempts).toBe(2);
      await expect.poll(() => signInLists).toBe(2);
    });
  });

  test.describe('backup codes', () => {
    test.use({
      api: {
        'GET /api/me/sign-ins': { status: 200, json: signIns },
        'POST /api/auth/two-factor/generate-backup-codes': {
          status: 200,
          json: { backupCodes: setup.backupCodes },
        },
      },
    });

    test('shows the new set once', async ({ page }) => {
      await page.goto('/account/security');
      await page.getByRole('button', { name: t.security.backupCodes.regenerate }).click();
      await expect(
        page.getByRole('list', { name: t.security.backupCodes.newCodes }).getByRole('listitem'),
      ).toHaveText(setup.backupCodes);
    });
  });

  test.describe('sign-ins', () => {
    test.use({
      api: {
        'GET /api/me/sign-ins': (request) =>
          new URL(request.url()).searchParams.get('cursor') === 'page-2'
            ? { status: 200, json: { entries: [signIns.entries[2]], nextCursor: null } }
            : {
                status: 200,
                json: { entries: signIns.entries.slice(0, 2), nextCursor: 'page-2' },
              },
        'POST /api/auth/sign-out': { status: 204 },
      },
    });

    test('lists them a page at a time, then signs out', async ({ page }) => {
      await page.goto('/account/security');
      const rows = page.getByRole('row');
      await expect(rows).toHaveCount(3);
      await page.getByRole('button', { name: t.security.signIns.more }).click();
      await expect(rows).toHaveCount(4);
      await expect(
        page.getByRole('cell', { name: t.events['user.backup_code_used'] }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: t.security.signIns.more })).toBeHidden();
      await page.route('**/api/me', (route) =>
        route.fulfill({
          status: 401,
          json: { statusCode: 401, code: 'UNAUTHENTICATED', message: '' },
        }),
      );
      await page.getByRole('button', { name: t.security.signOut }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.signIn.title);
    });
  });
});
