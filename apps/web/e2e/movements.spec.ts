import { ar } from '@vertex-mizan/i18n';
import {
  client,
  dashboard,
  expense,
  ids,
  material,
  materialCosts,
  movementPage,
  otherProject,
  owner,
  project,
  ratesMissing,
  received,
  supplier,
} from './movements-data';
import {
  type ApiMocks,
  expect,
  expectNoProductName,
  fieldError,
  refusal,
  signedIn,
  test,
} from './test';

const t = ar.movements;
const companyId = owner.activeCompanyId ?? '';

const projectPage: ApiMocks = {
  [`GET /api/project-books/${ids.project}`]: { status: 200, json: project },
  'GET /api/movements': { status: 200, json: movementPage },
};

test.use({ me: owner });

test.describe('the dashboard', () => {
  test('shows the figures in USD, the boxes by currency and the lists', async ({ page }) => {
    await page.route('**/api/dashboard', (route) => route.fulfill({ json: dashboard }));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.dashboard.title);
    const figures = page.getByRole('region', { name: t.dashboard.title });
    await expect(figures.getByText('8,799.50')).toBeVisible();
    await expect(page.getByText('22,000.00')).toBeVisible();
    await expect(page.getByRole('link', { name: project.name }).first()).toBeVisible();
    await expect(page.getByText(expense.description).first()).toBeVisible();
    await expect(page.getByText(t.cancelled).first()).toBeVisible();
    await expect(page.getByText(t.rates.title, { exact: true })).toBeVisible();
    await expectNoProductName(page);
  });

  test('shows a box below zero as a negative amount in the negative color (S11 rule 8)', async ({
    page,
  }) => {
    const overdrawn = {
      ...dashboard,
      boxes: [{ currency: 'USD' as const, amountMinor: '-3085900', bookMinor: '-3085900' }],
    };
    await page.route('**/api/dashboard', (route) => route.fulfill({ json: overdrawn }));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.dashboard.title);
    const box = page.locator('[data-negative="true"]', { hasText: '30,859.00' }).first();
    await expect(box).toBeVisible();
    await expect(box).toHaveClass(/text-negative/);
  });

  test.describe('without today’s rates', () => {
    let sent: unknown;
    test.use({
      api: {
        'GET /api/dashboard': { status: 200, json: { ...dashboard, rates: ratesMissing } },
        'GET /api/day-rates': { status: 200, json: ratesMissing },
        'POST /api/day-rates': (request) => {
          sent = request.postDataJSON();
          return { status: 200, json: { ...ratesMissing, missing: false } };
        },
      },
    });

    test('records them from the prompt', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText(t.rates.missing)).toBeVisible();
      await page.getByRole('button', { name: t.rates.record }).click();
      const dialog = page.getByRole('dialog', { name: t.rates.dialogTitle });
      const syp = dialog.getByLabel(`${t.rates.rateOf}${ar.accounting.currencies.SYP}`);
      await expect(syp).toHaveValue(/110/);
      await dialog.getByRole('button', { name: t.rates.save }).click();
      await expect(fieldError(dialog, t.rates.invalid)).toBeVisible();
      await dialog.getByLabel(`${t.rates.rateOf}${ar.accounting.currencies.TRY}`).fill('34.5');
      await dialog.getByRole('button', { name: t.rates.save }).click();
      await expect(dialog).toBeHidden();
      expect(sent).toEqual({
        date: ratesMissing.date,
        rates: [
          { base: 'USD', quote: 'SYP', rate: '110.0000' },
          { base: 'USD', quote: 'TRY', rate: '34.5' },
        ],
        reason: null,
      });
    });
  });

  test.describe('without the reports', () => {
    test.use({ me: signedIn });

    test('says so and asks nothing of the API', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByText(t.dashboard.noAccess)).toBeVisible();
      await expect(page.getByRole('button', { name: t.dashboard.newMovement })).toBeHidden();
    });
  });
});

test.describe('the projects', () => {
  test('lists them and searches by name', async ({ page }) => {
    const searches: (string | null)[] = [];
    await page.route(/\/api\/project-books(\?.*)?$/, (route) => {
      searches.push(new URL(route.request().url()).searchParams.get('search'));
      return route.fulfill({ json: [project, otherProject] });
    });
    await page.goto('/projects');
    await expect(page.getByRole('link', { name: project.name })).toBeVisible();
    await expect(page.getByText(t.states.finished)).toBeVisible();
    await page.getByLabel(t.projects.search).fill('بناء');
    await expect.poll(() => searches.at(-1)).toBe('بناء');
  });

  test.describe('a new project', () => {
    let created: unknown;
    test.use({
      api: {
        'GET /api/project-books': { status: 200, json: [] },
        'GET /api/parties': { status: 200, json: [client] },
        'POST /api/project-books': (request) => {
          created = request.postDataJSON();
          return { status: 201, json: project };
        },
        ...projectPage,
      },
    });

    test('is made for a new client and opens', async ({ page }) => {
      await page.goto('/projects');
      await expect(page.getByText(t.projects.empty)).toBeVisible();
      await page.getByRole('button', { name: t.projects.newProject }).first().click();
      const dialog = page.getByRole('dialog', { name: t.newProject.title });
      await dialog.getByRole('button', { name: t.newProject.submit }).click();
      await expect(fieldError(dialog, t.newProject.nameRequired)).toBeVisible();
      await expect(fieldError(dialog, t.newProject.clientRequired)).toBeVisible();
      await dialog.getByLabel(t.newProject.name).fill('مشروع جديد');
      await dialog.getByRole('button', { name: t.newProject.newClient }).click();
      await dialog.getByLabel(t.newProject.newClientName).fill('عميل جديد');
      await dialog.getByLabel(t.newProject.contractValue).fill('1250.5');
      await dialog.getByRole('button', { name: t.newProject.submit }).click();
      await expect(page).toHaveURL(`/projects/${ids.project}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(project.name);
      expect(created).toMatchObject({
        name: 'مشروع جديد',
        clientId: null,
        clientName: 'عميل جديد',
        contractValue: { amountMinor: '125050', currency: 'USD' },
      });
    });
  });
});

test.describe('a project', () => {
  test.describe('its page', () => {
    test.use({
      api: { ...projectPage, 'GET /api/material-costs': { status: 200, json: materialCosts } },
    });

    test('shows its figures, movements and materials', async ({ page }) => {
      await page.goto(`/projects/${ids.project}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(project.name);
      await expect(page.getByText('8,799.50').first()).toBeVisible();
      await expect(page.getByText(expense.description)).toBeVisible();
      await expect(page.getByText(received.cancellation?.reason ?? '')).toBeVisible();
      await page.getByRole('tab', { name: t.project.tabs.materials }).click();
      await expect(page.getByRole('cell', { name: material.name })).toBeVisible();
      await expectNoProductName(page);
    });
  });

  test.describe('its PDF', () => {
    const fileId = '019a0000-0000-7000-8000-0000000000f1';
    const file = {
      id: fileId,
      report: 'project_statement',
      params: { project: ids.project },
      format: 'pdf',
      official: false,
      state: 'queued',
      sizeBytes: null,
      error: null,
      createdAt: '2026-12-31T09:00:00.000Z',
      readyAt: null,
      expiresAt: null,
    };
    let asked: unknown;
    let reads = 0;
    test.use({
      api: {
        ...projectPage,
        'POST /api/reports/files': (request) => {
          asked = request.postDataJSON();
          return { status: 201, json: file };
        },
        [`GET /api/reports/files/${fileId}`]: () => {
          reads += 1;
          return {
            status: 200,
            json:
              reads < 2
                ? file
                : {
                    ...file,
                    state: 'ready',
                    sizeBytes: 9,
                    readyAt: '2026-12-31T09:00:02.000Z',
                    expiresAt: '2026-01-01T09:00:02.000Z',
                  },
          };
        },
        [`GET /api/reports/files/${fileId}/download`]: {
          status: 200,
          body: Buffer.from('%PDF-1.7 synthetic'),
          contentType: 'application/pdf',
        },
      },
    });

    test('is asked, waited for and downloaded', async ({ page }) => {
      await page.goto(`/projects/${ids.project}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(project.name);
      await page.getByRole('button', { name: t.print.projectAction }).click();
      const save = page.getByRole('button', { name: ar.reports.exportMenu.download });
      await expect(save).toBeVisible();
      expect(asked).toEqual({ report: 'project_statement', params: { project: ids.project } });
      const downloaded = page.waitForEvent('download');
      await save.click();
      expect(await (await downloaded).failure()).toBeNull();
    });
  });

  test.describe('cancelling a movement', () => {
    let cancelled: { url: string; body: unknown } | undefined;
    test.use({
      api: {
        ...projectPage,
        [`POST /api/movements/${ids.movement}/cancel`]: (request) => {
          cancelled = { url: request.url(), body: request.postDataJSON() };
          return { status: 200, json: expense };
        },
      },
    });

    test('takes a reason', async ({ page }) => {
      await page.goto(`/projects/${ids.project}`);
      await page.getByRole('button', { name: `${t.list.cancel} 2026/7` }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(t.list.cancelReason).fill('مبلغ خاطئ');
      await dialog.getByRole('button', { name: t.list.cancelSubmit }).click();
      await expect(dialog).toBeHidden();
      expect(cancelled?.body).toEqual({ reason: 'مبلغ خاطئ' });
    });
  });

  test.describe('finished', () => {
    test.use({
      api: {
        [`GET /api/project-books/${ids.otherProject}`]: { status: 200, json: otherProject },
        'GET /api/movements': { status: 200, json: { movements: [], nextCursor: null } },
      },
    });

    test('takes no new movement', async ({ page }) => {
      await page.goto(`/projects/${ids.otherProject}`);
      await expect(page.getByText(t.project.finishedNote)).toBeVisible();
      await expect(page.getByRole('button', { name: t.dashboard.newMovement })).toBeHidden();
      await expect(page.getByRole('button', { name: t.project.reopen })).toBeVisible();
      await expect(page.getByText(t.list.empty)).toBeVisible();
    });
  });

  test.describe('unknown', () => {
    test.use({ api: { [`GET /api/project-books/${ids.project}`]: refusal(404, 'NOT_FOUND') } });

    test('says so', async ({ page }) => {
      await page.goto(`/projects/${ids.project}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.project.notFound);
    });
  });
});

test.describe('the new movement', () => {
  test.describe('an expense with a material', () => {
    let sent: { body: Record<string, unknown>; company: string | undefined } | undefined;
    test.use({
      api: {
        ...projectPage,
        'GET /api/materials': { status: 200, json: { materials: [material], nextCursor: null } },
        'POST /api/movements': (request) => {
          sent = {
            body: request.postDataJSON(),
            company: request.headers()['x-mizan-company'],
          };
          return { status: 201, json: expense };
        },
      },
    });

    test('shows its amount and posts it once', async ({ page }) => {
      await page.goto(`/projects/${ids.project}`);
      await page.getByRole('button', { name: t.dashboard.newMovement }).click();
      const dialog = page.getByRole('dialog', { name: t.dialog.title });
      await dialog.getByRole('button', { name: t.dialog.submit }).click();
      await expect(fieldError(dialog, t.dialog.required)).toBeVisible();
      await dialog.getByRole('combobox', { name: t.dialog.kind }).click();
      await page.getByRole('option', { name: t.kinds.expense }).click();
      await expect(dialog.getByText(t.kindHints.expense)).toBeVisible();
      await dialog.getByRole('switch', { name: t.dialog.withMaterial }).click();
      await dialog.getByRole('combobox', { name: t.dialog.material }).fill('إسمنت');
      await page.getByRole('option', { name: /إسمنت/ }).click();
      await dialog.getByLabel(t.dialog.quantity).fill('2.5');
      await dialog.getByLabel(t.dialog.unitPrice).fill('10.005');
      // 2.5 × 10.005 = 25.0125, rounded once to 25.01 (S12 rule 12).
      await expect(dialog.getByText('25.01')).toBeVisible();
      const date = await dialog.getByLabel(t.dialog.date).inputValue();
      await dialog.getByRole('button', { name: t.dialog.submit }).click();
      await expect(dialog).toBeHidden();
      expect(sent?.company).toBe(companyId);
      expect(sent?.body).toMatchObject({
        kind: 'expense',
        date,
        projectId: ids.project,
        supplierId: null,
        currency: 'USD',
        amountMinor: null,
        material: { materialId: ids.material, quantity: '2.500', unitPrice: '10.0050' },
        description: t.kinds.expense,
        dealtRate: null,
      });
      expect(typeof sent?.body.requestKey).toBe('string');
    });
  });

  test.describe('a debt paid', () => {
    let sent: Record<string, unknown> | undefined;
    test.use({
      api: {
        ...projectPage,
        'GET /api/parties': { status: 200, json: [supplier] },
        'POST /api/movements': (request) => {
          sent = request.postDataJSON();
          return { status: 201, json: expense };
        },
      },
    });

    test('shows the open debt and offers its currency', async ({ page }) => {
      await page.goto(`/projects/${ids.project}`);
      await page.getByRole('button', { name: t.dashboard.newMovement }).click();
      const dialog = page.getByRole('dialog', { name: t.dialog.title });
      await dialog.getByRole('combobox', { name: t.dialog.kind }).click();
      await page.getByRole('option', { name: t.kinds.debt_paid }).click();
      await expect(dialog.getByText(t.dialog.openByUs)).toBeVisible();
      await dialog.getByRole('combobox', { name: t.dialog.supplier }).fill('مورد');
      await page.getByRole('option', { name: supplier.name }).click();
      await expect(dialog.getByText(t.dialog.supplierOpen)).toBeVisible();
      await dialog.getByLabel(t.dialog.amount).fill('1500');
      await dialog.getByRole('button', { name: t.dialog.submit }).click();
      await expect(dialog).toBeHidden();
      expect(sent).toMatchObject({
        kind: 'debt_paid',
        supplierId: ids.supplier,
        currency: 'USD',
        amountMinor: '150000',
      });
    });
  });

  test.describe('a debt paid to a supplier', () => {
    test.use({
      api: {
        [`GET /api/project-books/${ids.project}`]: {
          status: 200,
          json: {
            ...project,
            figures: {
              ...project.figures,
              owedByUs: [
                ...project.figures.owedByUs,
                { currency: 'SYP', amountMinor: '5500000', bookMinor: '50000' },
              ],
            },
          },
        },
        'GET /api/movements': { status: 200, json: movementPage },
        'GET /api/parties': { status: 200, json: [supplier] },
      },
    });

    test('offers only the currencies that supplier is owed in', async ({ page }) => {
      await page.goto(`/projects/${ids.project}`);
      await page.getByRole('button', { name: t.dashboard.newMovement }).click();
      const dialog = page.getByRole('dialog', { name: t.dialog.title });
      await dialog.getByRole('combobox', { name: t.dialog.kind }).click();
      await page.getByRole('option', { name: t.kinds.debt_paid }).click();
      const currency = dialog.getByRole('combobox', { name: t.dialog.currency });
      await currency.click();
      await expect(page.getByRole('option', { name: ar.accounting.currencies.SYP })).toBeVisible();
      await page.keyboard.press('Escape');
      await dialog.getByRole('combobox', { name: t.dialog.supplier }).fill('مورد');
      await page.getByRole('option', { name: supplier.name }).click();
      await currency.click();
      await expect(page.getByRole('option', { name: ar.accounting.currencies.USD })).toBeVisible();
      await expect(page.getByRole('option', { name: ar.accounting.currencies.SYP })).toBeHidden();
    });
  });

  test.describe('refused', () => {
    const bodies: Record<string, unknown>[] = [];
    const rateDays: (string | null)[] = [];
    let ratesRecorded = false;
    test.use({
      api: {
        ...projectPage,
        'GET /api/materials': { status: 200, json: { materials: [material], nextCursor: null } },
        'GET /api/day-rates': (request) => {
          rateDays.push(new URL(request.url()).searchParams.get('date'));
          return { status: 200, json: ratesMissing };
        },
        'POST /api/day-rates': () => {
          ratesRecorded = true;
          return { status: 200, json: { ...ratesMissing, missing: false } };
        },
        'POST /api/movements': (request) => {
          const body = request.postDataJSON();
          bodies.push(body);
          if (body.currency === 'SYP' && !ratesRecorded) return refusal(422, 'RATE_MISSING');
          if (body.kind === 'received') return refusal(422, 'CLIENT_HAS_OPEN_DEBT');
          return { status: 201, json: expense };
        },
      },
    });

    test('a receipt while the client owes is recorded as a debt collected', async ({ page }) => {
      await page.goto(`/projects/${ids.project}`);
      await page.getByRole('button', { name: t.dashboard.newMovement }).click();
      const dialog = page.getByRole('dialog', { name: t.dialog.title });
      await dialog.getByRole('combobox', { name: t.dialog.kind }).click();
      await page.getByRole('option', { name: t.kinds.received }).click();
      await dialog.getByLabel(t.dialog.amount).fill('100');
      await dialog.getByRole('button', { name: t.dialog.submit }).click();
      await expect(dialog.getByRole('alert')).toHaveText(ar.errors.CLIENT_HAS_OPEN_DEBT);
      await dialog.getByRole('button', { name: t.dialog.toCollect }).click();
      await expect(dialog.getByText(t.dialog.openToUs)).toBeVisible();
      await dialog.getByRole('button', { name: t.dialog.submit }).click();
      await expect(dialog).toBeHidden();
      const [first, second] = bodies.slice(-2);
      expect(second).toMatchObject({ kind: 'debt_collected', amountMinor: '10000' });
      expect(second?.requestKey).not.toBe(first?.requestKey);
    });

    test('wages beyond the box post with no refusal (S11 rule 8)', async ({ page }) => {
      await page.goto(`/projects/${ids.project}`);
      await page.getByRole('button', { name: t.dashboard.newMovement }).click();
      const dialog = page.getByRole('dialog', { name: t.dialog.title });
      await dialog.getByRole('combobox', { name: t.dialog.kind }).click();
      await page.getByRole('option', { name: t.kinds.wages }).click();
      await dialog.getByLabel(t.dialog.amount).fill('300');
      await dialog.getByRole('button', { name: t.dialog.submit }).click();
      await expect(dialog).toBeHidden();
      expect(bodies.at(-1)).toMatchObject({ kind: 'wages', amountMinor: '30000' });
    });

    test('without the day’s rate records it for the movement’s day, then posts', async ({
      page,
    }) => {
      await page.goto(`/projects/${ids.project}`);
      await page.getByRole('button', { name: t.dashboard.newMovement }).click();
      const dialog = page.getByRole('dialog', { name: t.dialog.title });
      await dialog.getByRole('combobox', { name: t.dialog.kind }).click();
      await page.getByRole('option', { name: t.kinds.expense }).click();
      await dialog.getByRole('combobox', { name: t.dialog.currency }).click();
      await page.getByRole('option', { name: ar.accounting.currencies.SYP }).click();
      await dialog.getByLabel(t.dialog.amount).fill('1000');
      const date = await dialog.getByLabel(t.dialog.date).inputValue();
      await dialog.getByRole('button', { name: t.dialog.submit }).click();
      await expect(dialog.getByRole('alert')).toHaveText(ar.errors.RATE_MISSING);
      await dialog.getByRole('button', { name: t.dialog.toRates }).click();
      const rates = page.getByRole('dialog', { name: t.rates.dialogTitle });
      await rates.getByLabel(`${t.rates.rateOf}${ar.accounting.currencies.TRY}`).fill('34.5');
      await rates.getByRole('button', { name: t.rates.save }).click();
      await expect(rates).toBeHidden();
      expect(rateDays.at(-1)).toBe(date);
      await expect(dialog.getByRole('alert')).toBeHidden();
      await dialog.getByRole('button', { name: t.dialog.submit }).click();
      await expect(dialog).toBeHidden();
      expect(bodies.at(-1)).toMatchObject({
        kind: 'expense',
        currency: 'SYP',
        amountMinor: '100000',
      });
    });
  });
});
