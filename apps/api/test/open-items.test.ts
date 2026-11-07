import type { INestApplication } from '@nestjs/common';
import type {
  AgeingReport,
  ClientFunds,
  ClientStatement,
  DimensionType,
  Entry,
  EntryPreview,
  IntegrityReport,
  OpenItem,
  OpenItemPage,
} from '@vertex-mizan/contracts';
import { auditEntries, type Database, withCompany } from '@vertex-mizan/db';
import { ar } from '@vertex-mizan/i18n';
import ExcelJS from 'exceljs';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { type Books, books, draftOf, line, posted, today } from './books.js';
import type { Browser } from './browser.js';
import { expectGuarded } from './guards.js';
import { testDatabase } from './people.js';

// The receivables API (S04 "API"): open items, an item's page and its due date, the ageing, client
// funds and the client statement with their exports, and the drafts' item fields through save,
// preview and post; each as another company's member and without the permission too. The books are
// `books.ts`'s (bulletin 121.5000 and market 122.0000 SYP per USD today); every value is synthetic.

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

/** A date `days` after today in Damascus (the API's clock), as `YYYY-MM-DD`. */
function inDays(days: number): string {
  const [year, month, day] = today().split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

async function actions(companyId: string): Promise<string[]> {
  const rows = await withCompany(db, companyId, (tx) =>
    tx.select({ action: auditEntries.action }).from(auditEntries),
  );
  return rows.map((row) => row.action);
}

interface Receivables extends Books {
  /** Dimension values by code: clients `C1` and `C2`, service `S1`. */
  values: Map<string, string>;
}

/** The books with two clients and a service. */
async function receivables(): Promise<Receivables> {
  const book = await books(app, db);
  const types = (await book.owner.browser.get('/api/dimension-types')).body as DimensionType[];
  const typeId = (code: string) => types.find((type) => type.code === code)?.id as string;
  const values = new Map<string, string>();
  for (const [type, code] of [
    ['client', 'C1'],
    ['client', 'C2'],
    ['service', 'S1'],
  ] as const) {
    const added = await book.owner.browser.post('/api/dimension-values', {
      typeId: typeId(type),
      code,
      name: `قيمة تجريبية ${code}`,
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    values.set(code, added.body.id);
  }
  return { ...book, values };
}

const dims = (book: Receivables, ...codes: string[]) =>
  codes.map((code) => book.values.get(code) as string);

/** An invoice to C1: Dr 112001 opening `reference`, Cr 411001; due in `dueIn` days. */
const invoice = (book: Receivables, reference: string, amount: string, dueIn: number | null) => ({
  entryDate: today(),
  description: 'فاتورة تجريبية',
  reference: null,
  dealtRates: [],
  lines: [
    {
      ...line(book, '112001', 'USD', amount),
      dimensionValueIds: dims(book, 'C1'),
      newItem: { reference, dueOn: dueIn === null ? null : inDays(dueIn) },
    },
    { ...line(book, '411001', 'USD', `-${amount}`), dimensionValueIds: dims(book, 'C1', 'S1') },
  ],
});

/** A receipt in USD settling `amount` of the item. */
const receipt = (book: Receivables, itemId: string, amount: string) => ({
  entryDate: today(),
  description: 'قبض تجريبي',
  reference: null,
  dealtRates: [],
  lines: [
    line(book, '111004', 'USD', amount),
    { ...line(book, '112001', 'USD', `-${amount}`), openItemId: itemId },
  ],
});

async function itemOf(browser: Browser, reference: string): Promise<OpenItem> {
  const page = await browser.get('/api/open-items', { state: 'all', text: reference });
  expect(page.status, JSON.stringify(page.body)).toBe(200);
  const found = (page.body as OpenItemPage).items.find((item) => item.reference === reference);
  if (!found) throw new Error(`no item ${reference}`);
  const item = await browser.get(`/api/open-items/${found.id}`);
  expect(item.status, JSON.stringify(item.body)).toBe(200);
  return item.body as OpenItem;
}

/** A workbook's rows as arrays of cell values, from row 1. */
async function rowsOf(body: Buffer): Promise<unknown[][]> {
  return (await sheetOf(body)).rows;
}

/** A workbook's first sheet: its rows' values and each cell's number format, from row 1. */
async function sheetOf(body: Buffer): Promise<{ rows: unknown[][]; formats: string[][] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as never);
  const sheet = workbook.worksheets[0];
  const rows: unknown[][] = [];
  const formats: string[][] = [];
  sheet?.eachRow({ includeEmpty: true }, (row) => {
    rows.push((row.values as unknown[]).slice(1));
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cells[column - 1] = cell.numFmt ?? '';
    });
    formats.push(cells);
  });
  return { rows, formats };
}

/** Records a bulletin and a market rate for a date other than today (a rate must change). */
async function ratesOn(book: Books, on: string) {
  for (const [type, rate] of [
    ['bulletin', '121.6000'],
    ['market', '122.1000'],
  ] as const) {
    const recorded = await book.owner.browser.post('/api/rates', {
      effectiveOn: on,
      base: 'USD',
      quote: 'SYP',
      rate,
      type,
      source: 'manual',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
  }
}

describe('the guard on every receivables route', () => {
  it('answers 401, 403, COMPANY_SWITCHED and COMPANY_ARCHIVED', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/open-items' },
      { method: 'get', path: `/api/open-items/${id}` },
      { method: 'put', path: `/api/open-items/${id}/due-date` },
      { method: 'get', path: '/api/receivables/ageing' },
      { method: 'get', path: '/api/receivables/ageing/export' },
      { method: 'get', path: '/api/client-funds' },
      { method: 'get', path: `/api/clients/${id}/statement` },
      { method: 'get', path: `/api/clients/${id}/statement/export` },
    ]);
  });

  it('lets every role read, and only the owner and accountants change a due date', async () => {
    const book = await receivables();
    await posted(book.owner.browser, invoice(book, 'M-1', '100000', 30));
    const m1 = await itemOf(book.owner.browser, 'M-1');
    const change = { dueOn: inDays(45), reason: 'تمديد متفق عليه' };
    for (const role of ['viewer', 'approver', 'auditor'] as const) {
      const member = await book.join(role);
      for (const path of [
        '/api/open-items',
        `/api/open-items/${m1.id}`,
        '/api/receivables/ageing',
        '/api/client-funds',
        `/api/clients/${book.values.get('C1')}/statement`,
      ]) {
        expect((await member.browser.get(path)).status, `${role} ${path}`).toBe(200);
      }
      expect(
        (await member.browser.put(`/api/open-items/${m1.id}/due-date`, change)).body.code,
        role,
      ).toBe('FORBIDDEN');
    }
    const accountant = await book.join('accountant');
    expect((await accountant.browser.put(`/api/open-items/${m1.id}/due-date`, change)).status).toBe(
      200,
    );
  });
});

describe('an invoice and its receipts through drafts (S04 acceptance steps 2–6)', () => {
  it('saves a line’s new item, previews it, posts it and lists it', async () => {
    const book = await receivables();
    const browser = book.owner.browser;
    const draft = await draftOf(browser, invoice(book, 'M-1', '100000', 30));
    const saved = await browser.get(`/api/drafts/${draft.id}`);
    expect(saved.body.lines[0]).toMatchObject({
      openItemId: null,
      newItem: { reference: 'M-1', dueOn: inDays(30) },
    });
    const preview = (await browser.post(`/api/drafts/${draft.id}/preview`)).body as EntryPreview;
    expect(preview.refusals).toEqual([]);
    expect(preview.lines[0]?.item).toMatchObject({
      reference: 'M-1',
      movement: 'open',
      adjusted: false,
    });
    expect(preview.lines[1]?.item).toBeNull();
    expect(preview.items).toEqual([
      expect.objectContaining({
        reference: 'M-1',
        kind: 'document',
        currency: 'USD',
        isNew: true,
        before: { openMinor: '0', bookMinor: '0', parallelMinor: '0' },
        after: { openMinor: '100000', bookMinor: '12150000', parallelMinor: '100000' },
      }),
    ]);
    const result = await browser.post(`/api/drafts/${draft.id}/post`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const entry = result.body.entry as Entry;
    const m1 = await itemOf(browser, 'M-1');
    expect(entry.lines[0]?.item).toEqual({
      id: m1.id,
      reference: 'M-1',
      movement: 'open',
      adjusted: false,
    });
    expect(m1).toMatchObject({
      kind: 'document',
      source: 'manual',
      state: 'open',
      currency: 'USD',
      documentDate: today(),
      dueOn: inDays(30),
      client: { id: book.values.get('C1'), code: 'C1' },
      amounts: { openMinor: '100000', bookMinor: '12150000', parallelMinor: '100000' },
      openedByEntryId: entry.id,
      bookCurrency: 'SYP',
      parallelCurrency: 'USD',
    });
    expect(m1.movements.map((movement) => [movement.kind, movement.balance.openMinor])).toEqual([
      ['open', '100000'],
    ]);
    expect(m1.dueDates).toMatchObject([{ dueOn: inDays(30), setBy: 'opening', by: null }]);
    // A replay of the post answers the same entry and moves nothing (S03 idempotency).
    const replay = await browser.post(`/api/drafts/${draft.id}/post`);
    expect(replay.body.entry.id).toBe(entry.id);
    expect((await itemOf(browser, 'M-1')).movements).toHaveLength(1);
  });

  it('settles in proportion to what remains, and shows the item before and after', async () => {
    const book = await receivables();
    const browser = book.owner.browser;
    await posted(browser, invoice(book, 'M-1', '100000', 30));
    const m1 = await itemOf(browser, 'M-1');
    const draft = await draftOf(browser, receipt(book, m1.id, '40000'));
    const preview = (await browser.post(`/api/drafts/${draft.id}/preview`)).body as EntryPreview;
    expect(preview.items).toEqual([
      expect.objectContaining({
        id: m1.id,
        isNew: false,
        before: { openMinor: '100000', bookMinor: '12150000', parallelMinor: '100000' },
        after: { openMinor: '60000', bookMinor: '7290000', parallelMinor: '60000' },
      }),
    ]);
    expect(preview.lines[1]?.item).toMatchObject({ id: m1.id, movement: 'clear' });
    await browser.post(`/api/drafts/${draft.id}/post`);
    // The rest paid in SYP at the market rate: 600.00 USD for 73,200.00 SYP, a 300.00 SYP gain.
    const final = await posted(browser, {
      entryDate: today(),
      description: 'قبض بالليرة',
      reference: null,
      dealtRates: [{ base: 'USD', quote: 'SYP', rate: '122.0000' }],
      lines: [
        line(book, '111003', 'SYP', '7320000'),
        { ...line(book, '112001', 'USD', '-60000'), openItemId: m1.id },
      ],
    });
    const settled = await itemOf(browser, 'M-1');
    expect(settled).toMatchObject({
      state: 'settled',
      amounts: { openMinor: '0', bookMinor: '0', parallelMinor: '0' },
    });
    expect(settled.movements.map((movement) => movement.amounts.bookMinor)).toEqual([
      '12150000',
      '-4860000',
      '-7290000',
    ]);
    const entry = (await browser.get(`/api/entries/${final.id}`)).body as Entry;
    expect(
      entry.lines.map((entryLine) => [entryLine.accountCode, entryLine.bookMinor, entryLine.kind]),
    ).toEqual([
      ['111003', '7320000', 'measured'],
      ['112001', '-7290000', 'carried'],
      ['421001', '-30000', 'difference'],
    ]);
    expect(
      ((await browser.get('/api/open-items')).body as OpenItemPage).items.map((i) => i.reference),
    ).toEqual([]);
    expect(
      ((await browser.get('/api/open-items', { state: 'settled' })).body as OpenItemPage).items.map(
        (i) => i.reference,
      ),
    ).toEqual(['M-1']);
  });

  it('refuses an overpayment, an unknown item and a control-account line without an item', async () => {
    const book = await receivables();
    const browser = book.owner.browser;
    await posted(browser, invoice(book, 'M-1', '40000', null));
    const m1 = await itemOf(browser, 'M-1');
    const over = await draftOf(browser, receipt(book, m1.id, '50000'));
    const preview = (await browser.post(`/api/drafts/${over.id}/preview`)).body as EntryPreview;
    expect(preview.refusals.map((refusal) => [refusal.code, refusal.lineNo])).toEqual([
      ['RELEASE_EXCEEDS_BALANCE', 2],
    ]);
    expect((await browser.post(`/api/drafts/${over.id}/post`)).body.code).toBe(
      'RELEASE_EXCEEDS_BALANCE',
    );
    const unknown = await browser.post('/api/drafts', receipt(book, uuidv7(), '10000'));
    expect(unknown.body.code).toBe('VALIDATION_FAILED');
    expect(unknown.body.issues[0].path).toEqual(['lines', 1, 'openItemId']);
    const bare = await draftOf(browser, {
      ...receipt(book, m1.id, '10000'),
      lines: [line(book, '111004', 'USD', '10000'), line(book, '112001', 'USD', '-10000')],
    });
    expect((await browser.post(`/api/drafts/${bare.id}/post`)).body.code).toBe(
      'OPEN_ITEM_REQUIRED',
    );
    const both = await browser.post('/api/drafts', {
      ...receipt(book, m1.id, '10000'),
      lines: [
        line(book, '111004', 'USD', '10000'),
        {
          ...line(book, '112001', 'USD', '-10000'),
          openItemId: m1.id,
          newItem: { reference: 'X' },
        },
      ],
    });
    expect(both.body.code).toBe('VALIDATION_FAILED');
  });

  it('refuses another company’s item, client and draft line item as not found', async () => {
    const book = await receivables();
    const other = await receivables();
    await posted(other.owner.browser, invoice(other, 'M-1', '10000', null));
    const theirs = await itemOf(other.owner.browser, 'M-1');
    const browser = book.owner.browser;
    expect((await browser.get(`/api/open-items/${theirs.id}`)).body.code).toBe('NOT_FOUND');
    expect(
      (
        await browser.put(`/api/open-items/${theirs.id}/due-date`, {
          dueOn: inDays(10),
          reason: 'س',
        })
      ).body.code,
    ).toBe('NOT_FOUND');
    expect((await browser.get(`/api/clients/${other.values.get('C1')}/statement`)).body.code).toBe(
      'NOT_FOUND',
    );
    expect((await browser.get(`/api/clients/${book.values.get('S1')}/statement`)).body.code).toBe(
      'NOT_FOUND',
    );
    expect((await browser.post('/api/drafts', receipt(book, theirs.id, '10000'))).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(((await browser.get('/api/open-items')).body as OpenItemPage).items).toEqual([]);
    // The reports read nothing of the other company, by its account or its client.
    expect(
      (
        await browser.get('/api/receivables/ageing', {
          accounts: other.accounts.get('112001') as string,
        })
      ).body.code,
    ).toBe('VALIDATION_FAILED');
    const ageing = await browser.get('/api/receivables/ageing', {
      client: other.values.get('C1') as string,
    });
    expect((ageing.body as AgeingReport).clients).toEqual([]);
    const exported = await browser.download('/api/receivables/ageing/export', {
      client: other.values.get('C1') as string,
    });
    expect(exported.status).toBe(200);
    expect((await rowsOf(exported.body)).some((row) => row.includes('M-1'))).toBe(false);
    await posted(other.owner.browser, {
      entryDate: today(),
      description: 'إيداع أمانة',
      reference: null,
      dealtRates: [],
      lines: [
        line(other, '111004', 'USD', '30000'),
        { ...line(other, '213001', 'USD', '-30000'), dimensionValueIds: dims(other, 'C1') },
      ],
    });
    expect(((await browser.get('/api/client-funds')).body as ClientFunds).funds).toEqual([]);
    const theirExport = await browser.get(
      `/api/clients/${other.values.get('C1')}/statement/export`,
    );
    expect(theirExport.body.code).toBe('NOT_FOUND');
  });
});

describe('a manual item’s due date (S04 rule 15, acceptance step 9)', () => {
  it('changes from today with a reason, audited; the same date again changes nothing', async () => {
    const book = await receivables();
    const browser = book.owner.browser;
    await posted(browser, invoice(book, 'M-1', '100000', 30));
    const m1 = await itemOf(browser, 'M-1');
    const change = { dueOn: inDays(60), reason: 'تمديد متفق عليه' };
    const changed = await browser.put(`/api/open-items/${m1.id}/due-date`, change);
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body).toMatchObject({ dueOn: inDays(60) });
    expect((changed.body as OpenItem).dueDates).toMatchObject([
      { dueOn: inDays(30), setBy: 'opening' },
      { dueOn: inDays(60), effectiveOn: today(), setBy: 'user', reason: 'تمديد متفق عليه' },
    ]);
    expect((changed.body as OpenItem).dueDates[1]?.by?.id).toBe(book.owner.person.id);
    const replay = await browser.put(`/api/open-items/${m1.id}/due-date`, change);
    expect(replay.status).toBe(200);
    expect((replay.body as OpenItem).dueDates).toHaveLength(2);
    expect(
      (await actions(book.companyId)).filter((action) => action === 'open_item.due_date_changed'),
    ).toHaveLength(1);
    // Before its opening the item carried nothing and had no due date of its own (rule 14).
    const yesterday = await browser.get(`/api/open-items/${m1.id}`, { asOf: inDays(-1) });
    expect(yesterday.body).toMatchObject({
      dueOn: today(),
      movements: [],
      amounts: { openMinor: '0' },
    });
    expect(
      (await browser.put(`/api/open-items/${m1.id}/due-date`, { dueOn: inDays(5) })).body.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('writes once for two identical changes at once', async () => {
    const book = await receivables();
    const browser = book.owner.browser;
    await posted(browser, invoice(book, 'M-1', '100000', 30));
    const m1 = await itemOf(browser, 'M-1');
    const change = { dueOn: inDays(60), reason: 'تمديد متفق عليه' };
    const answers = await Promise.all([
      browser.put(`/api/open-items/${m1.id}/due-date`, change),
      browser.put(`/api/open-items/${m1.id}/due-date`, change),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    expect((await itemOf(browser, 'M-1')).dueDates).toHaveLength(2);
    expect(
      (await actions(book.companyId)).filter((action) => action === 'open_item.due_date_changed'),
    ).toHaveLength(1);
  });

  // An invoice dated later this month (S03 rule 6): its opening's due date applies from that date,
  // so a change made before it would be overridden then. Not on a month's last day.
  it.skipIf(inDays(1).slice(0, 7) !== today().slice(0, 7))(
    'refuses a change before the item’s document date',
    async () => {
      const book = await receivables();
      const browser = book.owner.browser;
      await ratesOn(book, inDays(1));
      await posted(browser, { ...invoice(book, 'M-9', '100000', 30), entryDate: inDays(1) });
      // Absent today (it opens tomorrow, S04 edge case 17), listed as of tomorrow.
      expect(((await browser.get('/api/open-items')).body as OpenItemPage).items).toEqual([]);
      const page = await browser.get('/api/open-items', { asOf: inDays(1) });
      const [m9] = (page.body as OpenItemPage).items;
      if (!m9) throw new Error('no M-9');
      expect(m9.documentDate).toBe(inDays(1));
      const refused = await browser.put(`/api/open-items/${m9.id}/due-date`, {
        dueOn: inDays(90),
        reason: 'تمديد مبكر',
      });
      expect(refused.body.code).toBe('VALIDATION_FAILED');
      expect(refused.body.issues[0].path).toEqual(['dueOn']);
    },
  );

  it('refuses a running item, which has no due date', async () => {
    const book = await receivables();
    const browser = book.owner.browser;
    await posted(browser, {
      entryDate: today(),
      description: 'إيداع أمانة',
      reference: null,
      dealtRates: [],
      lines: [
        line(book, '111004', 'USD', '30000'),
        { ...line(book, '213001', 'USD', '-30000'), dimensionValueIds: dims(book, 'C1') },
      ],
    });
    const running = await itemOf(browser, 'C1');
    expect(running).toMatchObject({ kind: 'running', dueOn: null, dueDates: [] });
    expect(
      (
        await browser.put(`/api/open-items/${running.id}/due-date`, {
          dueOn: inDays(5),
          reason: 'س',
        })
      ).body.code,
    ).toBe('VALIDATION_FAILED');
  });
});

describe('the ageing (S04 rule 16, acceptance step 3)', () => {
  it('ages by the due date in force, with totals per bucket and currency, and exports it', async () => {
    const book = await receivables();
    const browser = book.owner.browser;
    await posted(browser, invoice(book, 'M-1', '100000', 30));
    await posted(browser, invoice(book, 'M-2', '20000', null));
    const ageing = async (query: Record<string, string>) => {
      const answer = await browser.get('/api/receivables/ageing', query);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      return answer.body as AgeingReport;
    };
    const onDue = await ageing({ asOf: inDays(30) });
    expect(onDue).toMatchObject({ asOf: inDays(30), ledger: 'book', ledgerCurrency: 'SYP' });
    expect(onDue.accounts.map((account) => account.code)).toEqual(['112001']);
    expect(onDue.clients).toHaveLength(1);
    expect(
      onDue.clients[0]?.items.map((item) => [item.reference, item.daysPastDue, item.bucket]),
    ).toEqual([
      ['M-2', 30, 'days_1_30'],
      ['M-1', 0, 'not_due'],
    ]);
    expect(onDue.buckets).toMatchObject({ not_due: '12150000', days_1_30: '2430000' });
    expect(onDue.totalMinor).toBe('14580000');
    expect(onDue.currencyTotals).toEqual([
      expect.objectContaining({ currency: 'USD', totalMinor: '120000' }),
    ]);
    const later = await ageing({ asOf: inDays(37), ledger: 'parallel' });
    expect(later.ledgerCurrency).toBe('USD');
    expect(later.clients[0]?.items.map((item) => [item.bucket, item.carryingMinor])).toEqual([
      ['days_31_60', '20000'],
      ['days_1_30', '100000'],
    ]);
    expect((await ageing({ asOf: inDays(-1) })).clients).toEqual([]);
    expect((await ageing({ client: book.values.get('C2') as string })).clients).toEqual([]);
    expect(
      (
        await browser.get('/api/receivables/ageing', {
          accounts: book.accounts.get('111004') as string,
        })
      ).body.code,
    ).toBe('VALIDATION_FAILED');

    const exported = await browser.download('/api/receivables/ageing/export', {
      asOf: inDays(30),
    });
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
    const rows = await rowsOf(exported.body);
    const labels = ar.openItems.ageingExport;
    expect(rows[0]).toEqual([labels.asOf, inDays(30)]);
    expect(rows[3]?.slice(0, 4)).toEqual([
      labels.client,
      labels.clientCode,
      labels.account,
      labels.reference,
    ]);
    const m1 = rows.find((row) => row[3] === 'M-1');
    expect(m1?.slice(4, 12)).toEqual([
      today(),
      inDays(30),
      0,
      ar.openItems.buckets.not_due,
      ar.accounting.currencies.USD,
      1000,
      ar.accounting.sypPrintedName,
      121500,
    ]);
    expect(await actions(book.companyId)).toContain('export.ageing');
  });

  it('refuses the parallel ledger of a company without one', async () => {
    const book = await books(app, db, {
      ledgers: {
        book: {
          currency: 'SYP',
          ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
        },
        parallel: null,
      },
    });
    expect(
      (await book.owner.browser.get('/api/receivables/ageing', { ledger: 'parallel' })).body.code,
    ).toBe('VALIDATION_FAILED');
  });
});

describe('client funds and the client statement (S04 rule 17, acceptance step 7)', () => {
  it('lists running items with debit balances marked, never netted', async () => {
    const book = await receivables();
    const browser = book.owner.browser;
    const funds = (credit: string, client: string) => ({
      entryDate: today(),
      description: 'حركة أمانة',
      reference: null,
      dealtRates: [],
      lines: [
        line(book, '111004', 'USD', credit.startsWith('-') ? credit.slice(1) : `-${credit}`),
        { ...line(book, '213001', 'USD', credit), dimensionValueIds: dims(book, client) },
      ],
    });
    await posted(browser, funds('-30000', 'C1'));
    await posted(browser, funds('10000', 'C2'));
    const answer = (await browser.get('/api/client-funds')).body as ClientFunds;
    expect(
      answer.funds.map((fund) => [fund.client.code, fund.amounts.openMinor, fund.receivable]),
    ).toEqual([
      ['C1', '-30000', false],
      ['C2', '10000', true],
    ]);
    expect(answer).toMatchObject({ heldMinor: '-3645000', receivableMinor: '1215000' });
    // The account nets to a credit, but an item is not zero: archiving is refused (edge case 13).
    const archive = await browser.post(`/api/accounts/${book.accounts.get('213001')}/archive`, {
      reason: 'لا حاجة',
    });
    expect(archive.body.code).toBe('ACCOUNT_HAS_BALANCE');
  });

  it('lists every movement with running balances; opening plus movements is closing; exports it', async () => {
    const book = await receivables();
    const browser = book.owner.browser;
    await posted(browser, invoice(book, 'M-1', '100000', 30));
    const m1 = await itemOf(browser, 'M-1');
    await posted(browser, receipt(book, m1.id, '40000'));
    const client = book.values.get('C1') as string;
    const statement = (await browser.get(`/api/clients/${client}/statement`))
      .body as ClientStatement;
    expect(statement).toMatchObject({
      client: { id: client, code: 'C1' },
      from: null,
      to: today(),
      ledger: 'book',
      ledgerCurrency: 'SYP',
      opening: [],
      openingLedgerMinor: '0',
      closing: [{ currency: 'USD', amountMinor: '60000', ledgerMinor: '7290000' }],
      closingLedgerMinor: '7290000',
    });
    expect(
      statement.lines.map((row) => [
        row.kind,
        row.itemReference,
        row.amountMinor,
        row.balanceMinor,
        row.ledgerBalanceMinor,
      ]),
    ).toEqual([
      ['open', 'M-1', '100000', '100000', '12150000'],
      ['clear', 'M-1', '-40000', '60000', '7290000'],
    ]);
    const tomorrow = (
      await browser.get(`/api/clients/${client}/statement`, { from: inDays(1), to: inDays(1) })
    ).body as ClientStatement;
    expect(tomorrow.lines).toEqual([]);
    expect(tomorrow.opening).toEqual(statement.closing);
    expect(tomorrow.closing).toEqual(statement.closing);
    expect(
      (await browser.get(`/api/clients/${client}/statement`, { from: inDays(1), to: inDays(0) }))
        .body.code,
    ).toBe('VALIDATION_FAILED');

    const exported = await browser.download(`/api/clients/${client}/statement/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toBe(
      `attachment; filename="client-statement-${client}-${today()}.xlsx"`,
    );
    const { rows, formats } = await sheetOf(exported.body);
    const clearedAt = rows.findIndex((row) => row[6] === ar.openItems.movements.clear);
    expect(formats[clearedAt]?.slice(8, 13)).toEqual([
      '#,##0.00',
      '#,##0.00',
      '',
      '#,##0.00',
      '#,##0.00',
    ]);
    const labels = ar.openItems.statementExport;
    expect(rows[5]?.slice(0, 3)).toEqual([labels.date, labels.entry, labels.description]);
    const cleared = rows.find((row) => row[6] === ar.openItems.movements.clear);
    expect(cleared?.slice(8, 13)).toEqual([-400, 600, ar.accounting.sypPrintedName, -48600, 72900]);
    expect(rows.at(-1)?.[2]).toBe(labels.closing);
    expect(await actions(book.companyId)).toContain('export.client_statement');
    // A client's typed code never reaches the header: an Arabic one downloads too.
    const types = (await browser.get('/api/dimension-types')).body as DimensionType[];
    const arabic = await browser.post('/api/dimension-values', {
      typeId: types.find((type) => type.code === 'client')?.id,
      code: 'عميل-"١"',
      name: 'عميل بترميز عربي',
    });
    expect(arabic.status, JSON.stringify(arabic.body)).toBe(201);
    const theirs = await browser.download(`/api/clients/${arabic.body.id}/statement/export`);
    expect(theirs.status).toBe(200);
    expect(theirs.headers['content-disposition']).toContain(arabic.body.id);
  });
});

describe('the integrity check with open items (S04 "Reports")', () => {
  it('compares every control account with its items and finds nothing on sound books', async () => {
    const book = await receivables();
    await posted(book.owner.browser, invoice(book, 'M-1', '100000', null));
    const report = (await book.owner.browser.post('/api/integrity/check', {}))
      .body as IntegrityReport;
    expect(report).toMatchObject({ ok: true, controlAccounts: [], openItemBalances: [] });
  });
});
