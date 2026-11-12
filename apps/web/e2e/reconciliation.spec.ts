import type { Page, Request } from '@playwright/test';
import { CHECKLIST_ITEMS, type Me, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { owner } from './company-mocks';
import { october as octoberPeriod } from './periods-mocks';
import { today } from './rate-mocks';
import {
  adjustedItemId,
  amountInboxId,
  heldInboxId,
  missingEventId,
  noClients,
  november,
  novemberClosed,
  novemberTwoClients,
  october,
  reconciliationReads,
  resolvedEntryId,
  secondHub,
} from './reconciliation-mocks';
import { type ApiReply, expect, test } from './test';

const t = ar.reconciliation;

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
    seen.push(route.request());
    const sent = typeof reply === 'function' ? reply(route.request()) : reply;
    return sent.json === undefined
      ? route.fulfill({ status: sent.status })
      : route.fulfill({ status: sent.status, json: sent.json });
  });
  return seen;
}

const withRole = (role: 'auditor' | 'viewer'): Me => ({
  ...owner,
  memberships: owner.memberships.map((membership, index) =>
    index === 0 ? { ...membership, role } : membership,
  ),
  permissions: [...rolePermissions[role]],
});

const rowOf = (page: Page, day: string) =>
  page
    .getByRole('table', { name: t.month.table.label })
    .getByRole('row')
    .filter({ has: page.locator(`a[href^="/reconciliation/${day}"]`) });

test.use({ me: owner, api: reconciliationReads });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(today);
});

test.describe('the month', () => {
  test('lists the days with their states, counts and gaps, the current month by default', async ({
    page,
  }) => {
    await page.goto('/reconciliation');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByRole('table', { name: t.month.table.label })).toBeVisible();
    await expect(page.locator('[data-slot="matched-streak"]')).toHaveText(`${t.month.streak}: 0`);
    await expect(page.getByRole('textbox', { name: t.month.label, exact: true })).toHaveValue(
      '2026-11',
    );
    const third = rowOf(page, '2026-11-03');
    await expect(third).toContainText(t.states.matched);
    await expect(third.getByRole('cell')).toHaveText([
      /./,
      t.states.matched,
      '3',
      '3',
      '3',
      '0',
      '0',
    ]);
    const fourth = rowOf(page, '2026-11-04');
    await expect(fourth).toContainText(`${t.states.differences}${t.gaps}: 1`);
    await expect(rowOf(page, '2026-11-05')).toContainText(t.states.missing);
    await expect(rowOf(page, '2026-11-08')).toContainText(t.states.pending);
    // No report: Hub's count is unknown.
    await expect(rowOf(page, '2026-11-05').getByRole('cell').nth(2)).toHaveText(
      t.month.table.noReport,
    );
    await expect(page.locator(`a[href="/reconciliation/2026-11-04"]`)).toBeVisible();
    // One client: no filter.
    await expect(page.getByText(t.month.client, { exact: true })).toHaveCount(0);
  });

  test('moves to the month before, which needs no reconciliation', async ({ page }) => {
    const asked = await answer(page, 'GET', '/reconciliation/days*', (request) => ({
      status: 200,
      json: new URL(request.url()).searchParams.get('month') === '2026-10' ? october : november,
    }));
    await page.goto('/reconciliation?month=2026-11');
    await expect(page.getByRole('table', { name: t.month.table.label })).toBeVisible();
    await page.getByRole('button', { name: t.month.previous }).click();
    await expect(page).toHaveURL(/month=2026-10/);
    await expect(page.getByText(t.month.notRequired.title)).toBeVisible();
    expect(asked.map((request) => new URL(request.url()).search)).toEqual([
      '?month=2026-11',
      '?month=2026-10',
    ]);
  });

  test('marks a closed month’s unclean days "بعد الإقفال"', async ({ page }) => {
    await answer(page, 'GET', '/reconciliation/days*', { status: 200, json: novemberClosed });
    await page.goto('/reconciliation?month=2026-11');
    await expect(page.getByText(t.afterCloseDescription)).toBeVisible();
    await expect(rowOf(page, '2026-11-04')).toContainText(
      `${t.states.differences}${t.gaps}: 1${ar.common.listSeparator}${t.afterClose}`,
    );
    await expect(rowOf(page, '2026-11-05')).toContainText(t.afterClose);
    await expect(rowOf(page, '2026-11-03')).not.toContainText(t.afterClose);
  });

  test('filters by client when several report', async ({ page }) => {
    const asked = await answer(page, 'GET', '/reconciliation/days*', {
      status: 200,
      json: novemberTwoClients,
    });
    await page.goto('/reconciliation?month=2026-11');
    await page.getByRole('combobox', { name: t.month.client }).click();
    await page.getByRole('option', { name: secondHub.name }).click();
    await expect(page).toHaveURL(new RegExp(`client=${secondHub.id}`));
    await expect.poll(() => asked.length).toBe(2);
    expect(new URL(asked[1]?.url() ?? '').searchParams.get('client')).toBe(secondHub.id);
    await expect(
      page.locator(`a[href="/reconciliation/2026-11-04?client=${secondHub.id}"]`),
    ).toBeVisible();
  });

  test('says no client reports, with the way to the API clients', async ({ page }) => {
    await answer(page, 'GET', '/reconciliation/days*', { status: 200, json: noClients });
    await page.goto('/reconciliation');
    await expect(page.getByText(t.month.empty.title)).toBeVisible();
    await expect(page.getByRole('link', { name: t.month.empty.action })).toHaveAttribute(
      'href',
      '/settings/api-clients',
    );
  });

  test('shows a failed read with a retry', async ({ page }) => {
    // The query client's own retries fail too, until the person asks again.
    let failing = true;
    await answer(page, 'GET', '/reconciliation/days*', () =>
      failing ? { status: 500 } : { status: 200, json: november },
    );
    await page.goto('/reconciliation');
    const retry = page.getByRole('button', { name: ar.common.retry });
    await expect(retry).toBeVisible({ timeout: 15_000 });
    failing = false;
    await retry.click();
    await expect(page.getByRole('table', { name: t.month.table.label })).toBeVisible();
  });
});

test.describe('a day', () => {
  test('names a missing event with Hub’s id, delivery and refusal, and the reports', async ({
    page,
  }) => {
    await page.goto('/reconciliation?month=2026-11');
    await page.locator('a[href="/reconciliation/2026-11-04"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(t.day.title);
    const differences = page.getByRole('table', { name: t.day.differences.label });
    const row = differences.getByRole('row').nth(1);
    await expect(row).toContainText(t.kinds.missing_in_mizan);
    await expect(row).toContainText(ar.inbox.types['invoice.issued']);
    await expect(row).toContainText('400.00');
    await expect(row).toContainText(
      `${t.delivery.refused}${ar.common.listSeparator}${t.day.differences.refusal}: VALIDATION_FAILED`,
    );
    await expect(row).toContainText(t.day.differences.absent);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await row.getByRole('button', { name: t.day.differences.copy }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(missingEventId);
    const totals = page.getByRole('table', { name: t.day.totals.label });
    await expect(totals.getByRole('row').nth(1)).toContainText('400.00');
    const reports = page.getByRole('table', { name: t.day.reports.label }).getByRole('row');
    await expect(reports.nth(1)).toContainText(t.day.reports.latest);
    await expect(reports.nth(2)).toContainText(t.day.reports.superseded);
    await page.getByRole('link', { name: t.day.back }).click();
    await expect(page).toHaveURL(/\/reconciliation\?month=2026-11$/);
  });

  test('shows both amounts of an amount difference, with Mizan’s event', async ({ page }) => {
    await page.goto('/reconciliation/2026-11-07');
    const row = page.getByRole('table', { name: t.day.differences.label }).getByRole('row').nth(1);
    await expect(row).toContainText(t.kinds.amount_differs);
    await expect(row.getByRole('cell').nth(2)).toContainText('350.00');
    await expect(row.getByRole('cell').nth(3)).toContainText('400.00');
    await expect(row.getByRole('cell').nth(3)).toContainText(ar.inbox.states.posted);
    await expect(row.getByRole('link', { name: t.day.differences.openEvent })).toHaveAttribute(
      'href',
      `/inbox/${amountInboxId}`,
    );
  });

  test('lists the annotations with their reasons, entries and items, never as gaps', async ({
    page,
  }) => {
    await page.goto('/reconciliation/2026-11-06');
    await expect(page.getByText(t.day.differences.none)).toBeVisible();
    await expect(page.getByText(t.day.matched, { exact: true })).toHaveCount(0);
    const list = page.getByRole('list', { name: t.day.annotations.title });
    const held = list.locator('[data-annotation="held"]');
    await expect(held).toContainText(ar.inbox.reasons.RATE_MISSING);
    await expect(held.getByRole('link')).toHaveAttribute('href', `/inbox/${heldInboxId}`);
    await expect(
      list.locator('[data-annotation="resolved"]').getByRole('link').last(),
    ).toHaveAttribute('href', `/entries/${resolvedEntryId}`);
    await expect(list.locator('[data-annotation="resolved"]')).toContainText('2026/31');
    await expect(list.locator('[data-annotation="dismissed"]')).toContainText(
      'فاتورة مكررة في Hub (مثال)',
    );
    await expect(
      list
        .locator('[data-annotation="adjusted"]')
        .getByRole('link', { name: t.day.annotations.openItem }),
    ).toHaveAttribute('href', `/open-items/${adjustedItemId}`);
    // A retainer credit: a negative amount, compared as such (edge case 7).
    await expect(page.getByRole('table', { name: t.day.totals.label })).toContainText('-25.00');
  });

  test('says a matched day is matched, and a day without its report', async ({ page }) => {
    await page.goto('/reconciliation/2026-11-03');
    await expect(page.getByText(t.day.matched, { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: t.day.totals.label })).toContainText(
      t.day.totals.noCurrency,
    );
    await page.goto('/reconciliation/2026-11-05');
    await expect(page.getByText(t.day.noReport)).toBeVisible();
    await expect(page.getByText(t.day.noReportMissing)).toBeVisible();
    await page.goto('/reconciliation/2026-11-08');
    await expect(page.getByText(t.day.noReportPending)).toBeVisible();
  });
});

test.describe('around the screens', () => {
  test('the sidebar counts the unclean days, hidden at zero', async ({ page }) => {
    await answer(page, 'GET', '/reconciliation/counts', {
      status: 200,
      json: { uncleanDays: 2 },
    });
    await page.goto('/reconciliation');
    const link = page.getByRole('navigation').getByRole('link', { name: new RegExp(t.nav) });
    await expect(link.locator('[data-slot="unclean-days-count"]')).toHaveText(`2${t.uncleanCount}`);
  });

  test('the checklist’s failing item links to the month', async ({ page }) => {
    await answer(page, 'GET', '/periods/2026-10', {
      status: 200,
      json: {
        ...octoberPeriod,
        checklist: CHECKLIST_ITEMS.map((item) => ({
          item,
          result: item === 'reconciliation_clean' ? 'failed' : 'passed',
          count: item === 'reconciliation_clean' ? 3 : 0,
          ledgers: [],
        })),
      },
    });
    await page.goto('/periods/2026-10');
    const item = page
      .locator('[data-slot="checklist-item"]')
      .filter({ hasText: ar.periods.checklist.items.reconciliation_clean });
    await expect(item).toContainText(`${ar.periods.checklist.counts.reconciliation_clean}: 3`);
    await expect(
      item.getByRole('link', { name: ar.periods.checklist.links.reconciliation_clean }),
    ).toHaveAttribute('href', '/reconciliation?month=2026-10');
  });

  test.describe('the auditor', () => {
    test.use({ me: withRole('auditor') });

    test('reads the days', async ({ page }) => {
      await page.goto('/reconciliation/2026-11-04');
      await expect(page.getByRole('table', { name: t.day.differences.label })).toBeVisible();
    });
  });

  test.describe('the viewer', () => {
    test.use({ me: withRole('viewer') });

    test('does not see the reconciliation in the navigation', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('navigation').getByRole('link').first()).toBeVisible();
      await expect(
        page.getByRole('navigation').getByRole('link', { name: new RegExp(t.nav) }),
      ).toHaveCount(0);
    });
  });
});
