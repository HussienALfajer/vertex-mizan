import type { Request } from '@playwright/test';
import { ar } from '@vertex-mizan/i18n';
import {
  auditPage,
  company,
  companyId,
  companyReads,
  inSecondCompany,
  invitations,
  members,
  noCompany,
  owner,
  secondCompanyId,
  viewer,
} from './company-mocks';
import { type ApiReply, expect, refusal, test } from './test';

/** Records each request a mock answers, to check what the page sent. */
function recorder(reply: ApiReply) {
  const seen: Request[] = [];
  return {
    seen,
    mock: (request: Request) => {
      seen.push(request);
      return reply;
    },
  };
}

test.describe('the active company', () => {
  test.describe('as a member of two companies', () => {
    test.use({ me: owner });

    test('switching makes another company active', async ({ page }) => {
      const switched = recorder({ status: 200, json: inSecondCompany });
      await page.route('**/api/session/company', (route) =>
        route.fulfill({ status: 200, json: switched.mock(route.request()).json }),
      );
      await page.goto('/');
      await page.getByRole('button', { name: new RegExp(ar.company.switcher.open) }).click();
      await page.getByRole('menuitem', { name: /شركة ثانية/ }).click();
      await expect(
        page.getByRole('button', { name: `${ar.company.switcher.open}: شركة ثانية` }),
      ).toBeVisible();
      expect(switched.seen[0]?.postDataJSON()).toEqual({ companyId: secondCompanyId });
    });
  });

  test.describe('after a switch in another tab', () => {
    test.use({ me: owner, api: companyReads });

    test('a refused read loads the page again in the new company', async ({ page }) => {
      let switchedElsewhere = false;
      const shown: (string | undefined)[] = [];
      await page.route('**/api/me', (route) =>
        route.fulfill({ status: 200, json: switchedElsewhere ? inSecondCompany : owner }),
      );
      // The API refuses a read naming the company the session left (rule 22).
      await page.route('**/api/members', (route) => {
        const named = route.request().headers()['x-mizan-company'];
        shown.push(named);
        const reply =
          switchedElsewhere && named !== secondCompanyId
            ? refusal(409, 'COMPANY_SWITCHED')
            : { status: 200, json: members };
        return route.fulfill({ status: reply.status, json: reply.json });
      });
      await page.goto('/settings/company');
      await expect(page.getByLabel(ar.company.fields.name)).toHaveValue(company.name);
      switchedElsewhere = true;
      await page
        .getByRole('navigation', { name: ar.shell.navLabel })
        .getByRole('link', { name: ar.members.nav })
        .click();
      await expect(
        page.getByRole('button', { name: `${ar.company.switcher.open}: شركة ثانية` }),
      ).toBeVisible();
      await expect.poll(() => shown.at(-1)).toBe(secondCompanyId);
      expect(shown[0]).toBe(companyId);
    });
  });

  test.describe('without an active company', () => {
    test.use({ me: noCompany });

    test('a company page sends the person to choose one', async ({ page }) => {
      await page.goto('/settings/company');
      await expect(page).toHaveURL(/\/companies$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.company.list.title);
    });
  });

  test.describe('with no company at all', () => {
    test.use({ me: { ...noCompany, memberships: [] } });

    test('invites the person to create their first company', async ({ page }) => {
      await page.goto('/companies');
      await expect(page.getByText(ar.company.list.emptyTitle)).toBeVisible();
    });
  });
});

test.describe('company writes', () => {
  test.use({ me: owner, api: companyReads });

  test('carry the company the page shows (X-Mizan-Company)', async ({ page }) => {
    const patch = recorder({ status: 200, json: { ...company, name: 'شركة اختبار المعدلة' } });
    await page.route('**/api/company', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 200, json: patch.mock(route.request()).json })
        : route.fallback(),
    );
    await page.goto('/settings/company');
    const name = page.getByLabel(ar.company.fields.name);
    await expect(name).toHaveValue(company.name);
    await name.fill('شركة اختبار المعدلة');
    await page.getByRole('button', { name: ar.company.settings.profile.submit }).click();
    await expect(page.getByText(ar.company.settings.profile.saved)).toBeVisible();
    expect(patch.seen[0]?.headers()['x-mizan-company']).toBe(companyId);
    expect(patch.seen[0]?.postDataJSON()).toEqual({
      name: 'شركة اختبار المعدلة',
      nameLatin: 'Test Company',
    });
  });

  test('explain a switch in another tab', async ({ page }) => {
    await page.route('**/api/company', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 409, json: refusal(409, 'COMPANY_SWITCHED').json })
        : route.fallback(),
    );
    await page.goto('/settings/company');
    await page.getByRole('button', { name: ar.company.settings.policyNote.submit }).click();
    await expect(page.getByRole('alert')).toHaveText(ar.errors.COMPANY_SWITCHED);
  });

  test('ask for a fresh code before changing the ledgers', async ({ page }) => {
    let attempts = 0;
    const reauth = recorder({ status: 204 });
    await page.route('**/api/company/ledgers', (route) => {
      attempts += 1;
      const reply =
        attempts === 1 ? refusal(403, 'REAUTHENTICATION_REQUIRED') : { status: 200, json: company };
      return route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.route('**/api/auth/reauthenticate', (route) => {
      reauth.mock(route.request());
      return route.fulfill({ status: 204 });
    });
    await page.goto('/settings/company');
    await page.getByRole('button', { name: ar.company.settings.ledgers.submit }).click();
    const dialog = page.getByRole('dialog', { name: ar.auth.reauth.title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').first().click();
    await page.keyboard.type('123456');
    await expect(page.getByText(ar.company.settings.ledgers.saved)).toBeVisible();
    expect(attempts).toBe(2);
    expect(reauth.seen[0]?.postDataJSON()).toEqual({ code: '123456' });
  });

  test('refuse a parallel currency equal to the book currency', async ({ page }) => {
    await page.goto('/settings/company');
    const ledgers = page.getByRole('group', { name: ar.company.fields.parallelLedger });
    await ledgers.getByRole('combobox', { name: ar.company.fields.currency }).click();
    await page.getByRole('option', { name: `${ar.accounting.currencies.SYP} (SYP)` }).click();
    await expect(page.getByText(ar.company.validation.sameCurrency)).toBeVisible();
  });
});

test.describe('the settings lock and read-only access', () => {
  test.describe('after the first posted entry', () => {
    test.use({
      me: owner,
      api: {
        ...companyReads,
        'GET /api/company': { status: 200, json: { ...company, booksStarted: true } },
      },
    });

    test('shows the ledgers read-only with the reason; the policy note stays editable', async ({
      page,
    }) => {
      await page.goto('/settings/company');
      await expect(page.getByText(ar.company.settings.ledgers.lockedTitle)).toBeVisible();
      await expect(
        page.getByRole('button', { name: ar.company.settings.ledgers.submit }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: ar.company.settings.policyNote.submit }),
      ).toBeVisible();
    });
  });

  test.describe('as a viewer', () => {
    test.use({ me: viewer, api: companyReads });

    test('reads the settings and sees no members or audit pages', async ({ page }) => {
      await page.goto('/settings/company');
      await expect(page.getByText(ar.company.settings.readOnly)).toBeVisible();
      await expect(
        page.getByRole('button', { name: ar.company.settings.profile.submit }),
      ).toHaveCount(0);
      const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
      await expect(nav.getByRole('link', { name: ar.members.nav })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: ar.audit.nav })).toHaveCount(0);
      await page.goto('/settings/members');
      await expect(page).toHaveURL(/\/$/);
    });
  });
});

test.describe('a new company', () => {
  test.use({ me: owner });

  test('is created with the ledgers pre-filled, then becomes active', async ({ page }) => {
    const created = recorder({ status: 201, json: { ...company, id: secondCompanyId } });
    const switched = recorder({ status: 200, json: inSecondCompany });
    await page.route('**/api/companies', (route) =>
      route.fulfill({ status: 201, json: created.mock(route.request()).json }),
    );
    await page.route('**/api/session/company', (route) =>
      route.fulfill({ status: 200, json: switched.mock(route.request()).json }),
    );
    await page.goto('/companies/new');
    await page.getByRole('button', { name: ar.company.create.submit }).click();
    await expect(page.getByText(ar.company.validation.required).first()).toBeVisible();
    expect(created.seen).toHaveLength(0);

    await page.getByLabel(ar.company.fields.name).fill('شركة جديدة');
    await page.getByLabel(ar.company.fields.policyNote).fill('أساس العملة الوظيفية (مثال).');
    await page.getByRole('button', { name: ar.company.create.submit }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(created.seen[0]?.postDataJSON()).toEqual({
      name: 'شركة جديدة',
      nameLatin: null,
      ledgers: {
        book: {
          currency: 'SYP',
          ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
        },
        parallel: {
          currency: 'USD',
          ratePolicy: { rateType: 'market', acceptsTransactionRate: true },
        },
      },
      fiscalYearStartMonth: 1,
      policyNote: 'أساس العملة الوظيفية (مثال).',
    });
    expect(switched.seen[0]?.postDataJSON()).toEqual({ companyId: secondCompanyId });
  });
});

test.describe('members', () => {
  test.use({ me: owner, api: companyReads });

  test('an invitation is sent after a fresh code', async ({ page }) => {
    let attempts = 0;
    const sent: unknown[] = [];
    await page.route('**/api/invitations', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      attempts += 1;
      sent.push(route.request().postDataJSON());
      const reply =
        attempts === 1
          ? refusal(403, 'REAUTHENTICATION_REQUIRED')
          : { status: 201, json: invitations[0] };
      return route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.route('**/api/auth/reauthenticate', (route) => route.fulfill({ status: 204 }));
    await page.goto('/settings/members');
    await page.getByRole('button', { name: ar.members.invite }).click();
    const dialog = page.getByRole('dialog', { name: ar.members.inviteDialog.title });
    await dialog.getByLabel(ar.members.inviteDialog.email).fill('New.Person@Example.test');
    await dialog.getByText(ar.members.periodPermission).click();
    await dialog.getByRole('button', { name: ar.members.inviteDialog.submit }).click();
    const reauth = page.getByRole('dialog', { name: ar.auth.reauth.title });
    await reauth.getByRole('textbox').first().click();
    await page.keyboard.type('123456');
    await expect(page.getByText(ar.members.inviteDialog.sent)).toBeVisible();
    expect(sent[1]).toEqual({
      email: 'new.person@example.test',
      role: 'accountant',
      canClosePeriods: true,
    });
  });

  test('demoting the last owner is refused with the reason', async ({ page }) => {
    await page.route('**/api/members/*', (route) =>
      route.fulfill({ status: 409, json: refusal(409, 'LAST_OWNER').json }),
    );
    await page.route('**/api/auth/reauthenticate', (route) => route.fulfill({ status: 204 }));
    await page.goto('/settings/members');
    await page
      .getByRole('button', { name: `${ar.members.actions.menu}: ${members[0]?.name}` })
      .click();
    await page.getByRole('menuitem', { name: ar.members.actions.change }).click();
    const dialog = page.getByRole('dialog', { name: ar.members.change.title });
    await dialog.getByRole('combobox', { name: ar.members.table.role }).click();
    await page.getByRole('option', { name: ar.roles.viewer }).click();
    await dialog.getByRole('button', { name: ar.members.change.submit }).click();
    await expect(dialog.getByRole('alert')).toHaveText(ar.errors.LAST_OWNER);
  });

  test('removing a member asks for a reason', async ({ page }) => {
    const removed = recorder({ status: 204 });
    await page.route('**/api/members/*/remove', (route) => {
      removed.mock(route.request());
      return route.fulfill({ status: 204 });
    });
    await page.goto('/settings/members');
    await page
      .getByRole('button', { name: `${ar.members.actions.menu}: ${members[1]?.name}` })
      .click();
    await page.getByRole('menuitem', { name: ar.members.actions.remove }).click();
    const dialog = page.getByRole('dialog', { name: ar.members.remove.title });
    await dialog.getByRole('button', { name: ar.members.remove.submit }).click();
    await expect(dialog.getByText(ar.company.validation.required)).toBeVisible();
    await dialog.getByLabel(ar.members.reason).fill('انتهى التعاقد (مثال)');
    await dialog.getByRole('button', { name: ar.members.remove.submit }).click();
    await expect(dialog).toBeHidden();
    expect(removed.seen[0]?.url()).toContain(`/api/members/${members[1]?.id}/remove`);
    expect(removed.seen[0]?.headers()['x-mizan-company']).toBe(companyId);
    expect(removed.seen[0]?.postDataJSON()).toEqual({ reason: 'انتهى التعاقد (مثال)' });
  });
});

test.describe('the audit log', () => {
  test.use({ me: owner, api: companyReads });

  test('filters by action and shows an entry field by field', async ({ page }) => {
    const queries: string[] = [];
    await page.route('**/api/audit*', (route) => {
      queries.push(new URL(route.request().url()).search);
      return route.fulfill({ status: 200, json: auditPage });
    });
    await page.goto('/settings/audit');
    await page.getByRole('combobox', { name: ar.audit.filters.action }).click();
    await page.getByRole('option', { name: ar.audit.actions['membership.updated'] }).click();
    await expect.poll(() => queries.at(-1)).toBe('?action=membership.updated');

    await page.getByLabel(ar.audit.filters.from).fill('2026-10-01');
    await expect.poll(() => queries.at(-1)).toContain('from=2026-10-01T00%3A00%3A00.000%2B03%3A00');

    await page.getByRole('button', { name: ar.audit.table.details }).nth(1).click();
    const sheet = page.getByRole('dialog', { name: ar.audit.actions['membership.updated'] });
    const changes = sheet.locator('[data-slot="change-list"]');
    await expect(changes.getByRole('term').first()).toHaveText(ar.audit.fields.role);
    await expect(changes.getByRole('definition').first()).toContainText(ar.roles.viewer);
    await expect(changes.getByRole('definition').first()).toContainText(ar.roles.accountant);
  });

  test('marks an end date before the start date and does not query it', async ({ page }) => {
    const queries: string[] = [];
    await page.route('**/api/audit*', (route) => {
      queries.push(new URL(route.request().url()).search);
      return route.fulfill({ status: 200, json: auditPage });
    });
    await page.goto('/settings/audit');
    await expect(page.getByRole('table', { name: ar.audit.table.label })).toBeVisible();
    await page.getByLabel(ar.audit.filters.to).fill('2026-10-01');
    await page.getByLabel(ar.audit.filters.from).fill('2026-10-10');
    await expect(page.getByText(ar.audit.filters.order)).toBeVisible();
    expect(queries.some((query) => query.includes('from=2026-10-10'))).toBe(false);
  });
});
