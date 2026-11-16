import type { INestApplication } from '@nestjs/common';
import type { Account, DimensionType } from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { today } from './books.js';
import type { Browser } from './browser.js';
import { expectGuarded } from './guards.js';
import { joinCompany, newCompany, signedInPerson, testDatabase } from './people.js';

// S12 PR 1 through the API: the materials catalogue, a project's terms and budget, subcontracts,
// a project purchase invoice and a wage sheet saved, previewed and posted as drafts, the register
// of documents, rule 4 on a manual draft, and each route as a viewer, as another company's member
// and without a session. Every value is synthetic.

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

interface Contractor {
  browser: Browser;
  companyId: string;
  accounts: Map<string, string>;
  project: string;
  supplier: string;
  worker: string;
  cement: string;
}

/** `contracting@1` in the client's shape with today's rates, a project, a supplier and cement. */
async function contractor(): Promise<Contractor> {
  const owner = await signedInPerson(app, db);
  const company = await newCompany(owner.browser, {
    template: 'contracting',
    ledgers: {
      book: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
      parallel: {
        currency: 'SYP',
        ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
      },
    },
  });
  const { browser } = owner;
  expect((await browser.put('/api/rate-calendar', { daysOff: [] })).status).toBe(200);
  for (const [base, quote, rate, type] of [
    ['USD', 'SYP', '120.0000', 'bulletin'],
    ['TRY', 'SYP', '3.5000', 'bulletin'],
    ['USD', 'TRY', '34.0000', 'market'],
  ] as const) {
    const recorded = await browser.post('/api/rates', {
      effectiveOn: today(),
      base,
      quote,
      rate,
      type,
      source: 'manual',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
  }
  const types = (await browser.get('/api/dimension-types')).body as DimensionType[];
  const typeId = (code: string) => types.find((type) => type.code === code)?.id as string;
  const value = async (type: string, code: string, extra: object = {}) => {
    const made = await browser.post('/api/dimension-values', {
      typeId: typeId(type),
      code,
      name: code,
      ...extra,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return made.body.id as string;
  };
  const client = await value('client', 'C1');
  const project = await value('contract', 'P1', { contractKind: 'project', parentValueId: client });
  const supplier = await value('supplier', 'S1');
  const worker = await value('worker', 'W1');
  const cement = await browser.post('/api/materials', {
    code: 'CEM',
    name: 'أسمنت بورتلاندي',
    unit: 'طن',
  });
  expect(cement.status, JSON.stringify(cement.body)).toBe(201);
  const chart = (await browser.get('/api/accounts')).body as Account[];
  return {
    browser,
    companyId: company.id,
    accounts: new Map(chart.map((account) => [account.code, account.id])),
    project,
    supplier,
    worker,
    cement: cement.body.id as string,
  };
}

const purchase = (books: Contractor) => ({
  entryDate: today(),
  description: 'فاتورة مشتريات تجريبية',
  projectDocument: {
    kind: 'purchase',
    contractValueId: books.project,
    counterpartyValueId: books.supplier,
    currency: 'TRY',
    supplierReference: 'F-1024',
  },
  lines: [
    {
      accountId: books.accounts.get('511001'),
      currency: 'TRY',
      amountMinor: null,
      materialId: books.cement,
      quantity: '12.5',
      unitPrice: '3150',
    },
  ],
});

describe('the guard on the project routes', () => {
  it('answers 401 and COMPANY_SWITCHED', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/materials' },
      { method: 'get', path: `/api/projects/${id}/terms` },
      { method: 'get', path: '/api/subcontracts' },
      { method: 'get', path: '/api/project-documents' },
      { method: 'get', path: `/api/project-documents/${id}` },
    ]);
  });
});

describe('the materials catalogue, terms and subcontracts (S12 rules 1–3)', () => {
  it('keeps the catalogue, the terms and the subcontracts, to the roles that may change them', async () => {
    const books = await contractor();
    const { browser } = books;
    const listed = await browser.get('/api/materials');
    expect(listed.body.materials).toEqual([
      expect.objectContaining({ code: 'CEM', unit: 'طن', used: false }),
    ]);
    expect(
      (await browser.post('/api/materials', { code: 'CEM', name: 'x', unit: 'y' })).body.code,
    ).toBe('DIMENSION_CODE_TAKEN');
    const renamed = await browser.patch(`/api/materials/${books.cement}`, { unit: 'كيس' });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    const terms = await browser.put(`/api/projects/${books.project}/terms`, {
      currency: 'USD',
      contractValueMinor: '10000000',
      retentionBp: 1000,
      advanceRecoveryBp: 2000,
      budget: [{ accountId: books.accounts.get('511001'), amountMinor: '4000000' }],
    });
    expect(terms.status, JSON.stringify(terms.body)).toBe(200);
    expect(terms.body.terms).toMatchObject({ currency: 'USD', currencyLocked: false });
    const notDirect = await browser.put(`/api/projects/${books.project}/terms`, {
      currency: 'USD',
      contractValueMinor: '1',
      retentionBp: 0,
      advanceRecoveryBp: 0,
      budget: [{ accountId: books.accounts.get('531001'), amountMinor: '1' }],
    });
    expect(notDirect.body.code).toBe('VALIDATION_FAILED');
    const subcontract = await browser.post('/api/subcontracts', {
      contractValueId: books.project,
      supplierValueId: books.supplier,
      currency: 'TRY',
      retentionBp: 500,
      advanceRecoveryBp: 0,
    });
    expect(subcontract.status, JSON.stringify(subcontract.body)).toBe(201);
    expect((await browser.get('/api/subcontracts')).body.subcontracts).toHaveLength(1);

    const viewer = await joinCompany(app, db, books.companyId, 'viewer');
    expect((await viewer.browser.get('/api/materials')).status).toBe(200);
    expect(
      (await viewer.browser.post('/api/materials', { code: 'X', name: 'x', unit: 'y' })).status,
    ).toBe(403);
    expect(
      (await viewer.browser.put(`/api/projects/${books.project}/terms`, terms.body.terms)).status,
    ).toBe(403);

    const stranger = await contractor();
    expect((await stranger.browser.get(`/api/projects/${books.project}/terms`)).body.code).toBe(
      'NOT_FOUND',
    );
    expect(
      (await stranger.browser.patch(`/api/materials/${books.cement}`, { name: 'x' })).body.code,
    ).toBe('NOT_FOUND');
  });
});

describe('project documents as drafts (S12 rules 4–8, 10, 21)', () => {
  it('saves, previews and posts a purchase with its quantity, once, and lists it', async () => {
    const books = await contractor();
    const { browser } = books;
    const saved = await browser.post('/api/drafts', purchase(books));
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.projectDocument).toMatchObject({ kind: 'purchase', currency: 'TRY' });
    // The amount is the quantity times the unit price, computed on save (rule 6).
    expect(saved.body.lines[0]).toMatchObject({
      quantity: '12.500',
      unitPrice: '3150.0000',
      unit: 'طن',
      amountMinor: '3937500',
    });
    const preview = await browser.post(`/api/drafts/${saved.body.id}/preview`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.refusals).toEqual([]);
    expect(preview.body.projectDocument).toMatchObject({
      kind: 'purchase',
      totalMinor: '3937500',
      netMinor: '3937500',
      warnings: [],
    });
    expect(preview.body.lines.map((line: { accountCode: string }) => line.accountCode)).toEqual([
      '511001',
      '211001',
    ]);
    expect(preview.body.lines[0].quantity).toMatchObject({ quantity: '12.500' });
    const posted = await browser.post(`/api/drafts/${saved.body.id}/post`);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.projectDocument).toMatchObject({ kind: 'purchase', number: 1 });
    expect(posted.body.entry.projectDocument).toMatchObject({ kind: 'purchase', number: 1 });
    expect(posted.body.entry.reference).toMatch(/^فاتورة مشتريات \d{4}\/1$/);
    expect(posted.body.entry.lines[0].quantity).toMatchObject({ unit: 'طن', quantity: '12.500' });
    const again = await browser.post(`/api/drafts/${saved.body.id}/post`);
    expect(again.body.projectDocument.id).toBe(posted.body.projectDocument.id);

    const register = await browser.get('/api/project-documents', { query: { kind: 'purchase' } });
    expect(register.body.documents).toEqual([
      expect.objectContaining({ number: 1, totalMinor: '3937500', supplierReference: 'F-1024' }),
    ]);
    const detail = await browser.get(`/api/project-documents/${posted.body.projectDocument.id}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.quantities).toEqual([
      expect.objectContaining({ lineNo: 1, quantity: '12.500', unitPrice: '3150.0000' }),
    ]);
    // A second invoice with the same reference warns (rule 8); the material's unit is locked.
    const second = await browser.post('/api/drafts', purchase(books));
    const warned = await browser.post(`/api/drafts/${second.body.id}/preview`);
    expect(warned.body.projectDocument.warnings).toEqual(['duplicate_supplier_reference']);
    expect((await browser.patch(`/api/materials/${books.cement}`, { unit: 'كيس' })).body.code).toBe(
      'MATERIAL_LOCKED',
    );

    const viewer = await joinCompany(app, db, books.companyId, 'viewer');
    expect((await viewer.browser.get('/api/project-documents')).body.documents).toHaveLength(1);
    const stranger = await contractor();
    expect((await stranger.browser.get('/api/project-documents')).body.documents).toEqual([]);
    expect(
      (await stranger.browser.get(`/api/project-documents/${posted.body.projectDocument.id}`)).body
        .code,
    ).toBe('NOT_FOUND');
  });

  it('posts a wage sheet of days and refuses a kind that comes with S12’s billings', async () => {
    const books = await contractor();
    const { browser } = books;
    const on = today();
    const saved = await browser.post('/api/drafts', {
      entryDate: on,
      description: 'كشف أجور تجريبي',
      projectDocument: {
        kind: 'wage_sheet',
        contractValueId: books.project,
        currency: 'USD',
        periodFrom: `${on.slice(0, 8)}01`,
        periodTo: on,
      },
      lines: [
        {
          accountId: null,
          dimensionValueIds: [books.worker],
          currency: 'USD',
          amountMinor: null,
          unit: 'يوم',
          quantity: '6.0',
          unitPrice: '25',
        },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const posted = await browser.post(`/api/drafts/${saved.body.id}/post`);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(
      posted.body.entry.lines.map((line: { accountCode: string }) => line.accountCode),
    ).toEqual(['511002', '211007']);
    const billing = await browser.post('/api/drafts', {
      entryDate: on,
      projectDocument: {
        kind: 'progress_billing',
        contractValueId: books.project,
        cumulativeMinor: '100',
      },
    });
    expect(billing.body.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a manual line on 511001 without a material (rule 4)', async () => {
    const books = await contractor();
    const saved = await books.browser.post('/api/drafts', {
      entryDate: today(),
      description: 'قيد يدوي',
      lines: [
        {
          accountId: books.accounts.get('511001'),
          dimensionValueIds: [books.project],
          currency: 'USD',
          amountMinor: '1000',
        },
        { accountId: books.accounts.get('313001'), currency: 'USD', amountMinor: '-1000' },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const preview = await books.browser.post(`/api/drafts/${saved.body.id}/preview`);
    expect(preview.body.refusals).toEqual([
      expect.objectContaining({ code: 'MATERIAL_REQUIRED', lineNo: 1 }),
    ]);
  });

  it('sets requiresMaterial on an unused expense account and refuses it elsewhere', async () => {
    const books = await contractor();
    const set = await books.browser.patch(`/api/accounts/${books.accounts.get('511006')}`, {
      requiresMaterial: true,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.requiresMaterial).toBe(true);
    const asset = await books.browser.patch(`/api/accounts/${books.accounts.get('114001')}`, {
      requiresMaterial: true,
    });
    expect(asset.body.code).toBe('VALIDATION_FAILED');
  });
});
