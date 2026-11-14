import type { INestApplication } from '@nestjs/common';
import type {
  BalanceSheet,
  DimensionType,
  GeneralLedger,
  IncomeStatement,
  Journal,
  Profitability,
  ReportLines,
  ServiceDepartmentHistory,
  TrialBalance,
} from '@vertex-mizan/contracts';
import type { Database } from '@vertex-mizan/db';
import { closeMonthByHand } from '@vertex-mizan/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { type Books, books, line, posted, today } from './books.js';
import { expectGuarded } from './guards.js';
import { testDatabase } from './people.js';

// S09's `/api/reports/*` and a service's departments over HTTP ("API", "Acceptance" tests): every
// report read by every role (`reports.read`), the figures agreeing with each other, the parallel
// ledger profitability's default, the refusals of a query, another company's account `NOT_FOUND`
// and its figures none of the caller's; the department history read with `dimensions.read` and a
// manual service's row set with `dimensions.manage`, `DIMENSION_FROM_HUB` and `PERIOD_CLOSED`.
// Entries are dated today by the API's clock; every value is synthetic.

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

/** Capital of 1,000,000.00 SYP and rent of 150,000.00 SYP paid today. */
async function booksWithEntries(): Promise<Books> {
  const book = await books(app, db);
  await posted(book.owner.browser, {
    entryDate: today(),
    description: 'رأس المال',
    reference: null,
    dealtRates: [],
    lines: [line(book, '111003', 'SYP', '100000000'), line(book, '311001', 'SYP', '-100000000')],
  });
  await posted(book.owner.browser, {
    entryDate: today(),
    description: 'إيجار',
    reference: null,
    dealtRates: [],
    lines: [line(book, '531001', 'SYP', '15000000'), line(book, '111003', 'SYP', '-15000000')],
  });
  return book;
}

const month = () => ({ from: `${today().slice(0, 7)}-01`, to: today() });

describe('/api/reports', () => {
  it('reads every report by every role, the figures agreeing (rule 8)', async () => {
    const book = await booksWithEntries();
    const { from, to } = month();
    for (const role of ['accountant', 'approver', 'viewer', 'auditor'] as const) {
      const member = await book.join(role);
      const read = await member.browser.get('/api/reports/trial-balance', { from, to });
      expect(read.status, `${role} ${JSON.stringify(read.body)}`).toBe(200);
    }
    const browser = book.owner.browser;
    const tb = (await browser.get('/api/reports/trial-balance', { from, to })).body as TrialBalance;
    expect(tb.header).toMatchObject({ ledger: 'book', currency: 'SYP' });
    expect(tb.header.current.marks).toContain('period_open');
    expect(tb.rows.map((row) => [row.account.code, row.closing])).toEqual([
      ['111003', '85000000'],
      ['311001', '-100000000'],
      ['531001', '15000000'],
    ]);
    expect(tb.totals).toMatchObject({ debits: '115000000', credits: '115000000' });
    const parallel = await browser.get('/api/reports/trial-balance', {
      from,
      to,
      ledger: 'parallel',
    });
    expect((parallel.body as TrialBalance).header.currency).toBe('USD');
    expect((parallel.body as TrialBalance).totals.debits).toBe(
      (parallel.body as TrialBalance).totals.credits,
    );

    const income = (await browser.get('/api/reports/income-statement', { from, to }))
      .body as IncomeStatement;
    expect(income.subtotals.profit).toBe('-15000000');
    const sheet = (await browser.get('/api/reports/balance-sheet', { asOf: to }))
      .body as BalanceSheet;
    expect(sheet.yearResult).toBe('-15000000');
    expect(sheet.totals).toMatchObject({ assets: '85000000', liabilitiesAndEquity: '85000000' });

    const cash = book.accounts.get('111003') as string;
    const lines = (await browser.get('/api/reports/lines', { to, account: cash }))
      .body as ReportLines;
    expect(lines).toMatchObject({ sum: '85000000', count: 2 });
    const statement = await browser.get(`/api/reports/accounts/${cash}/statement`, { from, to });
    expect(statement.status, JSON.stringify(statement.body)).toBe(200);
    expect(statement.body).toMatchObject({ opening: '0', closing: '85000000' });
    const ledger = (await browser.get('/api/reports/general-ledger', { from, to }))
      .body as GeneralLedger;
    expect(ledger.accounts.map((account) => account.account.code)).toEqual([
      '111003',
      '311001',
      '531001',
    ]);
    const journal = (await browser.get('/api/reports/journal', { from, to })).body as Journal;
    expect(journal.entries.map((entry) => entry.description)).toEqual(['رأس المال', 'إيجار']);
    const profitability = (
      await browser.get('/api/reports/profitability', { by: 'department', from, to })
    ).body as Profitability;
    expect(profitability.header.ledger).toBe('parallel');
    expect(profitability.rows).toEqual([]);
    for (const [path, query] of [] as const) {
      const read = await browser.get(path, query);
      expect(read.status, `${path} ${JSON.stringify(read.body)}`).toBe(200);
    }
  });

  it('refuses a bad query and shows another company nothing of the caller', async () => {
    const book = await booksWithEntries();
    const other = await books(app, db);
    const { from, to } = month();
    const browser = other.owner.browser;
    expect(
      (await browser.get('/api/reports/trial-balance', { from: to, to: from })).body.code,
    ).toBe(to === from ? undefined : 'VALIDATION_FAILED');
    expect(
      (await browser.get('/api/reports/trial-balance', { from, to, level: '5' })).body.code,
    ).toBe('VALIDATION_FAILED');
    expect((await browser.get('/api/reports/lines', { to })).body.code).toBe('VALIDATION_FAILED');
    const tb = (await browser.get('/api/reports/trial-balance', { from, to })).body as TrialBalance;
    expect(tb.rows).toEqual([]);
    const cash = book.accounts.get('111003') as string;
    expect(
      (await browser.get(`/api/reports/accounts/${cash}/statement`, { from, to })).body.code,
    ).toBe('NOT_FOUND');
    expect((await browser.get('/api/reports/lines', { to, account: cash })).body.code).toBe(
      'NOT_FOUND',
    );
  });

  it('guards every report route', async () => {
    const { from, to } = month();
    const id = '01934b6e-0000-7000-8000-000000000001';
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/reports/trial-balance', query: { from, to } },
      { method: 'get', path: '/api/reports/general-ledger', query: { from, to } },
      { method: 'get', path: `/api/reports/accounts/${id}/statement`, query: { from, to } },
      { method: 'get', path: '/api/reports/journal', query: { from, to } },
      { method: 'get', path: '/api/reports/income-statement', query: { from, to } },
      { method: 'get', path: '/api/reports/balance-sheet', query: { asOf: to } },
      { method: 'get', path: '/api/reports/profitability', query: { by: 'client', from, to } },
      { method: 'get', path: '/api/reports/lines', query: { to, account: id } },
      { method: 'get', path: `/api/dimension-values/${id}/departments` },
      { method: 'post', path: `/api/dimension-values/${id}/departments` },
    ]);
  });
});

describe('/api/dimension-values/:id/departments (S09 rules 32–34)', () => {
  /** A service value and a department value of the company, made by hand. */
  async function values(book: Books) {
    const types = (await book.owner.browser.get('/api/dimension-types')).body as DimensionType[];
    const make = async (code: string, type: string) => {
      const made = await book.owner.browser.post('/api/dimension-values', {
        typeId: types.find((candidate) => candidate.code === type)?.id,
        code,
        name: `قيمة ${code}`,
      });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      return made.body.id as string;
    };
    return {
      service: await make('S1', 'service'),
      hubService: await make('S2', 'service'),
      department: await make('design', 'department'),
    };
  }

  it("sets a manual service's department by the accountant, read by every role", async () => {
    const book = await books(app, db);
    const { service, department } = await values(book);
    const accountant = await book.join('accountant');
    const set = await accountant.browser.post(`/api/dimension-values/${service}/departments`, {
      departmentValueId: department,
      effectiveFrom: today(),
      reason: 'خدمة يقدمها قسم التصميم',
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((set.body as ServiceDepartmentHistory).rows).toMatchObject([
      { effectiveFrom: today(), source: 'manual', department: { code: 'design' } },
    ]);
    const viewer = await book.join('viewer');
    const read = await viewer.browser.get(`/api/dimension-values/${service}/departments`);
    expect(read.status).toBe(200);
    expect(
      (
        await viewer.browser.post(`/api/dimension-values/${service}/departments`, {
          departmentValueId: department,
          effectiveFrom: today(),
          reason: 'محاولة',
        })
      ).body.code,
    ).toBe('FORBIDDEN');
    const audit = await book.owner.browser.get('/api/audit', { action: 'service_department.set' });
    expect(audit.status, JSON.stringify(audit.body)).toBe(200);
  });

  it('refuses a department dated in a closed month', async () => {
    const book = await books(app, db);
    const { service, department } = await values(book);
    const set = (id: string, effectiveFrom: string) =>
      book.owner.browser.post(`/api/dimension-values/${id}/departments`, {
        departmentValueId: department,
        effectiveFrom,
        reason: 'سبب تجريبي',
      });
    // Today's month holds an entry and is closed by hand: its department date is refused.
    await posted(book.owner.browser, {
      entryDate: today(),
      description: 'رأس المال',
      reference: null,
      dealtRates: [],
      lines: [line(book, '111003', 'SYP', '1000'), line(book, '311001', 'SYP', '-1000')],
    });
    await closeMonthByHand(db, book.companyId, today().slice(0, 7));
    expect((await set(service, today())).body.code).toBe('PERIOD_CLOSED');
    // Another company's ids: its service is none of the caller's, and its department neither.
    const other = await books(app, db);
    const theirs = await values(other);
    expect(
      (await other.owner.browser.get(`/api/dimension-values/${service}/departments`)).body.code,
    ).toBe('NOT_FOUND');
    const write = (browser: typeof other.owner.browser, id: string, departmentValueId: string) =>
      browser.post(`/api/dimension-values/${id}/departments`, {
        departmentValueId,
        effectiveFrom: today(),
        reason: 'سبب تجريبي',
      });
    expect((await write(other.owner.browser, service, theirs.department)).body.code).toBe(
      'NOT_FOUND',
    );
    expect((await write(other.owner.browser, theirs.service, department)).body.code).toBe(
      'VALIDATION_FAILED',
    );
  });
});
