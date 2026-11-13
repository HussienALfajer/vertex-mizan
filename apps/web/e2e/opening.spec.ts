import type { Page, Request } from '@playwright/test';
import type { SaveOpening } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { company, owner } from './company-mocks';
import { entryReads } from './entry-mocks';
import {
  booksStart,
  failingView,
  fingerprint,
  noSnapshotView,
  openingCompany,
  openingEntry,
  openingReads,
  postedView,
  readyView,
  reversedView,
} from './opening-mocks';
import { type ApiReply, expect, fieldError, refusal, test } from './test';
import { auditor } from './trust-mocks';

const t = ar.opening;

/** One test's own answer, before the shared mocks; it records each request it answers. */
async function answer(
  page: Page,
  method: string,
  path: string,
  reply: ApiReply | ((request: Request) => ApiReply),
): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route(`**/api${path}`, (route) => {
    if (route.request().method() !== method) return route.fallback();
    const url = new URL(route.request().url());
    if (url.pathname !== `/api${path}`) return route.fallback();
    seen.push(route.request());
    const sent = typeof reply === 'function' ? reply(route.request()) : reply;
    return sent.json === undefined
      ? route.fulfill({ status: sent.status })
      : route.fulfill({ status: sent.status, json: sent.json });
  });
  return seen;
}

const step = (page: Page, id: string) => page.locator(`#${id}`);

test.use({ me: owner, api: openingReads(failingView) });

test.describe('/opening', () => {
  test("shows Hub's snapshot, the failing checks with their links, and no post", async ({
    page,
  }) => {
    await page.goto('/opening');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    const steps = page.getByRole('navigation', { name: t.steps.label });
    await expect(steps.getByRole('link')).toHaveCount(4);
    await expect(steps.getByRole('listitem').nth(0)).toContainText(t.steps.status.done);
    await expect(steps.getByRole('listitem').nth(2)).toContainText(t.steps.status.attention);

    // Step 1: the snapshot's counts and totals.
    const hub = step(page, 'hub');
    await expect(hub.locator('[data-slot="opening-snapshot-counts"]')).toContainText(
      `${t.hub.counts.invoices}2`,
    );
    await expect(hub.getByRole('table')).toContainText('300.00');

    // Step 3: Hub's two pairs without a records' figure.
    const agreement = step(page, 'agreement').getByRole('table', { name: t.agreement.table });
    await expect(agreement.getByRole('row')).toHaveCount(3);
    await expect(agreement.getByRole('row').nth(1)).toContainText(t.agreement.missing);

    // Step 4: rates and the agreement fail, each item named, each with its way to fix it.
    const review = step(page, 'review');
    const failed = review.locator('[data-slot="checklist-item"][data-status="failed"]');
    await expect(failed).toHaveCount(2);
    await expect(failed.nth(0)).toContainText(t.review.checkNames.records_agree);
    await expect(failed.nth(1)).toContainText(t.review.checkNames.rates);
    await expect(failed.nth(1)).toContainText('USD/SYP 2026-09-10');
    await expect(failed.nth(1).getByRole('link', { name: t.review.links.rates })).toHaveAttribute(
      'href',
      '/rates',
    );
    await expect(review).toContainText(t.review.previewEmpty);

    const post = page.getByRole('button', { name: t.actions.post });
    await expect(post).toBeDisabled();
    await expect(page.locator('#opening-post-reasons')).toContainText(t.review.checkNames.rates);

    // The sidebar lists the opening while it is not posted (S10 "Screens").
    const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
    await expect(nav.getByRole('link', { name: t.nav })).toBeVisible();
  });

  test("saves the records' lines and figures, then posts with the preview's fingerprint", async ({
    page,
  }) => {
    let state: 'failing' | 'ready' | 'posted' = 'failing';
    await answer(page, 'GET', '/opening', () => ({
      status: 200,
      json: state === 'failing' ? failingView : state === 'ready' ? readyView : postedView,
    }));
    const saves = await answer(page, 'PUT', '/opening', () => {
      state = 'ready';
      return { status: 200, json: readyView };
    });
    const posts = await answer(page, 'POST', '/opening/post', () => {
      state = 'posted';
      return {
        status: 200,
        json: {
          openingId: '01900000-0000-7000-800a-000000000002',
          entry: { id: openingEntry.id, date: booksStart, fiscalYear: 2026, number: 1 },
        },
      };
    });
    await page.goto('/opening');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);

    // The cash from the records, by keyboard in the grid: account, then the debit.
    const grid = page.getByRole('grid', { name: t.records.grid });
    await grid.locator('[data-row="0"][data-column="1"]').click();
    await page.keyboard.type('111001');
    await page.keyboard.press('Enter');
    await expect(grid.locator('[data-row="0"][data-column="1"]')).toContainText('111001');
    await expect(grid.locator('[data-row="0"][data-column="2"]')).toHaveText('SYP');
    await grid.locator('[data-row="0"][data-column="3"]').click();
    await page.keyboard.type('2000000');
    await page.keyboard.press('Enter');
    // A monetary line is measured at the eve's rates, once saved.
    await expect(grid.locator('[data-row="0"][data-column="5"]')).toContainText(t.records.computed);

    // The records' figures for Hub's client.
    const agreement = step(page, 'agreement');
    const funds = agreement.getByRole('textbox', {
      name: `${t.agreement.records} · ${t.agreement.slots.ad_funds} · USD`,
    });
    await funds.fill('500');
    await funds.press('Enter');
    const receivable = agreement.getByRole('textbox', {
      name: `${t.agreement.records} · ${t.agreement.slots.receivable} · USD`,
    });
    await receivable.fill('300');
    await receivable.press('Enter');
    await expect(agreement.getByRole('table').getByRole('row').nth(2)).toContainText(
      t.agreement.agrees,
    );
    await expect(page.getByText(t.actions.unsaved).first()).toBeVisible();

    await page.getByRole('button', { name: t.actions.save }).click();
    await expect.poll(() => saves.length).toBe(1);
    const body = saves[0]?.postDataJSON() as SaveOpening;
    expect(body.version).toBe(0);
    expect(body.lines).toEqual([
      {
        accountId: expect.any(String),
        dimensionValueIds: [],
        currency: 'SYP',
        amount: '200000000',
        book: null,
        parallel: null,
        itemReference: null,
        itemDueOn: null,
        memo: null,
      },
    ]);
    expect(body.recordFigures.map((figure) => [figure.slot, figure.amount])).toEqual([
      ['ad_funds', '50000'],
      ['receivable', '30000'],
    ]);
    await expect(page.getByRole('status').filter({ hasText: t.actions.saved })).toBeVisible();

    // Every check passes: the preview's seven lines and the balancing figure per ledger.
    const review = step(page, 'review');
    await expect(review.locator('[data-slot="checklist-item"][data-status="passed"]')).toHaveCount(
      6,
    );
    await expect(review.locator('[data-slot="opening-balancing"]')).toContainText('-659,900.00');
    await expect(review.locator('[data-slot="opening-balancing"]')).toContainText('-3,999.15');
    // Hub's lines open to their documents.
    const receivables = review.locator('[data-group="receivable"]');
    await receivables.getByRole('button').click();
    await expect(receivables.getByRole('table')).toContainText('INV-EX-0007');

    await page.getByRole('button', { name: t.actions.post }).click();
    const dialog = page.getByRole('alertdialog', { name: t.postDialog.title });
    await dialog.getByRole('button', { name: t.postDialog.submit }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]?.postDataJSON()).toEqual({ fingerprint });
    await expect(page.getByText(t.posted.title)).toBeVisible();
    await expect(page.getByRole('link', { name: t.posted.entry })).toHaveAttribute(
      'href',
      `/entries/${openingEntry.id}`,
    );
  });

  test('a stale read refused OPENING_CHANGED is read again under a notice', async ({ page }) => {
    const reads = await answer(page, 'GET', '/opening', { status: 200, json: readyView });
    const posts = await answer(page, 'POST', '/opening/post', refusal(409, 'OPENING_CHANGED'));
    await page.goto('/opening');
    await page.getByRole('button', { name: t.actions.post }).click();
    await page
      .getByRole('alertdialog', { name: t.postDialog.title })
      .getByRole('button', { name: t.postDialog.submit })
      .click();
    await expect.poll(() => posts.length).toBe(1);
    // Read again, and the notice stays over the new read.
    await expect.poll(() => reads.length).toBeGreaterThan(1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: t.actions.changed })).toBeVisible();
  });

  test('a blank row inserted between saved lines leaves each line its own computed amounts', async ({
    page,
  }) => {
    await answer(page, 'GET', '/opening', { status: 200, json: readyView });
    await page.goto('/opening');
    const grid = page.getByRole('grid', { name: t.records.grid });
    // The cash, monetary, measured at the eve's market rate in the parallel ledger.
    await expect(grid.locator('[data-row="0"][data-column="5"]')).toContainText('118.0000');
    await grid.locator('[data-row="0"][data-column="1"]').click();
    await page.keyboard.press('Control+Insert');
    await expect(grid.locator('[data-row="1"][data-column="1"]')).toContainText('111001');
    await expect(grid.locator('[data-row="1"][data-column="5"]')).toContainText('118.0000');
    await expect(grid.locator('[data-row="1"][data-column="7"]')).toHaveText('16,949.15');
    await expect(grid.locator('[data-row="0"][data-column="5"]')).toHaveText('');
    // The capital, stated, keeps its own typed parallel amount.
    await expect(grid.locator('[data-row="2"][data-column="5"]')).toHaveText(t.records.stated);
    await expect(grid.locator('[data-row="2"][data-column="7"]')).toHaveText('10,000.00');
  });

  test('a read on focus keeps what was typed', async ({ page }) => {
    const reads = await answer(page, 'GET', '/opening', { status: 200, json: failingView });
    await page.goto('/opening');
    const funds = step(page, 'agreement').getByRole('textbox', {
      name: `${t.agreement.records} · ${t.agreement.slots.ad_funds} · USD`,
    });
    await funds.fill('500');
    await funds.press('Enter');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await expect(funds).toHaveValue('500.00');
    expect(reads).toHaveLength(1);
  });

  test('posted: read only with its entry, and reversed by the owner with a reason', async ({
    page,
  }) => {
    await answer(page, 'GET', '/opening', { status: 200, json: postedView });
    await answer(page, 'GET', '/company', { status: 200, json: openingCompany('posted') });
    const reverses = await answer(page, 'POST', '/opening/reverse', {
      status: 200,
      json: {
        openingId: '01900000-0000-7000-800a-000000000002',
        entry: { id: openingEntry.id, date: booksStart, fiscalYear: 2026, number: 2 },
      },
    });
    await page.goto('/opening');
    await expect(page.getByText(t.posted.title)).toBeVisible();
    await expect(page.getByRole('button', { name: t.actions.save })).toHaveCount(0);
    await expect(page.getByRole('grid', { name: t.records.grid })).toBeVisible();
    // Posted, the opening is in the palette only.
    const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
    await expect(nav.getByRole('link', { name: ar.reports.nav })).toBeVisible();
    await expect(nav.getByRole('link', { name: t.nav })).toHaveCount(0);

    await page.getByRole('button', { name: t.actions.reverse }).click();
    const dialog = page.getByRole('dialog', { name: t.reverseDialog.title });
    await dialog.getByRole('textbox', { name: t.reverseDialog.reason }).fill('رصيد صندوق خاطئ');
    await dialog.getByRole('button', { name: t.reverseDialog.submit }).click();
    await expect.poll(() => reverses.length).toBe(1);
    expect(reverses[0]?.postDataJSON()).toEqual({ reason: 'رصيد صندوق خاطئ' });
  });

  test('reversed: the history and a new draft from its lines', async ({ page }) => {
    await answer(page, 'GET', '/opening', { status: 200, json: reversedView });
    await page.goto('/opening');
    await expect(page.getByText(t.reversed.title)).toBeVisible();
    await expect(page.getByText(/رصيد صندوق خاطئ في السجلات/)).toBeVisible();
    await expect(page.getByText(t.reversed.newDraft, { exact: false })).toBeVisible();
    const grid = page.getByRole('grid', { name: t.records.grid });
    await expect(grid.locator('[data-row="2"][data-column="1"]')).toContainText('312002');
  });

  test("before Hub's snapshot, and without a books start", async ({ page }) => {
    await answer(page, 'GET', '/opening', { status: 200, json: noSnapshotView });
    await page.goto('/opening');
    await expect(step(page, 'hub')).toContainText(t.hub.noSnapshot);
    await expect(
      step(page, 'review').locator('[data-slot="checklist-item"][data-status="failed"]'),
    ).toContainText(t.review.failure.snapshot_missing);

    // A later route answers first: the company without a books start.
    await answer(page, 'GET', '/opening', refusal(409, 'NO_BOOKS_START'));
    await page.goto('/opening');
    await expect(page.getByText(t.noBooksStart.title)).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('link', { name: t.noBooksStart.action }),
    ).toHaveAttribute('href', '/settings/company');
  });

  test('the auditor reads the opening and changes nothing', async ({ page }) => {
    await answer(page, 'GET', '/me', { status: 200, json: auditor });
    await answer(page, 'GET', '/opening', { status: 200, json: readyView });
    await page.goto('/opening');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByText(t.records.readOnly)).toBeVisible();
    await expect(page.getByRole('button', { name: t.actions.save })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t.actions.post })).toHaveCount(0);
    await expect(step(page, 'agreement').getByRole('textbox')).toHaveCount(0);
  });
});

test.describe('the books start', () => {
  test.use({ api: entryReads });

  test('is set in the company settings with the ledgers, then locked by the draft', async ({
    page,
  }) => {
    const saves = await answer(page, 'PUT', '/company/ledgers', () => ({
      status: 200,
      json: openingCompany(null),
    }));
    await page.goto('/settings/company');
    const field = page.getByLabel(t.booksStart.label);
    await field.fill('2025-12');
    await page.getByRole('button', { name: t.booksStart.submit }).click();
    await expect(fieldError(page, t.booksStart.invalid)).toBeVisible();
    expect(saves).toHaveLength(0);

    await field.fill('2026-10');
    await page.getByRole('button', { name: t.booksStart.submit }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]?.postDataJSON()).toMatchObject({
      booksStart: booksStart,
      ledgers: company.ledgers,
      fiscalYearStartMonth: 1,
    });
    await expect(page.getByText(t.booksStart.saved)).toBeVisible();
    await expect(page.getByRole('link', { name: t.booksStart.openOpening })).toBeVisible();
  });

  test('names why it is locked once the opening has a draft', async ({ page }) => {
    await answer(page, 'GET', '/company', { status: 200, json: openingCompany('draft') });
    await page.goto('/settings/company');
    await expect(page.getByText(t.booksStart.lockedTitle)).toBeVisible();
    await expect(page.getByText(t.booksStart.locked.opening, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: t.booksStart.submit })).toHaveCount(0);
    await expect(page.getByLabel(t.booksStart.label)).toHaveAttribute('readonly', '');
  });
});

test.describe('the opening entry', () => {
  test.use({ api: entryReads });

  test('is marked "قيد افتتاحي" with the way to the opening', async ({ page }) => {
    await answer(page, 'GET', `/entries/${openingEntry.id}`, { status: 200, json: openingEntry });
    await answer(page, 'GET', '/opening', { status: 200, json: postedView });
    await page.goto(`/entries/${openingEntry.id}`);
    await expect(page.locator('[data-slot="opening-entry-badge"]')).toHaveText(t.entry.badge);
    // The snapshot it posted with.
    await expect(page.getByText(/كما في 2026-09-30/)).toBeVisible();
    await expect(page.getByRole('link', { name: t.entry.description })).toHaveAttribute(
      'href',
      '/opening',
    );
  });
});
