import type { INestApplication } from '@nestjs/common';
import type { DimensionType } from '@vertex-mizan/contracts';
import { auditEntries, type Database, dimensionValues, withCompany } from '@vertex-mizan/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import type { Browser } from './browser.js';
import { expectGuarded } from './guards.js';
import { joinCompany, newCompany, signedInPerson, testDatabase } from './people.js';

// Dimension types and values (S02 rules 9–13) through the API. All names and Hub IDs are synthetic.

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

async function owner(template: 'service-agency' | null = null) {
  const person = await signedInPerson(app, db);
  const company = await newCompany(person.browser, { template });
  return { ...person, company };
}

async function typeByCode(browser: Browser, code: string): Promise<DimensionType> {
  const types = (await browser.get('/api/dimension-types')).body as DimensionType[];
  const type = types.find((candidate) => candidate.code === code);
  if (!type) throw new Error(`No type ${code}`);
  return type;
}

async function actions(companyId: string): Promise<string[]> {
  const rows = await withCompany(db, companyId, (tx) =>
    tx.select({ action: auditEntries.action }).from(auditEntries),
  );
  return rows.map((row) => row.action);
}

describe('the guard on every dimension route', () => {
  it('answers 401, 403, COMPANY_SWITCHED and COMPANY_ARCHIVED', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/dimension-types' },
      { method: 'post', path: '/api/dimension-types' },
      { method: 'patch', path: `/api/dimension-types/${id}` },
      { method: 'post', path: `/api/dimension-types/${id}/archive` },
      { method: 'post', path: `/api/dimension-types/${id}/restore` },
      { method: 'get', path: '/api/dimension-values', query: { typeId: id } },
      { method: 'post', path: '/api/dimension-values' },
      { method: 'patch', path: `/api/dimension-values/${id}` },
      { method: 'post', path: `/api/dimension-values/${id}/link` },
      { method: 'post', path: `/api/dimension-values/${id}/archive` },
      { method: 'post', path: `/api/dimension-values/${id}/restore` },
    ]);
  });
});

describe('dimension types (rule 9)', () => {
  it('lists the four built-in types, adds custom ones up to ten, and archives them', async () => {
    const { browser, company } = await owner();
    const types = (await browser.get('/api/dimension-types')).body as DimensionType[];
    expect(types.map((type) => type.code)).toEqual(['client', 'contract', 'department', 'service']);
    const client = types[0] as DimensionType;
    expect(types[1]?.parentTypeId).toBe(client.id);

    const created = await browser.post('/api/dimension-types', {
      code: 'cost_centre',
      name: 'مركز التكلفة',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ builtin: false, position: 5, parentTypeId: null });
    expect(
      (await browser.post('/api/dimension-types', { code: 'cost_centre', name: 'مكرر' })).body.code,
    ).toBe('DIMENSION_CODE_TAKEN');
    for (const code of ['extra_a', 'extra_b', 'extra_c', 'extra_d', 'extra_e']) {
      expect((await browser.post('/api/dimension-types', { code, name: 'نوع' })).status).toBe(201);
    }
    const eleventh = await browser.post('/api/dimension-types', { code: 'extra_f', name: 'نوع' });
    expect(eleventh.body.code).toBe('DIMENSION_TYPE_LIMIT');

    const renamed = await browser.patch(`/api/dimension-types/${created.body.id}`, {
      name: 'مركز كلفة',
    });
    expect(renamed.body.name).toBe('مركز كلفة');
    const archived = await browser.post(`/api/dimension-types/${created.body.id}/archive`);
    expect(archived.body.archivedAt).not.toBeNull();
    expect(
      (await browser.post('/api/dimension-types', { code: 'extra_f', name: 'نوع' })).status,
    ).toBe(201);
    expect((await browser.post(`/api/dimension-types/${created.body.id}/restore`)).body.code).toBe(
      'DIMENSION_TYPE_LIMIT',
    );
    expect((await browser.post(`/api/dimension-types/${client.id}/archive`)).body.code).toBe(
      'DIMENSION_TYPE_IN_USE',
    );
    const log = await actions(company.id);
    for (const action of [
      'dimension_type.created',
      'dimension_type.updated',
      'dimension_type.archived',
    ]) {
      expect(log).toContain(action);
    }
  });

  it('keeps a type an account requires', async () => {
    const { browser } = await owner();
    const type = await browser.post('/api/dimension-types', { code: 'project_site', name: 'موقع' });
    const accounts = (await browser.get('/api/accounts')).body as { id: string; code: string }[];
    const assets = accounts.find((account) => account.code === '1');
    const header = await browser.post('/api/accounts', {
      parentId: assets?.id,
      code: '11',
      kind: 'header',
      name: 'متداولة',
    });
    const leaf = await browser.post('/api/accounts', {
      parentId: header.body.id,
      code: '111',
      kind: 'postable',
      name: 'الصندوق',
      statementLine: 'bs.cash',
      requiredDimensionTypeIds: [type.body.id],
    });
    expect(leaf.status, JSON.stringify(leaf.body)).toBe(201);
    expect((await browser.post(`/api/dimension-types/${type.body.id}/archive`)).body.code).toBe(
      'DIMENSION_TYPE_IN_USE',
    );
  });
});

describe('dimension values (rules 10–13)', () => {
  it('adds a manual client, links it to a Hub ID once, and a project under it', async () => {
    const { browser, company } = await owner();
    const client = await typeByCode(browser, 'client');
    const contract = await typeByCode(browser, 'contract');
    const added = await browser.post('/api/dimension-values', {
      typeId: client.id,
      name: 'عميل تجريبي',
      code: 'C-1',
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ externalSource: null, externalId: null });
    const hubId = uuidv7();
    const linked = await browser.post(`/api/dimension-values/${added.body.id}/link`, {
      externalId: hubId,
    });
    expect(linked.body).toMatchObject({ externalSource: 'hub', externalId: hubId });
    const again = await browser.post(`/api/dimension-values/${added.body.id}/link`, {
      externalId: uuidv7(),
    });
    expect(again.body.code).toBe('DIMENSION_ALREADY_LINKED');
    const other = await browser.post('/api/dimension-values', {
      typeId: client.id,
      name: 'عميل آخر',
    });
    expect(
      (await browser.post(`/api/dimension-values/${other.body.id}/link`, { externalId: hubId }))
        .body.code,
    ).toBe('DIMENSION_LINK_TAKEN');

    const project = await browser.post('/api/dimension-values', {
      typeId: contract.id,
      name: 'مشروع تجريبي',
      contractKind: 'project',
      parentValueId: added.body.id,
    });
    expect(project.status).toBe(201);
    expect(project.body).toMatchObject({
      contractKind: 'project',
      parentValueId: added.body.id,
      parentName: added.body.name,
    });
    // A page names each contract's client, whichever page the client sits on.
    const contracts = await browser.get(`/api/dimension-values?typeId=${contract.id}`);
    expect(contracts.body.values).toContainEqual(
      expect.objectContaining({ id: project.body.id, parentName: added.body.name }),
    );
    expect(added.body.parentName).toBeNull();
    const noKind = await browser.post('/api/dimension-values', {
      typeId: contract.id,
      name: 'عقد بلا نوع',
    });
    expect(noKind.body.code).toBe('VALIDATION_FAILED');
    const wrongParent = await browser.post('/api/dimension-values', {
      typeId: contract.id,
      name: 'عقد',
      contractKind: 'retainer',
      parentValueId: project.body.id,
    });
    expect(wrongParent.body.code).toBe('DIMENSION_PARENT_MISMATCH');
    const clientWithParent = await browser.post('/api/dimension-values', {
      typeId: client.id,
      name: 'عميل',
      parentValueId: added.body.id,
    });
    expect(clientWithParent.body.code).toBe('DIMENSION_PARENT_MISMATCH');
    expect(
      (await browser.post('/api/dimension-values', { typeId: client.id, name: 'م', code: 'C-1' }))
        .body.code,
    ).toBe('DIMENSION_CODE_TAKEN');
    const log = await actions(company.id);
    expect(log).toContain('dimension_value.created');
    expect(log).toContain('dimension_value.linked');
  });

  it('a manual contract without a client is linked only once it names one', async () => {
    const { browser } = await owner();
    const client = await typeByCode(browser, 'client');
    const contract = await typeByCode(browser, 'contract');
    const retainer = await browser.post('/api/dimension-values', {
      typeId: contract.id,
      name: 'اشتراك',
      contractKind: 'retainer',
    });
    expect(
      (
        await browser.post(`/api/dimension-values/${retainer.body.id}/link`, {
          externalId: uuidv7(),
        })
      ).body.code,
    ).toBe('VALIDATION_FAILED');
    const theClient = await browser.post('/api/dimension-values', {
      typeId: client.id,
      name: 'عميل الاشتراك',
    });
    const named = await browser.patch(`/api/dimension-values/${retainer.body.id}`, {
      parentValueId: theClient.body.id,
    });
    expect(named.body.parentValueId).toBe(theClient.body.id);
    const linked = await browser.post(`/api/dimension-values/${retainer.body.id}/link`, {
      externalId: uuidv7(),
    });
    expect(linked.status).toBe(200);
    expect(
      (await browser.patch(`/api/dimension-values/${retainer.body.id}`, { parentValueId: null }))
        .body.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('searches by code or name, pages, renames, archives and restores', async () => {
    const { browser, company } = await owner();
    const service = await typeByCode(browser, 'service');
    for (let index = 0; index < 105; index += 1) {
      await withCompany(db, company.id, (tx) =>
        tx.insert(dimensionValues).values({
          companyId: company.id,
          typeId: service.id,
          name: `خدمة ${index}`,
          code: `S-${index}`,
        }),
      );
    }
    const first = await browser.get('/api/dimension-values', { typeId: service.id });
    expect(first.body.values).toHaveLength(100);
    const second = await browser.get('/api/dimension-values', {
      typeId: service.id,
      cursor: first.body.nextCursor,
    });
    expect(second.body.values).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();
    const found = await browser.get('/api/dimension-values', { typeId: service.id, q: 's-10' });
    expect(found.body.values.map((value: { code: string }) => value.code).sort()).toEqual([
      'S-10',
      'S-100',
      'S-101',
      'S-102',
      'S-103',
      'S-104',
    ]);
    const percent = await browser.get('/api/dimension-values', { typeId: service.id, q: '%' });
    expect(percent.body.values).toEqual([]);
    const target = found.body.values[0];
    const renamed = await browser.patch(`/api/dimension-values/${target.id}`, {
      name: 'خدمة جديدة',
    });
    expect(renamed.body.name).toBe('خدمة جديدة');
    const archived = await browser.post(`/api/dimension-values/${target.id}/archive`);
    expect(archived.body.archivedAt).not.toBeNull();
    const hidden = await browser.get('/api/dimension-values', { typeId: service.id, q: 'جديدة' });
    expect(hidden.body.values).toEqual([]);
    const shown = await browser.get('/api/dimension-values', {
      typeId: service.id,
      q: 'جديدة',
      includeArchived: 'true',
    });
    expect(shown.body.values).toHaveLength(1);
    const restored = await browser.post(`/api/dimension-values/${target.id}/restore`);
    expect(restored.body.archivedAt).toBeNull();
    const log = await actions(company.id);
    for (const action of [
      'dimension_value.updated',
      'dimension_value.archived',
      'dimension_value.restored',
    ]) {
      expect(log).toContain(action);
    }
  });

  it("answers another company's type and value as unknown, and changes nothing", async () => {
    const mine = await owner();
    const theirs = await owner();
    const theirClient = await typeByCode(theirs.browser, 'client');
    const value = await theirs.browser.post('/api/dimension-values', {
      typeId: theirClient.id,
      name: 'عميلهم',
    });
    expect(
      (await mine.browser.get('/api/dimension-values', { typeId: theirClient.id })).body.code,
    ).toBe('NOT_FOUND');
    expect(
      (await mine.browser.post('/api/dimension-values', { typeId: theirClient.id, name: 'س' })).body
        .code,
    ).toBe('NOT_FOUND');
    for (const action of ['archive', 'link']) {
      const answer = await mine.browser.post(`/api/dimension-values/${value.body.id}/${action}`, {
        externalId: uuidv7(),
      });
      expect(answer.body.code, action).toBe('NOT_FOUND');
    }
    expect(
      (await mine.browser.patch(`/api/dimension-types/${theirClient.id}`, { name: 'س' })).body.code,
    ).toBe('NOT_FOUND');
    const after = await theirs.browser.get('/api/dimension-values', { typeId: theirClient.id });
    expect(after.body.values).toEqual([value.body]);
  });

  it("answers another company's ids on the other routes as unknown", async () => {
    const mine = await owner();
    const theirs = await owner();
    const theirClient = await typeByCode(theirs.browser, 'client');
    const theirValue = await theirs.browser.post('/api/dimension-values', {
      typeId: theirClient.id,
      name: 'عميلهم',
    });
    const custom = await theirs.browser.post('/api/dimension-types', {
      code: 'their_type',
      name: 'نوعهم',
    });
    const myContract = await typeByCode(mine.browser, 'contract');
    const myClient = await typeByCode(mine.browser, 'client');
    const myContractValue = await mine.browser.post('/api/dimension-values', {
      typeId: myContract.id,
      name: 'عقدي',
      contractKind: 'project',
    });
    const answers = [
      await mine.browser.post(`/api/dimension-types/${custom.body.id}/archive`),
      await mine.browser.post(`/api/dimension-types/${custom.body.id}/restore`),
      await mine.browser.patch(`/api/dimension-values/${theirValue.body.id}`, { name: 'س' }),
      await mine.browser.post(`/api/dimension-values/${theirValue.body.id}/restore`),
      await mine.browser.post('/api/dimension-values', {
        typeId: myContract.id,
        name: 'عقد',
        contractKind: 'retainer',
        parentValueId: theirValue.body.id,
      }),
      await mine.browser.patch(`/api/dimension-values/${myContractValue.body.id}`, {
        parentValueId: theirValue.body.id,
      }),
    ];
    for (const answer of answers) expect(answer.body.code).toBe('NOT_FOUND');
    expect((await theirs.browser.get('/api/dimension-types')).body).toContainEqual(custom.body);
    const after = await theirs.browser.get('/api/dimension-values', { typeId: theirClient.id });
    expect(after.body.values).toEqual([theirValue.body]);
    expect(myClient.id).not.toBe(theirClient.id);
  });

  it('gives one Hub ID to one value when two links claim it at once (edge case 2)', async () => {
    const { browser } = await owner();
    const client = await typeByCode(browser, 'client');
    const values = await Promise.all(
      ['أ', 'ب'].map((name) => browser.post('/api/dimension-values', { typeId: client.id, name })),
    );
    const hubId = uuidv7();
    const answers = await Promise.all(
      values.map((value) =>
        browser.post(`/api/dimension-values/${value.body.id}/link`, { externalId: hubId }),
      ),
    );
    expect(
      answers.map((answer) => (answer.status === 200 ? 200 : answer.body.code)).sort(),
    ).toEqual([200, 'DIMENSION_LINK_TAKEN']);
  });

  it('lets every role read and only the owner and accountant write', async () => {
    const { browser, company } = await owner();
    const client = await typeByCode(browser, 'client');
    const auditor = await joinCompany(app, db, company.id, 'auditor');
    expect((await auditor.browser.get('/api/dimension-types')).status).toBe(200);
    expect(
      (await auditor.browser.post('/api/dimension-values', { typeId: client.id, name: 'س' })).body
        .code,
    ).toBe('FORBIDDEN');
    const accountant = await joinCompany(app, db, company.id, 'accountant');
    expect(
      (await accountant.browser.post('/api/dimension-values', { typeId: client.id, name: 'س' }))
        .status,
    ).toBe(201);
  });
});
