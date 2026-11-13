import type { Page, Request } from '@playwright/test';
import { type Me, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { owner } from './company-mocks';
import {
  bookPreview,
  closedOctober,
  currentBookPreview,
  november,
  octoberClosedList,
  parallelPreview,
  passingOctober,
  periodsReads,
  reopenedOctober,
  revaluationEntryId,
  staleBookPreview,
} from './periods-mocks';
import { today } from './rate-mocks';
import { type ApiReply, expect, fieldError, refusal, test } from './test';

const t = ar.periods;
const r = ar.revaluation;

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

const withRole = (role: 'auditor'): Me => ({
  ...owner,
  memberships: owner.memberships.map((membership, index) =>
    index === 0 ? { ...membership, role } : membership,
  ),
  permissions: [...rolePermissions[role]],
});

const isParallel = (request: Request) =>
  new URL(request.url()).searchParams.get('ledger') === 'parallel';

test.use({ me: owner, api: periodsReads });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(today);
});

test.describe('the periods', () => {
  test('lists the months, the latest first, with their states and checklists', async ({ page }) => {
    await page.goto('/periods');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
    await expect(nav.getByRole('link', { name: t.nav })).toBeVisible();
    await expect(nav.getByRole('link', { name: r.nav })).toBeVisible();
    const table = page.getByRole('table', { name: t.table.label });
    const rows = table.getByRole('row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toContainText(t.states.open);
    await expect(rows.nth(1)).toContainText(t.table.endedNo);
    await expect(rows.nth(2)).toContainText(`${t.table.failing}: 3`);
    await expect(rows.nth(3)).toContainText(t.states.closed);
    await expect(rows.nth(3)).toContainText('إقفال أيلول بعد المراجعة');
    await rows.nth(2).getByRole('link').click();
    await expect(page).toHaveURL(/\/periods\/2026-10$/);
  });

  test('shows a month with nothing posted yet as empty', async ({ page }) => {
    await answer(page, 'GET', '/periods', { status: 200, json: [] });
    await page.goto('/periods');
    await expect(page.getByText(t.empty.title)).toBeVisible();
  });

  test('a failing checklist names each item, its count and the page that fixes it', async ({
    page,
  }) => {
    await page.goto('/periods/2026-10');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(t.detail.title);
    const items = page.locator('[data-slot="checklist-item"]');
    await expect(items).toHaveCount(8);
    // S08's item, last, without a link: its page left with Hub (ADR 0021).
    await expect(items.last()).toContainText(t.checklist.items.reconciliation_clean);
    await expect(items.last().getByRole('link')).toHaveCount(0);
    const drafts = items.filter({ hasText: t.checklist.items.no_drafts });
    await expect(drafts).toContainText(t.checklist.results.failed);
    await expect(drafts).toContainText(`${t.checklist.counts.no_drafts}: 1`);
    await expect(drafts.getByRole('link', { name: t.checklist.links.no_drafts })).toHaveAttribute(
      'href',
      '/drafts',
    );
    const held = items.filter({ hasText: t.checklist.items.no_held_events });
    await expect(held.getByRole('link')).toHaveCount(0);
    const revaluation = items.filter({ hasText: t.checklist.items.revaluation_current });
    await expect(revaluation).toContainText(r.ledgers.book);
    await expect(revaluation.getByRole('link')).toHaveAttribute(
      'href',
      '/revaluation?period=2026-10&ledger=book',
    );
    await expect(items.filter({ hasText: t.checklist.items.releases_posted })).toContainText(
      t.checklist.results.not_applicable,
    );
    await expect(page.getByText(`${t.detail.summary}: 5/8`)).toBeVisible();
    await expect(page.getByRole('button', { name: t.close.action })).toBeDisabled();
  });

  test('closes a month with a reason, and keeps a refusal with its failing items', async ({
    page,
  }) => {
    let refuse = true;
    let closed = false;
    await answer(page, 'GET', '/periods/2026-10', () => ({
      status: 200,
      json: closed ? closedOctober : passingOctober,
    }));
    const closes = await answer(page, 'POST', '/periods/2026-10/close', () => {
      if (refuse) {
        refuse = false;
        return {
          status: 409,
          json: {
            statusCode: 409,
            code: 'CHECKLIST_FAILED',
            message: 'CHECKLIST_FAILED',
            details: { items: 'no_drafts,no_held_events' },
          },
        };
      }
      closed = true;
      return { status: 200, json: closedOctober };
    });
    await page.goto('/periods/2026-10');
    await page.getByRole('button', { name: t.close.action }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(t.close.description);
    await dialog.getByRole('button', { name: t.close.confirm }).click();
    await expect(fieldError(dialog, ar.company.validation.required)).toBeVisible();
    await dialog.getByLabel(t.close.reason).fill('إقفال تشرين الأول');
    await dialog.getByRole('button', { name: t.close.confirm }).click();
    await expect(dialog).toContainText(ar.errors.CHECKLIST_FAILED);
    await expect(dialog.getByRole('listitem')).toHaveText([
      t.checklist.items.no_drafts,
      t.checklist.items.no_held_events,
    ]);
    await dialog.getByRole('button', { name: t.close.confirm }).click();
    await expect(dialog).toBeHidden();
    expect(closes.map((request) => request.postDataJSON())).toEqual([
      { reason: 'إقفال تشرين الأول' },
      { reason: 'إقفال تشرين الأول' },
    ]);
    await expect(page.getByRole('status').filter({ hasText: t.close.done })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('table', { name: t.detail.history })).toContainText(
      'إقفال تشرين الأول',
    );
  });

  test('reopens the latest closed month and says how many events are retried', async ({ page }) => {
    await answer(page, 'GET', '/periods', {
      status: 200,
      json: octoberClosedList,
    });
    await answer(page, 'GET', '/periods/2026-10', { status: 200, json: closedOctober });
    const reopens = await answer(page, 'POST', '/periods/2026-10/reopen', {
      status: 200,
      json: { period: reopenedOctober, queuedEvents: 2 },
    });
    await page.goto('/periods/2026-10');
    await expect(page.getByRole('button', { name: t.close.action })).toHaveCount(0);
    await page.getByRole('button', { name: t.reopen.action }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(t.reopen.description);
    await dialog.getByLabel(t.reopen.reason).fill('دفعة متأخرة من عميل');
    await dialog.getByRole('button', { name: t.reopen.confirm }).click();
    await expect(dialog).toBeHidden();
    expect(reopens[0]?.postDataJSON()).toEqual({ reason: 'دفعة متأخرة من عميل' });
    await expect(
      page.getByRole('status').filter({ hasText: `${t.reopen.queued}: 2` }),
    ).toBeVisible();
  });

  test('keeps the close off while an earlier month is open (rule 2)', async ({ page }) => {
    await answer(page, 'GET', '/periods/2026-11', {
      status: 200,
      json: { ...november, ended: true },
    });
    await page.goto('/periods/2026-11');
    await expect(page.getByText(t.close.outOfOrder)).toBeVisible();
    await expect(page.getByRole('button', { name: t.close.action })).toBeDisabled();
  });

  test('offers no reopen on a closed month that is not the latest', async ({ page }) => {
    await answer(page, 'GET', '/periods', {
      status: 200,
      json: octoberClosedList,
    });
    await page.goto('/periods/2026-09');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('table', { name: t.detail.history })).toBeVisible();
    await expect(page.getByRole('button', { name: t.reopen.action })).toHaveCount(0);
  });
});

test.describe('the revaluation', () => {
  test('shows the book ledger’s balances and posts them, then reads current', async ({ page }) => {
    let posted = false;
    await answer(page, 'GET', '/revaluation/2026-10*', (request) => ({
      status: 200,
      json: isParallel(request) ? parallelPreview : posted ? currentBookPreview : bookPreview,
    }));
    const posts = await answer(page, 'POST', '/revaluation/2026-10', () => {
      posted = true;
      return {
        status: 200,
        json: {
          posted: true,
          revaluation: currentBookPreview.posted[0],
          entryId: revaluationEntryId,
          reversalEntryId: currentBookPreview.posted[0]?.reversal.id,
        },
      };
    });
    await page.goto('/revaluation?period=2026-10&ledger=book');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(r.title);
    const rates = page.getByRole('table', { name: r.closingRates.label });
    await expect(rates).toContainText('USD/SYP 125.0000');
    await expect(rates).toContainText(ar.rates.types.bulletin);
    const balances = page.getByRole('table', { name: r.balances.label });
    const item = balances.getByRole('row').filter({ hasText: 'M-1' });
    await expect(item).toContainText('1,000.00');
    await expect(item).toContainText('120,000.00');
    await expect(item).toContainText('125,000.00');
    await expect(item).toContainText('5,000.00');
    await expect(balances.getByRole('row').filter({ hasText: '211002' })).toContainText(
      r.balances.blocked,
    );
    await expect(page.getByText(r.gain).locator('..')).toContainText('5,500.00');
    await expect(page.getByText(r.states.to_post)).toBeVisible();
    await page.getByRole('button', { name: r.actions.post }).click();
    await expect(page.getByRole('status').filter({ hasText: r.actions.done })).toBeVisible();
    expect(posts.map((request) => request.postDataJSON())).toEqual([
      { ledger: 'book', fingerprint: bookPreview.fingerprint },
    ]);
    await expect(page.getByText(r.states.current, { exact: true })).toBeVisible();
    const postedTable = page.getByRole('table', { name: r.posted.label });
    await expect(postedTable).toContainText('2026/40');
    await expect(postedTable).toContainText('2026/41');
    await expect(page.getByRole('button', { name: r.actions.adjust })).toBeDisabled();
  });

  test('a changed preview is read again with a notice, and posts as an adjustment', async ({
    page,
  }) => {
    let changed = false;
    await answer(page, 'GET', '/revaluation/2026-10*', (request) => ({
      status: 200,
      json: isParallel(request) ? parallelPreview : changed ? staleBookPreview : bookPreview,
    }));
    await answer(page, 'POST', '/revaluation/2026-10', () => {
      changed = true;
      return refusal(409, 'REVALUATION_CHANGED');
    });
    await page.goto('/revaluation?period=2026-10&ledger=book');
    await page.getByRole('button', { name: r.actions.post }).click();
    await expect(page.getByRole('status').filter({ hasText: r.changed })).toBeVisible();
    await expect(page.getByRole('button', { name: r.actions.adjust })).toBeEnabled();
    await expect(page.getByText(r.loss).locator('..')).toContainText('500.00');
  });

  test('the parallel ledger names its missing closing rate', async ({ page }) => {
    await page.goto('/revaluation?period=2026-10&ledger=book');
    await expect(page.getByRole('table', { name: r.balances.label })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(r.ledgers.parallel) }).click();
    await expect(page).toHaveURL(/ledger=parallel/);
    await expect(page.getByText(r.states.rate_missing)).toBeVisible();
    await expect(page.getByText('SYP/USD')).toBeVisible();
    await expect(page.getByRole('link', { name: r.rateMissing.record })).toHaveAttribute(
      'href',
      '/rates',
    );
    await expect(page.getByRole('button', { name: r.actions.post })).toBeDisabled();
  });

  test('posts both ledgers that have something to post, one request each', async ({ page }) => {
    const posts = await answer(page, 'POST', '/revaluation/2026-10', {
      status: 200,
      json: { posted: false, revaluation: null, entryId: null, reversalEntryId: null },
    });
    await page.goto('/revaluation?period=2026-10&ledger=book');
    await page.getByRole('button', { name: r.actions.both }).click();
    await expect(page.getByRole('status').filter({ hasText: r.actions.done })).toBeVisible();
    // The parallel ledger misses its rate: only the book posts.
    expect(posts.map((request) => request.postDataJSON())).toEqual([
      { ledger: 'book', fingerprint: bookPreview.fingerprint },
    ]);
  });

  test('a month not ended previews without a posting, and a closed one says so', async ({
    page,
  }) => {
    await page.goto('/revaluation?period=2026-11');
    await expect(page.getByText(r.notEnded)).toBeVisible();
    await expect(page.getByText(r.balances.empty)).toBeVisible();
    await answer(page, 'GET', '/revaluation/2026-09*', refusal(409, 'PERIOD_CLOSED'));
    await page.goto('/revaluation?period=2026-09');
    await expect(page.getByText(r.closed)).toBeVisible();
    await expect(page.getByRole('link', { name: r.openPeriod })).toHaveAttribute(
      'href',
      '/periods/2026-09',
    );
  });

  test('a revaluation entry links to its month', async ({ page }) => {
    await page.goto(`/entries/${revaluationEntryId}`);
    await expect(page.getByRole('link', { name: /2026-10/ })).toHaveAttribute(
      'href',
      '/revaluation?period=2026-10&ledger=book',
    );
  });
});

test.describe('the auditor', () => {
  test.use({ me: withRole('auditor') });

  test('the auditor reads the checklist without the actions', async ({ page }) => {
    await page.goto('/periods/2026-10');
    await expect(page.locator('[data-slot="checklist-item"]')).toHaveCount(8);
    await expect(page.getByRole('button', { name: t.close.action })).toHaveCount(0);
  });
});

test.describe('the auditor', () => {
  test.use({ me: withRole('auditor') });

  test('the auditor previews without the posting', async ({ page }) => {
    await page.goto('/revaluation?period=2026-10');
    await expect(page.getByRole('table', { name: r.balances.label })).toBeVisible();
    await expect(page.getByRole('button', { name: r.actions.post })).toHaveCount(0);
  });
});
