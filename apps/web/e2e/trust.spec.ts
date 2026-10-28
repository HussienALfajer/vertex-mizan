import type { Page, Request } from '@playwright/test';
import { ar } from '@vertex-mizan/i18n';
import { owner } from './company-mocks';
import { purchase } from './entry-mocks';
import { today } from './rate-mocks';
import { type ApiReply, expect, fieldError, refusal, test } from './test';
import {
  auditor,
  brokenReport,
  cleanReport,
  emailedAnchor,
  headHash,
  pastExports,
  queuedExport,
  readyExport,
  trustReads,
  verifiedReport,
} from './trust-mocks';

const ti = ar.integrity;
const tx = ar.export;

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

/**
 * Answers one route for this test only, before the shared mocks (a later `page.route` wins): the
 * shared `api` object is never changed.
 */
async function answer(
  page: Page,
  method: string,
  path: string,
  reply: ApiReply | ((request: Request) => ApiReply),
  headers?: Record<string, string>,
) {
  await page.route(`**/api${path}`, (route) => {
    if (route.request().method() !== method) return route.fallback();
    const sent = typeof reply === 'function' ? reply(route.request()) : reply;
    if (headers && sent.status === 200) {
      return route.fulfill({ status: 200, headers, body: String(sent.json) });
    }
    return sent.json === undefined
      ? route.fulfill({ status: sent.status })
      : route.fulfill({ status: sent.status, json: sent.json });
  });
}

test.use({ me: owner, api: trustReads });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(today);
});

test.describe('the integrity check', () => {
  test('runs the check and shows a clean result with its anchors (S03 rule 19)', async ({
    page,
  }) => {
    const check = recorder({ status: 200, json: cleanReport });
    await answer(page, 'POST', '/integrity/check', check.mock);
    await page.goto('/integrity');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ti.title);
    await expect(page.getByText(ti.notRun.title)).toBeVisible();
    await page.getByRole('button', { name: ti.run }).click();
    await expect(page.getByRole('status').filter({ hasText: ti.result.clean })).toBeVisible();
    expect(check.seen).toHaveLength(1);
    expect(check.seen[0]?.postDataJSON()).toEqual({});
    expect(check.seen[0]?.headers()['x-mizan-company']).toBe(owner.activeCompanyId);
    const anchors = page.getByRole('table', { name: ti.anchors.title });
    await expect(anchors.getByRole('row')).toHaveCount(3);
    await expect(anchors.getByText(ti.results.verified)).toHaveCount(2);
    // The report stays when the person leaves and comes back.
    await page
      .getByRole('navigation', { name: ar.shell.navLabel })
      .getByRole('link', {
        name: ar.shell.nav.home,
      })
      .click();
    await page
      .getByRole('navigation', { name: ar.shell.navLabel })
      .getByRole('link', {
        name: ti.nav,
      })
      .click();
    await expect(page.getByText(ti.result.clean)).toBeVisible();
    await expect(page.getByRole('button', { name: ti.runAgain })).toBeVisible();
    expect(check.seen).toHaveLength(1);
  });

  test('verifies an anchor pasted whole from the daily email', async ({ page }) => {
    const check = recorder({ status: 200, json: verifiedReport });
    await answer(page, 'POST', '/integrity/check', check.mock);
    await page.goto('/integrity');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ti.title);
    // The email's anchor pasted into the date field fills all three fields.
    await page.getByLabel(ti.pasted.date, { exact: true }).focus();
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      document.activeElement?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, emailedAnchor);
    await expect(page.getByLabel(ti.pasted.date, { exact: true })).toHaveValue('2026-11-09');
    await expect(page.getByLabel(ti.pasted.count, { exact: true })).toHaveValue('2');
    await expect(page.getByLabel(ti.pasted.hash, { exact: true })).toHaveValue(headHash);
    await page.getByRole('button', { name: ti.pasted.submit }).click();
    await expect(page.getByText(ti.pasted.verified)).toBeVisible();
    await expect(page.getByText(ti.pasted.stored.same, { exact: false })).toBeVisible();
    expect(check.seen[0]?.postDataJSON()).toEqual({
      anchor: { date: '2026-11-09', count: 2, hash: headHash },
    });
  });

  test('refuses a pasted anchor that is not one, before asking the server', async ({ page }) => {
    const check = recorder({ status: 200, json: verifiedReport });
    await answer(page, 'POST', '/integrity/check', check.mock);
    await page.goto('/integrity');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ti.title);
    await page.getByLabel(ti.pasted.date, { exact: true }).fill('9/11/2026');
    await page.getByLabel(ti.pasted.count, { exact: true }).fill('0');
    await page.getByLabel(ti.pasted.hash, { exact: true }).fill('abc');
    await page.getByRole('button', { name: ti.pasted.submit }).click();
    await expect(page.getByRole('region', { name: ar.common.errorSummary })).toBeFocused();
    await expect(fieldError(page, ti.pasted.errors.date)).toBeVisible();
    await expect(fieldError(page, ti.pasted.errors.count)).toBeVisible();
    await expect(fieldError(page, ti.pasted.errors.hash)).toBeVisible();
    expect(check.seen).toHaveLength(0);
  });

  test('names the first break and every mismatch', async ({ page }) => {
    await answer(page, 'POST', '/integrity/check', { status: 200, json: brokenReport });
    await page.goto('/integrity');
    await page.getByRole('button', { name: ti.run }).click();
    await expect(page.getByText(ti.result.broken)).toBeVisible();
    await expect(page.getByText(ti.firstBreak.reasons.hash)).toBeVisible();
    await expect(page.getByText(ti.result.headDiffers)).toBeVisible();
    await expect(
      page.getByRole('table', { name: ti.numbering.title }).getByText('2026/3'),
    ).toBeVisible();
    const unbalanced = page.getByRole('table', { name: ti.unbalanced.title });
    await expect(unbalanced).toContainText('-100.00SYP');
    await expect(
      page.getByRole('table', { name: ti.periodBalances.title }).getByText('111004'),
    ).toBeVisible();
    await expect(
      page.getByRole('table', { name: ti.anchors.title }).getByText(ti.results.mismatch),
    ).toBeVisible();
    // The broken entry opens from the report.
    await page.route(`**/api/entries/${purchase.id}`, (route) =>
      route.fulfill({ status: 200, json: purchase }),
    );
    await page.getByRole('link', { name: '2026/1' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/entries/${purchase.id}$`));
  });

  test('runs from the command palette', async ({ page }) => {
    const check = recorder({ status: 200, json: cleanReport });
    await answer(page, 'POST', '/integrity/check', check.mock);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: ar.commandPalette.title });
    await palette.getByRole('combobox', { name: ar.commandPalette.search }).fill(ti.paletteRun);
    await palette.getByRole('combobox', { name: ar.commandPalette.search }).press('Enter');
    await expect(page.getByText(ti.result.clean)).toBeVisible();
    await expect(page).toHaveURL(/\/integrity$/);
    expect(check.seen).toHaveLength(1);
  });

  test.describe('as the auditor', () => {
    test.use({ me: auditor });

    test('lists the integrity check, not the export', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
      await expect(nav.getByRole('link', { name: ti.nav })).toBeVisible();
      await expect(nav.getByRole('link', { name: tx.nav })).toHaveCount(0);
    });
  });
});

test.describe('the full export', () => {
  test('requests an export after a fresh code (S03 rule 21)', async ({ page }) => {
    let requests = 0;
    let listed = [readyExport, ...pastExports];
    const request = recorder(() => {
      requests += 1;
      if (requests === 1) return refusal(403, 'REAUTHENTICATION_REQUIRED');
      listed = [queuedExport, ...listed];
      return { status: 201, json: queuedExport };
    });
    let code = '';
    await answer(page, 'POST', '/company/exports', request.mock);
    await answer(page, 'GET', '/company/exports', () => ({ status: 200, json: listed }));
    await answer(page, 'POST', '/auth/reauthenticate', (sent) => {
      code = (sent.postDataJSON() as { code: string }).code;
      return { status: 204 };
    });
    await page.goto('/settings/export');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(tx.title);
    const table = page.getByRole('table', { name: tx.table.label });
    await expect(table.getByText(tx.states.ready)).toBeVisible();
    await expect(table.getByText(tx.states.failed)).toBeVisible();
    await expect(table.getByText(tx.states.expired)).toBeVisible();
    await page.getByRole('button', { name: tx.request }).click();
    const dialog = page.getByRole('dialog', { name: ar.auth.reauth.title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').first().click();
    await page.keyboard.type('246810');
    await expect(page.getByText(tx.requested)).toBeVisible();
    await expect(table.getByText(tx.states.queued)).toBeVisible();
    // One export at a time: the request waits for the queued one.
    await expect(page.getByRole('button', { name: tx.request })).toBeDisabled();
    expect(code).toBe('246810');
    expect(request.seen).toHaveLength(2);
    expect(request.seen[1]?.headers()['x-mizan-company']).toBe(owner.activeCompanyId);
  });

  test('downloads a ready export after a fresh code', async ({ page }) => {
    let downloads = 0;
    await answer(
      page,
      'GET',
      `/company/exports/${readyExport.id}/download`,
      () => {
        downloads += 1;
        return downloads === 1
          ? refusal(403, 'REAUTHENTICATION_REQUIRED')
          : { status: 200, json: 'PK' };
      },
      {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="vertex-mizan-export.zip"',
      },
    );
    await answer(page, 'POST', '/auth/reauthenticate', { status: 204 });
    await page.goto('/settings/export');
    await page.getByRole('button', { name: tx.download }).click();
    const dialog = page.getByRole('dialog', { name: ar.auth.reauth.title });
    await expect(dialog).toBeVisible();
    const saved = page.waitForEvent('download');
    await dialog.getByRole('textbox').first().click();
    await page.keyboard.type('135791');
    expect((await saved).suggestedFilename()).toBe('vertex-mizan-export.zip');
    expect(downloads).toBe(2);
  });

  test('shows a refused download in the page', async ({ page }) => {
    await answer(
      page,
      'GET',
      `/company/exports/${readyExport.id}/download`,
      refusal(410, 'LINK_INVALID'),
    );
    await page.goto('/settings/export');
    await page.getByRole('button', { name: tx.download }).click();
    await expect(page.getByRole('alert')).toHaveText(ar.errors.LINK_INVALID);
  });

  test('explains an empty list', async ({ page }) => {
    await answer(page, 'GET', '/company/exports', { status: 200, json: [] });
    await page.goto('/settings/export');
    await expect(page.getByText(tx.empty.title)).toBeVisible();
  });
});
