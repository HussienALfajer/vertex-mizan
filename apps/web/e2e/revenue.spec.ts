import type { Page, Request } from '@playwright/test';
import { type Me, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { owner, viewer } from './company-mocks';
import { detailOf } from './inbox-mocks';
import { today } from './rate-mocks';
import {
  cancelledProject,
  contractAssetItem,
  cycle,
  releasedCycle,
  revenueReads,
  serviceClosed,
  splitPreview,
} from './revenue-mocks';
import { type ApiReply, expect, fieldError, refusal, test } from './test';

const t = ar.revenue;

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

const withRole = (role: 'accountant' | 'auditor'): Me => ({
  ...owner,
  memberships: owner.memberships.map((membership, index) =>
    index === 0 ? { ...membership, role } : membership,
  ),
  permissions: [...rolePermissions[role]],
});

test.use({ me: owner, api: revenueReads });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(today);
});

test.describe('the schedules', () => {
  test('lists the schedules with what each holds in the selected ledger', async ({ page }) => {
    await page.goto('/revenue');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
    await expect(nav.getByRole('link', { name: t.nav })).toBeVisible();
    const table = page.getByRole('table', { name: t.table.label });
    await expect(table.getByRole('row')).toHaveCount(4);
    const row = table.getByRole('row').filter({ hasText: cycle.invoiceNumber });
    await expect(row).toContainText('900.00');
    await expect(row).toContainText('108,900.00');
    await expect(row).toContainText(t.states.active);
    await expect(row).toContainText(t.patterns.over_time);
    await expect(table.getByRole('row').filter({ hasText: 'INV-2026-102' })).toContainText(
      t.patterns.point_in_time,
    );
    // The parallel ledger: what remains in USD.
    await page.getByRole('button', { name: /الدفتر الموازي/ }).click();
    await expect(row).not.toContainText('108,900.00');
    await expect(row.getByRole('cell').nth(-2)).toHaveText('900.00');
  });

  test('filters by state and opens a schedule with its months and its deferral', async ({
    page,
  }) => {
    const asked = await answer(page, 'GET', '/revenue/schedules', (request) => {
      const state = new URL(request.url()).searchParams.get('state');
      return {
        status: 200,
        json: {
          schedules: state === 'completed' ? [releasedCycle] : [cycle, releasedCycle],
          nextCursor: null,
          openingSchedules: [],
        },
      };
    });
    await page.goto('/revenue');
    const table = page.getByRole('table', { name: t.table.label });
    await expect(table.getByRole('row')).toHaveCount(3);
    await page.getByRole('combobox', { name: t.filters.state }).click();
    await page.getByRole('option', { name: t.states.completed }).click();
    await expect.poll(() => asked.at(-1)?.url() ?? '').toContain('state=completed');
    await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: t.filters.clear }).click();
    await table.getByRole('link', { name: cycle.invoiceNumber }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(cycle.invoiceNumber);
    const months = page.getByRole('table', { name: t.schedule.monthsLabel });
    const november = months.getByRole('row').nth(1);
    await expect(november).toContainText('16');
    await expect(november).toContainText('480.00');
    await expect(november).toContainText('58,080.00');
    await expect(november).toContainText(t.schedule.monthPlanned);
    const movements = page.getByRole('table', { name: t.schedule.movementsLabel });
    await expect(movements).toContainText(t.movements.deferred);
    await expect(movements.getByRole('link', { name: '2026/31' })).toBeVisible();
    await expect(page.getByRole('link', { name: t.schedule.openEvent })).toHaveAttribute(
      'href',
      `/inbox/${cycle.inboxId}`,
    );
  });

  test('says when there is no schedule yet, and when none matches', async ({ page }) => {
    await answer(page, 'GET', '/revenue/schedules', {
      status: 200,
      json: { schedules: [], nextCursor: null, openingSchedules: [] },
    });
    await page.goto('/revenue');
    await expect(page.getByText(t.empty.title)).toBeVisible();
    await page.getByRole('combobox', { name: t.filters.state }).click();
    await page.getByRole('option', { name: t.states.voided }).click();
    await expect(page.getByText(t.empty.filtered)).toBeVisible();
  });

  test('a schedule not in the company is not found', async ({ page }) => {
    await answer(page, 'GET', '/revenue/schedules/01900000-0000-7000-800e-000000000099', {
      ...refusal(404, 'NOT_FOUND'),
    });
    await page.goto('/revenue/01900000-0000-7000-800e-000000000099');
    await expect(page.getByText(t.schedule.notFound)).toBeVisible();
  });
});

test.describe('the months', () => {
  test('shows each month’s releases, what is missing and the decisions, and previews November', async ({
    page,
  }) => {
    await page.goto('/revenue?view=months');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    // The decisions held in the inbox.
    await expect(page.getByText(t.decisions.title)).toContainText('2');
    await expect(
      page.getByRole('link', {
        name: `${t.decisions.open}: ${ar.inbox.reasons.SERVICE_PERIOD_CLOSED}`,
      }),
    ).toHaveAttribute('href', '/inbox?view=held&reason=SERVICE_PERIOD_CLOSED');
    const table = page.getByRole('table', { name: t.months.label });
    const october = table.getByRole('row').filter({ hasText: 'INV-2026-095' });
    await expect(october).toContainText('33,040.00');
    await expect(october).toContainText('280.00');
    await expect(october).toContainText(t.months.slotUnmapped);
    await expect(
      october.getByRole('link', { name: `${t.months.openEntries}: 2026-10` }),
    ).toHaveAttribute('href', '/entries?source=revenue_release&from=2026-10-01&to=2026-10-31');
    await page.getByRole('button', { name: t.preview.open }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(t.preview.title) });
    await expect(dialog).toContainText(cycle.invoiceNumber);
    await expect(dialog).toContainText('58,080.00');
    await expect(dialog).toContainText('480.00');
  });

  test('opens the decisions in the inbox, filtered by their reason', async ({ page }) => {
    const asked = await answer(page, 'GET', '/inbox', {
      status: 200,
      json: { events: [], nextCursor: null },
    });
    await page.goto('/revenue?view=months');
    await page
      .getByRole('link', { name: `${t.decisions.open}: ${ar.inbox.reasons.NEEDS_DECISION}` })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.inbox.title);
    await expect.poll(() => asked.at(-1)?.url() ?? '').toContain('reason=NEEDS_DECISION');
    expect(new URL(asked.at(-1)?.url() ?? '').searchParams.get('state')).toBe('held');
  });

  test('opens a month’s release entries in the journal, filtered', async ({ page }) => {
    const asked = await answer(page, 'GET', '/entries', {
      status: 200,
      json: { entries: [], nextCursor: null },
    });
    await page.goto('/entries?source=revenue_release&from=2026-10-01&to=2026-10-31');
    await expect.poll(() => asked.at(-1)?.url() ?? '').toContain('source=revenue_release');
    const search = new URL(asked.at(-1)?.url() ?? '').searchParams;
    expect([search.get('from'), search.get('to')]).toEqual(['2026-10-01', '2026-10-31']);
  });
});

test.describe('the actions of the inbox', () => {
  test('recognises a closed month’s elapsed part on the first open day, with a reason', async ({
    page,
  }) => {
    const recognised = await answer(
      page,
      'POST',
      `/inbox/${serviceClosed.id}/recognise-in-open-period`,
      {
        status: 200,
        json: detailOf({ ...serviceClosed, state: 'posted', reason: null }),
      },
    );
    await page.goto(`/inbox/${serviceClosed.id}`);
    const parts = page.getByRole('table', { name: t.actions.recognise.closedPartsLabel });
    await expect(parts.getByRole('row').nth(1)).toContainText('2026');
    await expect(page.getByText(`${t.previewEntries.elapsedOf}`).first()).toBeVisible();
    await page.getByRole('button', { name: t.actions.recognise.label }).click();
    const dialog = page.getByRole('dialog', { name: t.actions.recognise.title });
    await expect(dialog).toContainText('28,560.00');
    await dialog.getByRole('button', { name: t.actions.recognise.confirm }).click();
    await expect(fieldError(dialog, ar.company.validation.required)).toBeVisible();
    await dialog.getByLabel(ar.inbox.resolve.reason).fill('أُغلق تشرين الأول قبل وصول الفاتورة');
    await dialog.getByRole('button', { name: t.actions.recognise.confirm }).click();
    await expect(dialog).toBeHidden();
    expect(recognised[0]?.postDataJSON()).toEqual({
      reason: 'أُغلق تشرين الأول قبل وصول الفاتورة',
    });
    await expect(page.getByRole('button', { name: t.actions.recognise.label })).toHaveCount(0);
  });

  test('splits a cancelled project’s remainder, previewing the entry as the amount is typed', async ({
    page,
  }) => {
    const split = await answer(page, 'POST', `/inbox/${cancelledProject.id}/split-remainder`, {
      status: 200,
      json: detailOf({ ...cancelledProject, state: 'posted', reason: null, detail: null }),
    });
    const previews = await answer(
      page,
      'GET',
      `/inbox/${cancelledProject.id}/preview`,
      (request) => ({
        status: 200,
        json: splitPreview(new URL(request.url()).searchParams.get('revenueAmount') ?? '0'),
      }),
    );
    await page.goto(`/inbox/${cancelledProject.id}`);
    await expect(
      page.getByText(ar.inbox.details.cancelled_project_remainder).first(),
    ).toBeVisible();
    // The remainder, as the whole of it refunded would post.
    await expect(page.getByText('36,150.00').first()).toBeVisible();
    await page.getByRole('button', { name: t.actions.split.label }).click();
    const dialog = page.getByRole('dialog', { name: t.actions.split.title });
    await dialog.getByRole('button', { name: t.actions.split.confirm }).click();
    await expect(fieldError(dialog, t.actions.split.revenueRequired)).toBeVisible();
    await expect(fieldError(dialog, t.actions.split.reasonRequired)).toBeVisible();
    const amount = dialog.getByLabel(new RegExp(t.actions.split.revenue));
    await amount.fill('100');
    await amount.press('Tab');
    await expect
      .poll(() =>
        previews.map((request) => new URL(request.url()).searchParams.get('revenueAmount')),
      )
      .toContain('10000');
    await expect(dialog).toContainText('-12,000.00');
    await expect(dialog).toContainText('-24,100.00');
    await dialog.getByLabel(t.actions.split.reason).fill('ثلث العربون مستحق عن العمل المنجز');
    await dialog.getByRole('button', { name: t.actions.split.confirm }).click();
    await expect(dialog).toBeHidden();
    expect(split[0]?.postDataJSON()).toEqual({
      revenueAmount: '10000',
      reason: 'ثلث العربون مستحق عن العمل المنجز',
    });
  });

  test('shows a split outside the remainder with the remainder named', async ({ page }) => {
    await answer(page, 'GET', `/inbox/${cancelledProject.id}/preview`, (request) =>
      new URL(request.url()).searchParams.get('revenueAmount') === '0'
        ? { status: 200, json: splitPreview('0') }
        : {
            status: 422,
            json: {
              statusCode: 422,
              code: 'VALIDATION_FAILED',
              message: 'The revenue part is outside zero to the remainder',
              details: { revenueMinor: '30001', remainingMinor: '30000' },
            },
          },
    );
    await page.goto(`/inbox/${cancelledProject.id}`);
    await page.getByRole('button', { name: t.actions.split.label }).click();
    const dialog = page.getByRole('dialog', { name: t.actions.split.title });
    const amount = dialog.getByLabel(new RegExp(t.actions.split.revenue));
    await amount.fill('300.01');
    await amount.press('Tab');
    await expect(
      dialog.getByRole('alert').filter({ hasText: t.actions.split.outside }),
    ).toContainText('300.00');
  });
});

test.describe('the auditor', () => {
  test.use({ me: withRole('auditor') });

  test('reads the parts and the remainder, with no action', async ({ page }) => {
    await page.goto(`/inbox/${serviceClosed.id}`);
    await expect(
      page.getByRole('table', { name: t.actions.recognise.closedPartsLabel }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: t.actions.recognise.label })).toHaveCount(0);
    await page.goto(`/inbox/${cancelledProject.id}`);
    await expect(page.getByText('36,150.00').first()).toBeVisible();
    await expect(page.getByRole('button', { name: t.actions.split.label })).toHaveCount(0);
  });
});

test.describe('a contract asset item', () => {
  test('names its milestone', async ({ page }) => {
    await page.goto(`/open-items/${contractAssetItem.id}`);
    await expect(page.getByText(t.contractAsset.label)).toBeVisible();
    await expect(page.getByText(`${t.contractAsset.milestone} MS-1`)).toBeVisible();
  });
});

test.describe('the viewer', () => {
  test.use({ me: viewer });

  test('has no revenue in the navigation', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
    await expect(nav.getByRole('link').first()).toBeVisible();
    await expect(nav.getByRole('link', { name: t.nav })).toHaveCount(0);
  });
});
