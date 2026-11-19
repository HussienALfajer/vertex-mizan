import { ar } from '@vertex-mizan/i18n';
import {
  client,
  company,
  ids,
  material,
  materialCosts,
  otherProject,
  owedByUs,
  owedToUs,
  owner,
  project,
  rateHistory,
  ratesMissing,
  ratesToday,
  received,
  supplier,
} from './movements-data';
import { expect, expectNoProductName, fieldError, refusal, test } from './test';

/** S13 screens 6–8 (ADR 0024): the clients and suppliers, the materials and the rates. */

const t = ar.movements;
const p = t.parties;

test.use({ me: owner });

test.describe('the clients', () => {
  let listed: URL | undefined;
  let added: unknown;
  test.use({
    api: {
      'GET /api/company': { status: 200, json: company },
      'GET /api/parties': { status: 200, json: [client] },
      'POST /api/parties': (request) => {
        added = request.postDataJSON();
        return { status: 201, json: { ...client, id: ids.otherProject, name: 'عميل آخر' } };
      },
      'GET /api/project-books': { status: 200, json: [project, otherProject] },
      'GET /api/movements': (request) => {
        listed = new URL(request.url());
        return { status: 200, json: { movements: [owedToUs, received], nextCursor: null } };
      },
    },
  });

  test('lists each client with what it owes, and adds one by name', async ({ page }) => {
    await page.goto('/clients');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.client.title);
    await expect(page.getByRole('link', { name: client.name })).toBeVisible();
    // 4,000.00 USD and 11,000.00 SYP worth 100.00 USD
    await expect(page.getByText('4,000.00')).toBeVisible();
    await expect(page.getByText('11,000.00')).toBeVisible();

    await page.getByRole('button', { name: p.client.add }).click();
    const dialog = page.getByRole('dialog', { name: p.client.add });
    await dialog.getByRole('button', { name: p.submit }).click();
    await expect(fieldError(dialog, p.nameRequired)).toBeVisible();
    await dialog.getByLabel(p.name).fill('عميل آخر');
    await dialog.getByRole('button', { name: p.submit }).click();
    await expect(dialog).toBeHidden();
    expect(added).toEqual({ type: 'client', name: 'عميل آخر' });
    await expectNoProductName(page);
  });

  test("a client's page shows its debts, projects and movements", async ({ page }) => {
    await page.goto(`/clients/${ids.client}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(client.name);
    await expect(page.getByRole('link', { name: project.name })).toBeVisible();
    await expect(page.getByRole('link', { name: otherProject.name })).toBeVisible();
    await expect(page.getByText(owedToUs.description)).toBeVisible();
    // The movements name the client, across its projects.
    expect(listed?.searchParams.get('party')).toBe(ids.client);
    expect(listed?.searchParams.get('project')).toBeNull();
    await expect(page.getByRole('cell', { name: project.name }).first()).toBeVisible();
  });

  test('an unknown client says so', async ({ page }) => {
    await page.goto(`/clients/${ids.supplier}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.client.notFound);
  });
});

test.describe('the suppliers', () => {
  let listed: URL | undefined;
  test.use({
    api: {
      'GET /api/company': { status: 200, json: company },
      'GET /api/parties': { status: 200, json: [supplier] },
      'GET /api/movements': (request) => {
        listed = new URL(request.url());
        return { status: 200, json: { movements: [owedByUs], nextCursor: null } };
      },
    },
  });

  test('lists each supplier and opens its page', async ({ page }) => {
    await page.goto('/suppliers');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.supplier.title);
    await expect(page.getByText('1,500.00')).toBeVisible();
    await page.getByRole('link', { name: supplier.name }).click();
    await expect(page).toHaveURL(`/suppliers/${ids.supplier}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(supplier.name);
    await expect(page.getByText(owedByUs.description)).toBeVisible();
    expect(listed?.searchParams.get('party')).toBe(ids.supplier);
    // Only the supplier's kinds are offered as a filter.
    await page.getByRole('combobox', { name: t.list.kind }).click();
    await expect(page.getByRole('option', { name: t.kinds.debt_paid })).toBeVisible();
    await expect(page.getByRole('option', { name: t.kinds.received })).toHaveCount(0);
  });

  test.describe('with none yet', () => {
    test.use({
      api: {
        'GET /api/company': { status: 200, json: company },
        'GET /api/parties': { status: 200, json: [] },
      },
    });

    test('says how one is added', async ({ page }) => {
      await page.goto('/suppliers');
      await expect(page.getByText(p.supplier.empty)).toBeVisible();
    });
  });

  test.describe('owed nothing', () => {
    test.use({
      api: {
        'GET /api/company': { status: 200, json: company },
        'GET /api/parties': { status: 200, json: [{ ...supplier, owedByUs: [] }] },
      },
    });

    test('says the company owes the supplier nothing', async ({ page }) => {
      await page.goto('/suppliers');
      await expect(page.getByText('لا دين له عليك.')).toBeVisible();
    });
  });
});

test.describe('the materials', () => {
  let costsAsked: URL[] = [];
  let created: unknown;
  test.use({
    api: {
      'GET /api/project-books': { status: 200, json: [project, otherProject] },
      'GET /api/material-costs': (request) => {
        costsAsked.push(new URL(request.url()));
        return { status: 200, json: materialCosts };
      },
      'GET /api/materials': { status: 200, json: { materials: [material], nextCursor: null } },
      'POST /api/materials': (request) => {
        created = request.postDataJSON();
        return { status: 201, json: { ...material, id: ids.otherProject } };
      },
    },
  });
  test.beforeEach(() => {
    costsAsked = [];
  });

  test('shows the costs across projects and for one', async ({ page }) => {
    await page.goto('/materials');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.materialsPage.title);
    await expect(page.getByRole('cell', { name: material.name, exact: true })).toBeVisible();
    await expect(page.getByText(`${project.name}:`)).toBeVisible();
    await page.getByRole('combobox', { name: t.materialsPage.project }).click();
    await page.getByRole('option', { name: otherProject.name }).click();
    await expect.poll(() => costsAsked.at(-1)?.searchParams.get('project')).toBe(ids.otherProject);
    // For one project, the per-project column goes.
    await expect(page.getByText(`${project.name}:`)).toHaveCount(0);
    await expectNoProductName(page);
  });

  test('adds a material with a suggested code', async ({ page }) => {
    await page.goto('/materials');
    await page.getByRole('tab', { name: t.materialsPage.tabs.catalogue }).click();
    await expect(page.getByRole('cell', { name: material.code })).toBeVisible();
    await page.getByRole('button', { name: ar.materials.add }).click();
    const dialog = page.getByRole('dialog', { name: ar.materials.dialog.newTitle });
    await expect(dialog.getByLabel(ar.materials.code)).toHaveValue('001');
    await dialog.getByLabel(ar.materials.name, { exact: true }).fill('رمل');
    await dialog.getByLabel(ar.materials.unit).fill('م³');
    await dialog.getByRole('button', { name: ar.materials.dialog.submit }).click();
    await expect(dialog).toBeHidden();
    expect(created).toEqual({ code: '001', name: 'رمل', nameLatin: null, unit: 'م³' });
  });

  test.describe('with none recorded', () => {
    test.use({
      api: {
        'GET /api/project-books': { status: 200, json: [project, otherProject] },
        'GET /api/materials': { status: 200, json: { materials: [material], nextCursor: null } },
        'GET /api/material-costs': {
          status: 200,
          json: { bookCurrency: 'USD', materials: [], totalBookMinor: '0' },
        },
      },
    });

    test('says how a cost is recorded', async ({ page }) => {
      await page.goto('/materials');
      await expect(page.getByText(t.materialsPage.empty)).toBeVisible();
    });
  });
});

test.describe('the rates', () => {
  let asked: URL | undefined;
  let sent: unknown;
  test.use({
    api: {
      'GET /api/day-rates': { status: 200, json: ratesToday },
      'GET /api/rates': (request) => {
        asked = new URL(request.url());
        return { status: 200, json: { rates: rateHistory, nextCursor: null } };
      },
      'POST /api/day-rates': (request) => {
        sent = request.postDataJSON();
        return { status: 200, json: ratesToday };
      },
    },
  });

  test("shows today's rates and the last 30 days, a correction marked", async ({ page }) => {
    await page.goto('/rates');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.ratesPage.title);
    await expect.poll(() => asked?.searchParams.get('from')).toBe('2026-10-21');
    expect(asked?.searchParams.get('to')).toBe('2026-11-19');
    expect(asked?.searchParams.get('type')).toBe('market');
    const history = page.getByRole('table');
    await expect(history.getByRole('row')).toHaveCount(3);
    // The 18th's corrected SYP rate stands, the superseded one is not shown.
    await expect(history.getByText('111.5', { exact: true })).toBeVisible();
    await expect(history.getByText('115', { exact: true })).toHaveCount(0);
    await expect(history.getByText(t.ratesPage.corrected)).toHaveCount(1);
    await expectNoProductName(page);
  });

  test('corrects today’s rates with a reason', async ({ page }) => {
    await page.goto('/rates');
    await page.getByRole('button', { name: t.rates.correct }).click();
    const dialog = page.getByRole('dialog', { name: t.rates.dialogTitle });
    await dialog.getByLabel(t.rates.reason).fill('سعر السوق تغيّر');
    await dialog.getByRole('button', { name: t.rates.save }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toMatchObject({ date: '2026-11-19', reason: 'سعر السوق تغيّر' });
  });

  test.describe('missing today', () => {
    test.use({
      api: {
        'GET /api/day-rates': { status: 200, json: ratesMissing },
        'GET /api/rates': { status: 200, json: { rates: [], nextCursor: null } },
      },
    });

    test('prompts to record them', async ({ page }) => {
      await page.goto('/rates');
      await expect(page.getByText(t.rates.missing)).toBeVisible();
      await expect(page.getByText(t.ratesPage.historyEmpty)).toBeVisible();
    });
  });

  test.describe('refused', () => {
    test.use({
      api: {
        'GET /api/day-rates': { status: 200, json: ratesToday },
        'GET /api/rates': refusal(403, 'FORBIDDEN'),
      },
    });

    test('says the history could not load', async ({ page }) => {
      await page.goto('/rates');
      await expect(page.getByRole('button', { name: ar.common.retry })).toBeVisible();
    });
  });
});
