import { ar } from '@vertex-mizan/i18n';
import { linkToken, newPersonInvitation, notEnrolled, setup, signIns } from './access-mocks';
import { accountOf, chartReads, roots } from './chart-mocks';
import { archivedCompany, archivedOwner, company, companyReads, owner } from './company-mocks';
import { dimensionReads, typeOf } from './dimension-mocks';
import {
  approvalCompany,
  entryReads,
  ownDraft,
  purchase,
  purchasePreview,
  rejectedDraft,
  reversal,
  submittedDraft,
} from './entry-mocks';
import {
  closedMonth,
  dismissed,
  inboxReads,
  overpayment,
  postedInvoice,
  rateMissing,
  recordedRate,
  resolved,
  retainerInvoice,
} from './inbox-mocks';
import {
  closedOctober,
  currentBookPreview,
  octoberClosedList,
  passingOctober,
  periodsReads,
} from './periods-mocks';
import { rateReads, today } from './rate-mocks';
import { client, m1, receivablesReads } from './receivables-mocks';
import {
  cancelledProject,
  contractAssetItem,
  cycle,
  releasedCycle,
  revenueReads,
  serviceClosed,
} from './revenue-mocks';
import { hubClient, newKeyOf, newSecret, settingsReads } from './settings-mocks';
import { expect, expectNoPageOverflow, screenshot, test, widths } from './test';
import { brokenReport, emailedAnchor, trustReads } from './trust-mocks';

/** `/inbox/:id` in each state, and held for the reasons the page explains differently. */
const inboxScreenEvents = [
  rateMissing,
  overpayment,
  closedMonth,
  retainerInvoice,
  postedInvoice,
  resolved,
  dismissed,
  recordedRate,
];

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

      test.describe('dimension and rate screens', () => {
        test.use({ me: owner, api: { ...dimensionReads, ...rateReads } });

        test('dimensions', async ({ page }, testInfo) => {
          await page.goto('/dimensions');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.dimensions.title);
          await expect(page.getByText('عميل تجريبي', { exact: true })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `dimensions-${colorScheme}-${width}`);
        });

        test('dimension contracts', async ({ page }, testInfo) => {
          await page.goto('/dimensions');
          await page.getByRole('tab', { name: typeOf('contract').name }).click();
          await expect(page.getByText('حملة تجريبية')).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `dimension-contracts-${colorScheme}-${width}`);
        });

        test('rates', async ({ page }, testInfo) => {
          await page.clock.setFixedTime(today);
          await page.goto('/rates');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.rates.title);
          await expect(page.getByRole('list', { name: ar.rates.status.label })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `rates-${colorScheme}-${width}`);
        });

        test('record rate', async ({ page }, testInfo) => {
          await page.clock.setFixedTime(today);
          await page.goto('/rates');
          await page.getByRole('button', { name: ar.rates.recordBulletin }).click();
          await expect(
            page.getByRole('dialog', { name: ar.rates.record.bulletinTitle }),
          ).toBeVisible();
          await screenshot(page, testInfo, `record-rate-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('rate calendar', async ({ page }, testInfo) => {
          await page.goto('/rates/calendar');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.rates.calendar.title);
          await expect(page.getByText('عطلة تجريبية')).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `rate-calendar-${colorScheme}-${width}`);
        });
      });

      test.describe('entry screens', () => {
        test.use({ me: owner, api: entryReads });
        test.beforeEach(async ({ page }) => {
          await page.clock.setFixedTime(today);
        });

        test('journal', async ({ page }, testInfo) => {
          await page.goto('/entries');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.entries.title);
          await expect(page.getByRole('link', { name: '2026/1' })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `journal-${colorScheme}-${width}`);
        });

        test('entry', async ({ page }, testInfo) => {
          await page.goto(`/entries/${purchase.id}`);
          await expect(page.getByRole('heading', { level: 1 })).toContainText('2026/1');
          await expect(page.getByText('إيصال الصرافة.pdf')).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `entry-${colorScheme}-${width}`);
        });

        test('entry screen with its preview', async ({ page }, testInfo) => {
          await page.route(`**/api/drafts/${ownDraft.id}/preview`, (route) =>
            route.fulfill({ status: 200, json: purchasePreview }),
          );
          await page.goto(`/drafts/${ownDraft.id}`);
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.drafts.editor.title);
          await page.getByRole('button', { name: ar.drafts.editor.preview }).click();
          await expect(page.getByRole('table', { name: ar.drafts.preview.label })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `entry-screen-${colorScheme}-${width}`);
        });

        test('new entry', async ({ page }, testInfo) => {
          await page.goto('/entries/new');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(
            ar.drafts.editor.newTitle,
          );
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `new-entry-${colorScheme}-${width}`);
        });

        test('rejected draft', async ({ page }, testInfo) => {
          await page.goto(`/drafts/${rejectedDraft.id}`);
          await expect(page.getByText(ar.drafts.editor.rejectedTitle)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `rejected-draft-${colorScheme}-${width}`);
        });

        test('drafts', async ({ page }, testInfo) => {
          await page.goto('/drafts');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.drafts.title);
          await expect(page.getByText('شراء دولار للمصاريف')).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `drafts-${colorScheme}-${width}`);
        });

        test('reversal', async ({ page }, testInfo) => {
          await page.goto(`/entries/${reversal.id}`);
          await expect(page.getByRole('heading', { level: 1 })).toContainText('2026/2');
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `reversal-${colorScheme}-${width}`);
        });

        test('account lines', async ({ page }, testInfo) => {
          await page.goto(`/accounts/${accountOf('111004').id}/lines`);
          await expect(page.getByRole('table', { name: ar.entries.lines.label })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `account-lines-${colorScheme}-${width}`);
        });
      });

      test.describe('inbox screens', () => {
        test.use({ me: owner, api: { ...receivablesReads, ...inboxReads } });
        test.beforeEach(async ({ page }) => {
          await page.clock.setFixedTime(today);
        });

        for (const view of ['held', 'all'] as const) {
          test(`inbox: ${view}`, async ({ page }, testInfo) => {
            await page.goto(`/inbox?view=${view}`);
            await expect(
              page.getByRole('table', { name: `${ar.inbox.table.label}: ${ar.inbox.views[view]}` }),
            ).toBeVisible();
            await expectNoPageOverflow(page);
            await screenshot(page, testInfo, `inbox-${view}-${colorScheme}-${width}`);
          });
        }

        for (const event of inboxScreenEvents) {
          test(`inbox event: ${event.state} ${event.reason ?? ''}`, async ({ page }, testInfo) => {
            await page.goto(`/inbox/${event.id}`);
            await expect(page.getByRole('table', { name: ar.inbox.event.history })).toBeVisible();
            await expectNoPageOverflow(page);
            await screenshot(
              page,
              testInfo,
              `inbox-event-${event.state}-${(event.reason ?? 'none').toLowerCase()}-${colorScheme}-${width}`,
            );
          });
        }

        test('inbox: resolve dialog', async ({ page }, testInfo) => {
          await page.goto(`/inbox/${overpayment.id}`);
          await page.getByRole('button', { name: ar.inbox.resolve.label }).click();
          await expect(page.getByRole('dialog', { name: ar.inbox.resolve.title })).toBeVisible();
          await screenshot(page, testInfo, `inbox-resolve-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('inbox: move dialog', async ({ page }, testInfo) => {
          await page.goto(`/inbox/${closedMonth.id}`);
          await page.getByRole('button', { name: ar.inbox.move.label }).click();
          await expect(page.getByRole('dialog', { name: ar.inbox.move.title })).toBeVisible();
          await screenshot(page, testInfo, `inbox-move-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });
      });

      test.describe('revenue screens', () => {
        test.use({ me: owner, api: revenueReads });
        test.beforeEach(async ({ page }) => {
          await page.clock.setFixedTime(today);
        });

        test('revenue: schedules', async ({ page }, testInfo) => {
          await page.goto('/revenue');
          await expect(page.getByRole('table', { name: ar.revenue.table.label })).toBeVisible();
          await expect(page.getByText(ar.revenue.decisions.title)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `revenue-schedules-${colorScheme}-${width}`);
        });

        test('revenue: months', async ({ page }, testInfo) => {
          await page.goto('/revenue?view=months');
          await expect(page.getByRole('table', { name: ar.revenue.months.label })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `revenue-months-${colorScheme}-${width}`);
        });

        test('revenue: month preview', async ({ page }, testInfo) => {
          await page.goto('/revenue?view=months');
          await page.getByRole('button', { name: ar.revenue.preview.open }).click();
          const dialog = page.getByRole('dialog', { name: new RegExp(ar.revenue.preview.title) });
          await expect(dialog).toContainText(cycle.invoiceNumber);
          await screenshot(page, testInfo, `revenue-preview-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        for (const schedule of [cycle, releasedCycle]) {
          test(`revenue schedule: ${schedule.state}`, async ({ page }, testInfo) => {
            await page.goto(`/revenue/${schedule.id}`);
            await expect(
              page.getByRole('table', { name: ar.revenue.schedule.movementsLabel }),
            ).toBeVisible();
            await expectNoPageOverflow(page);
            await screenshot(
              page,
              testInfo,
              `revenue-schedule-${schedule.state}-${colorScheme}-${width}`,
            );
          });
        }

        test('inbox event: service period closed', async ({ page }, testInfo) => {
          await page.goto(`/inbox/${serviceClosed.id}`);
          await expect(
            page.getByRole('table', { name: ar.revenue.actions.recognise.closedPartsLabel }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `inbox-event-service-closed-${colorScheme}-${width}`);
        });

        test('inbox: recognise dialog', async ({ page }, testInfo) => {
          await page.goto(`/inbox/${serviceClosed.id}`);
          await page.getByRole('button', { name: ar.revenue.actions.recognise.label }).click();
          const dialog = page.getByRole('dialog', { name: ar.revenue.actions.recognise.title });
          await expect(
            dialog
              .getByText(ar.revenue.previewEntries.release)
              .or(dialog.getByRole('table').first()),
          ).toBeVisible();
          await screenshot(page, testInfo, `inbox-recognise-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('inbox event: cancelled project remainder', async ({ page }, testInfo) => {
          await page.goto(`/inbox/${cancelledProject.id}`);
          // The refund payable's line of the whole remainder refunded.
          await expect(page.getByText('211003').first()).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `inbox-event-remainder-${colorScheme}-${width}`);
        });

        test('inbox: split dialog', async ({ page }, testInfo) => {
          await page.goto(`/inbox/${cancelledProject.id}`);
          await page.getByRole('button', { name: ar.revenue.actions.split.label }).click();
          const dialog = page.getByRole('dialog', { name: ar.revenue.actions.split.title });
          const amount = dialog.getByLabel(new RegExp(ar.revenue.actions.split.revenue));
          await amount.fill('100');
          await amount.press('Tab');
          await expect(dialog).toContainText('-12,000.00');
          await screenshot(page, testInfo, `inbox-split-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('contract asset item', async ({ page }, testInfo) => {
          await page.goto(`/open-items/${contractAssetItem.id}`);
          await expect(page.getByText(ar.revenue.contractAsset.label)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `contract-asset-item-${colorScheme}-${width}`);
        });
      });

      test.describe('period screens', () => {
        test.use({ me: owner, api: periodsReads });
        test.beforeEach(async ({ page }) => {
          await page.clock.setFixedTime(today);
        });

        test('periods', async ({ page }, testInfo) => {
          await page.goto('/periods');
          await expect(page.getByRole('table', { name: ar.periods.table.label })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `periods-${colorScheme}-${width}`);
        });

        test('period: failing checklist', async ({ page }, testInfo) => {
          await page.goto('/periods/2026-10');
          await expect(page.locator('[data-slot="checklist-item"]')).toHaveCount(7);
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `period-failing-${colorScheme}-${width}`);
        });

        test('period: close dialog', async ({ page }, testInfo) => {
          await page.route('**/api/periods/2026-10', (route) =>
            route.fulfill({ status: 200, json: passingOctober }),
          );
          await page.goto('/periods/2026-10');
          await expect(page.getByText(`${ar.periods.detail.summary}: 7/7`)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `period-passing-${colorScheme}-${width}`);
          await page.getByRole('button', { name: ar.periods.close.action }).click();
          await expect(page.getByRole('dialog')).toContainText(ar.periods.close.description);
          await screenshot(page, testInfo, `period-close-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('period: reopen dialog', async ({ page }, testInfo) => {
          await page.route('**/api/periods/2026-10', (route) =>
            route.fulfill({ status: 200, json: closedOctober }),
          );
          await page.route('**/api/periods', (route) =>
            route.fulfill({ status: 200, json: octoberClosedList }),
          );
          await page.goto('/periods/2026-10');
          await page.getByRole('button', { name: ar.periods.reopen.action }).click();
          await expect(page.getByRole('dialog')).toContainText(ar.periods.reopen.description);
          await screenshot(page, testInfo, `period-reopen-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('revaluation: to post', async ({ page }, testInfo) => {
          await page.goto('/revaluation?period=2026-10&ledger=book');
          await expect(
            page.getByRole('table', { name: ar.revaluation.balances.label }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `revaluation-to-post-${colorScheme}-${width}`);
        });

        test('revaluation: current', async ({ page }, testInfo) => {
          await page.route('**/api/revaluation/2026-10*', (route) =>
            route.fulfill({ status: 200, json: currentBookPreview }),
          );
          await page.goto('/revaluation?period=2026-10&ledger=book');
          await expect(
            page.getByRole('table', { name: ar.revaluation.posted.label }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `revaluation-current-${colorScheme}-${width}`);
        });

        test('revaluation: parallel, rate missing', async ({ page }, testInfo) => {
          await page.goto('/revaluation?period=2026-10&ledger=parallel');
          await expect(page.getByText(ar.revaluation.states.rate_missing)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `revaluation-rate-missing-${colorScheme}-${width}`);
        });
      });

      test.describe('settings screens', () => {
        test.use({ me: owner, api: settingsReads });

        test('posting rules', async ({ page }, testInfo) => {
          await page.goto('/settings/posting-rules');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.postingRules.title);
          await expect(page.getByText(ar.postingRules.unmappedTitle)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `posting-rules-${colorScheme}-${width}`);
        });

        test('posting rules: map dialog', async ({ page }, testInfo) => {
          await page.goto('/settings/posting-rules');
          const name = ar.postingRules.slots.project_cost;
          await page.getByRole('button', { name: `${ar.postingRules.change}: ${name}` }).click();
          await expect(
            page.getByRole('dialog', { name: `${ar.postingRules.changeTitle}: ${name}` }),
          ).toBeVisible();
          await screenshot(page, testInfo, `posting-rules-map-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('API clients', async ({ page }, testInfo) => {
          await page.goto('/settings/api-clients');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.apiClients.title);
          await expect(page.getByRole('table', { name: ar.apiClients.keys.label })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `api-clients-${colorScheme}-${width}`);
        });

        test('API clients: new client', async ({ page }, testInfo) => {
          await page.goto('/settings/api-clients');
          await page.getByRole('button', { name: ar.apiClients.form.newTitle }).click();
          await expect(
            page.getByRole('dialog', { name: ar.apiClients.form.newTitle }),
          ).toBeVisible();
          await screenshot(page, testInfo, `api-clients-new-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('API clients: the key shown once', async ({ page }, testInfo) => {
          await page.route('**/api/api-clients/*/keys', (route) =>
            route.fulfill({ status: 201, json: newKeyOf(newSecret()) }),
          );
          await page.goto('/settings/api-clients');
          await page.getByRole('button', { name: ar.apiClients.client.newKey }).click();
          await page.getByRole('button', { name: ar.apiClients.newKey.confirm }).click();
          await expect(
            page.getByRole('dialog', {
              name: `${ar.apiClients.reveal.title}: ${hubClient.name}`,
            }),
          ).toBeVisible();
          await screenshot(page, testInfo, `api-clients-key-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });
      });

      test.describe('receivables screens', () => {
        test.use({ me: owner, api: receivablesReads });
        test.beforeEach(async ({ page }) => {
          await page.clock.setFixedTime(today);
        });

        test('receivables ageing', async ({ page }, testInfo) => {
          await page.goto('/receivables');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(
            ar.openItems.ageing.title,
          );
          // A client opened to its items: the table on a tablet and up, its card on a phone.
          await page
            .getByRole('button', { name: `${ar.openItems.ageingTable.showDetail} 1` })
            .filter({ visible: true })
            .click();
          await expect(
            page.getByRole('table', { name: ar.openItems.ageing.itemsLabel }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `receivables-${colorScheme}-${width}`);
        });

        test('client statement', async ({ page }, testInfo) => {
          await page.goto(`/receivables/clients/${client.id}`);
          await expect(
            page.getByRole('table', { name: ar.openItems.statement.label }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `client-statement-${colorScheme}-${width}`);
        });

        test('open item', async ({ page }, testInfo) => {
          await page.goto(`/open-items/${m1.id}`);
          await expect(
            page.getByRole('table', { name: ar.openItems.item.movementsLabel }),
          ).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `open-item-${colorScheme}-${width}`);
        });

        test('due-date change', async ({ page }, testInfo) => {
          await page.goto(`/open-items/${m1.id}`);
          await page.getByRole('button', { name: ar.openItems.item.changeDueDate }).click();
          await expect(
            page.getByRole('dialog', { name: ar.openItems.dueDate.title }),
          ).toBeVisible();
          await screenshot(page, testInfo, `due-date-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });

        test('client funds', async ({ page }, testInfo) => {
          await page.goto('/client-funds');
          await expect(page.getByRole('table', { name: ar.openItems.funds.label })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `client-funds-${colorScheme}-${width}`);
        });

        test('receipt with its item', async ({ page }, testInfo) => {
          await page.goto(`/entries/new?client=${client.id}`);
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(
            ar.drafts.editor.newTitle,
          );
          if (width >= 768) {
            const grid = page.getByRole('grid', { name: ar.drafts.editor.lines });
            await grid.locator('[data-row="1"][data-column="1"]').click();
            await page.keyboard.type('112001');
            await page.keyboard.press('Enter');
            await grid.locator('[data-row="1"][data-column="3"]').click();
            await page.keyboard.type('M-1');
            await page.keyboard.press('Enter');
            await expect(grid.locator('[data-row="1"][data-column="3"]')).toContainText('600.00');
          }
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `receipt-${colorScheme}-${width}`);
        });
      });

      test.describe('trust screens', () => {
        test.use({
          me: owner,
          api: {
            ...trustReads,
            'POST /api/integrity/check': { status: 200, json: brokenReport },
          },
        });
        test.beforeEach(async ({ page }) => {
          await page.clock.setFixedTime(today);
        });

        test('integrity check', async ({ page }, testInfo) => {
          await page.goto('/integrity');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.integrity.title);
          await page.getByRole('button', { name: ar.integrity.run }).click();
          await expect(page.getByText(ar.integrity.result.broken)).toBeVisible();
          await page.getByLabel(ar.integrity.pasted.hash, { exact: true }).fill(emailedAnchor);
          await page.getByRole('button', { name: ar.integrity.pasted.submit }).click();
          await expect(page.getByRole('region', { name: ar.common.errorSummary })).toBeFocused();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `integrity-${colorScheme}-${width}`);
        });

        test('export', async ({ page }, testInfo) => {
          await page.goto('/settings/export');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.export.title);
          await expect(page.getByText(ar.export.states.ready)).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `export-${colorScheme}-${width}`);
        });
      });

      test.describe('an entry not yet reversed', () => {
        test.use({
          me: owner,
          api: {
            ...entryReads,
            [`GET /api/entries/${purchase.id}`]: { status: 200, json: purchase },
          },
        });

        test('reverse dialog', async ({ page }, testInfo) => {
          await page.goto(`/entries/${purchase.id}`);
          await page.getByRole('button', { name: ar.entries.actions.reverse }).click();
          await expect(page.getByRole('dialog', { name: ar.entries.reverse.title })).toBeVisible();
          await screenshot(page, testInfo, `reverse-dialog-${colorScheme}-${width}`, {
            fullPage: false,
          });
        });
      });

      test.describe('entry screens with approval', () => {
        test.use({
          me: owner,
          api: { ...entryReads, 'GET /api/company': { status: 200, json: approvalCompany } },
        });

        test('draft awaiting approval', async ({ page }, testInfo) => {
          await page.clock.setFixedTime(today);
          await page.goto(`/drafts/${submittedDraft.id}`);
          await expect(page.getByRole('button', { name: ar.drafts.editor.approve })).toBeVisible();
          await expectNoPageOverflow(page);
          await screenshot(page, testInfo, `draft-approval-${colorScheme}-${width}`);
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
