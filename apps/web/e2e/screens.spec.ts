import { ar } from '@vertex-mizan/i18n';
import {
  client,
  company,
  dashboard,
  ids,
  material,
  materialCosts,
  movementPage,
  otherProject,
  owedToUs,
  owner,
  project,
  rateHistory,
  ratesMissing,
  ratesToday,
  received,
  supplier,
} from './movements-data';
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
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          ar.movements.dashboard.title,
        );
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

      test.describe('without an active company', () => {
        test.use({ me: { ...signedIn, activeCompanyId: null } });

        test('no company', async ({ page }, testInfo) => {
          await page.goto('/no-company');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.auth.noCompany.title);
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `no-company-${colorScheme}-${width}`);
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

      test.describe('the projects (S13)', () => {
        test.use({
          me: owner,
          api: {
            'GET /api/dashboard': { status: 200, json: dashboard },
            'GET /api/project-books': { status: 200, json: [project, otherProject] },
            [`GET /api/project-books/${ids.project}`]: { status: 200, json: project },
            'GET /api/movements': { status: 200, json: movementPage },
            'GET /api/material-costs': { status: 200, json: materialCosts },
            'GET /api/day-rates': { status: 200, json: ratesMissing },
          },
        });

        test('dashboard', async ({ page }, testInfo) => {
          await page.goto('/');
          await expect(page.getByRole('link', { name: project.name }).first()).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `dashboard-${colorScheme}-${width}`);
        });

        test('projects', async ({ page }, testInfo) => {
          await page.goto('/projects');
          await expect(page.getByRole('link', { name: otherProject.name })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `projects-${colorScheme}-${width}`);
        });

        test('project', async ({ page }, testInfo) => {
          await page.goto(`/projects/${ids.project}`);
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(project.name);
          await expect(page.getByText(movementPage.movements[0]?.description ?? '')).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `project-${colorScheme}-${width}`);
        });

        test('new movement', async ({ page }, testInfo) => {
          await page.goto(`/projects/${ids.project}`);
          await page.getByRole('button', { name: ar.movements.dashboard.newMovement }).click();
          const dialog = page.getByRole('dialog', { name: ar.movements.dialog.title });
          await dialog.getByRole('combobox', { name: ar.movements.dialog.kind }).click();
          await page.getByRole('option', { name: ar.movements.kinds.debt_collected }).click();
          await expect(dialog.getByText(ar.movements.dialog.openToUs)).toBeVisible();
          await screenshot(page, testInfo, `movement-dialog-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('new project', async ({ page }, testInfo) => {
          await page.route('**/api/parties**', (route) => route.fulfill({ json: [] }));
          await page.goto('/projects');
          await page.getByRole('button', { name: ar.movements.projects.newProject }).click();
          await expect(
            page.getByRole('dialog', { name: ar.movements.newProject.title }),
          ).toBeVisible();
          await screenshot(page, testInfo, `new-project-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });
      });

      test.describe('the parties, materials and rates (S13)', () => {
        test.use({
          me: owner,
          api: {
            'GET /api/company': { status: 200, json: company },
            'GET /api/parties': (request) => ({
              status: 200,
              json:
                new URL(request.url()).searchParams.get('type') === 'client'
                  ? [client]
                  : [supplier],
            }),
            'GET /api/project-books': { status: 200, json: [project, otherProject] },
            'GET /api/movements': {
              status: 200,
              json: { movements: [owedToUs, received], nextCursor: null },
            },
            'GET /api/material-costs': { status: 200, json: materialCosts },
            'GET /api/materials': {
              status: 200,
              json: { materials: [material], nextCursor: null },
            },
            'GET /api/day-rates': { status: 200, json: ratesToday },
            'GET /api/rates': { status: 200, json: { rates: rateHistory, nextCursor: null } },
          },
        });

        test('clients', async ({ page }, testInfo) => {
          await page.goto('/clients');
          await expect(page.getByRole('link', { name: client.name })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `clients-${colorScheme}-${width}`);
        });

        test('client', async ({ page }, testInfo) => {
          await page.goto(`/clients/${ids.client}`);
          await expect(page.getByText(owedToUs.description)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `client-${colorScheme}-${width}`);
        });

        test('suppliers', async ({ page }, testInfo) => {
          await page.goto('/suppliers');
          await expect(page.getByRole('link', { name: supplier.name })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `suppliers-${colorScheme}-${width}`);
        });

        test('materials', async ({ page }, testInfo) => {
          await page.goto('/materials');
          await expect(page.getByRole('cell', { name: material.name, exact: true })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `materials-${colorScheme}-${width}`);
        });

        test('materials catalogue', async ({ page }, testInfo) => {
          await page.goto('/materials');
          await page.getByRole('tab', { name: ar.movements.materialsPage.tabs.catalogue }).click();
          await expect(page.getByRole('cell', { name: material.code })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `materials-catalogue-${colorScheme}-${width}`);
        });

        test('rates', async ({ page }, testInfo) => {
          await page.goto('/rates');
          await expect(page.getByText(ar.movements.ratesPage.corrected)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `rates-${colorScheme}-${width}`);
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
