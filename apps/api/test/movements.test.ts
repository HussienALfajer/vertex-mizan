import type { INestApplication } from '@nestjs/common';
import type { Database } from '@vertex-mizan/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { today } from './books.js';
import { Browser } from './browser.js';
import { expectGuarded } from './guards.js';
import { joinCompany, newCompany, signedInPerson, testDatabase } from './people.js';

// S13 (ADR 0024) through the API: a project made with its client, each movement recorded and read
// back with its book amount, the project's figures, the dashboard, the parties, the materials'
// costs, the day's rates, a cancellation, the refusals of S13 rules 3–9, a replay, the entries
// route refusing a movement's entry, the branding with its logo and the sign-in page's branding.
// Every value is synthetic.

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

/** A one-pixel PNG, made at run time. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

interface Company {
  browser: Browser;
  companyId: string;
  project: string;
  supplier: string;
  steel: string;
}

/** The company's shape (ADR 0024): a USD book at market, no parallel ledger, `contracting@1`. */
async function company(): Promise<Company> {
  const owner = await signedInPerson(app, db);
  const made = await newCompany(owner.browser, {
    template: 'contracting',
    ledgers: {
      book: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
      parallel: null,
    },
  });
  const rates = await owner.browser.post('/api/day-rates', {
    date: today(),
    rates: [
      { base: 'USD', quote: 'SYP', rate: '118.5' },
      { base: 'USD', quote: 'TRY', rate: '41' },
    ],
  });
  expect(rates.status, JSON.stringify(rates.body)).toBe(200);
  expect(rates.body.missing).toBe(false);
  const project = await owner.browser.post('/api/project-books', {
    name: 'فيلا تجريبية',
    clientName: 'عميل تجريبي',
    startDate: today(),
  });
  expect(project.status, JSON.stringify(project.body)).toBe(201);
  const supplier = await owner.browser.post('/api/parties', {
    type: 'supplier',
    name: 'مورد تجريبي',
  });
  expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
  const steel = await owner.browser.post('/api/materials', {
    code: 'STL',
    name: 'حديد تسليح',
    unit: 'طن',
  });
  expect(steel.status, JSON.stringify(steel.body)).toBe(201);
  return {
    browser: owner.browser,
    companyId: made.id,
    project: project.body.id,
    supplier: supplier.body.id,
    steel: steel.body.id,
  };
}

function movement(books: Company, kind: string, fields: Record<string, unknown> = {}) {
  return {
    requestKey: uuidv7(),
    kind,
    date: today(),
    projectId: kind === 'deposit' ? null : books.project,
    supplierId: kind === 'owed_by_us' || kind === 'debt_paid' ? books.supplier : null,
    currency: 'USD',
    description: 'حركة تجريبية',
    ...fields,
  };
}

async function record(books: Company, body: object) {
  const answer = await books.browser.post('/api/movements', body);
  expect(answer.status, JSON.stringify(answer.body)).toBe(201);
  return answer.body;
}

describe('the guard on the movement routes', () => {
  it('answers 401, COMPANY_SWITCHED, FORBIDDEN and COMPANY_ARCHIVED', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/movements' },
      { method: 'post', path: '/api/movements' },
      { method: 'post', path: `/api/movements/${id}/cancel` },
      { method: 'get', path: '/api/project-books' },
      { method: 'get', path: `/api/project-books/${id}` },
      { method: 'post', path: '/api/project-books' },
      { method: 'patch', path: `/api/project-books/${id}` },
      { method: 'get', path: '/api/parties', query: { type: 'client' } },
      { method: 'post', path: '/api/parties' },
      { method: 'get', path: '/api/material-costs' },
      { method: 'get', path: '/api/day-rates' },
      { method: 'post', path: '/api/day-rates' },
      { method: 'get', path: '/api/dashboard' },
      { method: 'get', path: '/api/company/branding' },
      { method: 'put', path: '/api/company/branding' },
      { method: 'get', path: '/api/company/branding/logo' },
      { method: 'post', path: '/api/company/branding/logo' },
    ]);
  });
});

describe('movements (S13 rules 1–9)', () => {
  it('records each kind, reads the figures and cancels a movement', async () => {
    const books = await company();
    await record(books, movement(books, 'deposit', { amountMinor: '400000' }));
    const received = await record(books, movement(books, 'received', { amountMinor: '500000' }));
    expect(received).toMatchObject({
      kind: 'received',
      number: 2,
      currency: 'USD',
      amountMinor: '500000',
      bookMinor: '500000',
      project: { id: books.project, name: 'فيلا تجريبية' },
      party: { name: 'عميل تجريبي' },
      cancellation: null,
    });
    const steel = await record(
      books,
      movement(books, 'expense', {
        material: { materialId: books.steel, quantity: '2.500', unitPrice: '820.0000' },
      }),
    );
    expect(steel).toMatchObject({
      amountMinor: '205000',
      material: { name: 'حديد تسليح', unit: 'طن', quantity: '2.500', unitPrice: '820.0000' },
    });
    const wages = await record(books, movement(books, 'wages', { amountMinor: '120000' }));
    await record(books, movement(books, 'owed_by_us', { amountMinor: '815000' }));
    await record(books, movement(books, 'debt_paid', { amountMinor: '300000' }));
    await record(books, movement(books, 'owed_to_us', { amountMinor: '400000' }));
    await record(books, movement(books, 'debt_collected', { amountMinor: '150000' }));

    const project = await books.browser.get(`/api/project-books/${books.project}`);
    expect(project.status, JSON.stringify(project.body)).toBe(200);
    expect(project.body.figures).toEqual({
      bookCurrency: 'USD',
      revenueMinor: '900000',
      costsMinor: '1140000',
      profitMinor: '-240000',
      receivedMinor: '500000',
      expensesMinor: '205000',
      wagesMinor: '120000',
      netCashMinor: '25000',
      owedByUs: [{ currency: 'USD', amountMinor: '515000', bookMinor: '515000' }],
      owedToUs: [{ currency: 'USD', amountMinor: '250000', bookMinor: '250000' }],
      movementCount: 7,
    });

    const cancelled = await books.browser.post(`/api/movements/${wages.id}/cancel`, {
      reason: 'سُجّلت خطأً',
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.cancellation).toMatchObject({ reason: 'سُجّلت خطأً', on: today() });
    const again = await books.browser.post(`/api/movements/${wages.id}/cancel`, {
      reason: 'مرة ثانية',
    });
    expect(again.body.code).toBe('ENTRY_ALREADY_REVERSED');
    // Rule 8: the entries route never reverses a movement's entry.
    const reversed = await books.browser.post(`/api/entries/${received.entryId}/reverse`, {
      date: today(),
      description: 'عكس مباشر',
    });
    expect(reversed.body.code).toBe('ENTRY_NOT_REVERSIBLE');

    const list = await books.browser.get('/api/movements', { project: books.project });
    expect(list.status).toBe(200);
    expect(list.body.movements).toHaveLength(7);
    const dashboard = await books.browser.get('/api/dashboard');
    expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200);
    expect(dashboard.body.figures.wagesMinor).toBe('0');
    expect(dashboard.body.rates.missing).toBe(false);
    expect(dashboard.body.boxes).toContainEqual({
      currency: 'USD',
      // 4,000.00 + 250.00, and the cancelled wages back
      amountMinor: '545000',
      bookMinor: '545000',
    });
    const costs = await books.browser.get('/api/material-costs', { project: books.project });
    expect(costs.body.materials[0]).toMatchObject({ quantity: '2.500', bookMinor: '205000' });
    const clients = await books.browser.get('/api/parties', { type: 'client' });
    expect(clients.body[0].owedToUs).toEqual([
      { currency: 'USD', amountMinor: '250000', bookMinor: '250000' },
    ]);
  });

  it('answers a replay with its first movement and refuses rule 3, 7 and 9', async () => {
    const books = await company();
    const input = movement(books, 'owed_to_us', { amountMinor: '1000' });
    const first = await record(books, input);
    const replay = await books.browser.post('/api/movements', input);
    expect(replay.body.id).toBe(first.id);
    const conflict = await books.browser.post('/api/movements', { ...input, amountMinor: '2000' });
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    const owes = await books.browser.post(
      '/api/movements',
      movement(books, 'received', { currency: 'SYP', amountMinor: '118500' }),
    );
    expect(owes.body.code).toBe('CLIENT_HAS_OPEN_DEBT');
    const future = await books.browser.post(
      '/api/movements',
      movement(books, 'owed_to_us', { amountMinor: '1000', date: '2099-01-01' }),
    );
    expect(future.body.code).toBe('ENTRY_DATE_OUT_OF_RANGE');
    const finished = await books.browser.patch(`/api/project-books/${books.project}`, {
      state: 'finished',
    });
    expect(finished.body.state).toBe('finished');
    const refused = await books.browser.post(
      '/api/movements',
      movement(books, 'owed_to_us', { amountMinor: '1000' }),
    );
    expect(refused.body.code).toBe('PROJECT_FINISHED');
  });

  it("never reads or writes another company's projects or movements", async () => {
    const mine = await company();
    const movementOfMine = await record(mine, movement(mine, 'deposit', { amountMinor: '1000' }));
    const other = await company();
    const read = await other.browser.get(`/api/project-books/${mine.project}`);
    expect(read.body.code).toBe('NOT_FOUND');
    const patched = await other.browser.patch(`/api/project-books/${mine.project}`, {
      state: 'finished',
    });
    expect(patched.body.code).toBe('NOT_FOUND');
    const recorded = await other.browser.post(
      '/api/movements',
      movement(mine, 'owed_to_us', { amountMinor: '1000' }),
    );
    expect(recorded.body.code).toBe('NOT_FOUND');
    const supplier = await other.browser.post('/api/movements', {
      ...movement(other, 'owed_by_us', { amountMinor: '1000' }),
      supplierId: mine.supplier,
    });
    expect(supplier.body.code).toBe('NOT_FOUND');
    const material = await other.browser.post(
      '/api/movements',
      movement(other, 'expense', {
        material: { materialId: mine.steel, quantity: '1.000', unitPrice: '1.0000' },
      }),
    );
    expect(material.body.code).toBe('MATERIAL_REQUIRED');
    const cancelled = await other.browser.post(`/api/movements/${movementOfMine.id}/cancel`, {
      reason: 'إلغاء',
    });
    expect(cancelled.body.code).toBe('NOT_FOUND');
    const listed = await other.browser.get('/api/movements', { project: mine.project });
    expect(listed.body.movements).toEqual([]);
    const malformed = await other.browser.get('/api/movements', { cursor: 'x_y' });
    expect(malformed.body.code).toBe('VALIDATION_FAILED');
  });

  it('lets a viewer read and nothing more', async () => {
    const books = await company();
    const viewer = await joinCompany(app, db, books.companyId, 'viewer');
    expect((await viewer.browser.get('/api/dashboard')).status).toBe(200);
    const write = await viewer.browser.post(
      '/api/movements',
      movement(books, 'deposit', { amountMinor: '1000' }),
    );
    expect(write.body.code).toBe('FORBIDDEN');
  });
});

describe('branding (S13 "Data")', () => {
  it('keeps the display name and a PNG logo, and refuses another file', async () => {
    const books = await company();
    const named = await books.browser.put('/api/company/branding', { displayName: 'شركة تجريبية' });
    expect(named.body).toEqual({ displayName: 'شركة تجريبية', hasLogo: false, logoVersion: null });
    const logo = await books.browser.upload('/api/company/branding/logo', PNG, 'logo.png');
    expect(logo.status, JSON.stringify(logo.body)).toBe(200);
    expect(logo.body.hasLogo).toBe(true);
    const served = await books.browser.download('/api/company/branding/logo');
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
    const text = await books.browser.upload(
      '/api/company/branding/logo',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'logo.svg',
    );
    expect(text.body.code).toBe('ATTACHMENT_TYPE');
    const large = await books.browser.upload(
      '/api/company/branding/logo',
      Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]),
      'large.png',
    );
    expect(large.body.code).toBe('ATTACHMENT_TOO_LARGE');
  });

  it("shows the sign-in page the setting's company only, and nothing without it", async () => {
    const stranger = new Browser(app);
    expect((await stranger.get('/api/branding/public')).body).toEqual({
      displayName: '',
      hasLogo: false,
      logoVersion: null,
    });
    const books = await company();
    await books.browser.put('/api/company/branding', { displayName: 'شركة تجريبية' });
    const named = await createTestApp({ signInCompanyId: books.companyId });
    try {
      const visitor = new Browser(named);
      const answer = await visitor.get('/api/branding/public', { companyId: uuidv7() });
      expect(answer.body).toEqual({
        displayName: 'شركة تجريبية',
        hasLogo: false,
        logoVersion: null,
      });
      expect((await visitor.download('/api/branding/public/logo')).status).toBe(404);
    } finally {
      await named.close();
    }
  });
});
