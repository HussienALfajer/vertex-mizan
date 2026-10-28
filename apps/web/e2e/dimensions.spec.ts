import type { Page, Request } from '@playwright/test';
import type { DimensionType, Me } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { companyId, owner, viewer } from './company-mocks';
import { dimensionReads, hubClient, hubContract, manualClient, typeOf } from './dimension-mocks';
import { type ApiReply, expect, fieldError, refusal, test } from './test';

const t = ar.dimensions;

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

const table = (page: Page, type: string) =>
  page.getByRole('table', { name: `${t.table.label}: ${type}` });

async function valueAction(page: Page, name: string, action: string) {
  await page.getByRole('button', { name: `${t.table.menu}: ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

const reader: Me = { ...viewer, permissions: ['company.read', 'dimensions.read'] };

test.describe('dimensions', () => {
  test.use({ me: owner, api: dimensionReads });

  test('adds a manual client, links it to a Hub ID once, and adds a contract under it (step 4)', async ({
    page,
  }) => {
    const create = recorder((request) => ({
      status: 201,
      json: { ...manualClient, ...request.postDataJSON() },
    }));
    let links = 0;
    const link = recorder(() => {
      links += 1;
      return links === 1
        ? { status: 200, json: { ...manualClient, externalSource: 'hub', externalId: 'x' } }
        : refusal(409, 'DIMENSION_ALREADY_LINKED');
    });
    await page.route('**/api/dimension-values', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill(create.mock(route.request()))
        : route.fallback(),
    );
    await page.route('**/api/dimension-values/*/link', (route) =>
      route.fulfill(link.mock(route.request())),
    );
    await page.goto('/dimensions');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);

    // A manual client.
    await page.getByRole('button', { name: t.newValue }).click();
    let dialog = page.getByRole('dialog', { name: t.value.createTitle });
    await dialog.getByRole('button', { name: t.value.create }).click();
    await expect(fieldError(dialog, t.validation.required)).toBeVisible();
    await dialog.getByLabel(t.value.name, { exact: true }).fill('عميل تجريبي');
    await dialog.getByLabel(t.value.code).fill('C-001');
    await dialog.getByRole('button', { name: t.value.create }).click();
    await expect(dialog).toHaveCount(0);
    expect(create.seen[0]?.postDataJSON()).toEqual({
      typeId: typeOf('client').id,
      code: 'C-001',
      name: 'عميل تجريبي',
      nameLatin: null,
      contractKind: null,
      parentValueId: null,
    });
    expect(create.seen[0]?.headers()['x-mizan-company']).toBe(companyId);

    // Its Hub link, then a second attempt the API refuses (the list here is still unlinked).
    for (const attempt of [1, 2]) {
      await valueAction(page, 'عميل تجريبي', t.actions.link);
      dialog = page.getByRole('dialog', { name: `${t.link.title}: عميل تجريبي` });
      await dialog.getByLabel(t.link.externalId).fill('01900000-0000-7000-9000-000000000009');
      await dialog.getByRole('button', { name: t.link.submit }).click();
      if (attempt === 1) await expect(dialog).toHaveCount(0);
    }
    await expect(dialog.getByText(ar.errors.DIMENSION_ALREADY_LINKED)).toBeVisible();
    expect(link.seen.map((request) => request.postDataJSON())).toEqual([
      { externalId: '01900000-0000-7000-9000-000000000009' },
      { externalId: '01900000-0000-7000-9000-000000000009' },
    ]);
    await dialog.getByRole('button', { name: ar.common.cancel }).click();

    // A project under the client.
    await page.getByRole('tab', { name: typeOf('contract').name }).click();
    await expect(table(page, typeOf('contract').name).getByText(hubClient.name)).toBeVisible();
    await page.getByRole('button', { name: t.newValue }).click();
    dialog = page.getByRole('dialog', { name: t.value.createTitle });
    await dialog.getByLabel(t.value.name, { exact: true }).fill('مشروع تجريبي');
    await dialog.getByRole('button', { name: t.value.create }).click();
    await expect(fieldError(dialog, t.validation.required)).toBeVisible();
    await page.getByRole('combobox', { name: t.value.kind }).click();
    await page.getByRole('option', { name: t.contractKinds.project, exact: true }).click();
    const client = dialog.getByRole('combobox', { name: typeOf('client').name });
    await client.fill('تجريبي');
    await page.getByRole('option', { name: /عميل تجريبي/ }).click();
    await expect(client).toHaveValue('C-001 عميل تجريبي');
    await dialog.getByRole('button', { name: t.value.create }).click();
    await expect(dialog).toHaveCount(0);
    expect(create.seen[1]?.postDataJSON()).toEqual({
      typeId: typeOf('contract').id,
      code: null,
      name: 'مشروع تجريبي',
      nameLatin: null,
      contractKind: 'project',
      parentValueId: manualClient.id,
    });
  });

  test('renames a Hub value, saying Hub renames it again (rule 12)', async ({ page }) => {
    const update = recorder({ status: 200, json: hubClient });
    await page.route('**/api/dimension-values/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill(update.mock(route.request()))
        : route.fallback(),
    );
    await page.goto('/dimensions');
    await valueAction(page, hubClient.name, t.actions.edit);
    const dialog = page.getByRole('dialog', { name: t.value.editTitle });
    await expect(dialog.getByText(t.value.hubDescription)).toBeVisible();
    await dialog.getByRole('button', { name: t.value.save }).click();
    await expect(dialog.getByText(t.value.nothingChanged)).toBeVisible();
    expect(update.seen).toHaveLength(0);
    await dialog.getByLabel(t.value.name, { exact: true }).fill('شركة تجريبية للإعلان');
    await dialog.getByRole('button', { name: t.value.save }).click();
    await expect(dialog).toHaveCount(0);
    expect(update.seen[0]?.url()).toContain(`/api/dimension-values/${hubClient.id}`);
    expect(update.seen[0]?.postDataJSON()).toEqual({ name: 'شركة تجريبية للإعلان' });
  });

  test('archives a value and restores an archived one', async ({ page }) => {
    const sent: string[] = [];
    await page.route('**/api/dimension-values/*/*', (route) => {
      sent.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 200, json: manualClient });
    });
    await page.goto('/dimensions');
    await valueAction(page, manualClient.name, t.actions.archive);
    let dialog = page.getByRole('alertdialog', { name: t.archive.title });
    await dialog.getByRole('button', { name: t.archive.submit }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByText('عميل مؤرشف تجريبي')).toHaveCount(0);
    await page.getByText(t.showArchived).click();
    await expect(page.getByText('عميل مؤرشف تجريبي')).toBeVisible();
    await valueAction(page, 'عميل مؤرشف تجريبي', t.actions.restore);
    dialog = page.getByRole('alertdialog', { name: t.restore.title });
    await dialog.getByRole('button', { name: t.restore.submit }).click();
    await expect(dialog).toHaveCount(0);
    expect(sent).toEqual([
      `/api/dimension-values/${manualClient.id}/archive`,
      '/api/dimension-values/01900000-0000-7000-8004-000000000003/restore',
    ]);
  });

  test('adds a custom type, checking its code, and shows the limit refusal', async ({ page }) => {
    const added: DimensionType = {
      ...typeOf('department'),
      id: '01900000-0000-7000-8003-000000000009',
      code: 'cost_centre',
      builtin: false,
      name: 'مركز التكلفة',
      nameLatin: null,
      position: 5,
    };
    let calls = 0;
    const create = recorder(() => {
      calls += 1;
      return calls === 1 ? refusal(409, 'DIMENSION_TYPE_LIMIT') : { status: 201, json: added };
    });
    await page.route('**/api/dimension-types', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill(create.mock(route.request()))
        : route.fallback(),
    );
    await page.goto('/dimensions');
    await page.getByRole('button', { name: t.newType }).click();
    const dialog = page.getByRole('dialog', { name: t.type.createTitle });
    await dialog.getByLabel(t.type.code).fill('Cost Centre');
    await dialog.getByLabel(t.type.name, { exact: true }).fill('مركز التكلفة');
    await dialog.getByRole('button', { name: t.type.create }).click();
    await expect(fieldError(dialog, t.validation.typeCode)).toBeVisible();
    expect(create.seen).toHaveLength(0);
    await dialog.getByLabel(t.type.code).fill('cost_centre');
    await dialog.getByRole('button', { name: t.type.create }).click();
    await expect(dialog.getByText(ar.errors.DIMENSION_TYPE_LIMIT)).toBeVisible();
    await dialog.getByRole('button', { name: t.type.create }).click();
    await expect(dialog).toHaveCount(0);
    expect(create.seen[1]?.postDataJSON()).toEqual({
      code: 'cost_centre',
      name: 'مركز التكلفة',
      nameLatin: null,
    });
  });

  test('searches a type on the server', async ({ page }) => {
    const queries: (string | null)[] = [];
    await page.route(
      (url) => url.pathname === '/api/dimension-values',
      (route) => {
        const url = new URL(route.request().url());
        queries.push(url.searchParams.get('q'));
        return route.fallback();
      },
    );
    await page.goto('/dimensions');
    await page.getByLabel(t.search).fill('C-001');
    await expect(page.getByText(hubClient.name)).toHaveCount(0);
    await expect(page.getByText(manualClient.name, { exact: true })).toBeVisible();
    expect(queries).toContain('C-001');
    await page.getByLabel(t.search).fill('لا يوجد');
    await expect(page.getByText(t.empty.search)).toBeVisible();
  });
});

test.describe('a company with more than a page of clients', () => {
  // 100 newer clients fill the first page; the manual client is older, on a later page.
  const newer = Array.from({ length: 100 }, (_, index) => ({
    ...hubClient,
    id: `01900000-0000-7000-8009-${String(index).padStart(12, '0')}`,
    name: `عميل أحدث ${index + 1}`,
    externalId: `01900000-0000-7000-9001-${String(index).padStart(12, '0')}`,
  }));
  const olderContract = {
    ...hubContract,
    id: '01900000-0000-7000-8004-000000000010',
    name: 'مشروع قديم',
    contractKind: 'project' as const,
    parentValueId: manualClient.id,
    parentName: manualClient.name,
    externalSource: null,
    externalId: null,
  };
  test.use({
    me: owner,
    api: {
      ...dimensionReads,
      'GET /api/dimension-values': (request) => {
        const url = new URL(request.url());
        const q = url.searchParams.get('q');
        if (url.searchParams.get('typeId') === typeOf('contract').id) {
          return { status: 200, json: { values: [olderContract], nextCursor: null } };
        }
        const values = q
          ? [...newer, manualClient].filter((value) => value.name.includes(q))
          : newer;
        return { status: 200, json: { values, nextCursor: q ? null : 'next-page' } };
      },
    },
  });

  test("shows and finds a contract's client beyond the first page (rule 9)", async ({ page }) => {
    const update = recorder({ status: 200, json: olderContract });
    await page.route('**/api/dimension-values/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill(update.mock(route.request()))
        : route.fallback(),
    );
    await page.goto('/dimensions');
    await page.getByRole('tab', { name: typeOf('contract').name }).click();
    const row = page.getByRole('row').filter({ hasText: olderContract.name });
    await expect(row.getByText(manualClient.name)).toBeVisible();

    await valueAction(page, olderContract.name, t.actions.edit);
    const dialog = page.getByRole('dialog', { name: t.value.editTitle });
    const client = dialog.getByRole('combobox', { name: typeOf('client').name });
    await expect(client).toHaveValue(manualClient.name);
    // Clearing and searching again finds the older client on the server.
    await client.fill('تجريبي');
    await page.getByRole('option', { name: /عميل تجريبي/ }).click();
    await expect(client).toHaveValue('C-001 عميل تجريبي');
    await dialog.getByLabel(t.value.name, { exact: true }).fill('مشروع قديم معدّل');
    await dialog.getByRole('button', { name: t.value.save }).click();
    await expect(dialog).toHaveCount(0);
    // The client is unchanged, so only the name is sent.
    expect(update.seen[0]?.postDataJSON()).toEqual({ name: 'مشروع قديم معدّل' });
  });
});

test.describe('dimensions for a reader', () => {
  test.use({ me: reader, api: dimensionReads });

  test('reads without changing (S02 access)', async ({ page }) => {
    await page.goto('/dimensions');
    await expect(page.getByText(t.readOnly)).toBeVisible();
    await expect(page.getByText(manualClient.name, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: t.newValue })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t.newType })).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp(t.table.menu) })).toHaveCount(0);
    // A contract's client and kind.
    await page.getByRole('tab', { name: typeOf('contract').name }).click();
    const row = page.getByRole('row').filter({ hasText: hubContract.name });
    await expect(row.getByText(t.contractKinds.retainer)).toBeVisible();
    await expect(row.getByText(hubClient.name)).toBeVisible();
  });
});
