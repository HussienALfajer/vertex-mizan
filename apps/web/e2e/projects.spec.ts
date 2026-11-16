import type { Page, Request } from '@playwright/test';
import { type DraftInput, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { owner, viewer } from './company-mocks';
import { manualClient } from './dimension-mocks';
import { ownDraft } from './entry-mocks';
import {
  accountOfContracting,
  billing,
  billingPreview,
  cement,
  documentDraftOf,
  postedDocument,
  project,
  projectReads,
  purchaseDocument,
  purchaseDocumentPreview,
  purchaseEntry,
  supplier,
  terms,
  workerOne,
  workerTwo,
} from './projects-mocks';
import { today } from './rate-mocks';
import { type ApiReply, expect, test } from './test';

const t = ar.projects;
const f = t.form;

/** One test's own answer, before the shared mocks; it records each request it answers. */
async function answer(
  page: Page,
  method: string,
  path: string,
  reply: ApiReply | ((request: Request) => ApiReply),
): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route(`**/api${path}*`, (route) => {
    if (route.request().method() !== method) return route.fallback();
    seen.push(route.request());
    const sent = typeof reply === 'function' ? reply(route.request()) : reply;
    return sent.json === undefined
      ? route.fulfill({ status: sent.status })
      : route.fulfill({ status: sent.status, json: sent.json });
  });
  return seen;
}

/** A queued PDF, as `POST /api/reports/files` answers it. */
const queuedFile = (request: Request): ApiReply => {
  const body = request.postDataJSON() as { report: string; params: Record<string, string> };
  return {
    status: 201,
    json: {
      id: '01900000-0000-7000-800f-000000000021',
      report: body.report,
      params: body.params,
      format: 'pdf',
      official: false,
      state: 'queued',
      sizeBytes: null,
      error: null,
      createdAt: '2026-11-09T08:00:00.000Z',
      readyAt: null,
      expiresAt: null,
    },
  };
};

/** Types into a picker and takes the option that shows the text. */
async function pick(page: Page, label: string, text: string, option: RegExp | string = text) {
  await page.getByRole('combobox', { name: label, exact: true }).fill(text);
  await page.getByRole('option', { name: option }).first().click();
}

/** A select's option, chosen by keyboard as a person would (the list opens on its choice). */
async function choose(page: Page, label: string, option: string) {
  await page.mouse.move(0, 0);
  const trigger = page.getByRole('combobox', { name: label, exact: true });
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(trigger).toHaveText(option);
}

/** The draft the first save creates, read back on its page and previewed there. */
async function draftFlow(page: Page, preview: object) {
  const created = await answer(page, 'POST', '/drafts', (request) => ({
    status: 201,
    json: documentDraftOf(request.postDataJSON() as DraftInput, ownDraft.id),
  }));
  await answer(page, 'GET', `/drafts/${ownDraft.id}`, () => ({
    status: 200,
    json: documentDraftOf(created.at(-1)?.postDataJSON() as DraftInput, ownDraft.id),
  }));
  await answer(page, 'PUT', `/drafts/${ownDraft.id}`, (request) => ({
    status: 200,
    json: documentDraftOf(request.postDataJSON() as DraftInput, ownDraft.id),
  }));
  const previews = await answer(page, 'POST', `/drafts/${ownDraft.id}/preview`, {
    status: 200,
    json: preview,
  });
  return { created, previews };
}

test.use({ me: owner, api: projectReads });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(today);
});

test.describe('the materials catalogue', () => {
  test('lists the materials with a used unit locked, and adds one', async ({ page }) => {
    const created = await answer(page, 'POST', '/materials', (request) => ({
      status: 201,
      json: { ...cement, ...(request.postDataJSON() as object), id: cement.id, used: false },
    }));
    await page.goto('/materials');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.materials.title);
    const table = page.getByRole('table', { name: ar.materials.title });
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByRole('img', { name: ar.materials.unitLocked })).toHaveCount(1);
    // The archived material shows on request.
    await page.getByRole('switch', { name: ar.materials.showArchived }).click();
    await expect(table.getByRole('row')).toHaveCount(4);

    await page.getByRole('button', { name: ar.materials.add }).click();
    const dialog = page.getByRole('dialog', { name: ar.materials.dialog.newTitle });
    await dialog.getByRole('button', { name: ar.materials.dialog.submit }).click();
    await expect(dialog.getByRole('region', { name: ar.common.errorSummary })).toBeFocused();
    await dialog.getByLabel(ar.materials.code).fill('M-004');
    await dialog.getByLabel(ar.materials.name, { exact: true }).fill('بلوك تجريبي');
    await dialog.getByLabel(ar.materials.unit).fill('قطعة');
    await dialog.getByRole('button', { name: ar.materials.dialog.submit }).click();
    await expect(dialog).toHaveCount(0);
    expect(created[0]?.postDataJSON()).toEqual({
      code: 'M-004',
      name: 'بلوك تجريبي',
      nameLatin: null,
      unit: 'قطعة',
    });
  });
});

test.describe('the document form', () => {
  test('a purchase with quantities: the amount computed, saved, previewed with its warning', async ({
    page,
  }) => {
    const { created, previews } = await draftFlow(page, purchaseDocumentPreview);
    await page.goto(`/projects/documents/new/purchase?project=${project.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      f.newTitle.replace('{kind}', t.kinds.purchase),
    );
    await expect(page.getByRole('combobox', { name: f.project })).toHaveValue(`P1 ${project.name}`);
    await pick(page, f.supplier, 'S2', /مورد مواد تجريبي/);
    await choose(page, f.currency, `USD · ${ar.accounting.currencies.USD}`);
    await page.getByLabel(f.supplierReference).fill('INV-77');
    await pick(page, `${f.account} 1`, '511001', /511001/);
    // The account requires a material: its picker shows, and the amount is the product.
    await pick(page, `${f.material} 1`, 'M-001', /M-001/);
    await page.getByLabel(`${f.quantity} 1`).fill('12.5');
    await expect(page.getByText(`${ar.materials.unit}: طن`)).toBeVisible();
    await page.getByLabel(`${f.unitPrice} 1`).fill('92.6472');
    await expect(page.locator('[data-slot="line-amount"]').first()).toHaveText('1,158.09USD');

    await page.getByRole('button', { name: f.preview }).click();
    await expect(page).toHaveURL(new RegExp(`/drafts/${ownDraft.id}\\?open=preview$`));
    await expect.poll(() => previews.length).toBe(1);
    expect(created[0]?.postDataJSON()).toMatchObject({
      entryDate: '2026-11-09',
      lines: [
        {
          accountId: accountOfContracting('511001').id,
          currency: 'USD',
          amountMinor: null,
          materialId: cement.id,
          unit: 'طن',
          quantity: '12.500',
          unitPrice: '92.6472',
        },
      ],
      projectDocument: {
        kind: 'purchase',
        contractValueId: project.id,
        counterpartyValueId: supplier.id,
        currency: 'USD',
        supplierReference: 'INV-77',
      },
    });
    // The preview: the quantity on its line, the document's figures and the warning.
    const lines = page.getByRole('table', { name: ar.drafts.preview.label });
    await expect(lines.locator('[data-slot="line-quantity"]')).toContainText('12.500');
    await expect(lines.locator('[data-slot="line-quantity"]')).toContainText(cement.name);
    await expect(page.getByText(t.preview.warnings.duplicate_supplier_reference)).toBeVisible();
  });

  test('a wage sheet: days at a daily rate and a lump sum, posted', async ({ page }) => {
    const { created } = await draftFlow(page, billingPreview);
    const posted = await answer(page, 'POST', `/drafts/${ownDraft.id}/post`, () => ({
      status: 200,
      json: postedDocument(created.at(-1)?.postDataJSON() as DraftInput, ownDraft.id, 2),
    }));
    await answer(page, 'GET', '/entries/', {
      status: 200,
      json: { ...purchaseEntry, id: '01900000-0000-7000-8009-000000000090' },
    });
    await page.goto(`/projects/documents/new/wage_sheet?project=${project.id}`);
    await choose(page, f.currency, `USD · ${ar.accounting.currencies.USD}`);
    await page.getByLabel(f.periodFrom, { exact: true }).fill('2026-11-01');
    await page.getByLabel(f.periodTo, { exact: true }).fill('2026-11-07');
    await pick(page, `${f.worker} 1`, 'W1', /عامل تجريبي أول/);
    await page.getByLabel(`${f.days} 1`).fill('6');
    await page.getByLabel(`${f.dailyRate} 1`).fill('25');
    await expect(page.locator('[data-slot="line-amount"]').first()).toHaveText('150.00USD');
    await page.getByRole('button', { name: f.addLine }).click();
    await pick(page, `${f.worker} 2`, 'W2', /حرفي تجريبي/);
    await choose(page, `${f.mode} 2`, f.modes.lump);
    await page.getByLabel(`${f.lumpSum} 2`).fill('400');
    await page.getByLabel(`${f.lumpSum} 2`).press('Tab');
    await page.getByLabel(`${f.lumpDescription} 2`).fill('نجارة قوالب');

    await page.getByRole('button', { name: f.post }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(created.at(-1)?.postDataJSON()).toMatchObject({
      entryDate: '2026-11-07',
      lines: [
        {
          accountId: null,
          dimensionValueIds: [workerOne.id],
          currency: 'USD',
          amountMinor: null,
          unit: 'يوم',
          quantity: '6.000',
          unitPrice: '25.0000',
        },
        {
          dimensionValueIds: [workerTwo.id],
          amountMinor: '40000',
          memo: 'نجارة قوالب',
          quantity: null,
        },
      ],
      projectDocument: {
        kind: 'wage_sheet',
        currency: 'USD',
        periodFrom: '2026-11-01',
        periodTo: '2026-11-07',
      },
    });
    expect(posted[0]?.postDataJSON()).toEqual({ expectedMinor: null });
    await expect(page).toHaveURL(/\/entries\//);
  });

  test('a wage sheet across two months and an incomplete line are refused before saving', async ({
    page,
  }) => {
    const created = await answer(page, 'POST', '/drafts', { status: 500 });
    await page.goto(`/projects/documents/new/wage_sheet?project=${project.id}`);
    await page.getByLabel(f.periodFrom, { exact: true }).fill('2026-11-09');
    await page.getByLabel(f.periodTo, { exact: true }).fill('2026-11-01');
    await page.getByRole('button', { name: f.post }).click();
    const summary = page.getByRole('region', { name: ar.common.errorSummary });
    await expect(summary).toBeFocused();
    await expect(summary).toContainText(f.periodOrder);
    await expect(summary).toContainText(f.currencyMissing);
    expect(created).toHaveLength(0);
  });

  test('a billing: the cumulative typed, the summary from the preview with its covered part', async ({
    page,
  }) => {
    const { created, previews } = await draftFlow(page, billingPreview);
    await page.goto(`/projects/documents/new/progress_billing?project=${project.id}`);
    // The billing takes its terms' currency and rates.
    await expect(page.getByText(f.currencyOfTerms.replace('{currency}', 'USD'))).toBeVisible();
    const summary = page.locator('[data-slot="billing-summary"]');
    await expect(summary).toContainText('10%');
    await expect(summary).toContainText('20%');
    await page.getByLabel(f.cumulative).fill('30000');
    await page.getByLabel(f.cumulative).press('Tab');
    await page.getByLabel(f.date).fill('2026-11-08');
    await page.getByRole('button', { name: f.preview }).click();
    await expect.poll(() => previews.length).toBe(1);
    expect(created[0]?.postDataJSON()).toMatchObject({
      lines: [],
      projectDocument: {
        kind: 'progress_billing',
        contractValueId: project.id,
        counterpartyValueId: null,
        currency: null,
        cumulativeMinor: '3000000',
        retentionMinor: null,
        advanceMinor: null,
      },
    });
    await expect(summary.locator('[data-slot="billing-summary-period"]')).toContainText(
      '30,000.00',
    );
    await expect(summary.locator('[data-slot="billing-summary-net"]')).toContainText('21,000.00');
    // The revenue line's covered part at the advance's carrying amounts (IFRIC 22).
    const covered = page.locator('[data-slot="covered-part"]');
    await expect(covered).toContainText('6,000.00USD');
    await expect(covered).toContainText('690,000.00SYP');
  });

  test('a billing without terms leads to them', async ({ page }) => {
    await answer(page, 'GET', `/projects/${project.id}/terms`, {
      status: 200,
      json: { ...terms, terms: null },
    });
    await page.goto(`/projects/documents/new/progress_billing?project=${project.id}`);
    await expect(page.getByText(f.noTerms)).toBeVisible();
    await page.getByRole('link', { name: f.toTerms }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/terms$`));
  });
});

test.describe('the register', () => {
  test('filters by kind, prints a billing and cancels a purchase by its reversal', async ({
    page,
  }) => {
    const files = await answer(page, 'POST', '/reports/files', queuedFile);
    await answer(page, 'GET', '/reports/files/', () => ({
      status: 200,
      json: queuedFile(files[0] as Request).json as object,
    }));
    await answer(page, 'GET', `/project-documents/${purchaseDocument.id}`, {
      status: 200,
      json: {
        ...purchaseDocument,
        periodFrom: null,
        periodTo: null,
        cumulativeMinor: null,
        previousMinor: null,
        retentionMinor: null,
        advanceMinor: null,
        entryDetail: purchaseEntry,
        quantities: [],
        applications: [],
      },
    });
    await page.goto('/projects/documents');
    const table = page.getByRole('table', { name: t.register.title });
    await expect(table.getByRole('row')).toHaveCount(5);
    // The cancelled billing names the reversal that cancelled it.
    await expect(table.getByText(t.register.cancelledBy)).toHaveCount(1);

    await choose(page, t.register.kind, t.kinds.progress_billing);
    await expect(page).toHaveURL(/kind=progress_billing/);
    await expect(table.getByRole('row')).toHaveCount(3);
    const row = table.getByRole('row').filter({ hasText: '2026/1' });
    await expect(row).toContainText(
      ar.reports.projectDocument.billingNumber.replace('{number}', '1'),
    );
    await row.getByRole('button', { name: t.register.print }).click();
    await expect.poll(() => files.length).toBe(1);
    expect(files[0]?.postDataJSON()).toEqual({
      report: 'project_document',
      params: { document: billing.id },
    });

    await choose(page, t.register.kind, t.register.allKinds);
    await table
      .getByRole('row')
      .filter({ hasText: 'INV-77' })
      .getByRole('button', { name: t.register.cancel })
      .click();
    await expect(page.getByRole('dialog', { name: ar.entries.reverse.title })).toBeVisible();
  });
});

test.describe('the projects and a project report', () => {
  test('the list opens a project report; its tabs, budget and drill-down', async ({ page }) => {
    await page.goto('/projects');
    const table = page.getByRole('table', { name: t.list.title });
    await expect(table).toContainText('100,000.00USD');
    await expect(table).toContainText('30.0%');
    await expect(table).toContainText(manualClient.name);
    await table.getByRole('link', { name: new RegExp(project.name) }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(project.name);
    const summary = page.locator('[data-slot="project-summary"]');
    await expect(summary).toContainText('100,000.00USD');
    await expect(summary).toContainText('89.5%');
    // Revenue opens its lines: the project's revenue lines in the range and ledger.
    await expect(summary.getByRole('link').first()).toHaveAttribute(
      'href',
      new RegExp(
        `statementLine=is.revenue.*contract=${project.id}|contract=${project.id}.*statementLine=is.revenue`,
      ),
    );

    await page.getByRole('tab', { name: t.report.tabs.costs }).click();
    await expect(page).toHaveURL(/tab=costs/);
    // The terms are in USD, the book in SYP: the budget shows without a variance (answer 15).
    await expect(page.getByText(t.report.marks.otherCurrency)).toBeVisible();

    await page.getByRole('tab', { name: t.report.tabs.materials }).click();
    const materials = page.getByRole('table', { name: t.report.tabs.materials });
    await expect(materials).toContainText('12.500طن');
    await expect(materials.getByRole('link').first()).toHaveAttribute(
      'href',
      new RegExp(`material=${cement.id}`),
    );

    await page.getByRole('tab', { name: t.report.tabs.billings }).click();
    const billings = page.getByRole('table', { name: t.report.tabs.billings });
    await expect(billings).toContainText('21,000.00');
    await expect(billings.getByRole('link').first()).toHaveAttribute(
      'href',
      new RegExp(`/entries/${billing.entry.id}$`),
    );
  });

  test('the terms show the locked currency and save the rates and budget', async ({ page }) => {
    const saved = await answer(page, 'PUT', `/projects/${project.id}/terms`, {
      status: 200,
      json: terms,
    });
    await page.goto(`/projects/${project.id}/terms`);
    await expect(page.getByText(t.terms.currencyLocked)).toBeVisible();
    await expect(page.getByLabel(t.terms.retentionRate)).toHaveValue('10');
    await page.getByLabel(t.terms.recoveryRate).fill('12.5');
    await page.getByRole('button', { name: t.terms.save }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]?.postDataJSON()).toEqual({
      currency: 'USD',
      contractValueMinor: '10000000',
      retentionBp: 1000,
      advanceRecoveryBp: 1250,
      budget: [
        { accountId: accountOfContracting('511001').id, amountMinor: '4000000' },
        { accountId: accountOfContracting('511002').id, amountMinor: '1500000' },
      ],
    });
    await expect(page.getByRole('status')).toHaveText(t.terms.saved);
  });

  test('material quantities across projects, each amount opening its lines', async ({ page }) => {
    await page.goto('/reports/material-quantities?from=2026-11-01&to=2026-11-09');
    const table = page.getByRole('table', { name: ar.reports.names.material_quantities });
    await expect(table).toContainText('14.500طن');
    await expect(table).toContainText('-2.000طن');
    await expect(table).toContainText('138,970.80');
  });

  test('the palette opens a project report and a new document', async ({ page }) => {
    await page.goto('/projects');
    // Keys pressed before the page renders are lost: wait for its heading first.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.list.title);
    await page.keyboard.press('Control+k');
    const search = page.getByRole('combobox', { name: ar.commandPalette.search });
    await search.fill('تقرير مشروع');
    await page.keyboard.press('Enter');
    const finder = page.getByRole('dialog', { name: t.palette.report });
    await finder.getByRole('combobox', { name: t.palette.pickProject }).fill('P1');
    await page.getByRole('option', { name: /P1/ }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}`));

    await page.keyboard.press('Control+k');
    await search.fill(t.newDocument.progress_billing);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/projects\/documents\/new\/progress_billing$/);
  });
});

test.describe('a viewer', () => {
  test.use({ me: { ...viewer, permissions: [...rolePermissions.viewer] } });

  test('reads the catalogue with nothing to add or edit', async ({ page }) => {
    await page.goto('/materials');
    await expect(page.getByRole('table', { name: ar.materials.title })).toBeVisible();
    await expect(page.getByRole('button', { name: ar.materials.add })).toHaveCount(0);
  });

  test('reads the projects and the register with nothing to prepare or cancel', async ({
    page,
  }) => {
    await page.goto('/projects');
    await expect(page.getByRole('table', { name: t.list.title })).toBeVisible();
    await expect(page.getByRole('button', { name: t.register.newDocument })).toHaveCount(0);
    await page.goto('/projects/documents');
    await expect(page.getByRole('table', { name: t.register.title })).toBeVisible();
    await expect(page.getByRole('button', { name: t.register.cancel })).toHaveCount(0);
  });
});
