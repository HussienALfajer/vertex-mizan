import type { Request } from '@playwright/test';
import { type DraftInput, type Me, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { accountOf } from './chart-mocks';
import { company, owner, viewer } from './company-mocks';
import {
  approvalCompany,
  draftOf,
  entryReads,
  journal,
  ownDraft,
  purchase,
  purchasePreview,
  rejectedDraft,
  reversal,
  reversedPurchase,
  submittedDraft,
} from './entry-mocks';
import { today } from './rate-mocks';
import { type ApiReply, expect, refusal, test } from './test';

const te = ar.drafts.editor;
const tn = ar.entries;

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

const newDraftId = '01900000-0000-7000-800a-000000000099';
const posted = {
  status: 200,
  json: { entry: purchase, draft: { ...ownDraft, state: 'posted', postedEntryId: purchase.id } },
};

test.use({ me: owner, api: entryReads });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(today);
});

test.describe('the keyboard entry screen', () => {
  test('types, posts and opens an entry by keyboard only', async ({ page }) => {
    const created = recorder((request) => ({
      status: 201,
      json: draftOf(request.postDataJSON() as DraftInput, { id: newDraftId }),
    }));
    const post = recorder(posted);
    await page.goto('/entries/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(te.newTitle);

    // The header, by keyboard.
    await page.getByLabel(te.statement).focus();
    await page.keyboard.type('شراء دولار');
    await page.keyboard.press('Tab');
    await page.keyboard.type('ص-12');
    // Past the add-line button into the grid's active cell, then Enter along the line.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const grid = page.getByRole('grid', { name: te.lines });
    await expect(grid.locator('[data-row="0"][data-column="0"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type('111004');
    await page.keyboard.press('Enter');
    // The account's currency is the line's.
    await expect(grid.locator('[data-row="0"][data-column="2"]')).toHaveText('USD');
    await page.keyboard.press('Enter');
    await page.keyboard.type('100');
    for (const _ of [0, 1, 2, 3]) await page.keyboard.press('Enter');
    await expect(grid.locator('[data-row="1"][data-column="1"]')).toBeFocused();
    await page.keyboard.type('111003');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('12250');
    await page.keyboard.press('Enter');
    await expect(grid.locator('[data-row="0"][data-column="1"]')).toContainText('111004');
    await expect(grid.locator('[data-row="1"][data-column="4"]')).toHaveText('12,250.00');

    // Live totals per currency, the imbalance written out.
    const totals = page.getByRole('table', { name: te.totals.label });
    await expect(totals.getByRole('row')).toHaveCount(3);
    await expect(totals).toContainText('USD100.000.00');

    // The dealt rate of the pair the parallel ledger accepts (rule 13).
    const rate = page.getByRole('textbox', { name: /سعر الصفقة/ });
    await rate.focus();
    await page.keyboard.type('122.5');

    await page.route(`**/api/drafts`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const reply = created.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.route(`**/api/drafts/${newDraftId}/post`, async (route) => {
      const reply = post.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    // Posted from inside the rate field: the rate typed there is committed first, and sent.
    await page.keyboard.press('Control+Shift+Enter');
    await expect(page).toHaveURL(new RegExp(`/entries/${purchase.id}$`));
    expect(created.seen).toHaveLength(1);
    expect(created.seen[0]?.headers()['x-mizan-company']).toBe(company.id);
    const body = created.seen[0]?.postDataJSON() as DraftInput;
    expect(body).toMatchObject({
      entryDate: '2026-11-09',
      description: 'شراء دولار',
      reference: 'ص-12',
      dealtRates: [{ base: 'USD', quote: 'SYP', rate: '122.5' }],
      lines: [
        { accountId: accountOf('111004').id, currency: 'USD', amountMinor: '10000' },
        { accountId: accountOf('111003').id, currency: 'SYP', amountMinor: '-1225000' },
      ],
    });
    expect(post.seen).toHaveLength(1);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('2026/1');
  });

  test('balances with =, adds a line with Ctrl+Enter, and refuses an incomplete entry', async ({
    page,
  }) => {
    await page.goto('/entries/new');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(te.newTitle);
    const grid = page.getByRole('grid', { name: te.lines });
    const cell = (row: number, column: number) =>
      grid.locator(`[data-row="${row}"][data-column="${column}"]`);
    await cell(0, 1).click();
    await page.keyboard.type('531001');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('=');
    await page.keyboard.press('Enter');
    // Nothing to balance yet: the grid says so and keeps the text.
    await expect(
      page.getByRole('alert').filter({ hasText: ar.grid.problems.NOTHING_TO_BALANCE }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.type('250.5');
    await page.keyboard.press('Enter');
    await cell(1, 1).click();
    await page.keyboard.type('111003');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('=');
    await page.keyboard.press('Enter');
    await expect(cell(1, 4)).toHaveText('250.50');
    const totals = page.getByRole('table', { name: te.totals.label });
    await expect(totals).toContainText(te.totals.balanced);

    await page.keyboard.press('Control+Enter');
    await expect(grid.locator('tbody tr')).toHaveCount(3);
    await expect(cell(2, 1)).toBeFocused();

    // No description: refused before anything is sent, the summary linking to the field.
    await page.keyboard.press('Control+Shift+Enter');
    const summary = page.getByRole('region', { name: ar.common.errorSummary });
    await expect(summary).toBeFocused();
    await expect(summary).toContainText(te.validation.statement);
  });

  test('looks up an account with Alt+↓', async ({ page }) => {
    await page.goto('/entries/new');
    const grid = page.getByRole('grid', { name: te.lines });
    await grid.locator('[data-row="0"][data-column="1"]').click();
    // A pointer resting where the list opens would move its highlight by hover.
    await page.mouse.move(0, 0);
    await page.keyboard.press('Alt+ArrowDown');
    const dialog = page.getByRole('dialog', { name: te.chooseAccount });
    // The picker takes the focus a moment after the dialog opens.
    await expect(dialog.getByRole('combobox', { name: te.account })).toBeFocused();
    await page.keyboard.type('531001');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: /^531001/ })).toHaveAttribute(
      'data-highlighted',
      '',
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(grid.locator('[data-row="0"][data-column="1"]')).toContainText('531001');
    await expect(grid.locator('[data-row="0"][data-column="1"]')).toBeFocused();
  });
});

test.describe('drafts', () => {
  test('previews the posting with its exchange difference, and lists a missing rate', async ({
    page,
  }) => {
    const preview = recorder({ status: 200, json: purchasePreview });
    await page.route(`**/api/drafts/${ownDraft.id}/preview`, async (route) => {
      const reply = preview.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto(`/drafts/${ownDraft.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(te.title);
    await page.getByRole('button', { name: te.preview }).click();
    const lines = page.getByRole('table', { name: ar.drafts.preview.label });
    await expect(lines).toBeVisible();
    // The loss in the book ledger only, labelled; the dealt rate named on the SYP line.
    await expect(lines.locator('[data-kind="difference"]')).toContainText(tn.kinds.difference);
    await expect(lines.locator('[data-kind="difference"]')).toContainText(tn.entry.oneLedger);
    await expect(lines).toContainText('1 USD = 122.5 SYP');
    await expect(lines).toContainText('12,150.00');
    expect(preview.seen).toHaveLength(1);

    await page.unroute(`**/api/drafts/${ownDraft.id}/preview`);
    await page.route(`**/api/drafts/${ownDraft.id}/preview`, (route) =>
      route.fulfill({
        status: 200,
        json: {
          ...purchasePreview,
          lines: [],
          refusals: [
            {
              code: 'RATE_MISSING',
              message: 'RATE_MISSING',
              lineNo: 1,
              details: {
                ledger: 'book',
                rateType: 'bulletin',
                from: 'USD',
                to: 'SYP',
                on: '2026-11-08',
              },
            },
          ],
        },
      }),
    );
    await page.getByRole('button', { name: te.preview }).click();
    const refused = page.getByRole('alert').filter({ hasText: ar.drafts.preview.refusals });
    await expect(refused).toContainText(ar.errors.RATE_MISSING);
    await expect(refused).toContainText('USD/SYP');
    await expect(refused.getByRole('link', { name: ar.drafts.preview.openRates })).toHaveAttribute(
      'href',
      '/rates',
    );
  });

  test('saves with Ctrl+S and refuses a stale write', async ({ page }) => {
    const save = recorder(refusal(409, 'DRAFT_CHANGED'));
    await page.route(`**/api/drafts/${ownDraft.id}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const reply = save.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto(`/drafts/${ownDraft.id}`);
    const description = page.getByLabel(te.statement);
    await description.fill('شراء دولار نقدًا');
    await expect(page.getByText(te.unsaved)).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(page.getByText(te.changed)).toBeVisible();
    expect(save.seen[0]?.postDataJSON()).toMatchObject({
      description: 'شراء دولار نقدًا',
      updatedAt: ownDraft.updatedAt,
    });
  });

  test('never shows or sends a dealt rate kept in the other orientation', async ({ page }) => {
    const reversed = { ...ownDraft, dealtRates: [{ base: 'SYP', quote: 'USD', rate: '0.008' }] };
    const save = recorder({ status: 200, json: ownDraft });
    await page.route(`**/api/drafts/${ownDraft.id}`, async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, json: reversed });
      }
      save.mock(route.request());
      return route.fulfill({ status: 200, json: { ...reversed, dealtRates: [] } });
    });
    await page.goto(`/drafts/${ownDraft.id}`);
    // The company quotes USD/SYP: the field is empty, never 0.008 under the other quote.
    await expect(page.getByRole('textbox', { name: /سعر الصفقة/ })).toHaveValue('');
    await expect(page.getByText(te.unsaved)).toBeVisible();
    await page.getByLabel(te.statement).focus();
    await page.keyboard.press('Control+s');
    await expect.poll(() => save.seen.length).toBe(1);
    expect(save.seen[0]?.postDataJSON()).toMatchObject({ dealtRates: [] });
  });

  test('names a refused line by its row, past a blank row', async ({ page }) => {
    await page.route(`**/api/drafts/${ownDraft.id}/preview`, (route) =>
      route.fulfill({
        status: 200,
        json: {
          ...purchasePreview,
          lines: [],
          refusals: [
            {
              code: 'ACCOUNT_BLOCKED',
              message: 'ACCOUNT_BLOCKED',
              lineNo: 2,
              details: {},
            },
          ],
        },
      }),
    );
    await page.goto(`/drafts/${ownDraft.id}`);
    const grid = page.getByRole('grid', { name: te.lines });
    await grid.locator('[data-row="1"][data-column="1"]').click();
    // A blank row inserted above the second line: the saved line 2 is row 3 now.
    await page.keyboard.press('Control+Insert');
    await expect(grid.locator('tbody tr')).toHaveCount(3);
    await page.getByRole('button', { name: te.preview }).click();
    const refused = page.getByRole('alert').filter({ hasText: ar.drafts.preview.refusals });
    await expect(refused).toContainText(`${ar.drafts.preview.line} 3`);
    await expect(refused).toContainText(ar.errors.ACCOUNT_BLOCKED);
  });

  test('saves a dealt rate typed in its field with Ctrl+S from that field', async ({ page }) => {
    const save = recorder((request) => ({
      status: 200,
      json: draftOf(request.postDataJSON() as DraftInput, { id: ownDraft.id }),
    }));
    await page.route(`**/api/drafts/${ownDraft.id}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const reply = save.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto(`/drafts/${ownDraft.id}`);
    const rate = page.getByRole('textbox', { name: /سعر الصفقة/ });
    await expect(rate).toHaveValue('122.5');
    await rate.fill('123.25');
    await page.keyboard.press('Control+s');
    await expect.poll(() => save.seen.length).toBe(1);
    expect(save.seen[0]?.postDataJSON()).toMatchObject({
      dealtRates: [{ base: 'USD', quote: 'SYP', rate: '123.25' }],
    });
  });

  test('shows a rejection with its reason', async ({ page }) => {
    await page.goto(`/drafts/${rejectedDraft.id}`);
    await expect(page.getByText(te.rejectedTitle)).toBeVisible();
    await expect(page.getByText('أرفق إيصال الصرافة قبل الاعتماد (مثال)')).toBeVisible();
  });

  test('lists the approval queue', async ({ page }) => {
    await page.goto('/drafts?view=awaiting');
    const table = page.getByRole('table', {
      name: `${ar.drafts.table.label}: ${ar.drafts.views.awaiting}`,
    });
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('شراء دولار للمصاريف');
    await page.getByRole('tab', { name: ar.drafts.views.mine }).click();
    await expect(page).toHaveURL(/view=mine/);
  });
});

test.describe('approval', () => {
  test.use({ api: { ...entryReads, 'GET /api/company': { status: 200, json: approvalCompany } } });

  test('an approver approves another person’s draft, which posts', async ({ page }) => {
    const approve = recorder(posted);
    await page.route(`**/api/drafts/${submittedDraft.id}/approve`, async (route) => {
      const reply = approve.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto(`/drafts/${submittedDraft.id}`);
    await expect(page.getByText(te.submittedNote)).toBeVisible();
    // Only its preparer withdraws it (rule 8).
    await expect(page.getByRole('button', { name: te.withdraw })).toHaveCount(0);
    // Submitted: read only.
    await expect(page.getByLabel(te.statement)).toHaveAttribute('readonly', '');
    await page.getByRole('button', { name: te.approve }).click();
    await expect(page).toHaveURL(new RegExp(`/entries/${purchase.id}$`));
    expect(approve.seen).toHaveLength(1);
  });

  test('rejects with a reason', async ({ page }) => {
    const reject = recorder({ status: 200, json: { ...submittedDraft, state: 'draft' } });
    await page.route(`**/api/drafts/${submittedDraft.id}/reject`, async (route) => {
      const reply = reject.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto(`/drafts/${submittedDraft.id}`);
    await page.getByRole('button', { name: te.reject }).click();
    const dialog = page.getByRole('dialog', { name: ar.drafts.reject.title });
    await dialog.getByLabel(ar.drafts.reject.reason).fill('أرفق الإيصال (مثال)');
    await dialog.getByRole('button', { name: ar.drafts.reject.submit }).click();
    await expect(dialog).toBeHidden();
    expect(reject.seen[0]?.postDataJSON()).toEqual({ reason: 'أرفق الإيصال (مثال)' });
  });

  test('the preparer cannot approve their own draft, and submits instead of posting', async ({
    page,
  }) => {
    await page.goto(`/drafts/${ownDraft.id}`);
    await expect(page.getByRole('button', { name: te.submit })).toBeVisible();
    await expect(page.getByRole('button', { name: te.post })).toHaveCount(0);
  });

  test.describe('own submitted draft', () => {
    test.use({
      api: {
        ...entryReads,
        'GET /api/company': { status: 200, json: approvalCompany },
        [`GET /api/drafts/${submittedDraft.id}`]: {
          status: 200,
          json: {
            ...submittedDraft,
            preparedBy: { id: owner.person.id, name: owner.person.name },
          },
        },
      },
    });

    test('says why approving is not offered', async ({ page }) => {
      await page.goto(`/drafts/${submittedDraft.id}`);
      await expect(page.getByText(te.selfApproval)).toBeVisible();
      await expect(page.getByRole('button', { name: te.approve })).toHaveCount(0);
      await expect(page.getByRole('button', { name: te.withdraw })).toBeVisible();
    });
  });
});

test.describe('approval by role', () => {
  const as = (role: 'approver' | 'accountant'): Me => ({
    ...owner,
    memberships: owner.memberships.map((membership) => ({ ...membership, role })),
    permissions: [...rolePermissions[role]],
  });

  test.describe('an approver', () => {
    test.use({
      me: as('approver'),
      api: { ...entryReads, 'GET /api/company': { status: 200, json: approvalCompany } },
    });

    test('approves, rejects and previews, and edits nothing', async ({ page }) => {
      await page.goto(`/drafts/${submittedDraft.id}`);
      await expect(page.getByRole('button', { name: te.approve })).toBeVisible();
      await expect(page.getByRole('button', { name: te.reject })).toBeVisible();
      await expect(page.getByRole('button', { name: te.preview })).toBeVisible();
      for (const name of [te.withdraw, te.save, te.submit, te.discard]) {
        await expect(page.getByRole('button', { name })).toHaveCount(0);
      }
    });
  });

  test.describe('an accountant', () => {
    test.use({
      me: as('accountant'),
      api: { ...entryReads, 'GET /api/company': { status: 200, json: approvalCompany } },
    });

    test('cannot approve another person’s submitted draft', async ({ page }) => {
      await page.goto(`/drafts/${submittedDraft.id}`);
      await expect(page.getByText(te.submittedNote)).toBeVisible();
      await expect(page.getByRole('button', { name: te.approve })).toHaveCount(0);
      await expect(page.getByRole('button', { name: te.withdraw })).toHaveCount(0);
    });
  });
});

test.describe('posted entries', () => {
  test.use({
    api: { ...entryReads, [`GET /api/entries/${purchase.id}`]: { status: 200, json: purchase } },
  });

  test('shows the entry in both ledgers, its hash and its files, and reverses it', async ({
    page,
  }) => {
    const reverse = recorder({ status: 200, json: { entry: reversal, draft: null } });
    await page.route(`**/api/entries/${purchase.id}/reverse`, async (route) => {
      const reply = reverse.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto(`/entries/${purchase.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('2026/1');
    const lines = page.getByRole('table', { name: `${tn.entry.lines} 2026/1` });
    await expect(lines.getByRole('row')).toHaveCount(5);
    await expect(lines.getByRole('link', { name: /111004/ })).toHaveAttribute(
      'href',
      `/accounts/${accountOf('111004').id}/lines`,
    );
    await expect(page.getByText('aaaaaaaaaaaa…')).toBeVisible();
    await expect(page.getByText(tn.entry.firstInChain)).toBeVisible();
    const files = page.getByRole('table', { name: tn.attachments.label });
    await expect(files).toContainText('إيصال الصرافة.pdf');
    // A posted entry's file is never removed (owner, 2026-10-28).
    await expect(
      files.getByRole('button', { name: new RegExp(tn.attachments.remove) }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: tn.actions.reverse }).click();
    const dialog = page.getByRole('dialog', { name: tn.reverse.title });
    await expect(dialog.getByLabel(tn.reverse.date)).toHaveValue('2026-11-08');
    const description = dialog.getByLabel(tn.reverse.descriptionLabel);
    await expect(description).toHaveValue('عكس القيد 2026/1: ');
    await description.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('سعر صفقة خاطئ');
    await dialog.getByRole('button', { name: tn.reverse.submit }).click();
    await expect(page).toHaveURL(new RegExp(`/entries/${reversal.id}$`));
    expect(reverse.seen[0]?.postDataJSON()).toEqual({
      date: '2026-11-08',
      description: 'عكس القيد 2026/1: سعر صفقة خاطئ',
    });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('2026/2');
    await expect(page.getByRole('link', { name: '2026/1' })).toBeVisible();
    await expect(page.getByRole('button', { name: tn.actions.reverse })).toHaveCount(0);
  });

  test('attaches a file to a posted entry', async ({ page }) => {
    const attach = recorder({ status: 201, json: purchase.attachments[0] });
    await page.route(`**/api/entries/${purchase.id}/attachments`, async (route) => {
      const reply = attach.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto(`/entries/${purchase.id}`);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'وصل.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 synthetic'),
    });
    await expect.poll(() => attach.seen.length).toBe(1);
    expect(attach.seen[0]?.headers()['content-type']).toMatch(/^multipart\/form-data/);
    expect(attach.seen[0]?.headers()['x-mizan-company']).toBe(company.id);
  });

  test('copies an entry to a new draft', async ({ page }) => {
    const copy = recorder({ status: 201, json: ownDraft });
    await page.route(`**/api/entries/${purchase.id}/copy`, async (route) => {
      const reply = copy.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto(`/entries/${purchase.id}`);
    await page.getByRole('button', { name: tn.actions.copy }).click();
    await expect(page).toHaveURL(new RegExp(`/drafts/${ownDraft.id}$`));
  });

  test('the journal finds an entry by its number and opens it', async ({ page }) => {
    const list = recorder(entryReads['GET /api/entries']);
    await page.route('**/api/entries?**', async (route) => {
      const reply = list.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto('/entries?find=number');
    await expect(page.getByLabel(tn.filters.number)).toBeFocused();
    await page.keyboard.type('2026/1');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => list.seen.map((request) => new URL(request.url()).search).at(-1))
      .toBe('?fiscalYear=2026&number=1');
    const table = page.getByRole('table', { name: tn.table.label });
    await expect(table.getByRole('row')).toHaveCount(3);
    await table.getByRole('link', { name: '2026/1' }).click();
    await expect(page).toHaveURL(new RegExp(`/entries/${purchase.id}$`));
  });

  test('an account’s lines run their balances', async ({ page }) => {
    await page.goto(`/accounts/${accountOf('111004').id}/lines`);
    const table = page.getByRole('table', { name: tn.lines.label });
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(table.getByRole('row').nth(1)).toContainText(tn.lines.opening);
    await expect(table.getByRole('row').nth(3)).toContainText('2026/2');
  });
});

test.describe('a viewer', () => {
  const reader: Me = {
    ...viewer,
    permissions: ['company.read', 'accounts.read', 'dimensions.read', 'rates.read', 'entries.read'],
  };
  test.use({
    me: reader,
    api: {
      ...entryReads,
      [`GET /api/entries/${reversedPurchase.id}`]: { status: 200, json: reversedPurchase },
    },
  });

  test('reads entries, with no entry action', async ({ page }) => {
    await page.goto(`/entries/${purchase.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('2026/1');
    await expect(page.getByRole('button', { name: tn.actions.reverse })).toHaveCount(0);
    await expect(page.getByRole('button', { name: tn.actions.copy })).toHaveCount(0);
    await expect(page.getByRole('button', { name: tn.actions.attach })).toHaveCount(0);
    await page.goto('/entries');
    await expect(page.getByText(tn.readOnly)).toBeVisible();
    await expect(page.getByRole('link', { name: tn.newEntry })).toHaveCount(0);
  });
});

test.describe('around the entries', () => {
  test('the owner switches approval of manual entries on', async ({ page }) => {
    const patch = recorder({ status: 200, json: approvalCompany });
    await page.route('**/api/company', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const reply = patch.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto('/settings/company');
    const toggle = page.getByRole('switch', { name: ar.company.settings.approval.label });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(patch.seen[0]?.postDataJSON()).toEqual({ manualEntryApproval: true });
  });

  test('a rate row lists the entries that used it', async ({ page }) => {
    const used = recorder({ status: 200, json: { entries: [journal[1]], nextCursor: null } });
    await page.route('**/api/rates/*/entries**', async (route) => {
      const reply = used.mock(route.request());
      await route.fulfill({ status: reply.status, json: reply.json });
    });
    await page.goto('/rates');
    await page.getByRole('button', { name: tn.rateEntries.open }).first().click();
    const sheet = page.getByRole('dialog', { name: tn.rateEntries.title });
    await expect(sheet.getByRole('link', { name: '2026/1' })).toHaveAttribute(
      'href',
      `/entries/${purchase.id}`,
    );
    expect(used.seen).toHaveLength(1);
  });
});
