import { ar } from '@vertex-mizan/i18n';
import { linkToken, newPersonInvitation, notEnrolled, setup, signIns } from './access-mocks';
import { chartReads, roots } from './chart-mocks';
import { archivedCompany, archivedOwner, company, companyReads, owner } from './company-mocks';
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
        await screenshot(page, testInfo, `navigation-${colorScheme}-${width}`, { fullPage: false });
      });

      test('design system', async ({ page }, testInfo) => {
        await page.goto('/design-system');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.designSystem.title);
        await expect(page.getByRole('grid', { name: ar.designSystem.grid.label })).toBeVisible();
        await expect(page.getByRole('img', { name: ar.designSystem.access.qr })).toBeVisible();
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
        test.use({ me: null });

        test('sign-in', async ({ page }, testInfo) => {
          await page.goto('/sign-in');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.auth.signIn.title);
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `sign-in-${colorScheme}-${width}`);
        });

        test('two-factor', async ({ page }, testInfo) => {
          await page.goto('/sign-in/two-factor');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.auth.twoFactor.title);
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `two-factor-${colorScheme}-${width}`);
        });

        test('forgot password', async ({ page }, testInfo) => {
          await page.goto('/forgot-password');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.auth.forgot.title);
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `forgot-password-${colorScheme}-${width}`);
        });

        test('reset password', async ({ page }, testInfo) => {
          await page.goto(`/reset-password#token=${linkToken}`);
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.auth.reset.title);
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `reset-password-${colorScheme}-${width}`);
        });

        test.describe('invitation', () => {
          test.use({
            api: { 'POST /api/invitations/lookup': { status: 200, json: newPersonInvitation } },
          });

          test('invitation', async ({ page }, testInfo) => {
            await page.goto(`/invitation#token=${linkToken}`);
            await expect(page.getByText(newPersonInvitation.companyName)).toBeVisible();
            await expectNoPageOverflow(page);
            await screenshot(page, testInfo, `invitation-${colorScheme}-${width}`);
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

        test('enrolment', async ({ page }, testInfo) => {
          await page.goto('/two-factor/enrol');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.auth.enrol.title);
          await page.getByLabel(ar.auth.fields.password, { exact: true }).fill('a-long-passphrase');
          await page.getByRole('button', { name: ar.auth.enrol.start }).click();
          await expect(page.getByRole('img', { name: ar.auth.enrol.qr })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `enrol-${colorScheme}-${width}`);
          await page.getByRole('textbox').first().click();
          await page.keyboard.type('123456');
          await expect(page.getByRole('list', { name: ar.auth.enrol.backupCodes })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `enrol-codes-${colorScheme}-${width}`);
        });
      });

      test.describe('account security', () => {
        test.use({ api: { 'GET /api/me/sign-ins': { status: 200, json: signIns } } });

        test('account security', async ({ page }, testInfo) => {
          await page.goto('/account/security');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.auth.security.title);
          await expect(
            page.getByRole('cell', { name: ar.auth.events['user.sign_in_failed'] }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `account-security-${colorScheme}-${width}`);
        });
      });

      test.describe('company screens', () => {
        test.use({ me: owner, api: companyReads });

        test('companies', async ({ page }, testInfo) => {
          await page.goto('/companies');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.company.list.title);
          await expect(page.getByRole('cell', { name: 'شركة ثانية', exact: true })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `companies-${colorScheme}-${width}`);
        });

        test('company switcher', async ({ page }, testInfo) => {
          await page.goto('/');
          await page.getByRole('button', { name: new RegExp(ar.company.switcher.open) }).click();
          await expect(page.getByRole('menu')).toBeVisible();
          await screenshot(page, testInfo, `switcher-${colorScheme}-${width}`, { fullPage: false });
        });

        test('new company', async ({ page }, testInfo) => {
          await page.goto('/companies/new');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.company.create.title);
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `new-company-${colorScheme}-${width}`);
        });

        test('company settings', async ({ page }, testInfo) => {
          await page.goto('/settings/company');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(
            ar.company.settings.title,
          );
          await expect(page.getByLabel(ar.company.fields.name)).toHaveValue(company.name);
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `company-settings-${colorScheme}-${width}`);
        });

        test('members', async ({ page }, testInfo) => {
          await page.goto('/settings/members');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.members.title);
          await expect(
            page.getByRole('cell', { name: 'viewer@example.test', exact: true }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `members-${colorScheme}-${width}`);
        });

        test('audit log', async ({ page }, testInfo) => {
          await page.goto('/settings/audit');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.audit.title);
          await expect(
            page.getByRole('cell', { name: ar.audit.actions['company.ledgers_updated'] }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `audit-${colorScheme}-${width}`);
          await page.getByRole('button', { name: ar.audit.table.details }).first().click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await screenshot(page, testInfo, `audit-entry-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });
      });

      test.describe('chart screens', () => {
        test.use({ me: owner, api: chartReads });

        test('chart of accounts', async ({ page }, testInfo) => {
          await page.goto('/chart');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.chart.title);
          await expect(
            page.getByRole('treegrid', { name: ar.chart.tree.label }).getByText('111001'),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `chart-${colorScheme}-${width}`);
        });

        test('account sheet', async ({ page }, testInfo) => {
          await page.goto('/chart');
          await page.getByRole('button', { name: `${ar.chart.tree.menu}: 111001` }).click();
          await page.getByRole('menuitem', { name: ar.chart.actions.edit }).click();
          await expect(page.getByRole('dialog', { name: ar.chart.sheet.editTitle })).toBeVisible();
          await screenshot(page, testInfo, `account-sheet-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('account roles', async ({ page }, testInfo) => {
          await page.goto('/chart/roles');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(
            ar.chart.roleSettings.title,
          );
          await expect(
            page.getByRole('cell', { name: ar.chart.roles.retained_earnings, exact: true }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `account-roles-${colorScheme}-${width}`);
        });
      });

      test.describe('empty chart', () => {
        test.use({
          me: owner,
          api: { ...chartReads, 'GET /api/accounts': { status: 200, json: roots } },
        });

        test('chart templates', async ({ page }, testInfo) => {
          await page.goto('/chart');
          await expect(page.getByText(ar.chart.empty.title)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `chart-empty-${colorScheme}-${width}`);
        });
      });

      test.describe('archived company', () => {
        test.use({
          me: archivedOwner,
          api: { ...companyReads, 'GET /api/company': { status: 200, json: archivedCompany } },
        });

        test('archived company settings', async ({ page }, testInfo) => {
          await page.goto('/settings/company');
          await expect(page.getByText(ar.company.archivedBanner.title)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `company-archived-${colorScheme}-${width}`);
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
