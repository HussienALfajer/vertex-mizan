import type { INestApplication } from '@nestjs/common';
import type { Account } from '@vertex-mizan/contracts';
import { auditEntries, type Database, withCompany } from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { today } from './books.js';
import type { Browser } from './browser.js';
import { expectGuarded } from './guards.js';
import { joinCompany, newCompany, signedInPerson, testDatabase } from './people.js';

// S11 PR 2 through the API: voucher drafts saved, previewed (a transfer's derived rate, a count's
// expected amount) and posted (numbers, the box rule, a stale count, a count that matched, a
// replayed post), and the cash reads (the position, a box's statement, the register, a voucher),
// each as another company's member and without a session too. Every value is synthetic.

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
}

/**
 * The client's shape (S11 "The client's currencies"): a USD book at market accepting dealt rates,
 * an SYP parallel ledger at the bulletin, `contracting@1`, and today's rates: 120 SYP per USD and
 * 3.5 SYP per TRY at the bulletin, 34 TRY per USD at market.
 */
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
  const calendar = await owner.browser.put('/api/rate-calendar', { daysOff: [] });
  expect(calendar.status, JSON.stringify(calendar.body)).toBe(200);
  for (const [base, quote, rate, type] of [
    ['USD', 'SYP', '120.0000', 'bulletin'],
    ['TRY', 'SYP', '3.5000', 'bulletin'],
    ['USD', 'TRY', '34.0000', 'market'],
  ] as const) {
    const recorded = await owner.browser.post('/api/rates', {
      effectiveOn: today(),
      base,
      quote,
      rate,
      type,
      source: 'manual',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
  }
  const chart = (await owner.browser.get('/api/accounts')).body as Account[];
  return {
    browser: owner.browser,
    companyId: company.id,
    accounts: new Map(chart.map((account) => [account.code, account.id])),
  };
}

const line = (books: Contractor, code: string, currency: string, amountMinor: string) => ({
  accountId: books.accounts.get(code) as string,
  currency,
  amountMinor,
});

/** A voucher draft saved through `POST /api/drafts`. */
async function voucherDraft(
  books: Contractor,
  voucher: Record<string, unknown>,
  lines: ReturnType<typeof line>[] = [],
): Promise<string> {
  const saved = await books.browser.post('/api/drafts', {
    entryDate: today(),
    description: 'سند تجريبي',
    voucher,
    lines,
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(201);
  expect(saved.body.voucher.kind).toBe(voucher.kind);
  return saved.body.id as string;
}

const receipt = (books: Contractor, box: string, currency: string, amount: string) =>
  voucherDraft(
    books,
    { kind: 'receipt', cashAccountId: books.accounts.get(box), partyName: 'المالك' },
    [line(books, box, currency, amount), line(books, '313001', currency, `-${amount}`)],
  );

describe('the guard on the cash routes', () => {
  it('answers 401 and COMPANY_SWITCHED', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/cash/accounts' },
      {
        method: 'get',
        path: `/api/cash/accounts/${id}/statement`,
        query: { from: '2026-12-01', to: '2026-12-31' },
      },
      { method: 'get', path: '/api/vouchers' },
      { method: 'get', path: `/api/vouchers/${id}` },
    ]);
  });
});

describe('vouchers through the drafts (S11 rules 9–13)', () => {
  it('posts a receipt and an exchange at the derived rate, numbered per kind, once', async () => {
    const books = await contractor();
    const first = await receipt(books, '111002', 'USD', '200000');
    const posted = await books.browser.post(`/api/drafts/${first}/post`);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.voucher).toMatchObject({ kind: 'receipt', number: 1 });
    expect(posted.body.entry.reference).toMatch(/^سند قبض \d{4}\/1$/);
    expect(posted.body.entry.voucher).toMatchObject({ kind: 'receipt', number: 1 });
    // A double click answers the same voucher.
    const again = await books.browser.post(`/api/drafts/${first}/post`);
    expect(again.body.voucher.id).toBe(posted.body.voucher.id);

    const exchange = await voucherDraft(
      books,
      {
        kind: 'transfer',
        cashAccountId: books.accounts.get('111002'),
        counterCashAccountId: books.accounts.get('111005'),
      },
      [
        line(books, '111002', 'USD', '-101000'),
        line(books, '111005', 'TRY', '3450000'),
        line(books, '532002', 'USD', '1000'),
      ],
    );
    const preview = await books.browser.post(`/api/drafts/${exchange}/preview`);
    expect(preview.body.refusals).toEqual([]);
    expect(preview.body.voucher).toMatchObject({
      kind: 'transfer',
      derivedRate: { base: 'USD', quote: 'TRY', rate: '34.5000000000' },
    });
    const exchanged = await books.browser.post(`/api/drafts/${exchange}/post`);
    expect(exchanged.status, JSON.stringify(exchanged.body)).toBe(200);
    expect(
      exchanged.body.entry.lines.map((entryLine: { accountCode: string; bookMinor: string }) => [
        entryLine.accountCode,
        entryLine.bookMinor,
      ]),
    ).toContainEqual(['111005', '100000']);
  });

  it('refuses a payment beyond the box with its shortfall, and a voucher on another account', async () => {
    const books = await contractor();
    await books.browser.post(`/api/drafts/${await receipt(books, '111002', 'USD', '1000')}/post`);
    const payment = await voucherDraft(
      books,
      { kind: 'payment', cashAccountId: books.accounts.get('111002') },
      [line(books, '531005', 'USD', '1500'), line(books, '111002', 'USD', '-1500')],
    );
    const preview = await books.browser.post(`/api/drafts/${payment}/preview`);
    expect(preview.body.refusals[0]).toMatchObject({ code: 'CASH_BOX_NEGATIVE' });
    const refused = await books.browser.post(`/api/drafts/${payment}/post`);
    expect([refused.status, refused.body.code]).toEqual([409, 'CASH_BOX_NEGATIVE']);
    const wrong = await voucherDraft(
      books,
      { kind: 'receipt', cashAccountId: books.accounts.get('313001') },
      [line(books, '313001', 'USD', '100'), line(books, '111002', 'USD', '-100')],
    );
    const invalid = await books.browser.post(`/api/drafts/${wrong}/post`);
    expect([invalid.status, invalid.body.code]).toEqual([422, 'CASH_ACCOUNT_INVALID']);
  });

  it('counts a box: the expected amount required, a stale one refused, a match with no entry', async () => {
    const books = await contractor();
    await books.browser.post(`/api/drafts/${await receipt(books, '111002', 'USD', '200000')}/post`);
    const count = await voucherDraft(books, {
      kind: 'count',
      cashAccountId: books.accounts.get('111002'),
      countedMinor: '199800',
    });
    const preview = await books.browser.post(`/api/drafts/${count}/preview`);
    expect(preview.body.voucher).toMatchObject({
      kind: 'count',
      expectedMinor: '200000',
      differenceMinor: '-200',
    });
    expect((await books.browser.post(`/api/drafts/${count}/post`)).body.code).toBe(
      'VALIDATION_FAILED',
    );
    const stale = await books.browser.post(`/api/drafts/${count}/post`, {
      expectedMinor: '195000',
    });
    expect([stale.status, stale.body.code]).toEqual([409, 'CASH_COUNT_STALE']);
    const shortage = await books.browser.post(`/api/drafts/${count}/post`, {
      expectedMinor: '200000',
    });
    expect(shortage.status, JSON.stringify(shortage.body)).toBe(200);
    expect(shortage.body.voucher).toMatchObject({ kind: 'count', number: 1 });
    const matched = await voucherDraft(books, {
      kind: 'count',
      cashAccountId: books.accounts.get('111002'),
      countedMinor: '199800',
    });
    const recorded = await books.browser.post(`/api/drafts/${matched}/post`, {
      expectedMinor: '199800',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    expect(recorded.body.entry).toBeNull();
    expect(recorded.body.draft.state).toBe('posted');
    expect(recorded.body.voucher).toMatchObject({ number: 2 });
    const audit = await withCompany(db, books.companyId, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'cash_count.recorded')),
    );
    expect(audit).toHaveLength(1);
  });
});

describe('a voucher draft checked before it posts (S11 "Data")', () => {
  it('refuses lines typed on a count, and a malformed voucher at submission', async () => {
    const books = await contractor();
    const count = await voucherDraft(
      books,
      { kind: 'count', cashAccountId: books.accounts.get('111002'), countedMinor: '0' },
      [line(books, '532007', 'USD', '100'), line(books, '111002', 'USD', '-100')],
    );
    const preview = await books.browser.post(`/api/drafts/${count}/preview`);
    expect(preview.body.refusals[0]).toMatchObject({ code: 'CASH_ACCOUNT_INVALID' });
    const posted = await books.browser.post(`/api/drafts/${count}/post`, { expectedMinor: '0' });
    expect([posted.status, posted.body.code]).toEqual([422, 'CASH_ACCOUNT_INVALID']);

    const approval = await books.browser.patch('/api/company', { manualEntryApproval: true });
    expect(approval.status, JSON.stringify(approval.body)).toBe(200);
    const malformed = await voucherDraft(
      books,
      { kind: 'receipt', cashAccountId: books.accounts.get('313001') },
      [line(books, '313001', 'USD', '100'), line(books, '111002', 'USD', '-100')],
    );
    const submitted = await books.browser.post(`/api/drafts/${malformed}/submit`);
    expect([submitted.status, submitted.body.code]).toEqual([422, 'CASH_ACCOUNT_INVALID']);
  });
});

describe('the cash reads (S11 rules 16–17)', () => {
  it('answers the position, a statement, the register and a voucher; never another company’s', async () => {
    const books = await contractor();
    const posted = await books.browser.post(
      `/api/drafts/${await receipt(books, '111002', 'USD', '200000')}/post`,
    );
    await books.browser.post(
      `/api/drafts/${await voucherDraft(
        books,
        { kind: 'payment', cashAccountId: books.accounts.get('111002') },
        [line(books, '531005', 'USD', '5000'), line(books, '111002', 'USD', '-5000')],
      )}/post`,
    );
    const position = await books.browser.get('/api/cash/accounts', { asOf: today() });
    expect(position.status, JSON.stringify(position.body)).toBe(200);
    const usd = position.body.groups.find(
      (group: { currency: string }) => group.currency === 'USD',
    );
    expect(usd.total).toEqual({ amountMinor: '195000', currency: 'USD' });
    expect(
      usd.accounts.find((account: { code: string }) => account.code === '111002').parallel,
    ).toEqual({ amountMinor: '23400000', currency: 'SYP' });

    const box = books.accounts.get('111002') as string;
    const statement = await books.browser.get(`/api/cash/accounts/${box}/statement`, {
      from: today(),
      to: today(),
      ledgers: 'book,parallel',
    });
    expect(statement.status, JSON.stringify(statement.body)).toBe(200);
    expect(statement.body.opening.amount.amountMinor).toBe('0');
    expect(statement.body.rows.map((row: { balance: string }) => row.balance)).toEqual([
      '200000',
      '195000',
    ]);
    expect(statement.body.rows[1].counterAccount.code).toBe('531005');
    expect(statement.body.closing.amount.amountMinor).toBe('195000');
    expect([statement.body.totalIn, statement.body.totalOut]).toEqual(['200000', '5000']);

    const register = await books.browser.get('/api/vouchers', { kind: 'receipt' });
    expect(register.status, JSON.stringify(register.body)).toBe(200);
    expect(register.body.vouchers).toHaveLength(1);
    expect(register.body.vouchers[0]).toMatchObject({
      kind: 'receipt',
      number: 1,
      state: 'posted',
      amount: { amountMinor: '200000', currency: 'USD' },
    });
    const voucher = await books.browser.get(`/api/vouchers/${posted.body.voucher.id}`);
    expect(voucher.status, JSON.stringify(voucher.body)).toBe(200);
    expect(voucher.body.entryDetail.id).toBe(posted.body.entry.id);

    // A viewer reads them (reports.read); another company's member reads nothing of them.
    const viewer = await joinCompany(app, db, books.companyId, 'viewer');
    expect((await viewer.browser.get('/api/vouchers')).body.vouchers).toHaveLength(2);
    const other = await contractor();
    expect((await other.browser.get(`/api/vouchers/${posted.body.voucher.id}`)).body.code).toBe(
      'NOT_FOUND',
    );
    expect(
      (
        await other.browser.get(`/api/cash/accounts/${box}/statement`, {
          from: today(),
          to: today(),
        })
      ).body.code,
    ).toBe('NOT_FOUND');
    expect((await other.browser.get('/api/vouchers')).body.vouchers).toEqual([]);
  });
});
