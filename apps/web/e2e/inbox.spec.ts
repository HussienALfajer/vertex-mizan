import type { Page, Request } from '@playwright/test';
import { type Me, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { owner, viewer } from './company-mocks';
import {
  closedMonth,
  detailOf,
  dismissed,
  hubEntry,
  inboxCounts,
  inboxReads,
  overpayment,
  postedInvoice,
  rateMissing,
  recordedRate,
  resolved,
  retainerInvoice,
  unmappedExpense,
  waiting,
} from './inbox-mocks';
import { today } from './rate-mocks';
import { hubItem, receivablesReads } from './receivables-mocks';
import { type ApiReply, expect, fieldError, refusal, test } from './test';

const t = ar.inbox;

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
const accountant = withRole('accountant');
const auditor = withRole('auditor');

const reads = { ...receivablesReads, ...inboxReads };

test.use({ me: owner, api: reads });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(today);
});

test.describe('the inbox', () => {
  test('lists the held events by default, with the count in the sidebar', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
    await expect(nav.getByRole('link', { name: new RegExp(t.nav) })).toContainText(
      String(inboxCounts.held),
    );
    const table = page.getByRole('table', { name: `${t.table.label}: ${t.views.held}` });
    const rows = table.getByRole('row');
    await expect(rows).toHaveCount(inboxCounts.held + 1);
    // Newest received first, each with its type, document, state and reason in words.
    await expect(rows.nth(1)).toContainText(t.types['payment.recorded']);
    await expect(rows.nth(1)).toContainText('PAY-2026-033');
    await expect(rows.nth(1)).toContainText(t.reasons.WAITING_FOR_EARLIER_EVENT);
    const expense = rows.filter({ hasText: 'EXP-2026-005' });
    await expect(expense).toContainText(t.reasons.NO_MAPPING);
    await expect(expense).toContainText(`${t.slotUnmapped}: ${ar.postingRules.slots.project_cost}`);
    await expect(rows.filter({ hasText: 'INV-2026-078' })).toContainText(
      t.details.deferred_revenue,
    );
    await expect(rows.filter({ hasText: 'PAY-2026-032' })).toContainText(
      t.details.amount_above_applied,
    );
  });

  test('shows the posted and all events in their tabs, with their entries', async ({ page }) => {
    await page.goto('/inbox');
    await page.getByRole('tab', { name: t.views.posted }).click();
    await expect(page).toHaveURL(/view=posted/);
    const posted = page.getByRole('table', { name: `${t.table.label}: ${t.views.posted}` });
    await expect(posted.getByRole('row')).toHaveCount(2);
    await expect(posted).toContainText('INV-2026-077');
    await expect(posted.getByRole('link', { name: '2026/21' })).toHaveAttribute(
      'href',
      `/entries/${hubEntry.id}`,
    );
    // The posted tab has no reason filter.
    await expect(page.getByRole('combobox', { name: t.filters.reason })).toHaveCount(0);
    await page.getByRole('tab', { name: t.views.all }).click();
    const all = page.getByRole('table', { name: `${t.table.label}: ${t.views.all}` });
    await expect(all.getByRole('row')).toHaveCount(11);
    await expect(all.getByRole('row').filter({ hasText: 'PAY-2026-020' })).toContainText(
      t.states.resolved,
    );
    await expect(all.getByRole('row').filter({ hasText: 'WAL-2026-004' })).toContainText(
      t.states.dismissed,
    );
    await expect(all.getByRole('row').filter({ hasText: t.types['rate.changed'] })).toContainText(
      t.states.recorded,
    );
  });

  test('filters by reason and accounting dates, and says when nothing matches', async ({
    page,
  }) => {
    const seen = await answer(page, 'GET', '/inbox', (request) => ({
      status: 200,
      json: { events: [], nextCursor: null, url: request.url() },
    }));
    await page.goto('/inbox');
    await expect(page.getByText(t.empty.held)).toBeVisible();
    await page.mouse.move(0, 0);
    await page.getByRole('combobox', { name: t.filters.reason }).click();
    await page.getByRole('option', { name: t.reasons.RATE_MISSING }).click();
    await page.getByLabel(t.filters.from).fill('2026-11-01');
    await expect(page.getByText(t.empty.filtered)).toBeVisible();
    const last = new URL(seen.at(-1)?.url() ?? '');
    expect(Object.fromEntries(last.searchParams)).toEqual({
      state: 'held',
      reason: 'RATE_MISSING',
      from: '2026-11-01',
    });
  });

  test('says no event has arrived yet, and offers a retry when the list fails', async ({
    page,
  }) => {
    let fail = true;
    await answer(page, 'GET', '/inbox', () =>
      fail ? refusal(403, 'FORBIDDEN') : { status: 200, json: { events: [], nextCursor: null } },
    );
    await page.goto('/inbox?view=all');
    await expect(page.getByRole('alert')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: ar.common.retry }).click();
    await expect(page.getByText(t.empty.none)).toBeVisible();
  });

  test('retries a held event from its row and says what it led to', async ({ page }) => {
    const retried = await answer(page, 'POST', `/inbox/${rateMissing.id}/retry`, {
      status: 200,
      json: detailOf({ ...rateMissing, state: 'posted', reason: null }),
    });
    await page.goto('/inbox');
    await page
      .getByRole('button', { name: `${t.retry}: ${t.types['payment.recorded']} PAY-2026-031` })
      .click();
    await expect(page.getByRole('status').filter({ hasText: t.retried.posted })).toBeVisible();
    expect(retried).toHaveLength(1);
    expect(retried[0]?.headers()['x-mizan-company']).toBeTruthy();
  });

  test('opens a Hub document’s events from the palette', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: ar.commandPalette.search }).fill(t.palette.find);
    await page.keyboard.press('Enter');
    const finder = page.getByRole('dialog', { name: t.palette.findTitle });
    await finder.getByLabel(t.palette.findLabel).fill('INV-2026-077');
    await finder.getByRole('button', { name: t.palette.findSubmit }).click();
    await expect(page).toHaveURL(/document=INV-2026-077/);
    const table = page.getByRole('table', { name: `${t.table.label}: ${t.views.all}` });
    await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByRole('link', { name: t.filters.clear }).click();
    await expect(page).not.toHaveURL(/document=/);
  });
});

test.describe('the inbox for the auditor', () => {
  test.use({ me: auditor });

  test('reads the events without retry or actions', async ({ page }) => {
    await page.goto('/inbox');
    await expect(
      page.getByRole('table', { name: `${t.table.label}: ${t.views.held}` }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${t.retry}`) })).toHaveCount(0);
    await page.goto(`/inbox/${overpayment.id}`);
    await expect(page.getByText(t.event.readOnly)).toBeVisible();
    for (const name of [t.retryAction.label, t.resolve.label, t.dismiss.label]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
  });
});

test.describe('an event', () => {
  test('a missing rate: the hold, what fixes it, the key fields and the raw JSON', async ({
    page,
  }) => {
    await page.goto(`/inbox/${rateMissing.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      t.types['payment.recorded'],
    );
    await expect(page.getByText(`${t.event.hold}: ${t.reasons.RATE_MISSING}`)).toBeVisible();
    await expect(page.getByText(t.fixes.RATE_MISSING)).toBeVisible();
    await expect(page.getByRole('link', { name: t.fixLinks.rates })).toHaveAttribute(
      'href',
      '/rates?record=bulletin',
    );
    // The example payment: 61,000.00 SYP applying 500.00 USD, through Amount.
    const fields = page.locator('dl').filter({ hasText: t.fields.applied });
    await expect(fields).toContainText(t.methods.bank_transfer);
    await expect(fields.locator('[data-slot="amount"]').first()).toBeVisible();
    const raw = page.locator('[data-slot="json-viewer"]');
    await expect(raw.locator('[dir="ltr"]')).toContainText('"method": "bank_transfer"');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await raw.getByRole('button', { name: t.event.json.copy }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied)).toMatchObject({ method: 'bank_transfer' });
    // The history: received, then held with its reason.
    const history = page.getByRole('table', { name: t.event.history });
    await expect(history.getByRole('row')).toHaveCount(3);
    await expect(history.getByRole('row').nth(2)).toContainText(t.actions.held);
  });

  test('retry keeps the page on the event with its new state', async ({ page }) => {
    const retried = await answer(page, 'POST', `/inbox/${rateMissing.id}/retry`, {
      status: 200,
      json: detailOf({
        ...rateMissing,
        state: 'posted',
        reason: null,
        entries: [{ id: hubEntry.id, fiscalYear: 2026, number: 21 }],
      }),
    });
    await page.goto(`/inbox/${rateMissing.id}`);
    await page.getByRole('button', { name: t.retryAction.label }).click();
    await expect(page.getByText(t.states.posted).first()).toBeVisible();
    await expect(page.getByRole('link', { name: '2026/21' })).toBeVisible();
    await expect(page.getByRole('button', { name: t.retryAction.label })).toHaveCount(0);
    expect(retried).toHaveLength(1);
  });

  test('a closed month moves to the next open period with its day shown and a reason', async ({
    page,
  }) => {
    const moved = await answer(page, 'POST', `/inbox/${closedMonth.id}/post-in-open-period`, {
      status: 200,
      json: detailOf({ ...closedMonth, state: 'posted', reason: null, postedOn: '2026-11-01' }),
    });
    await page.goto(`/inbox/${closedMonth.id}`);
    await expect(page.getByRole('button', { name: t.resolve.label })).toHaveCount(0);
    await page.getByRole('button', { name: t.move.label }).click();
    const dialog = page.getByRole('dialog', { name: t.move.title });
    await expect(dialog).toContainText(t.move.targetDate);
    await expect(dialog).toContainText(/2026/);
    await dialog.getByRole('button', { name: t.move.confirm }).click();
    await expect(fieldError(dialog, ar.company.validation.required)).toBeVisible();
    await dialog.getByLabel(t.resolve.reason).fill('وصلت الفاتورة بعد إقفال تشرين الأول');
    await dialog.getByRole('button', { name: t.move.confirm }).click();
    await expect(dialog).toBeHidden();
    expect(moved[0]?.postDataJSON()).toEqual({ reason: 'وصلت الفاتورة بعد إقفال تشرين الأول' });
    await expect(page.getByText(t.event.postedOn)).toBeVisible();
  });

  test('an overpayment is resolved by a posted manual entry found in the picker', async ({
    page,
  }) => {
    const resolvedNow = await answer(page, 'POST', `/inbox/${overpayment.id}/resolve`, {
      status: 200,
      json: detailOf({
        ...overpayment,
        state: 'resolved',
        reason: null,
        detail: null,
        resolvedBy: { id: '01900000-0000-7000-8009-000000000014', fiscalYear: 2026, number: 14 },
      }),
    });
    await page.goto(`/inbox/${overpayment.id}`);
    await expect(page.getByText(t.details.amount_above_applied).first()).toBeVisible();
    await expect(page.getByRole('button', { name: t.move.label })).toHaveCount(0);
    await page.getByRole('button', { name: t.resolve.label }).click();
    const dialog = page.getByRole('dialog', { name: t.resolve.title });
    await dialog.getByRole('button', { name: t.resolve.confirm }).click();
    await expect(fieldError(dialog, t.resolve.entryRequired)).toBeVisible();
    await expect(fieldError(dialog, t.resolve.reasonRequired)).toBeVisible();
    await page.mouse.move(0, 0);
    await dialog.getByRole('combobox', { name: t.resolve.entry }).fill('زائدة');
    await page.getByRole('option', { name: /2026\/14/ }).click();
    await dialog.getByLabel(t.resolve.reason).fill('الزيادة أمانة للعميل');
    await dialog.getByRole('button', { name: t.resolve.confirm }).click();
    await expect(dialog).toBeHidden();
    expect(resolvedNow[0]?.postDataJSON()).toEqual({
      entryId: '01900000-0000-7000-8009-000000000014',
      reason: 'الزيادة أمانة للعميل',
    });
    await expect(page.getByText(t.event.resolvedBy)).toBeVisible();
  });

  test('the owner dismisses with a reason; the accountant cannot', async ({ page }) => {
    const dismissedNow = await answer(page, 'POST', `/inbox/${unmappedExpense.id}/dismiss`, {
      status: 200,
      json: detailOf({ ...unmappedExpense, state: 'dismissed', reason: null, detail: null }),
    });
    await page.goto(`/inbox/${unmappedExpense.id}`);
    await expect(page.getByText(t.fixes.NO_MAPPING)).toBeVisible();
    await page.getByRole('button', { name: t.dismiss.label }).click();
    const dialog = page.getByRole('dialog', { name: t.dismiss.title });
    await dialog.getByLabel(t.resolve.reason).fill('مصروف تجريبي مكرر');
    await dialog.getByRole('button', { name: t.dismiss.confirm }).click();
    await expect(dialog).toBeHidden();
    expect(dismissedNow[0]?.postDataJSON()).toEqual({ reason: 'مصروف تجريبي مكرر' });
    await expect(page.getByText(t.states.dismissed).first()).toBeVisible();
  });

  test('keeps a refusal in the dialog', async ({ page }) => {
    await answer(
      page,
      'POST',
      `/inbox/${closedMonth.id}/post-in-open-period`,
      refusal(409, 'EVENT_NOT_HELD'),
    );
    await page.goto(`/inbox/${closedMonth.id}`);
    await page.getByRole('button', { name: t.move.label }).click();
    const dialog = page.getByRole('dialog', { name: t.move.title });
    await dialog.getByLabel(t.resolve.reason).fill('سبب تجريبي');
    await dialog.getByRole('button', { name: t.move.confirm }).click();
    await expect(dialog.getByText(ar.errors.EVENT_NOT_HELD)).toBeVisible();
  });

  test('a waiting event links to the one it waits for; a retainer invoice waits for S06', async ({
    page,
  }) => {
    await page.goto(`/inbox/${waiting.id}`);
    await page.getByRole('link', { name: t.fixLinks.waitingFor }).click();
    await expect(page).toHaveURL(new RegExp(`/inbox/${closedMonth.id}$`));
    await expect(page.getByText(`${t.event.hold}: ${t.reasons.PERIOD_CLOSED}`)).toBeVisible();
    await page.goto(`/inbox/${retainerInvoice.id}`);
    await expect(page.getByText(t.details.deferred_revenue).first()).toBeVisible();
    await expect(page.getByText(t.deferredFix)).toBeVisible();
  });

  test('posted, resolved, dismissed and recorded events show no actions', async ({ page }) => {
    for (const event of [postedInvoice, resolved, dismissed, recordedRate]) {
      await page.goto(`/inbox/${event.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(t.states[event.state as 'posted']).first()).toBeVisible();
      await expect(page.getByRole('button', { name: t.retryAction.label })).toHaveCount(0);
      await expect(page.getByText(t.event.hold)).toHaveCount(0);
    }
    await page.goto(`/inbox/${dismissed.id}`);
    await expect(page.getByRole('table', { name: t.event.history })).toContainText(
      'إيداع تجريبي أُدخل خطأً في Hub',
    );
  });

  test('opens the document’s other events, and says when an event is not found', async ({
    page,
  }) => {
    await page.goto(`/inbox/${postedInvoice.id}`);
    await page.getByRole('link', { name: t.event.otherEvents }).click();
    await expect(page).toHaveURL(/document=INV-2026-077/);
    await answer(
      page,
      'GET',
      '/inbox/01900000-0000-7000-a000-000000000999',
      refusal(404, 'NOT_FOUND'),
    );
    await page.goto('/inbox/01900000-0000-7000-a000-000000000999');
    await expect(page.getByText(t.event.notFound)).toBeVisible();
  });
});

test.describe('the Hub document on an entry and an item', () => {
  test('an entry from Hub names its document and links to its event', async ({ page }) => {
    await page.goto(`/entries/${hubEntry.id}`);
    await expect(page.getByText(t.entryLink.hubDocument)).toBeVisible();
    await expect(page.getByText(t.documentTypes.invoice).first()).toBeVisible();
    await page.getByRole('link', { name: t.entryLink.openEvent }).click();
    await expect(page).toHaveURL(new RegExp(`/inbox/${postedInvoice.id}$`));
  });

  test('a Hub item links to the event that opened it', async ({ page }) => {
    await page.goto(`/open-items/${hubItem.id}`);
    await page.getByRole('link', { name: t.entryLink.openEvent }).click();
    await expect(page).toHaveURL(new RegExp(`/inbox/${postedInvoice.id}$`));
  });
});

test.describe('the Hub document for a person without the inbox', () => {
  test.use({ me: { ...viewer, permissions: [...rolePermissions.viewer] } });

  test('an entry shows its document but no link to the event', async ({ page }) => {
    await page.goto(`/entries/${hubEntry.id}`);
    await expect(page.getByText('INV-2026-077').first()).toBeVisible();
    await expect(page.getByRole('link', { name: t.entryLink.openEvent })).toHaveCount(0);
  });
});

test.describe('the inbox for the accountant', () => {
  test.use({ me: accountant });

  test('acts on a held event but cannot dismiss it', async ({ page }) => {
    await page.goto(`/inbox/${overpayment.id}`);
    await expect(page.getByRole('button', { name: t.resolve.label })).toBeVisible();
    await expect(page.getByRole('button', { name: t.dismiss.label })).toHaveCount(0);
  });
});
