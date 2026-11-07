import type { Page, Request } from '@playwright/test';
import { type DraftInput, type EntryPreview, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { accountOf } from './chart-mocks';
import { companyId, owner, viewer } from './company-mocks';
import { hubClient } from './dimension-mocks';
import { draftOf, ownDraft, purchaseLines } from './entry-mocks';
import { today } from './rate-mocks';
import {
  client,
  emptyAgeing,
  hubItem,
  hubOpenItem,
  m1,
  m1Extended,
  m1Item,
  receivablesReads,
} from './receivables-mocks';
import { type ApiReply, expect, fieldError, refusal, test } from './test';

const t = ar.openItems;
const te = ar.drafts.editor;

/** One test's own answer, before the shared mocks; it records each request it answers. */
async function answer(
  page: Page,
  method: string,
  path: string,
  reply: ApiReply | ((request: Request) => ApiReply),
): Promise<Request[]> {
  const seen: Request[] = [];
  // `*`: a read's query string; it never crosses a `/`.
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

/** A file answer, as the exports send it. */
async function answerFile(page: Page, path: string, name: string): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route(`**/api${path}*`, (route) => {
    seen.push(route.request());
    return route.fulfill({
      status: 200,
      body: 'xlsx',
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${name}"`,
      },
    });
  });
  return seen;
}

test.use({ me: owner, api: receivablesReads });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(today);
});

test.describe('the receivables ageing', () => {
  test('shows each client by bucket, opens its items and exports the ageing', async ({ page }) => {
    const exported = await answerFile(page, '/receivables/ageing/export', 'ageing.xlsx');
    await page.goto('/receivables');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.ageing.title);
    const table = page.getByRole('table', { name: /أعمار الذمم حتى/ });
    const rows = table.getByRole('row');
    // A row per client, then the totals.
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toContainText('C-001');
    await expect(rows.nth(1)).toContainText('72,000.00');
    await expect(rows.nth(1)).toContainText('102,000.00');
    await expect(rows.nth(3)).toContainText('152,000.00');

    // The client opens to its items: M-0 is 69 days past due, M-1 not yet due.
    await table.getByRole('button', { name: `${t.ageingTable.showDetail} 1` }).click();
    const items = page.getByRole('table', { name: t.ageing.itemsLabel });
    await expect(items.getByRole('row')).toHaveCount(3);
    await expect(items.getByRole('row').nth(1)).toContainText('M-0');
    await expect(items.getByRole('row').nth(1)).toContainText('69');
    await expect(items.getByRole('row').nth(1)).toContainText(t.buckets.days_61_90);
    await expect(items.getByRole('row').nth(2)).toContainText('600.00USD');
    await expect(items.getByRole('row').nth(2)).toContainText(t.buckets.not_due);

    // The totals per transaction currency under the table.
    const totals = page.getByRole('table', { name: t.ageing.currencyTotalsLabel });
    await expect(totals.getByRole('row').filter({ hasText: 'USD' })).toContainText('850.00');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: t.ageing.exportExcel }).click();
    expect((await download).suggestedFilename()).toBe('ageing.xlsx');
    const search = new URL(exported[0]?.url() ?? '').searchParams;
    expect(search.get('asOf')).toBe('2026-11-09');
    expect(search.get('ledger')).toBe('book');
    expect(exported[0]?.headers()['x-mizan-company']).toBe(companyId);

    // An item opens its page.
    await items.getByRole('link', { name: 'M-1' }).click();
    await expect(page).toHaveURL(new RegExp(`/open-items/${m1.id}$`));
  });

  test('asks again by date and ledger, and explains a date with nothing open', async ({ page }) => {
    const asked = await answer(page, 'GET', '/receivables/ageing', (request) => {
      const search = new URL(request.url()).searchParams;
      return {
        status: 200,
        json:
          search.get('asOf') === '2026-07-01'
            ? emptyAgeing
            : { ...emptyAgeing, ledger: search.get('ledger'), clients: [] },
      };
    });
    await page.goto('/receivables');
    await expect(page.getByText(t.ageing.emptyTitle)).toBeVisible();
    await page.getByRole('button', { name: /الدفتر الموازي/ }).click();
    await expect.poll(() => asked.at(-1)?.url() ?? '').toContain('ledger=parallel');
    await page.getByLabel(t.ageing.asOf).fill('2026-07-01');
    await expect.poll(() => asked.at(-1)?.url() ?? '').toContain('asOf=2026-07-01');
    await expect(page.getByText(t.ageing.emptyTitle)).toBeVisible();
  });

  test('finds a client statement and an item from the command palette', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.shell.home.title);
    await page.keyboard.press('Control+k');
    const search = page.getByRole('combobox', { name: ar.commandPalette.search });
    await search.fill('كشف حساب');
    await page.keyboard.press('Enter');
    const finder = page.getByRole('dialog', { name: t.find.clientTitle });
    await finder.getByRole('combobox', { name: t.ageing.client }).fill('C-001');
    await page.getByRole('option', { name: /C-001/ }).click();
    await expect(page).toHaveURL(new RegExp(`/receivables/clients/${client.id}$`));

    await page.keyboard.press('Control+k');
    await search.fill('الانتقال إلى بند');
    await page.keyboard.press('Enter');
    const items = page.getByRole('dialog', { name: t.find.itemTitle });
    await items.getByRole('searchbox', { name: t.find.reference }).fill('INV');
    await expect(items.getByRole('button', { name: /INV-2026-077/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/open-items/${hubItem.id}$`));
  });

  test('the client funds say when the chart cannot be read', async ({ page }) => {
    await answer(page, 'GET', '/accounts', refusal(403, 'FORBIDDEN'));
    await page.goto('/client-funds');
    await expect(page.getByText(ar.errors.FORBIDDEN)).toBeVisible();
  });

  test('shows the client funds, a debit balance marked', async ({ page }) => {
    await page.goto('/receivables');
    await page.getByRole('link', { name: t.ageing.clientFunds }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.funds.title);
    const table = page.getByRole('table', { name: t.funds.label });
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByRole('row').nth(1)).toContainText('-500.00USD');
    await expect(table.getByRole('row').nth(2)).toContainText(t.labels.receivable);
  });
});

test.describe('the client statement', () => {
  test('lists every movement with its balances, exports and starts a receipt', async ({ page }) => {
    const exported = await answerFile(
      page,
      `/clients/${client.id}/statement/export`,
      'client-statement.xlsx',
    );
    await page.goto(`/receivables/clients/${client.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(t.statement.title);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(client.name);
    const table = page.getByRole('table', { name: t.statement.label });
    // The opening, three movements, the closing.
    await expect(table.getByRole('row')).toHaveCount(6);
    const receipt = table.getByRole('row').nth(4);
    await expect(receipt).toContainText('M-1');
    await expect(receipt).toContainText(t.movements.clear);
    await expect(receipt).toContainText('-400.00USD');
    await expect(receipt).toContainText('850.00USD');
    await expect(table.getByRole('row').nth(5)).toContainText('102,000.00');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: t.statement.exportExcel }).click();
    expect((await download).suggestedFilename()).toBe('client-statement.xlsx');
    expect(new URL(exported[0]?.url() ?? '').searchParams.get('ledger')).toBe('book');

    await page.getByRole('link', { name: t.statement.newReceipt }).click();
    await expect(page).toHaveURL(new RegExp(`/entries/new\\?client=${client.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(te.newTitle);
  });
});

test.describe('a viewer', () => {
  test.use({ me: { ...viewer, permissions: [...rolePermissions.viewer] } });

  test('reads the statement and an item, with no receipt or due-date change', async ({ page }) => {
    await page.goto(`/receivables/clients/${client.id}`);
    await expect(page.getByRole('table', { name: t.statement.label })).toBeVisible();
    await expect(page.getByRole('link', { name: t.statement.newReceipt })).toHaveCount(0);
    await page.goto(`/open-items/${m1.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('M-1');
    await expect(page.getByRole('button', { name: t.item.changeDueDate })).toHaveCount(0);
  });
});

test.describe('the entry screen with open items', () => {
  test('a receipt by keyboard: the item picked with Alt+↓, = takes its open amount', async ({
    page,
  }) => {
    const created = await answer(page, 'POST', '/drafts', (request) => ({
      status: 201,
      json: draftOf(request.postDataJSON() as DraftInput, { id: ownDraft.id }),
    }));
    await page.goto(`/entries/new?client=${client.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(te.newTitle);
    await page.getByLabel(te.statement).fill('سند قبض من عميل تجريبي');
    const grid = page.getByRole('grid', { name: te.lines });
    const cell = (row: number, column: number) =>
      grid.locator(`[data-row="${row}"][data-column="${column}"]`);

    // Line 1: the USD bank. The second line already names the client (column 2).
    await cell(0, 1).click();
    await page.keyboard.type('111004');
    await page.keyboard.press('Enter');
    await expect(cell(1, 2)).toContainText(client.name);
    // Line 2: the receivables account; its item column appears (column 3).
    await cell(1, 1).click();
    await page.keyboard.type('112001');
    await page.keyboard.press('Enter');
    await cell(1, 3).click();
    await page.mouse.move(0, 0);
    await page.keyboard.press('Alt+ArrowDown');
    const lookup = page.getByRole('dialog', { name: t.editor.lookupTitle });
    const picker = lookup.getByRole('combobox', { name: t.editor.existing });
    await picker.focus();
    await page.keyboard.type('M-1');
    await page.keyboard.press('ArrowDown');
    const option = page.getByRole('option', { name: /M-1/ });
    await expect(option).toContainText('600.00USD');
    await expect(option).toContainText('72,000.00SYP');
    await page.keyboard.press('Enter');
    await expect(lookup).toBeHidden();
    await expect(cell(1, 3)).toContainText('M-1');
    // The line takes the item's currency; = in its credit takes what is open.
    await expect(cell(1, 4)).toHaveText('USD');
    await cell(1, 6).click();
    await page.keyboard.type('=');
    await page.keyboard.press('Enter');
    await expect(cell(1, 6)).toHaveText('600.00');
    await cell(0, 5).click();
    await page.keyboard.type('600');
    await page.keyboard.press('Enter');

    await page.keyboard.press('Control+s');
    await expect.poll(() => created.length).toBe(1);
    const body = created[0]?.postDataJSON() as DraftInput;
    expect(body.lines).toMatchObject([
      { accountId: accountOf('111004').id, currency: 'USD', amountMinor: '60000' },
      {
        accountId: accountOf('112001').id,
        dimensionValueIds: [client.id],
        currency: 'USD',
        amountMinor: '-60000',
        openItemId: m1.id,
        newItem: null,
      },
    ]);
  });

  test("a changed client drops the picked item, and its currency stays the item's", async ({
    page,
  }) => {
    const created = await answer(page, 'POST', '/drafts', (request) => ({
      status: 201,
      json: draftOf(request.postDataJSON() as DraftInput, { id: ownDraft.id }),
    }));
    await page.goto(`/entries/new?client=${client.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(te.newTitle);
    const grid = page.getByRole('grid', { name: te.lines });
    const cell = (row: number, column: number) =>
      grid.locator(`[data-row="${row}"][data-column="${column}"]`);
    await cell(1, 1).click();
    await page.keyboard.type('112001');
    await page.keyboard.press('Enter');
    await cell(1, 3).click();
    await page.keyboard.type('M-1');
    await page.keyboard.press('Enter');
    await expect(cell(1, 3)).toContainText('600.00');
    // The currency of a line moving an item is the item's: typing over it changes nothing.
    await cell(1, 4).click();
    await page.keyboard.type('SYP');
    await page.keyboard.press('Enter');
    await expect(cell(1, 4)).toHaveText('USD');
    // Another client: the item, which was the first client's, is dropped.
    await cell(1, 2).click();
    await page.mouse.move(0, 0);
    await page.keyboard.press('Alt+ArrowDown');
    const lookup = page.getByRole('dialog', { name: te.chooseDimension });
    await expect(lookup.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('للتسويق');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: hubClient.name })).toHaveAttribute(
      'data-highlighted',
      '',
    );
    await page.keyboard.press('Enter');
    await expect(lookup).toBeHidden();
    await expect(cell(1, 2)).toContainText(hubClient.name);
    await expect(cell(1, 3)).toHaveText('');

    await page.keyboard.press('Control+s');
    await expect.poll(() => created.length).toBe(1);
    const body = created[0]?.postDataJSON() as DraftInput;
    expect(body.lines[0]).toMatchObject({
      accountId: accountOf('112001').id,
      dimensionValueIds: [hubClient.id],
      openItemId: null,
      newItem: null,
    });
  });

  test('an invoice opens a new item with its reference and due date', async ({ page }) => {
    const created = await answer(page, 'POST', '/drafts', (request) => ({
      status: 201,
      json: draftOf(request.postDataJSON() as DraftInput, { id: ownDraft.id }),
    }));
    await page.goto('/entries/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(te.newTitle);
    await page.getByLabel(te.statement).fill('فاتورة خدمات تسويق');
    const grid = page.getByRole('grid', { name: te.lines });
    const cell = (row: number, column: number) =>
      grid.locator(`[data-row="${row}"][data-column="${column}"]`);
    // 112001, then its client (column 2) and the item (column 3) typed as a new reference.
    await cell(0, 1).click();
    await page.keyboard.type('112001');
    await page.keyboard.press('Enter');
    await page.keyboard.type('C-001');
    await page.keyboard.press('Enter');
    await expect(cell(0, 3)).toBeFocused();
    await page.keyboard.type('M-2');
    await page.keyboard.press('Enter');
    await expect(cell(0, 3)).toContainText(t.editor.newItem);
    // Its due date in the lookup.
    await cell(0, 3).click();
    await page.keyboard.press('Alt+ArrowDown');
    const lookup = page.getByRole('dialog', { name: t.editor.lookupTitle });
    const form = lookup.getByRole('form', { name: t.editor.newTitle });
    await expect(form.getByLabel(t.editor.reference)).toHaveValue('M-2');
    await form.getByLabel(t.editor.dueOn).fill('2026-12-09');
    await form.getByRole('button', { name: t.editor.useNew }).click();
    await expect(lookup).toBeHidden();
    await expect(cell(0, 3)).toContainText('M-2');
    await cell(0, 4).click();
    await page.keyboard.type('USD');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1000');
    await page.keyboard.press('Enter');

    await page.keyboard.press('Control+s');
    await expect.poll(() => created.length).toBe(1);
    const body = created[0]?.postDataJSON() as DraftInput;
    expect(body.lines[0]).toMatchObject({
      accountId: accountOf('112001').id,
      dimensionValueIds: [client.id],
      currency: 'USD',
      amountMinor: '100000',
      openItemId: null,
      newItem: { reference: 'M-2', dueOn: '2026-12-09' },
    });
  });

  test('the preview shows each item before and after the entry', async ({ page }) => {
    const receipt = draftOf(
      {
        entryDate: '2026-11-09',
        description: 'سند قبض',
        reference: null,
        dealtRates: [],
        lines: [
          {
            accountId: accountOf('111004').id,
            dimensionValueIds: [],
            currency: 'USD',
            amountMinor: '40000',
            memo: null,
            openItemId: null,
            newItem: null,
          },
          {
            accountId: accountOf('112001').id,
            dimensionValueIds: [client.id],
            currency: 'USD',
            amountMinor: '-40000',
            memo: null,
            openItemId: m1.id,
            newItem: null,
          },
        ],
      },
      { id: ownDraft.id },
    );
    const preview: EntryPreview = {
      entryDate: '2026-11-09',
      bookCurrency: 'SYP',
      parallelCurrency: 'USD',
      lines: purchaseLines.slice(0, 1),
      items: [
        {
          id: m1.id,
          accountId: m1.account.id,
          kind: 'document',
          reference: 'M-1',
          currency: 'USD',
          isNew: false,
          before: { openMinor: '60000', bookMinor: '7200000', parallelMinor: '60000' },
          after: { openMinor: '20000', bookMinor: '2400000', parallelMinor: '20000' },
        },
      ],
      refusals: [],
    };
    await answer(page, 'GET', `/drafts/${ownDraft.id}`, { status: 200, json: receipt });
    await answer(page, 'POST', `/drafts/${ownDraft.id}/preview`, { status: 200, json: preview });
    await page.goto(`/drafts/${ownDraft.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(te.title);
    await expect(
      page.getByRole('grid', { name: te.lines }).locator('[data-row="1"][data-column="3"]'),
    ).toContainText('M-1');
    await page.getByRole('button', { name: te.preview }).click();
    const items = page.getByRole('table', { name: t.preview.label });
    await expect(items.getByRole('row').nth(1)).toContainText('600.00USD');
    await expect(items.getByRole('row').nth(1)).toContainText('200.00USD');
    await expect(items.getByRole('row').nth(1)).toContainText('24,000.00');
  });
});

test.describe('an item', () => {
  test('shows its movements and changes its due date with a reason', async ({ page }) => {
    const changed = await answer(page, 'PUT', `/open-items/${m1.id}/due-date`, {
      status: 200,
      json: m1Extended,
    });
    // Read again after the change, the item has its new due date.
    await answer(page, 'GET', `/open-items/${m1.id}`, () => ({
      status: 200,
      json: changed.length > 0 ? m1Extended : m1Item,
    }));
    await page.goto(`/open-items/${m1.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('M-1');
    await expect(page.getByText(t.states.open, { exact: true })).toBeVisible();
    const movements = page.getByRole('table', { name: t.item.movementsLabel });
    await expect(movements.getByRole('row')).toHaveCount(3);
    await expect(movements.getByRole('row').nth(2)).toContainText('-48,000.00');
    await expect(movements.getByRole('row').nth(2)).toContainText('2026/4');

    await page.getByRole('button', { name: t.item.changeDueDate }).click();
    const dialog = page.getByRole('dialog', { name: t.dueDate.title });
    await dialog.getByRole('button', { name: t.dueDate.submit }).click();
    await expect(fieldError(dialog, t.dueDate.required)).toBeVisible();
    expect(changed).toHaveLength(0);
    await dialog.getByLabel(t.dueDate.dueOn).fill('2027-01-03');
    await dialog.getByLabel(t.dueDate.reason).fill('تمديد متفق عليه مع العميل (مثال)');
    await dialog.getByRole('button', { name: t.dueDate.submit }).click();
    await expect(dialog).toBeHidden();
    expect(changed[0]?.postDataJSON()).toEqual({
      dueOn: '2027-01-03',
      reason: 'تمديد متفق عليه مع العميل (مثال)',
    });
    expect(changed[0]?.headers()['x-mizan-company']).toBe(companyId);
    const history = page.getByRole('table', { name: t.item.dueDatesLabel });
    await expect(history.getByRole('row')).toHaveCount(3);
    await expect(history.getByRole('row').nth(2)).toContainText(t.dueDateSetters.user);
  });

  test('a Hub item says its due date comes from Hub and marks the adjustment', async ({ page }) => {
    await page.goto(`/open-items/${hubItem.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('INV-2026-077');
    await expect(page.getByText(t.item.hubDueNote)).toBeVisible();
    await expect(page.getByRole('button', { name: t.item.changeDueDate })).toHaveCount(0);
    const movements = page.getByRole('table', { name: t.item.movementsLabel });
    await expect(movements.getByRole('row').nth(2)).toContainText(t.labels.adjusted);
    await expect(page.getByText(hubClient.name).first()).toBeVisible();
    await expect(page.getByText(hubOpenItem.hubDocument?.number ?? '').last()).toBeVisible();
  });

  test('an unknown item is explained', async ({ page }) => {
    await answer(page, 'GET', `/open-items/${m1Item.openedByEntryId}`, refusal(404, 'NOT_FOUND'));
    await page.goto(`/open-items/${m1Item.openedByEntryId}`);
    await expect(page.getByText(t.item.notFound)).toBeVisible();
  });
});
