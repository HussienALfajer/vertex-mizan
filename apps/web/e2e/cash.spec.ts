import type { Page, Request } from '@playwright/test';
import { type DraftInput, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import {
  cashReads,
  count,
  emptyPosition,
  postedVoucher,
  receipt,
  receiptVoucher,
  statement,
  sypBox,
  usdBox,
  voucherDraftOf,
  voucherPreview,
} from './cash-mocks';
import { accountOf } from './chart-mocks';
import { owner, viewer } from './company-mocks';
import { ownDraft } from './entry-mocks';
import { type ApiReply, expect, fieldError, test } from './test';

const t = ar.cash;
const f = t.form;
const te = ar.drafts.editor;

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
      id: '01900000-0000-7000-800f-000000000001',
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

test.use({ me: owner, api: cashReads });

test.describe('the cash position', () => {
  test('groups the cash accounts by currency with balances, totals and exports', async ({
    page,
  }) => {
    const files = await answer(page, 'POST', '/reports/files', queuedFile);
    await answer(page, 'GET', '/reports/files/', () => ({
      status: 200,
      json: queuedFile(files[0] as Request).json as object,
    }));
    await page.goto('/cash');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.position.title);
    const usd = page.getByRole('region', { name: ar.accounting.currencies.USD });
    await expect(usd.locator('[data-slot="cash-account-card"]')).toHaveCount(2);
    const box = usd.locator('[data-slot="cash-account-card"]').first();
    await expect(box).toContainText('111002');
    await expect(box).toContainText('1,500.00USD');
    await expect(box).toContainText('182,250.00SYP');
    // The bank at zero is marked.
    await expect(usd.locator('[data-slot="cash-account-card"]').nth(1)).toContainText(
      t.position.atZero,
    );
    await expect(page.locator('[data-slot="cash-ledger-totals"]')).toContainText('187,250.00SYP');

    await page.getByRole('button', { name: ar.reports.exportMenu.trigger }).click();
    await page.getByRole('menuitem', { name: ar.reports.exportMenu.pdf }).click();
    await expect.poll(() => files.length).toBe(1);
    expect(files[0]?.postDataJSON()).toMatchObject({ report: 'cash_position' });

    await box.getByRole('link', { name: t.position.statement }).click();
    await expect(page).toHaveURL(new RegExp(`/cash/${usdBox.id}$`));
  });

  test('starts a voucher from a card on its cash account', async ({ page }) => {
    await page.goto('/cash');
    await page
      .getByRole('button', {
        name: t.position.actions.replace('{account}', `111002 ${usdBox.name}`),
      })
      .click();
    await page.getByRole('menuitem', { name: t.newVoucher.payment }).click();
    await expect(page).toHaveURL(new RegExp(`/cash/vouchers/new/payment\\?account=${usdBox.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      f.newTitle.replace('{kind}', t.kinds.payment),
    );
    await expect(page.getByRole('combobox', { name: f.cashAccount })).toHaveValue(
      `111002 ${usdBox.name}`,
    );
  });

  test('explains a company with no cash account', async ({ page }) => {
    await answer(page, 'GET', '/cash/accounts', { status: 200, json: emptyPosition });
    await page.goto('/cash');
    await expect(page.getByText(t.position.empty)).toBeVisible();
    await expect(
      page.locator('#main').getByRole('link', { name: t.position.toChart }),
    ).toBeVisible();
  });
});

test.describe('a cash account statement', () => {
  test('lists its lines and count with the balance, opens a voucher, adds a ledger column', async ({
    page,
  }) => {
    const reads = await answer(page, 'GET', `/cash/accounts/${usdBox.id}/statement`, {
      status: 200,
      json: statement,
    });
    await page.goto(`/cash/${usdBox.id}?from=2026-11-01&to=2026-11-09`);
    const table = page.getByRole('table', { name: t.statement.title });
    // The opening, two lines, the count, the totals, the closing.
    await expect(table.getByRole('row')).toHaveCount(7);
    await expect(table.getByRole('row').nth(1)).toContainText(t.statement.opening);
    await expect(table.getByRole('row').nth(2)).toContainText('112001');
    await expect(table.getByRole('row').nth(3)).toContainText(t.statement.several);
    await expect(table.locator('tr[data-kind="count"]')).toContainText(
      t.statement.columns.expected,
    );
    await expect(table.getByRole('row').nth(6)).toContainText('1,500.00');

    await page.getByRole('checkbox', { name: t.statement.columns.book }).click();
    await expect
      .poll(() => reads.map((request) => new URL(request.url()).searchParams.get('ledgers')))
      .toContain('book');

    await table.getByRole('link', { name: /سند قبض/ }).click();
    await expect(page).toHaveURL(new RegExp(`/cash/vouchers/${receipt.id}$`));
  });
});

test.describe('the vouchers', () => {
  test('filter by kind, print one and show a cancelled one', async ({ page }) => {
    const files = await answer(page, 'POST', '/reports/files', queuedFile);
    await answer(page, 'GET', '/reports/files/', () => ({
      status: 200,
      json: queuedFile(files[0] as Request).json as object,
    }));
    await page.goto('/cash/vouchers');
    const table = page.getByRole('table', { name: t.register.title });
    await expect(table.getByRole('row')).toHaveCount(5);
    await expect(table.getByRole('row').filter({ hasText: t.kinds.payment })).toContainText(
      t.states.cancelled,
    );
    await page.getByRole('combobox', { name: t.register.kind }).click();
    await page.getByRole('option', { name: t.kinds.receipt }).click();
    await expect(page).toHaveURL(/kind=receipt/);
    await expect(table.getByRole('row')).toHaveCount(2);
    await table.getByRole('button', { name: f.print }).click();
    await expect.poll(() => files.length).toBe(1);
    expect(files[0]?.postDataJSON()).toEqual({
      report: 'voucher',
      params: { voucher: receipt.id },
    });
    await expect(
      page.getByText(`${ar.reports.exportMenu.pdf}: ${ar.reports.exportMenu.queued}`),
    ).toBeVisible();
  });

  test('a voucher shows its number, entry and lines, and is cancelled by a reversal', async ({
    page,
  }) => {
    const reversed = await answer(
      page,
      'POST',
      `/entries/${receiptVoucher.entryDetail?.id}/reverse`,
      {
        status: 201,
        json: {
          entry: { id: receiptVoucher.entryDetail?.id, fiscalYear: 2026, number: 20 },
          draft: null,
        },
      },
    );
    await page.goto(`/cash/vouchers/${receipt.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      t.voucher.title.replace('{kind}', t.kinds.receipt).replace('{number}', '2026/1'),
    );
    const header = page.locator('[data-slot="voucher-header"]');
    await expect(header.locator('[data-slot="voucher-number"]')).toHaveText('2026/1');
    await expect(header).toContainText(t.states.posted);
    await expect(header).toContainText('عميل تجريبي');
    await expect(header.getByRole('link', { name: '2026/11' })).toBeVisible();

    await page.getByRole('button', { name: t.register.cancel }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: ar.entries.reverse.submit }).click();
    await expect.poll(() => reversed.length).toBe(1);
  });

  test('a count that matched has no entry and no cancellation', async ({ page }) => {
    await page.goto(`/cash/vouchers/${count.id}`);
    await expect(page.getByText(t.voucher.noEntry)).toBeVisible();
    await expect(page.getByRole('button', { name: t.register.cancel })).toHaveCount(0);
  });
});

test.describe('the voucher form', () => {
  test('a receipt: its cash line from the header, the party and a counter line, posted', async ({
    page,
  }) => {
    const created = await answer(page, 'POST', '/drafts', (request) => ({
      status: 201,
      json: voucherDraftOf(request.postDataJSON() as DraftInput, ownDraft.id),
    }));
    const posted = await answer(page, 'POST', `/drafts/${ownDraft.id}/post`, () => ({
      status: 200,
      json: postedVoucher(
        created[0]?.postDataJSON() as DraftInput,
        ownDraft.id,
        { id: receipt.id, kind: 'receipt', number: 1 },
        true,
      ),
    }));
    await page.goto(`/cash/vouchers/new/receipt?account=${usdBox.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      f.newTitle.replace('{kind}', t.kinds.receipt),
    );
    const header = page.locator('[data-slot="voucher-header"]');
    // The number comes at posting; the box shows its balance.
    await expect(header.locator('[data-slot="voucher-number"]')).toHaveText(f.numberPending);
    await expect(header).toContainText('1,500.00USD');
    await page.getByLabel(f.partyReceipt).fill('شريك تجريبي');
    await page.getByLabel(f.description).fill('إيداع رأس مال');

    const grid = page.getByRole('grid', { name: te.lines });
    const cell = (row: number, column: number) =>
      grid.locator(`[data-row="${row}"][data-column="${column}"]`);
    // Line 1 is the box, from the header.
    await expect(cell(0, 1)).toContainText('111002');
    await cell(0, 3).click();
    await page.keyboard.type('250');
    await page.keyboard.press('Enter');
    await cell(1, 1).click();
    await page.keyboard.type('313001');
    await page.keyboard.press('Enter');
    await cell(1, 2).click();
    await page.keyboard.type('USD');
    await page.keyboard.press('Enter');
    await cell(1, 4).click();
    await page.keyboard.type('=');
    await page.keyboard.press('Enter');
    await expect(cell(1, 4)).toHaveText('250.00');

    await page.getByRole('button', { name: te.post }).click();
    await expect.poll(() => posted.length).toBe(1);
    const body = created[0]?.postDataJSON() as DraftInput;
    expect(body.voucher).toEqual({
      kind: 'receipt',
      cashAccountId: usdBox.id,
      counterCashAccountId: null,
      partyName: 'شريك تجريبي',
      countedMinor: null,
    });
    expect(body.lines).toMatchObject([
      { accountId: usdBox.id, currency: 'USD', amountMinor: '25000' },
      { accountId: accountOf('313001').id, currency: 'USD', amountMinor: '-25000' },
    ]);
    expect(posted[0]?.postDataJSON()).toEqual({ expectedMinor: null });
    await expect(page).toHaveURL(new RegExp(`/cash/vouchers/${receipt.id}$`));
  });

  test('a transfer between currencies names both boxes and shows the derived rate', async ({
    page,
  }) => {
    const created = await answer(page, 'POST', '/drafts', (request) => ({
      status: 201,
      json: voucherDraftOf(request.postDataJSON() as DraftInput, ownDraft.id),
    }));
    await answer(page, 'GET', `/drafts/${ownDraft.id}`, () => ({
      status: 200,
      json: voucherDraftOf(created[0]?.postDataJSON() as DraftInput, ownDraft.id),
    }));
    await answer(page, 'POST', `/drafts/${ownDraft.id}/preview`, {
      status: 200,
      json: voucherPreview({
        kind: 'transfer',
        derivedRate: { base: 'USD', quote: 'SYP', rate: '125' },
        expectedMinor: null,
        differenceMinor: null,
      }),
    });
    await page.goto(`/cash/vouchers/new/transfer?account=${usdBox.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      f.newTitle.replace('{kind}', t.kinds.transfer),
    );
    // Saving without a destination is refused at the field.
    await page.getByRole('button', { name: te.save }).click();
    await expect(fieldError(page, f.errors.destination)).toBeVisible();
    const destination = page.getByRole('combobox', { name: f.destination });
    await destination.focus();
    await page.mouse.move(0, 0);
    await page.keyboard.press('Alt+ArrowDown');
    await page.getByRole('option', { name: /111001/ }).click();
    await expect(destination).toHaveValue(`111001 ${sypBox.name}`);
    const grid = page.getByRole('grid', { name: te.lines });
    await expect(grid.locator('[data-row="1"][data-column="1"]')).toContainText('111001');
    await page.getByLabel(f.description).fill('صرف عملة');
    await page.getByRole('button', { name: te.preview }).click();
    await expect(page).toHaveURL(new RegExp(`/drafts/${ownDraft.id}`));
    await expect(page.locator('[data-slot="voucher-derived-rate"]')).toContainText(
      '1 USD = 125 SYP',
    );
    expect((created[0]?.postDataJSON() as DraftInput | undefined)?.voucher).toMatchObject({
      kind: 'transfer',
      cashAccountId: usdBox.id,
      counterCashAccountId: sypBox.id,
    });
  });

  test('a count asks for its preview, then posts at the expected amount it showed', async ({
    page,
  }) => {
    const created = await answer(page, 'POST', '/drafts', (request) => ({
      status: 201,
      json: voucherDraftOf(request.postDataJSON() as DraftInput, ownDraft.id),
    }));
    await answer(page, 'GET', `/drafts/${ownDraft.id}`, () => ({
      status: 200,
      json: voucherDraftOf(created[0]?.postDataJSON() as DraftInput, ownDraft.id),
    }));
    const previews = await answer(page, 'POST', `/drafts/${ownDraft.id}/preview`, {
      status: 200,
      json: voucherPreview({
        kind: 'count',
        derivedRate: null,
        expectedMinor: '150000',
        differenceMinor: '-1000',
      }),
    });
    const posted = await answer(page, 'POST', `/drafts/${ownDraft.id}/post`, () => ({
      status: 200,
      json: postedVoucher(
        created[0]?.postDataJSON() as DraftInput,
        ownDraft.id,
        { id: count.id, kind: 'count', number: 2 },
        true,
      ),
    }));
    await page.goto(`/cash/vouchers/new/count?account=${usdBox.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      f.newTitle.replace('{kind}', t.kinds.count),
    );
    // A count has no lines of its own.
    await expect(page.getByRole('grid', { name: te.lines })).toHaveCount(0);
    await page.getByLabel(f.counted).fill('1490');
    await page.getByLabel(f.counted).press('Tab');
    await page.getByLabel(f.reason).fill('جرد مفاجئ');
    await page.getByRole('button', { name: te.post }).click();
    // The first press asks for the preview: the expected balance and the shortage.
    await expect.poll(() => previews.length).toBe(1);
    const facts = page.locator('[data-slot="voucher-count-facts"]');
    await expect(facts).toContainText('1,500.00USD');
    await expect(facts).toContainText(f.shortage);
    await expect(facts).toContainText('-10.00USD');
    expect(posted).toHaveLength(0);
    await page.getByRole('button', { name: te.post }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]?.postDataJSON()).toEqual({ expectedMinor: '150000' });
    expect((created[0]?.postDataJSON() as DraftInput | undefined)?.voucher).toMatchObject({
      kind: 'count',
      countedMinor: '149000',
    });
    await expect(page).toHaveURL(new RegExp(`/cash/vouchers/${count.id}$`));
  });
});

test.describe('the command palette', () => {
  test('opens a new voucher and a box statement', async ({ page }) => {
    await page.goto('/cash');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.position.title);
    await page.keyboard.press('Control+k');
    await page.keyboard.type(t.palette.receipt);
    await page.getByRole('option', { name: t.palette.receipt }).click();
    await expect(page).toHaveURL(/\/cash\/vouchers\/new\/receipt$/);

    await page.keyboard.press('Control+k');
    // The palette keeps its last query.
    await page.keyboard.press('Control+a');
    await page.keyboard.type('كشف صندوق');
    await page.getByRole('option', { name: t.palette.statement }).click();
    const finder = page.getByRole('dialog', { name: t.statement.title });
    await finder.getByRole('combobox', { name: f.cashAccount }).focus();
    await page.keyboard.type('111002');
    await page.getByRole('option', { name: /111002/ }).click();
    await expect(page).toHaveURL(new RegExp(`/cash/${usdBox.id}$`));
  });
});

test.describe('a viewer', () => {
  test.use({ me: { ...viewer, permissions: [...rolePermissions.viewer] } });

  test('reads the position, the vouchers and a voucher, with no voucher to make or cancel', async ({
    page,
  }) => {
    await page.goto('/cash');
    await expect(page.locator('[data-slot="cash-account-card"]')).toHaveCount(3);
    await expect(page.getByRole('link', { name: t.newVoucher.receipt })).toHaveCount(0);
    await page.goto(`/cash/vouchers/${receipt.id}`);
    await expect(page.getByRole('button', { name: f.print })).toBeVisible();
    await expect(page.getByRole('button', { name: t.register.cancel })).toHaveCount(0);
  });
});
