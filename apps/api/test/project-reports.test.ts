import type { INestApplication } from '@nestjs/common';
import type { Account, DimensionType } from '@vertex-mizan/contracts';
import { auditEntries, type Database, withCompany } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { today } from './books.js';
import type { Browser } from './browser.js';
import { expectGuarded } from './guards.js';
import { joinCompany, newCompany, signedInPerson, testDatabase } from './people.js';

// S12 PR 3 through the API: the projects list, a project's report and the material quantities,
// their Excel exports (audited) and their PDFs queued with a document's print, as a viewer, as
// another company's member and without a session. Every value is synthetic.

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
  client: string;
  project: string;
  supplier: string;
  cement: string;
}

/** `contracting@1` in the client's shape with today's rates, a project with terms, and cement. */
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
  const cement = await browser.post('/api/materials', { code: 'CEM', name: 'أسمنت', unit: 'طن' });
  expect(cement.status, JSON.stringify(cement.body)).toBe(201);
  const chart = (await browser.get('/api/accounts')).body as Account[];
  const accounts = new Map(chart.map((account) => [account.code, account.id]));
  const terms = await browser.put(`/api/projects/${project}/terms`, {
    currency: 'USD',
    contractValueMinor: '10000000',
    retentionBp: 1000,
    advanceRecoveryBp: 2000,
    budget: [{ accountId: accounts.get('511001'), amountMinor: '4000000' }],
  });
  expect(terms.status, JSON.stringify(terms.body)).toBe(200);
  return {
    browser,
    companyId: company.id,
    accounts,
    client,
    project,
    supplier,
    cement: cement.body.id as string,
  };
}

/** S1's TRY invoice of 12.500 t of cement at 3,150.0000, posted today. */
async function purchase(books: Contractor): Promise<string> {
  const saved = await books.browser.post('/api/drafts', {
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
  expect(saved.status, JSON.stringify(saved.body)).toBe(201);
  const posted = await books.browser.post(`/api/drafts/${saved.body.id}/post`);
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  return posted.body.projectDocument.id as string;
}

const month = () => ({ from: `${today().slice(0, 8)}01`, to: today() });

async function workbookRows(body: Buffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  const rows: unknown[][] = [];
  workbook.worksheets[0]?.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1));
  });
  return rows;
}

describe('the guard on the project reports', () => {
  it('answers 401 and COMPANY_SWITCHED', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/projects' },
      { method: 'get', path: `/api/projects/${id}/report`, query: month() },
      {
        method: 'get',
        path: `/api/projects/${id}/report/export`,
        query: { ...month(), format: 'xlsx' },
      },
      { method: 'get', path: '/api/reports/material-quantities', query: month() },
      {
        method: 'get',
        path: '/api/reports/material-quantities/export',
        query: { ...month(), format: 'xlsx' },
      },
    ]);
  });
});

describe('the project reports (S12 "Reports")', () => {
  it('lists the project and reads its report and quantities, as a viewer', async () => {
    const books = await contractor();
    const document = await purchase(books);
    const viewer = await joinCompany(app, db, books.companyId, 'viewer');

    const list = await viewer.browser.get('/api/projects');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    // 39,375.00 TRY / 34 = 1,158.09 USD of direct costs; no billing yet.
    expect(list.body.projects).toEqual([
      expect.objectContaining({
        project: expect.objectContaining({ id: books.project, code: 'P1' }),
        client: expect.objectContaining({ id: books.client }),
        cumulativeMinor: '0',
        billed: '0.0',
        revenue: '0',
        directCosts: '115809',
        budgetMinor: '4000000',
      }),
    ]);

    const report = await viewer.browser.get(`/api/projects/${books.project}/report`, month());
    expect(report.status, JSON.stringify(report.body)).toBe(200);
    expect(report.body.header).toMatchObject({ ledger: 'book', currency: 'USD' });
    expect(report.body.costs.rows).toEqual([
      expect.objectContaining({
        inRange: '115809',
        toDate: '115809',
        budgetMinor: '4000000',
        variance: '3884191',
        used: '2.9',
      }),
    ]);
    expect(report.body.materials).toEqual([
      expect.objectContaining({
        currency: 'TRY',
        quantity: '12.500',
        amountMinor: '3937500',
        ledgerAmount: '115809',
        average: '3150.0000',
      }),
    ]);
    const parallel = await viewer.browser.get(`/api/projects/${books.project}/report`, {
      ...month(),
      ledger: 'parallel',
    });
    // 39,375.00 TRY × 3.5 = 137,812.50 SYP; the budget in USD shows no variance there.
    expect(parallel.body.costs.totals).toMatchObject({ inRange: '13781250', variance: null });

    const quantities = await viewer.browser.get('/api/reports/material-quantities', {
      ...month(),
      contract: books.project,
    });
    expect(quantities.status, JSON.stringify(quantities.body)).toBe(200);
    expect(quantities.body.ledgerTotal).toBe('115809');
    const lines = await viewer.browser.get('/api/reports/lines', {
      ...month(),
      statementLine: 'is.direct_costs',
      material: books.cement,
    });
    expect(lines.body.sum).toBe('115809');

    // Refusals: a value that is not a project, a range out of order.
    expect(
      (await viewer.browser.get(`/api/projects/${books.client}/report`, month())).body.code,
    ).toBe('NOT_FOUND');
    expect(
      (
        await viewer.browser.get(`/api/projects/${books.project}/report`, {
          from: today(),
          to: '2000-01-01',
        })
      ).body.code,
    ).toBe('VALIDATION_FAILED');

    // Another company sees none of it.
    const stranger = await contractor();
    expect(
      (await stranger.browser.get(`/api/projects/${books.project}/report`, month())).body.code,
    ).toBe('NOT_FOUND');
    expect(
      (await stranger.browser.get('/api/projects')).body.projects.map(
        (row: { project: { id: string } }) => row.project.id,
      ),
    ).toEqual([stranger.project]);
    expect(
      (
        await stranger.browser.get(`/api/projects/${books.project}/report/export`, {
          ...month(),
          format: 'xlsx',
        })
      ).body.code,
    ).toBe('NOT_FOUND');
    const theirs = await stranger.browser.get('/api/reports/material-quantities', {
      ...month(),
      contract: books.project,
    });
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(200);
    expect(theirs.body).toMatchObject({ rows: [], ledgerTotal: '0' });
    const theirExport = await stranger.browser.download('/api/reports/material-quantities/export', {
      ...month(),
      format: 'xlsx',
      material: books.cement,
    });
    expect(theirExport.status).toBe(200);
    expect((await workbookRows(theirExport.body as Buffer)).flat()).not.toContain('CEM');
    for (const [file, params] of [
      ['project_report', { contract: books.project, ...month() }],
      ['project_document', { document }],
    ] as const) {
      const refused = await stranger.browser.post('/api/reports/files', { report: file, params });
      expect(refused.body.code, file).toBe('NOT_FOUND');
    }
  });

  it('exports the report and the quantities to Excel, audited, and queues their PDFs and a print', async () => {
    const books = await contractor();
    const document = await purchase(books);
    const viewer = await joinCompany(app, db, books.companyId, 'viewer');

    const report = await viewer.browser.download(`/api/projects/${books.project}/report/export`, {
      ...month(),
      format: 'xlsx',
    });
    expect(report.status, String(report.body)).toBe(200);
    expect(report.headers['content-type']).toContain('spreadsheetml');
    const rows = (await workbookRows(report.body as Buffer)).flat();
    expect(rows).toContain('تقرير المشروع');
    expect(rows).toContain('المواد');
    expect(rows).toContain('12.500');
    // 1,158.09 as a number in major units.
    expect(rows).toContain(1158.09);

    const quantities = await viewer.browser.download('/api/reports/material-quantities/export', {
      ...month(),
      format: 'xlsx',
    });
    expect(quantities.status, String(quantities.body)).toBe(200);
    expect((await workbookRows(quantities.body as Buffer)).flat()).toContain('CEM');

    for (const [file, params] of [
      ['project_report', { contract: books.project, ...month() }],
      ['material_quantities', month()],
      ['project_document', { document }],
    ] as const) {
      const queued = await viewer.browser.post('/api/reports/files', { report: file, params });
      expect(queued.status, JSON.stringify(queued.body)).toBe(201);
      expect(queued.body).toMatchObject({ report: file, state: 'queued' });
    }
    const audit = await withCompany(db, books.companyId, (tx) =>
      tx
        .select({ action: auditEntries.action, after: auditEntries.after })
        .from(auditEntries)
        .where(eq(auditEntries.entityType, 'report_export')),
    );
    expect(audit.map((row) => row.action).sort()).toEqual([
      'export.material_quantities',
      'export.material_quantities',
      'export.project_document',
      'export.project_report',
      'export.project_report',
    ]);
    expect(audit.find((row) => row.action === 'export.project_report')?.after).toMatchObject({
      report: 'project_report',
      params: { contract: books.project },
    });

    // A file of a value that is not a project, or of an unknown document.
    for (const [file, params] of [
      ['project_report', { contract: books.client, ...month() }],
      ['project_document', { document: uuidv7() }],
    ] as const) {
      const refused = await books.browser.post('/api/reports/files', { report: file, params });
      expect(refused.body.code).toBe('NOT_FOUND');
    }
  });
});
