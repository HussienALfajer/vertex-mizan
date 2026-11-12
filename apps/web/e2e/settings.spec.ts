import type { Page, Request } from '@playwright/test';
import { type Company, type Me, rolePermissions } from '@vertex-mizan/contracts';
import { ar } from '@vertex-mizan/i18n';
import { accountOf } from './chart-mocks';
import { company, owner } from './company-mocks';
import {
  activeKey,
  hubClient,
  mappedProjectCost,
  newKeyOf,
  newSecret,
  postingRules,
  revokedKey,
  settingsReads,
} from './settings-mocks';
import { type ApiReply, expect, fieldError, refusal, test } from './test';

const p = ar.postingRules;
const c = ar.apiClients;

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

/** The first answer refuses for a fresh code, the next ones give `reply` (S01's re-authentication). */
function afterFreshCode(reply: ApiReply): () => ApiReply {
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? refusal(403, 'REAUTHENTICATION_REQUIRED') : reply;
  };
}

/** Types an authenticator code in the re-authentication dialog, which then runs the action again. */
async function enterFreshCode(page: Page) {
  const dialog = page.getByRole('dialog', { name: ar.auth.reauth.title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').first().click();
  await page.keyboard.type('654321');
}

const withRole = (role: 'accountant' | 'auditor'): Me => ({
  ...owner,
  memberships: owner.memberships.map((membership, index) =>
    index === 0 ? { ...membership, role } : membership,
  ),
  permissions: [...rolePermissions[role]],
});

/** The settings reads, and the fresh code every sensitive action may ask for. */
const reads = { ...settingsReads, 'POST /api/auth/reauthenticate': { status: 204 } };

test.use({ me: owner, api: reads });

test.describe('the posting rules', () => {
  test('mark the unmapped slot with its held events and map it to an account that fits', async ({
    page,
  }) => {
    const put = await answer(page, 'PUT', '/posting-rules/project_cost', {
      status: 200,
      json: mappedProjectCost,
    });
    await page.goto('/settings/posting-rules');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.title);
    await expect(page.getByText(p.unmappedTitle)).toBeVisible();
    await expect(page.getByRole('link', { name: p.openInbox })).toHaveAttribute('href', '/inbox');

    const expenses = page.getByRole('table', { name: p.rules.projectExpenses.title });
    const row = expenses.getByRole('row').filter({ hasText: p.slots.project_cost });
    await expect(row.getByText(p.notMapped)).toBeVisible();
    await expect(row.getByText(`2 ${p.heldEvents}`)).toBeVisible();
    // The template's default beside it, and the scenario the rule follows.
    await expect(row.getByText('511001')).toBeVisible();
    await expect(page.getByText('expenses/project-expense')).toBeVisible();

    await row.getByRole('button', { name: `${p.change}: ${p.slots.project_cost}` }).click();
    const dialog = page.getByRole('dialog', { name: `${p.changeTitle}: ${p.slots.project_cost}` });
    await expect(dialog.getByText(p.fits.project_cost)).toBeVisible();
    // A refused submit with no account.
    await dialog.getByRole('button', { name: p.save }).click();
    await expect(fieldError(dialog, p.required)).toBeVisible();

    const picker = dialog.getByRole('combobox', { name: p.picker });
    await picker.fill('411001');
    // Revenue does not fit the project cost: the picker never offers it.
    await expect(page.getByRole('option', { name: /^411001/ })).toHaveCount(0);
    await picker.fill('511001');
    await page.getByRole('option', { name: /^511001/ }).click();
    await dialog.getByRole('button', { name: p.save }).click();
    await expect(dialog).toHaveCount(0);
    expect(put[0]?.postDataJSON()).toEqual({ accountId: accountOf('511001').id });
  });

  test('send the currency of a payment method and keep a refusal in the dialog', async ({
    page,
  }) => {
    const put = await answer(
      page,
      'PUT',
      '/posting-rules/payment_method.cash',
      refusal(409, 'ACCOUNT_HAS_BALANCE'),
    );
    await page.goto('/settings/posting-rules');
    const name = `${p.slots['payment_method.cash']} — USD`;
    await page.getByRole('button', { name: `${p.change}: ${name}` }).click();
    const dialog = page.getByRole('dialog', { name: `${p.changeTitle}: ${name}` });
    const picker = dialog.getByRole('combobox', { name: p.picker });
    await picker.fill('1110');
    // Only the USD cash and bank accounts fit a USD payment method.
    await expect(page.getByRole('option', { name: /^111001/ })).toHaveCount(0);
    await page.getByRole('option', { name: /^111004/ }).click();
    await dialog.getByRole('button', { name: p.save }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: p.hasOpenItems })).toBeVisible();
    expect(put[0]?.postDataJSON()).toEqual({
      accountId: accountOf('111004').id,
      currency: 'USD',
    });
  });

  test.describe('for the accountant', () => {
    test.use({ me: withRole('accountant') });

    test('changes the mapping and has no API clients', async ({ page }) => {
      const put = await answer(page, 'PUT', '/posting-rules/project_cost', {
        status: 200,
        json: mappedProjectCost,
      });
      await page.goto('/settings/posting-rules');
      await expect(page.getByText(p.readOnly)).toHaveCount(0);
      await page.getByRole('button', { name: `${p.change}: ${p.slots.project_cost}` }).click();
      const dialog = page.getByRole('dialog', {
        name: `${p.changeTitle}: ${p.slots.project_cost}`,
      });
      await dialog.getByRole('combobox', { name: p.picker }).fill('511001');
      await page.getByRole('option', { name: /^511001/ }).click();
      await dialog.getByRole('button', { name: p.save }).click();
      await expect(dialog).toHaveCount(0);
      expect(put[0]?.postDataJSON()).toEqual({ accountId: accountOf('511001').id });

      const nav = page.getByRole('navigation', { name: ar.shell.navLabel });
      await expect(nav.getByRole('link', { name: p.nav })).toBeVisible();
      await expect(nav.getByRole('link', { name: c.nav })).toHaveCount(0);
      await page.goto('/settings/api-clients');
      await expect(page.getByRole('heading', { level: 1, name: c.title })).toHaveCount(0);
    });
  });

  test.describe('for the auditor', () => {
    test.use({ me: withRole('auditor') });

    test('reads the mapping without changing it', async ({ page }) => {
      await page.goto('/settings/posting-rules');
      await expect(page.getByText(p.readOnly)).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(`^${p.change}`) })).toHaveCount(0);
      const mapped = postingRules.find((rule) => rule.slot === 'receivable');
      await expect(page.getByText(mapped?.account?.name ?? '').first()).toBeVisible();
    });
  });
});

test.describe('the API clients', () => {
  test('list each client with its scopes, allow-list, document types and keys', async ({
    page,
  }) => {
    await page.goto('/settings/api-clients');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.title);
    await expect(page.getByText(c.scopes['events:write'])).toBeVisible();
    await expect(page.getByText('198.51.100.0/24')).toBeVisible();
    await expect(page.getByText(ar.inbox.documentTypes.project_expense)).toBeVisible();
    const keys = page.getByRole('table', { name: c.keys.label });
    const active = keys.getByRole('row').filter({ hasText: activeKey.prefix });
    await expect(active.getByText(c.keys.active)).toBeVisible();
    await expect(active.getByText(activeKey.lastUsedIp ?? '')).toBeVisible();
    const revoked = keys.getByRole('row').filter({ hasText: revokedKey.prefix });
    await expect(revoked.getByText(c.keys.revoked)).toBeVisible();
    await expect(revoked.getByText(revokedKey.revokeReason ?? '')).toBeVisible();
    await expect(
      revoked.getByRole('button', { name: `${c.keys.revoke}: ${revokedKey.prefix}` }),
    ).toHaveCount(0);
  });

  test('create a client after a fresh code and show its key once, until it is kept', async ({
    page,
  }) => {
    const secret = newSecret();
    const created = await answer(
      page,
      'POST',
      '/api-clients',
      afterFreshCode({
        status: 201,
        json: {
          client: { ...hubClient, name: 'Vertex Hub 2', keys: [newKeyOf(secret).key] },
          key: newKeyOf(secret),
        },
      }),
    );
    await page.goto('/settings/api-clients');
    await page.getByRole('button', { name: c.form.newTitle }).click();
    const form = page.getByRole('dialog', { name: c.form.newTitle });
    // A name is required, and every line of the allow-list is an address or a network.
    await form.getByLabel(c.form.allowList).fill('203.0.113.10\n10.0.0.1/8');
    await form.getByRole('button', { name: c.form.create }).click();
    await expect(fieldError(form, c.form.nameRequired)).toBeVisible();
    await expect(fieldError(form, `${c.form.allowListInvalidLine} 10.0.0.1/8`)).toBeVisible();
    expect(created).toHaveLength(0);

    // S08 rule 13: posting events needs the reconciliation's start date.
    await expect(fieldError(form, c.form.reconcileFromRequired)).toBeVisible();
    await form.getByLabel(c.form.name).fill('Vertex Hub 2');
    await form.getByLabel(c.form.allowList).fill('203.0.113.10\n10.0.0.0/8');
    await form.getByLabel(c.form.reconcileFrom).fill('2026-10-19');
    await form.getByRole('button', { name: c.form.create }).click();
    await enterFreshCode(page);

    const reveal = page.getByRole('dialog', { name: `${c.reveal.title}: Vertex Hub 2` });
    await expect(reveal.getByRole('status', { name: c.reveal.label })).toHaveText(secret);
    await expect(reveal.getByText(c.reveal.warning)).toBeVisible();
    expect(created).toHaveLength(2);
    expect(created[1]?.postDataJSON()).toEqual({
      name: 'Vertex Hub 2',
      system: 'hub',
      scopes: ['events:write', 'periods:read'],
      ipAllowList: ['203.0.113.10', '10.0.0.0/8'],
      reconcileFrom: '2026-10-19',
    });

    // Escape does not close it, and it is done only once the key is kept.
    await page.keyboard.press('Escape');
    await expect(reveal).toBeVisible();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await reveal.getByRole('button', { name: c.reveal.copy }).click();
    await expect(reveal.getByRole('button', { name: c.reveal.copied })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
    const done = reveal.getByRole('button', { name: c.reveal.done });
    await expect(done).toBeDisabled();
    await reveal.getByRole('checkbox', { name: c.reveal.confirm }).click();
    await done.click();
    await expect(reveal).toHaveCount(0);
    await expect(page.getByText(secret)).toHaveCount(0);
  });

  test('create a second key for a rotation, refused at the limit', async ({ page }) => {
    const secret = newSecret();
    const keys = await answer(
      page,
      'POST',
      `/api-clients/${hubClient.id}/keys`,
      afterFreshCode({ status: 201, json: newKeyOf(secret) }),
    );
    await page.goto('/settings/api-clients');
    await page.getByRole('button', { name: c.client.newKey }).click();
    const confirm = page.getByRole('alertdialog', { name: c.newKey.title });
    await confirm.getByRole('button', { name: c.newKey.confirm }).click();
    await enterFreshCode(page);
    const reveal = page.getByRole('dialog', { name: `${c.reveal.title}: ${hubClient.name}` });
    await expect(reveal.getByRole('status', { name: c.reveal.label })).toHaveText(secret);
    expect(keys).toHaveLength(2);
  });

  test.describe('with two active keys', () => {
    test.use({
      api: {
        ...reads,
        'GET /api/api-clients': {
          status: 200,
          json: [{ ...hubClient, keys: [activeKey, { ...revokedKey, revokedAt: null }] }],
        },
      },
    });

    test('offers no third key until one is revoked', async ({ page }) => {
      await page.goto('/settings/api-clients');
      await expect(page.getByRole('button', { name: c.client.newKey })).toBeDisabled();
      await expect(page.getByText(c.keys.limit)).toBeVisible();
    });
  });

  test('revoke a key with a reason after a fresh code', async ({ page }) => {
    const revoked = await answer(
      page,
      'POST',
      `/api-clients/${hubClient.id}/keys/${activeKey.id}/revoke`,
      afterFreshCode({
        status: 200,
        json: { ...activeKey, revokedAt: '2026-11-03T09:00:00.000Z', revokeReason: 'تدوير' },
      }),
    );
    await page.goto('/settings/api-clients');
    await page.getByRole('button', { name: `${c.keys.revoke}: ${activeKey.prefix}` }).click();
    const dialog = page.getByRole('dialog', { name: c.revoke.title });
    // The contract keeps 500 characters of a revocation's reason: refused before any code.
    await dialog.getByLabel(c.revoke.reason).fill('س'.repeat(501));
    await expect(dialog.getByLabel(c.revoke.reason)).toHaveValue('س'.repeat(500));
    await dialog.getByLabel(c.revoke.reason).fill(' ');
    await dialog.getByRole('button', { name: c.revoke.confirm }).click();
    await expect(fieldError(dialog, ar.company.validation.required)).toBeVisible();
    expect(revoked).toHaveLength(0);
    await dialog.getByLabel(c.revoke.reason).fill('تدوير المفتاح (مثال)');
    await dialog.getByRole('button', { name: c.revoke.confirm }).click();
    await enterFreshCode(page);
    // The dialog is hidden from the tree while the code is asked for: wait for the second request.
    await expect.poll(() => revoked.length).toBe(2);
    await expect(dialog).toHaveCount(0);
    expect(revoked[1]?.postDataJSON()).toEqual({ reason: 'تدوير المفتاح (مثال)' });
  });

  test('edit the scopes and move a document type away after a fresh code', async ({ page }) => {
    const updated = await answer(
      page,
      'PUT',
      `/api-clients/${hubClient.id}`,
      afterFreshCode({ status: 200, json: hubClient }),
    );
    await page.goto('/settings/api-clients');
    await page.getByRole('button', { name: c.client.edit }).click();
    const form = page.getByRole('dialog', { name: c.form.editTitle });
    await form.getByRole('checkbox', { name: c.scopes['periods:read'] }).click();
    await form.getByRole('checkbox', { name: ar.inbox.documentTypes.rate }).click();
    await form.getByRole('button', { name: c.form.save }).click();
    await enterFreshCode(page);
    await expect.poll(() => updated.length).toBe(2);
    await expect(form).toHaveCount(0);
    expect(updated[1]?.postDataJSON()).toEqual({
      name: hubClient.name,
      scopes: ['events:write'],
      ipAllowList: hubClient.ipAllowList,
      documentTypes: ['invoice', 'payment', 'project_expense', 'ad_wallet_entry', 'ad_spend'],
    });
  });

  test.describe('for the auditor', () => {
    test.use({ me: withRole('auditor') });

    test('reads the clients and keys without managing them', async ({ page }) => {
      await page.goto('/settings/api-clients');
      await expect(page.getByText(c.readOnly)).toBeVisible();
      await expect(page.getByText(activeKey.prefix)).toBeVisible();
      await expect(page.getByRole('button', { name: c.form.newTitle })).toHaveCount(0);
      await expect(page.getByRole('button', { name: c.client.newKey })).toHaveCount(0);
      await expect(page.getByRole('button', { name: c.client.edit })).toHaveCount(0);
    });
  });
});

test.describe("the payments' tolerance", () => {
  test('the owner saves it per invoice currency', async ({ page }) => {
    const saved = await answer(page, 'PATCH', '/company', (request) => ({
      status: 200,
      json: { ...company, ...(request.postDataJSON() as Partial<Company>) },
    }));
    await page.goto('/settings/company');
    const t = ar.company.settings.tolerance;
    const usd = page.getByLabel(t.usd);
    await expect(usd).toHaveValue('1.00');
    await usd.fill('2.5');
    await usd.press('Tab');
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page.getByText(t.saved)).toBeVisible();
    expect(saved[0]?.postDataJSON()).toEqual({
      paymentToleranceSyp: '100',
      paymentToleranceUsd: '250',
    });
  });

  test('refuses text that is not an amount', async ({ page }) => {
    const saved = await answer(page, 'PATCH', '/company', { status: 200, json: company });
    await page.goto('/settings/company');
    const t = ar.company.settings.tolerance;
    const syp = page.getByLabel(t.syp);
    await syp.fill('-1');
    await syp.press('Tab');
    await page.getByRole('button', { name: t.submit }).click();
    await expect(fieldError(page, ar.accounting.amountInput.NEGATIVE_NOT_ALLOWED)).toBeVisible();
    expect(saved).toHaveLength(0);
  });
});
