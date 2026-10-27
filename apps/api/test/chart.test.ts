import type { INestApplication } from '@nestjs/common';
import { type Account, chartTemplate, STATEMENT_LINES } from '@vertex-mizan/contracts';
import { auditEntries, chartAccounts, type Database, withCompany } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import type { Browser } from './browser.js';
import { expectGuarded } from './guards.js';
import { joinCompany, newCompany, signedInPerson, testDatabase } from './people.js';

// The chart of accounts (S02 rules 1–7): the tree, templates, accounts and their lock, blocking,
// archiving, roles and the export, through the API as each role. All values are synthetic.

let app: INestApplication;
let db: Database;

beforeAll(async () => {
  app = await createTestApp();
  db = testDatabase();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

async function ownerWith(template: 'service-agency' | 'general' | null) {
  const owner = await signedInPerson(app, db);
  const company = await newCompany(owner.browser, { template });
  return { ...owner, company };
}

async function tree(browser: Browser, includeArchived = false): Promise<Account[]> {
  const answer = await browser.get(
    '/api/accounts',
    includeArchived ? { includeArchived: 'true' } : undefined,
  );
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body as Account[];
}

function byCode(accounts: readonly Account[], code: string): Account {
  const account = accounts.find((candidate) => candidate.code === code);
  if (!account) throw new Error(`No account ${code}`);
  return account;
}

async function actions(companyId: string): Promise<string[]> {
  const rows = await withCompany(db, companyId, (tx) =>
    tx.select({ action: auditEntries.action }).from(auditEntries),
  );
  return rows.map((row) => row.action);
}

const euroBank = (parentId: string) => ({
  parentId,
  code: '111007',
  kind: 'postable',
  name: 'الحساب المصرفي — يورو',
  statementLine: 'bs.cash',
  currency: 'EUR',
  isMonetary: true,
});

describe('the guard on every chart route', () => {
  it('answers 401, 403, COMPANY_SWITCHED and COMPANY_ARCHIVED', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/accounts' },
      { method: 'post', path: '/api/accounts' },
      { method: 'patch', path: `/api/accounts/${id}` },
      { method: 'post', path: `/api/accounts/${id}/block` },
      { method: 'post', path: `/api/accounts/${id}/unblock` },
      { method: 'post', path: `/api/accounts/${id}/archive` },
      { method: 'post', path: `/api/accounts/${id}/restore` },
      { method: 'get', path: '/api/chart/templates' },
      { method: 'post', path: '/api/chart/apply-template' },
      { method: 'get', path: '/api/chart/statement-lines' },
      { method: 'get', path: '/api/chart/export', query: { format: 'xlsx' } },
      { method: 'get', path: '/api/account-roles' },
      { method: 'put', path: '/api/account-roles' },
    ]);
  });
});

describe('templates (rule 1)', () => {
  it('applies the service-agency template at creation, with all six roles', async () => {
    const owner = await ownerWith('service-agency');
    const accounts = await tree(owner.browser);
    const template = chartTemplate('service-agency');
    expect(accounts.map((account) => account.code)).toEqual(
      template.accounts.map((account) => account.code),
    );
    const clientFunds = template.accounts.find((account) => account.requiredDimensions.length > 0);
    if (!clientFunds) throw new Error('The template requires no dimension');
    expect(byCode(accounts, clientFunds.code).requiredDimensionTypeIds).toHaveLength(
      clientFunds.requiredDimensions.length,
    );
    const roles = await owner.browser.get('/api/account-roles');
    expect(roles.body).toHaveLength(6);
    for (const { role, accountId } of roles.body) {
      const expected = template.accounts.find((account) => account.role === role);
      expect(accounts.find((account) => account.id === accountId)?.code, role).toBe(expected?.code);
    }
    expect(await actions(owner.company.id)).toContain('chart.template_applied');
  });

  it('keeps the five roots alone without a template, then applies one only to them', async () => {
    const owner = await ownerWith(null);
    expect((await tree(owner.browser)).map((account) => account.code)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    const listed = await owner.browser.get('/api/chart/templates');
    expect(listed.body).toEqual([
      expect.objectContaining({ id: 'service-agency', version: 1 }),
      expect.objectContaining({ id: 'general', version: 1 }),
    ]);
    const [first, second] = await Promise.all([
      owner.browser.post('/api/chart/apply-template', { templateId: 'general' }),
      owner.browser.post('/api/chart/apply-template', { templateId: 'service-agency' }),
    ]);
    const answers = [first, second].map((answer) => answer.body.code ?? answer.status).sort();
    expect(answers).toEqual([200, 'CHART_NOT_EMPTY']);
    const counts = [chartTemplate('general'), chartTemplate('service-agency')].map(
      (template) => template.accounts.length,
    );
    expect(counts).toContain((await tree(owner.browser)).length);
  });

  it('serves the statement-line catalogue', async () => {
    const owner = await ownerWith(null);
    const lines = await owner.browser.get('/api/chart/statement-lines');
    expect(lines.body).toEqual(STATEMENT_LINES);
  });
});

describe('POST /api/accounts (rule 2)', () => {
  it('adds an account under a header; a misfit or used code is refused', async () => {
    const owner = await ownerWith('service-agency');
    const cash = byCode(await tree(owner.browser), '111');
    const created = await owner.browser.post('/api/accounts', euroBank(cash.id));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      code: '111007',
      level: 4,
      class: 'asset',
      normalBalance: 'debit',
      currency: 'EUR',
    });
    const misfit = await owner.browser.post('/api/accounts', {
      ...euroBank(cash.id),
      code: '1110071',
    });
    expect(misfit.body.code).toBe('ACCOUNT_CODE_INVALID');
    expect(
      (await owner.browser.post('/api/accounts', { ...euroBank(cash.id), code: '112001' })).body
        .code,
    ).toBe('ACCOUNT_CODE_INVALID');
    expect((await owner.browser.post('/api/accounts', euroBank(cash.id))).body.code).toBe(
      'ACCOUNT_CODE_TAKEN',
    );
    const under = await owner.browser.post('/api/accounts', {
      ...euroBank(created.body.id),
      code: '111008',
    });
    expect(under.body.code).toBe('ACCOUNT_CODE_INVALID');
    expect(await actions(owner.company.id)).toContain('account.created');
  });

  it('refuses a child of a postable account, a misfit statement line and a header with flags', async () => {
    const owner = await ownerWith(null);
    const assets = byCode(await tree(owner.browser), '1');
    const header = await owner.browser.post('/api/accounts', {
      parentId: assets.id,
      code: '11',
      kind: 'header',
      name: 'الأصول المتداولة',
    });
    expect(header.status).toBe(201);
    const leaf = await owner.browser.post('/api/accounts', {
      parentId: header.body.id,
      code: '111',
      kind: 'postable',
      name: 'الصندوق',
      statementLine: 'bs.cash',
    });
    expect(leaf.status).toBe(201);
    const child = await owner.browser.post('/api/accounts', {
      parentId: leaf.body.id,
      code: '111001',
      kind: 'postable',
      name: 'فرعي',
      statementLine: 'bs.cash',
    });
    expect(child.body.code).toBe('ACCOUNT_NOT_HEADER');
    const wrongLine = await owner.browser.post('/api/accounts', {
      parentId: header.body.id,
      code: '112',
      kind: 'postable',
      name: 'ذمم',
      statementLine: 'is.revenue',
    });
    expect(wrongLine.body.code).toBe('STATEMENT_LINE_INVALID');
    const flagged = await owner.browser.post('/api/accounts', {
      parentId: header.body.id,
      code: '113',
      kind: 'header',
      name: 'رئيسي',
      isMonetary: true,
    });
    expect(flagged.body.code).toBe('VALIDATION_FAILED');
  });

  it("answers another company's parent as unknown; one code at once for two accountants", async () => {
    const owner = await ownerWith('service-agency');
    const stranger = await ownerWith('service-agency');
    const theirCash = byCode(await tree(stranger.browser), '111');
    const foreign = await owner.browser.post('/api/accounts', euroBank(theirCash.id));
    expect(foreign.body.code).toBe('NOT_FOUND');
    expect((await tree(stranger.browser)).some((account) => account.code === '111007')).toBe(false);

    const accountant = await joinCompany(app, db, owner.company.id, 'accountant');
    const cash = byCode(await tree(owner.browser), '111');
    const answers = await Promise.all([
      owner.browser.post('/api/accounts', euroBank(cash.id)),
      accountant.browser.post('/api/accounts', euroBank(cash.id)),
    ]);
    expect(
      answers.map((answer) => (answer.status === 201 ? 201 : answer.body.code)).sort(),
    ).toEqual([201, 'ACCOUNT_CODE_TAKEN']);
  });
});

describe('PATCH /api/accounts/:id (rules 3–4)', () => {
  it('changes an unused leaf freely, moves it with its code, and locks it after first use', async () => {
    const owner = await ownerWith('service-agency');
    const accounts = await tree(owner.browser);
    const created = await owner.browser.post('/api/accounts', euroBank(byCode(accounts, '111').id));
    const id = created.body.id as string;
    const renamed = await owner.browser.patch(`/api/accounts/${id}`, {
      name: 'المصرف — يورو',
      isControl: true,
    });
    expect(renamed.body).toMatchObject({ name: 'المصرف — يورو', isControl: true });
    const receivables = byCode(accounts, '112');
    const moved = await owner.browser.patch(`/api/accounts/${id}`, {
      parentId: receivables.id,
      code: '112009',
      statementLine: 'bs.trade_receivables',
    });
    expect(moved.body).toMatchObject({ code: '112009', parentId: receivables.id });
    expect((await owner.browser.patch(`/api/accounts/${id}`, { code: '111009' })).body.code).toBe(
      'ACCOUNT_CODE_INVALID',
    );

    await withCompany(db, owner.company.id, (tx) =>
      tx.update(chartAccounts).set({ firstPostedAt: new Date() }).where(eq(chartAccounts.id, id)),
    );
    const locked = await owner.browser.patch(`/api/accounts/${id}`, { currency: 'USD' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    const kept = await owner.browser.patch(`/api/accounts/${id}`, {
      name: 'اسم بعد الاستخدام',
      statementLine: 'bs.other_current_assets',
    });
    expect(kept.status).toBe(200);
    expect(kept.body.statementLine).toBe('bs.other_current_assets');
    expect(await actions(owner.company.id)).toContain('account.updated');
  });

  it('only renames a root; a header with children never becomes postable', async () => {
    const owner = await ownerWith('service-agency');
    const accounts = await tree(owner.browser);
    const root = byCode(accounts, '1');
    expect((await owner.browser.patch(`/api/accounts/${root.id}`, { name: 'أصول' })).status).toBe(
      200,
    );
    expect(
      (await owner.browser.patch(`/api/accounts/${root.id}`, { normalBalance: 'credit' })).body
        .code,
    ).toBe('ACCOUNT_LOCKED');
    const header = byCode(accounts, '111');
    const postable = await owner.browser.patch(`/api/accounts/${header.id}`, {
      kind: 'postable',
      statementLine: 'bs.cash',
    });
    expect(postable.body.code).toBe('ACCOUNT_HAS_CHILDREN');
  });

  it('refuses a change that leaves a role on an account it no longer fits', async () => {
    const owner = await ownerWith('service-agency');
    const roles = (await owner.browser.get('/api/account-roles')).body as {
      role: string;
      accountId: string;
    }[];
    const gain = roles.find((role) => role.role === 'fx_realised_gain');
    const expenses = (await tree(owner.browser)).find(
      (account) => account.class === 'expense' && account.level === 2,
    );
    if (!gain || !expenses) throw new Error('No gain role or expense header');
    const answer = await owner.browser.patch(`/api/accounts/${gain.accountId}`, {
      parentId: expenses.id,
      code: `${expenses.code}9`,
      statementLine: 'is.other_expenses',
    });
    expect(answer.body.code).toBe('ACCOUNT_ROLE_INVALID');
  });
});

describe('block, archive and restore (rules 5–6)', () => {
  it('blocks, archives with a reason, hides and restores an account', async () => {
    const owner = await ownerWith('service-agency');
    const created = await owner.browser.post(
      '/api/accounts',
      euroBank(byCode(await tree(owner.browser), '111').id),
    );
    const id = created.body.id as string;
    expect((await owner.browser.post(`/api/accounts/${id}/block`, {})).body.code).toBe(
      'VALIDATION_FAILED',
    );
    const blocked = await owner.browser.post(`/api/accounts/${id}/block`, { reason: 'مراجعة' });
    expect(blocked.status).toBe(200);
    expect(blocked.body.blocked).toMatchObject({ reason: 'مراجعة' });
    const archived = await owner.browser.post(`/api/accounts/${id}/archive`, {
      reason: 'أُغلق الحساب',
    });
    expect(archived.body.archived).toMatchObject({ reason: 'أُغلق الحساب' });
    expect((await tree(owner.browser)).some((account) => account.id === id)).toBe(false);
    expect((await tree(owner.browser, true)).some((account) => account.id === id)).toBe(true);
    const restored = await owner.browser.post(`/api/accounts/${id}/restore`, { reason: 'خطأ' });
    expect(restored.body.archived).toBeNull();
    const unblocked = await owner.browser.post(`/api/accounts/${id}/unblock`);
    expect(unblocked.body.blocked).toBeNull();
    const log = await actions(owner.company.id);
    for (const action of [
      'account.blocked',
      'account.archived',
      'account.restored',
      'account.unblocked',
    ]) {
      expect(log).toContain(action);
    }
  });

  it('refuses a header, a role account, an account with children and a root', async () => {
    const owner = await ownerWith('service-agency');
    const accounts = await tree(owner.browser);
    const header = byCode(accounts, '111');
    expect(
      (await owner.browser.post(`/api/accounts/${header.id}/block`, { reason: 'س' })).body.code,
    ).toBe('ACCOUNT_NOT_POSTABLE');
    expect(
      (await owner.browser.post(`/api/accounts/${header.id}/archive`, { reason: 'س' })).body.code,
    ).toBe('ACCOUNT_HAS_CHILDREN');
    const roleAccount = accounts.find((account) => account.roles.length > 0);
    if (!roleAccount) throw new Error('No role account');
    for (const action of ['block', 'archive']) {
      const answer = await owner.browser.post(`/api/accounts/${roleAccount.id}/${action}`, {
        reason: 'س',
      });
      expect(answer.body.code, action).toBe('ACCOUNT_IN_ROLE');
    }
    const root = byCode(accounts, '5');
    expect(
      (await owner.browser.post(`/api/accounts/${root.id}/archive`, { reason: 'س' })).body.code,
    ).toBe('ACCOUNT_LOCKED');
  });

  it("answers another company's account as unknown, and changes nothing", async () => {
    const owner = await ownerWith('service-agency');
    const stranger = await ownerWith('service-agency');
    const theirs = byCode(await tree(stranger.browser), '111001');
    for (const action of ['block', 'archive']) {
      const answer = await owner.browser.post(`/api/accounts/${theirs.id}/${action}`, {
        reason: 'س',
      });
      expect(answer.body.code, action).toBe('NOT_FOUND');
    }
    expect((await owner.browser.patch(`/api/accounts/${theirs.id}`, { name: 'س' })).status).toBe(
      404,
    );
    expect(byCode(await tree(stranger.browser), '111001')).toEqual(theirs);
  });
});

describe("another company's ids on every account route", () => {
  it('answer NOT_FOUND and change nothing', async () => {
    const owner = await ownerWith('service-agency');
    const stranger = await ownerWith('service-agency');
    const theirs = await tree(stranger.browser);
    const theirAccount = byCode(theirs, '111001');
    const theirHeader = byCode(theirs, '112');
    const theirRoles = (await stranger.browser.get('/api/account-roles')).body;
    const theirGain = theirs.find((account) => account.roles.includes('fx_realised_gain'));
    if (!theirGain) throw new Error('No gain account');
    const theirType = (await stranger.browser.get('/api/dimension-types')).body[0].id as string;
    const mine = await tree(owner.browser);
    const myCash = byCode(mine, '111');
    const created = await owner.browser.post('/api/accounts', euroBank(myCash.id));
    const id = created.body.id as string;
    const answers = [
      await owner.browser.post(`/api/accounts/${theirAccount.id}/unblock`),
      await owner.browser.post(`/api/accounts/${theirAccount.id}/restore`, { reason: 'س' }),
      await owner.browser.put('/api/account-roles', {
        role: 'fx_realised_gain',
        accountId: theirGain.id,
      }),
      await owner.browser.patch(`/api/accounts/${id}`, {
        parentId: theirHeader.id,
        code: '112009',
        statementLine: 'bs.trade_receivables',
      }),
      await owner.browser.patch(`/api/accounts/${id}`, { requiredDimensionTypeIds: [theirType] }),
      await owner.browser.post('/api/accounts', {
        ...euroBank(myCash.id),
        code: '111008',
        requiredDimensionTypeIds: [theirType],
      }),
    ];
    for (const answer of answers) expect(answer.body.code).toBe('NOT_FOUND');
    expect(await tree(stranger.browser)).toEqual(theirs);
    expect((await stranger.browser.get('/api/account-roles')).body).toEqual(theirRoles);
  });

  it('refuse a child or a restore under an archived parent, and required dimensions on a root', async () => {
    const owner = await ownerWith(null);
    const assets = byCode(await tree(owner.browser), '1');
    const header = await owner.browser.post('/api/accounts', {
      parentId: assets.id,
      code: '11',
      kind: 'header',
      name: 'متداولة',
    });
    const leaf = await owner.browser.post('/api/accounts', {
      parentId: header.body.id,
      code: '111',
      kind: 'postable',
      name: 'الصندوق',
      statementLine: 'bs.cash',
    });
    await owner.browser.post(`/api/accounts/${leaf.body.id}/archive`, { reason: 'س' });
    await owner.browser.post(`/api/accounts/${header.body.id}/archive`, { reason: 'س' });
    const under = await owner.browser.post('/api/accounts', {
      parentId: header.body.id,
      code: '112',
      kind: 'postable',
      name: 'ذمم',
      statementLine: 'bs.trade_receivables',
    });
    expect(under.body.code).toBe('ACCOUNT_ARCHIVED');
    const restore = await owner.browser.post(`/api/accounts/${leaf.body.id}/restore`, {
      reason: 'س',
    });
    expect(restore.body.code).toBe('ACCOUNT_ARCHIVED');
    const type = (await owner.browser.get('/api/dimension-types')).body[0].id as string;
    const root = await owner.browser.patch(`/api/accounts/${assets.id}`, {
      requiredDimensionTypeIds: [type],
    });
    expect(root.body.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('account roles (rule 7)', () => {
  it('moves a role to a fitting account and refuses one that does not fit', async () => {
    const owner = await ownerWith('service-agency');
    const accounts = await tree(owner.browser);
    const expense = accounts.find(
      (account) =>
        account.class === 'expense' && account.kind === 'postable' && !account.roles.length,
    );
    const revenue = accounts.find(
      (account) => account.class === 'revenue' && account.kind === 'postable',
    );
    if (!expense || !revenue) throw new Error('No expense or revenue account');
    const moved = await owner.browser.put('/api/account-roles', {
      role: 'conversion_rounding',
      accountId: expense.id,
    });
    expect(moved.status).toBe(200);
    expect(moved.body).toContainEqual({ role: 'conversion_rounding', accountId: expense.id });
    const invalid = await owner.browser.put('/api/account-roles', {
      role: 'fx_realised_loss',
      accountId: revenue.id,
    });
    expect(invalid.body.code).toBe('ACCOUNT_ROLE_INVALID');
    const header = byCode(accounts, '1');
    expect(
      (
        await owner.browser.put('/api/account-roles', {
          role: 'retained_earnings',
          accountId: header.id,
        })
      ).body.code,
    ).toBe('ACCOUNT_ROLE_INVALID');
    expect(
      (
        await owner.browser.put('/api/account-roles', {
          role: 'retained_earnings',
          accountId: uuidv7(),
        })
      ).body.code,
    ).toBe('NOT_FOUND');
    expect(await actions(owner.company.id)).toContain('account_role.set');
  });

  it('shows a missing role as null on a chart without a template', async () => {
    const owner = await ownerWith(null);
    const roles = await owner.browser.get('/api/account-roles');
    expect(roles.body).toHaveLength(6);
    expect(roles.body.every((role: { accountId: unknown }) => role.accountId === null)).toBe(true);
  });
});

describe('GET /api/chart/export', () => {
  it('answers an Arabic workbook of every account, audited, for every role', async () => {
    const owner = await ownerWith('service-agency');
    const viewer = await joinCompany(app, db, owner.company.id, 'viewer');
    const file = await viewer.browser.download('/api/chart/export', { format: 'xlsx' });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(file.body as Buffer).buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('No sheet');
    expect(sheet.views[0]?.rightToLeft).toBe(true);
    expect(sheet.getRow(1).getCell(1).value).toBe('رمز الحساب');
    const accounts = await tree(owner.browser, true);
    expect(sheet.rowCount).toBe(accounts.length + 1);
    expect(sheet.getRow(2).getCell(1).value).toBe('1');
    expect((await owner.browser.get('/api/chart/export', { format: 'pdf' })).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(await actions(owner.company.id)).toContain('export.chart');
  });
});
