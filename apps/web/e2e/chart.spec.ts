import type { Page, Request } from '@playwright/test';
import type { Account } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { accountOf, chart, chartReads, roles, roots, templates, usedChart } from './chart-mocks';
import { companyId, owner, viewer } from './company-mocks';
import { type ApiReply, expect, fieldError, refusal, test } from './test';

const t = ar.chart;
const s = t.sheet;

/** Records each request a mock answers, to check what the page sent. */
function recorder(reply: ApiReply | ((request: Request) => ApiReply)) {
  const seen: Request[] = [];
  return {
    seen,
    mock: (request: Request) => {
      seen.push(request);
      return typeof reply === 'function' ? reply(request) : reply;
    },
  };
}

const tree = (page: Page) => page.getByRole('treegrid', { name: t.tree.label });
const row = (page: Page, code: string) =>
  tree(page)
    .getByRole('row')
    .filter({ has: page.getByText(code, { exact: true }) });

async function rowAction(page: Page, code: string, action: string) {
  // A menu still closing (its exit animation) holds the same items: open the next one after it.
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: `${t.tree.menu}: ${code}`, exact: true }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: action }).click();
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('an empty chart', () => {
  test.use({ me: owner });

  test('takes a template, then shows its accounts (S02 rule 1)', async ({ page }) => {
    let applied = false;
    const apply = recorder({ status: 200, json: chart });
    await page.route('**/api/accounts*', (route) =>
      route.fulfill({ status: 200, json: applied ? chart : roots }),
    );
    await page.route('**/api/chart/apply-template', (route) => {
      applied = true;
      return route.fulfill({ status: 200, json: apply.mock(route.request()).json });
    });
    await page.route('**/api/chart/templates', (route) =>
      route.fulfill({ status: 200, json: templates }),
    );
    await page.goto('/chart');
    await expect(page.getByText(t.empty.title)).toBeVisible();
    await expect(row(page, '1')).toBeVisible();
    await page.getByRole('button', { name: t.empty.apply }).first().click();
    await expect(row(page, '111001')).toBeVisible();
    await expect(page.getByText(t.empty.title)).toHaveCount(0);
    expect(apply.seen[0]?.postDataJSON()).toEqual({ templateId: 'service-agency' });
    expect(apply.seen[0]?.headers()['x-mizan-company']).toBe(companyId);
  });
});

test.describe('the chart', () => {
  test.use({ me: owner, api: chartReads });

  test('adds an account under a header, refusing a code that breaks the shape (step 2)', async ({
    page,
  }) => {
    const bank = accountOf('111');
    const added: Account = {
      ...accountOf('111001'),
      id: '01900000-0000-7000-8002-000000111007',
      code: '111007',
      name: 'الحساب المصرفي — يورو',
      currency: 'EUR',
    };
    const create = recorder({ status: 201, json: added });
    await page.route('**/api/accounts', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, json: create.mock(route.request()).json })
        : route.fallback(),
    );
    await page.goto('/chart');
    await rowAction(page, '111', t.actions.addChild);
    const sheet = page.getByRole('dialog', { name: s.createTitle });
    // The next free code under the header is offered.
    await expect(sheet.getByLabel(s.code)).toHaveValue('111007');
    await sheet.getByLabel(s.code).fill('1110071');
    await sheet.getByLabel(s.name).fill('الحساب المصرفي — يورو');
    await choose(page, s.statementLine, 'النقد وما يعادله');
    await sheet.getByRole('button', { name: s.create }).click();
    await expect(fieldError(sheet, ar.errors.ACCOUNT_CODE_INVALID)).toBeVisible();
    expect(create.seen).toHaveLength(0);

    await sheet.getByLabel(s.code).fill('111007');
    await choose(page, s.currency, `${ar.accounting.currencies.EUR} (EUR)`);
    await sheet.getByRole('button', { name: s.create }).click();
    await expect(sheet).toHaveCount(0);
    expect(create.seen[0]?.postDataJSON()).toEqual({
      parentId: bank.id,
      code: '111007',
      kind: 'postable',
      name: 'الحساب المصرفي — يورو',
      nameLatin: null,
      normalBalance: 'debit',
      statementLine: 'bs.cash',
      currency: 'EUR',
      isControl: false,
      // Q12: a currency restriction turns the monetary flag on.
      isMonetary: true,
      requiredDimensionTypeIds: [],
    });
    expect(create.seen[0]?.headers()['x-mizan-company']).toBe(companyId);
  });

  test('shows the API refusal of a taken code', async ({ page }) => {
    await page.route('**/api/accounts', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 409, json: refusal(409, 'ACCOUNT_CODE_TAKEN').json })
        : route.fallback(),
    );
    await page.goto('/chart');
    await rowAction(page, '111', t.actions.addChild);
    const sheet = page.getByRole('dialog', { name: s.createTitle });
    await sheet.getByLabel(s.name).fill('حساب مكرر');
    await choose(page, s.statementLine, 'النقد وما يعادله');
    await sheet.getByRole('button', { name: s.create }).click();
    await expect(sheet.getByText(ar.errors.ACCOUNT_CODE_TAKEN)).toBeVisible();
  });

  test('blocks, archives and restores an account with a reason (step 3)', async ({ page }) => {
    const box = accountOf('111001');
    const sent: { path: string; body: unknown }[] = [];
    await page.route('**/api/accounts/*/*', (route) => {
      const path = new URL(route.request().url()).pathname;
      sent.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ status: 200, json: box });
    });
    await page.goto('/chart');
    await rowAction(page, '111001', t.actions.block);
    let dialog = page.getByRole('dialog', { name: t.block.title });
    await dialog.getByLabel(t.block.reason).fill('حساب قيد المراجعة (مثال)');
    await dialog.getByRole('button', { name: t.block.submit }).click();
    await expect(dialog).toHaveCount(0);

    await rowAction(page, '111001', t.actions.archive);
    dialog = page.getByRole('dialog', { name: t.archive.title });
    await dialog.getByRole('button', { name: t.archive.submit }).click();
    await expect(fieldError(dialog, ar.company.validation.required)).toBeVisible();
    await dialog.getByLabel(t.archive.reason).fill('لم يعد مستخدمًا (مثال)');
    await dialog.getByRole('button', { name: t.archive.submit }).click();
    await expect(dialog).toHaveCount(0);

    expect(sent).toEqual([
      { path: `/api/accounts/${box.id}/block`, body: { reason: 'حساب قيد المراجعة (مثال)' } },
      { path: `/api/accounts/${box.id}/archive`, body: { reason: 'لم يعد مستخدمًا (مثال)' } },
    ]);
  });

  test('marks blocked and archived accounts, and restores an archived one', async ({ page }) => {
    const marked = chart.map((account) =>
      account.code === '111002'
        ? { ...account, blocked: { at: '2026-10-26T09:00:00.000Z', reason: 'مثال' } }
        : account.code === '111003'
          ? { ...account, archived: { at: '2026-10-26T09:00:00.000Z', reason: 'مثال' } }
          : account,
    );
    const restore = recorder({ status: 200, json: accountOf('111003') });
    let includeArchived: string | null = null;
    await page.route(
      (url) => url.pathname === '/api/accounts',
      (route) => {
        includeArchived = new URL(route.request().url()).searchParams.get('includeArchived');
        return route.fulfill({ status: 200, json: marked });
      },
    );
    await page.route('**/api/accounts/*/restore', (route) =>
      route.fulfill({ status: 200, json: restore.mock(route.request()).json }),
    );
    await page.goto('/chart');
    await expect(row(page, '111002').getByText(t.tree.blocked)).toBeVisible();
    await expect(row(page, '111003')).toHaveCount(0);
    await page.getByText(t.filters.showArchived).click();
    await expect(row(page, '111003').getByText(t.tree.archived)).toBeVisible();
    expect(includeArchived).toBe('true');
    await rowAction(page, '111003', t.actions.restore);
    const dialog = page.getByRole('dialog', { name: t.restore.title });
    await dialog.getByLabel(t.restore.reason).fill('أُرشف خطأً (مثال)');
    await dialog.getByRole('button', { name: t.restore.submit }).click();
    await expect(dialog).toHaveCount(0);
    expect(restore.seen[0]?.postDataJSON()).toEqual({ reason: 'أُرشف خطأً (مثال)' });
  });

  test('filters by text, class and flag, keeping the matches in their branches', async ({
    page,
  }) => {
    await page.goto('/chart');
    await page.getByLabel(t.filters.search).fill('111002');
    await expect(tree(page).getByRole('row')).toHaveCount(5);
    await expect(row(page, '11')).toBeVisible();
    await page.getByLabel(t.filters.search).fill('لا يوجد حساب بهذا الاسم');
    await expect(page.getByText(t.emptyFilter)).toBeVisible();
    await page.getByLabel(t.filters.search).fill('');
    await choose(page, t.filters.flag, t.filters.control);
    const controls = chart.filter((account) => account.isControl);
    for (const account of controls) await expect(row(page, account.code)).toBeVisible();
    await expect(row(page, '111001')).toHaveCount(0);
  });

  test('edits only the changed fields, and opens with the keyboard', async ({ page }) => {
    const box = accountOf('111001');
    const patch = recorder({ status: 200, json: box });
    await page.route('**/api/accounts/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 200, json: patch.mock(route.request()).json })
        : route.fallback(),
    );
    await page.goto('/chart');
    await row(page, '111001').focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: s.editTitle });
    await sheet.getByRole('button', { name: s.save }).click();
    await expect(sheet.getByText(s.nothingChanged)).toBeVisible();
    await sheet.getByLabel(s.name).fill('الصندوق الرئيسي');
    await sheet.getByRole('button', { name: s.save }).click();
    await expect(sheet).toHaveCount(0);
    expect(patch.seen[0]?.postDataJSON()).toEqual({ name: 'الصندوق الرئيسي' });
    expect(new URL(patch.seen[0]?.url() ?? '').pathname).toBe(`/api/accounts/${box.id}`);
  });

  test('exports the chart to Excel with the company header (step 8)', async ({ page }) => {
    const exported = recorder({ status: 200 });
    await page.route('**/api/chart/export*', (route) => {
      exported.mock(route.request());
      return route.fulfill({
        status: 200,
        body: 'xlsx',
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': 'attachment; filename="chart-of-accounts.xlsx"',
        },
      });
    });
    await page.goto('/chart');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: t.exportExcel }).click();
    expect((await download).suggestedFilename()).toBe('chart-of-accounts.xlsx');
    expect(new URL(exported.seen[0]?.url() ?? '').search).toBe('?format=xlsx');
    expect(exported.seen[0]?.headers()['x-mizan-company']).toBe(companyId);
  });

  test('opens a new account from the command palette', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
    await page.keyboard.press('Control+k');
    const search = page.getByRole('combobox', { name: ar.commandPalette.search });
    await expect(search).toBeFocused();
    await search.fill(t.newAccount);
    await search.press('Enter');
    await expect(page.getByRole('dialog', { name: s.createTitle })).toBeVisible();
  });

  test('follows a new parent with its code, kind and normal balance (rule 2)', async ({ page }) => {
    const create = recorder({ status: 201, json: accountOf('211001') });
    await page.route('**/api/accounts', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 201, json: create.mock(route.request()).json })
        : route.fallback(),
    );
    await page.goto('/chart?new=true');
    const sheet = page.getByRole('dialog', { name: s.createTitle });
    // Under the root of assets: a level-2 header, debit.
    await expect(sheet.getByRole('combobox', { name: s.kind })).toBeDisabled();
    await expect(sheet.getByRole('combobox', { name: s.kind })).toHaveText(t.kinds.header);
    await expect(sheet.getByRole('combobox', { name: s.normalBalance })).toHaveText(
      t.normalBalances.debit,
    );
    await choose(page, s.parent, `21 ${accountOf('21').name}`);
    await expect(sheet.getByLabel(s.code)).toHaveValue('216');
    await expect(sheet.getByRole('combobox', { name: s.kind })).toHaveText(t.kinds.postable);
    await expect(sheet.getByRole('combobox', { name: s.normalBalance })).toHaveText(
      t.normalBalances.credit,
    );
    await sheet.getByLabel(s.name).fill('أمانات إعلانات العملاء');
    await choose(page, s.statementLine, 'أمانات العملاء');
    await sheet.getByRole('button', { name: s.create }).click();
    await expect(sheet).toHaveCount(0);
    expect(create.seen[0]?.postDataJSON()).toMatchObject({
      parentId: accountOf('21').id,
      code: '216',
      kind: 'postable',
      normalBalance: 'credit',
      statementLine: 'bs.client_money',
    });
  });
});

test.describe('archived accounts', () => {
  const archived = { at: '2026-10-26T09:00:00.000Z', reason: 'مثال' };
  test.use({
    me: owner,
    api: {
      ...chartReads,
      'GET /api/accounts': {
        status: 200,
        json: [
          ...chart.map((account) =>
            account.code === '113001' ? { ...account, archived } : account,
          ),
          {
            ...accountOf('111001'),
            id: '01900000-0000-7000-8002-000000111007',
            code: '111007',
            archived,
          },
        ],
      },
    },
  });

  test('still hold their codes and lock their parent, as the API counts them', async ({ page }) => {
    await page.goto('/chart');
    await rowAction(page, '111', t.actions.addChild);
    let sheet = page.getByRole('dialog', { name: s.createTitle });
    await expect(sheet.getByLabel(s.code)).toHaveValue('111008');
    await page.keyboard.press('Escape');
    await rowAction(page, '113', t.actions.edit);
    sheet = page.getByRole('dialog', { name: s.editTitle });
    await expect(sheet.getByText(s.headerLockedTitle)).toBeVisible();
    await expect(sheet.getByLabel(s.code)).toBeDisabled();
    await expect(sheet.getByLabel(s.name)).toBeEnabled();
  });
});

test.describe('a used account', () => {
  test.use({
    me: owner,
    api: { ...chartReads, 'GET /api/accounts': { status: 200, json: usedChart } },
  });

  test('keeps its locked fields and says which stay editable', async ({ page }) => {
    await page.goto('/chart');
    await rowAction(page, '111001', t.actions.edit);
    const sheet = page.getByRole('dialog', { name: s.editTitle });
    await expect(sheet.getByText(s.lockedTitle)).toBeVisible();
    await expect(sheet.getByLabel(s.code)).toBeDisabled();
    await expect(sheet.getByRole('combobox', { name: s.currency })).toBeDisabled();
    await expect(sheet.getByLabel(s.name)).toBeEnabled();
  });
});

test.describe('a viewer', () => {
  test.use({
    me: { ...viewer, permissions: ['company.read', 'accounts.read', 'dimensions.read'] },
    api: chartReads,
  });

  test('reads the chart and the roles without changing them', async ({ page }) => {
    await page.goto('/chart');
    await expect(page.getByText(t.readOnly)).toBeVisible();
    await page.getByRole('button', { name: `${t.tree.menu}: 111001` }).click();
    await expect(page.getByRole('menuitem')).toHaveText([t.actions.view]);
    await page.getByRole('menuitem', { name: t.actions.view }).click();
    const sheet = page.getByRole('dialog', { name: s.viewTitle });
    await expect(sheet.getByLabel(s.name)).toBeDisabled();
    await expect(sheet.getByRole('button', { name: s.save })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/chart/roles');
    await expect(page.getByRole('button', { name: new RegExp(t.roleSettings.change) })).toHaveCount(
      0,
    );
  });
});

test.describe('the account roles', () => {
  test.use({ me: owner, api: chartReads });

  test('warns of a missing role and sets it through the picker (rule 7)', async ({ page }) => {
    const missing = roles.map((assignment) =>
      assignment.role === 'conversion_rounding' ? { ...assignment, accountId: null } : assignment,
    );
    const put = recorder({ status: 200, json: roles });
    await page.route('**/api/account-roles', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 200, json: put.mock(route.request()).json })
        : route.fulfill({ status: 200, json: missing }),
    );
    await page.goto('/chart/roles');
    await expect(page.getByText(t.roleSettings.missingTitle)).toBeVisible();
    await expect(page.getByText(t.roleSettings.notSet, { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: `${t.roleSettings.change}: ${t.roles.conversion_rounding}` })
      .click();
    const dialog = page.getByRole('dialog');
    const revenue = chart.find(
      (account) => account.kind === 'postable' && account.class === 'revenue',
    ) as Account;
    await dialog.getByRole('combobox', { name: t.roleSettings.picker }).fill(revenue.code);
    // Assets do not fit the role: the picker never offers them.
    await expect(page.getByRole('option', { name: /^111001/ })).toHaveCount(0);
    await page.getByRole('option', { name: new RegExp(`^${revenue.code}`) }).click();
    await dialog.getByRole('button', { name: t.roleSettings.save }).click();
    await expect(dialog).toHaveCount(0);
    expect(put.seen[0]?.postDataJSON()).toEqual({
      role: 'conversion_rounding',
      accountId: revenue.id,
    });
  });
});
