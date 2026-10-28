import type { INestApplication } from '@nestjs/common';
import { auditEntries, type Database, withCompany } from '@vertex-mizan/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './app.js';
import { type Books, books, draftOf, files, line, posted, purchase, today } from './books.js';
import { expectGuarded } from './guards.js';
import { testDatabase } from './people.js';

// Posted entries through the API (S03 rules 9–10, 17, "Screens", acceptance steps 2–4 and 6): the
// journal, an entry with both ledgers, its rate rows and hash, the reversal (approval off and on),
// the copy, an account's lines with running balances, the entries of a rate row, files added after
// posting, and archiving an account with a balance. Every value is synthetic.

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

async function actions(companyId: string): Promise<string[]> {
  const rows = await withCompany(db, companyId, (tx) =>
    tx.select({ action: auditEntries.action }).from(auditEntries),
  );
  return rows.map((row) => row.action);
}

/** The day before `on`, as `YYYY-MM-DD`. */
const dayBefore = (on: string) =>
  new Date(Date.parse(`${on}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** A day in the month after today's: beyond rule 6's last day of the current month. */
const nextMonth = () => {
  const [year, month] = today().split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01-15` : `${year}-${String(month + 1).padStart(2, '0')}-15`;
};

const reverse = (book: Books, id: string, date = today()) =>
  book.owner.browser.post(`/api/entries/${id}/reverse`, {
    date,
    description: 'عكس القيد: خطأ في المبلغ',
  });

describe('the guard on every entry route', () => {
  it('answers 401, 403, COMPANY_SWITCHED and COMPANY_ARCHIVED', async () => {
    const id = uuidv7();
    await expectGuarded(app, db, [
      { method: 'get', path: '/api/entries' },
      { method: 'get', path: `/api/entries/${id}` },
      { method: 'post', path: `/api/entries/${id}/reverse` },
      { method: 'post', path: `/api/entries/${id}/copy` },
      { method: 'post', path: `/api/entries/${id}/attachments` },
      { method: 'get', path: `/api/attachments/${id}` },
      { method: 'get', path: `/api/accounts/${id}/lines` },
      { method: 'get', path: `/api/rates/${id}/entries` },
    ]);
  });
});

describe('an entry (acceptance steps 2–3)', () => {
  it('shows both ledgers, the rate rows, the people and the hash; every role reads it', async () => {
    const book = await books(app, db);
    const entry = await posted(book.owner.browser, purchase(book));
    const viewer = await book.join('viewer');
    const read = await viewer.browser.get(`/api/entries/${entry.id}`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({
      fiscalYear: Number(today().slice(0, 4)),
      number: 1,
      sequence: '1',
      entryDate: today(),
      source: 'manual',
      description: 'شراء دولار',
      bookCurrency: 'SYP',
      parallelCurrency: 'USD',
      previousHash: null,
      reverses: null,
      reversedBy: null,
    });
    expect(read.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      read.body.lines.map(
        (l: {
          accountCode: string;
          amountMinor: string;
          bookMinor: string;
          parallelMinor: string;
        }) => [l.accountCode, l.amountMinor, l.bookMinor, l.parallelMinor],
      ),
    ).toEqual([
      ['111004', '10000', '1215000', '10000'],
      ['111003', '-1225000', '-1225000', '-10000'],
      ['541001', '10000', '10000', '0'],
    ]);
    expect(read.body.lines[0].conversions).toEqual([
      expect.objectContaining({
        ledger: 'book',
        basis: 'policy',
        rateId: book.rates.bulletin,
        rate: '121.5',
      }),
    ]);
    expect(read.body.lines[1].conversions).toEqual([
      expect.objectContaining({
        ledger: 'parallel',
        basis: 'transaction',
        rateId: null,
        rate: '122.5',
      }),
    ]);
    expect(read.body.postedBy).toEqual(read.body.preparedBy);

    const journal = await viewer.browser.get('/api/entries');
    expect(journal.body.entries).toEqual([
      expect.objectContaining({
        id: entry.id,
        bookDebit: { amountMinor: '1225000', currency: 'SYP' },
        parallelDebit: { amountMinor: '10000', currency: 'USD' },
        reversedByEntryId: null,
      }),
    ]);
    for (const query of [
      { number: '1' },
      { text: 'دولار' },
      { account: book.accounts.get('541001') as string },
      { from: today(), to: today() },
      { source: 'manual' },
    ]) {
      expect(
        (await viewer.browser.get('/api/entries', query)).body.entries,
        JSON.stringify(query),
      ).toHaveLength(1);
    }
    for (const query of [{ number: '2' }, { text: '50%' }, { source: 'hub_event' }]) {
      expect(
        (await viewer.browser.get('/api/entries', query)).body.entries,
        JSON.stringify(query),
      ).toEqual([]);
    }
    expect((await viewer.browser.get(`/api/entries/${uuidv7()}`)).body.code).toBe('NOT_FOUND');
  });

  it("never shows another company's entries", async () => {
    const first = await books(app, db);
    const second = await books(app, db);
    const entry = await posted(first.owner.browser, purchase(first));
    const other = second.owner.browser;
    expect((await other.get(`/api/entries/${entry.id}`)).body.code).toBe('NOT_FOUND');
    expect((await other.get('/api/entries')).body.entries).toEqual([]);
    expect(
      (await other.post(`/api/entries/${entry.id}/reverse`, { date: today(), description: 'عكس' }))
        .body.code,
    ).toBe('NOT_FOUND');
    expect((await other.post(`/api/entries/${entry.id}/copy`)).body.code).toBe('NOT_FOUND');
    expect(
      (await other.upload(`/api/entries/${entry.id}/attachments`, files.pdf, 'a.pdf')).body.code,
    ).toBe('NOT_FOUND');
    expect((await first.owner.browser.get(`/api/entries/${entry.id}`)).body.attachments).toEqual(
      [],
    );
    expect((await other.get(`/api/accounts/${first.accounts.get('111004')}/lines`)).body.code).toBe(
      'NOT_FOUND',
    );
    expect((await other.get(`/api/rates/${first.rates.bulletin}/entries`)).body.code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('the reversal (rule 9, acceptance step 3)', () => {
  it('negates every line at its amounts, once, and returns the account to zero', async () => {
    const book = await books(app, db);
    const entry = await posted(book.owner.browser, purchase(book));
    expect((await reverse(book, entry.id, dayBefore(today()))).body.code).toBe(
      'REVERSAL_BEFORE_ORIGINAL',
    );
    expect((await reverse(book, entry.id, nextMonth())).body.code).toBe('ENTRY_DATE_OUT_OF_RANGE');
    const reversal = await reverse(book, entry.id);
    expect(reversal.status, JSON.stringify(reversal.body)).toBe(200);
    expect(reversal.body.draft).toBeNull();
    expect(reversal.body.entry).toMatchObject({
      number: 2,
      reverses: { id: entry.id, number: 1 },
    });
    expect(
      reversal.body.entry.lines.map(
        (l: { bookMinor: string; parallelMinor: string; conversions: unknown[] }) => [
          l.bookMinor,
          l.parallelMinor,
          l.conversions.length,
        ],
      ),
    ).toEqual([
      ['-1215000', '-10000', 0],
      ['1225000', '10000', 0],
      ['-10000', '0', 0],
    ]);
    expect((await reverse(book, entry.id)).body.code).toBe('ENTRY_ALREADY_REVERSED');
    expect((await reverse(book, reversal.body.entry.id)).body.code).toBe('ENTRY_NOT_REVERSIBLE');
    expect(
      (await book.owner.browser.get(`/api/entries/${entry.id}`)).body.reversedBy,
    ).toMatchObject({
      id: reversal.body.entry.id,
      number: 2,
    });

    const lines = await book.owner.browser.get(
      `/api/accounts/${book.accounts.get('111004')}/lines`,
      {
        currency: 'USD',
      },
    );
    expect(lines.status, JSON.stringify(lines.body)).toBe(200);
    expect(
      lines.body.lines.map(
        (l: {
          balance: {
            transaction: { amountMinor: string };
            book: { amountMinor: string };
            parallel: { amountMinor: string };
          };
        }) => [
          l.balance.transaction.amountMinor,
          l.balance.book.amountMinor,
          l.balance.parallel.amountMinor,
        ],
      ),
    ).toEqual([
      ['10000', '1215000', '10000'],
      ['0', '0', '0'],
    ]);
    expect(await actions(book.companyId)).toEqual(expect.arrayContaining(['entry.posted']));
  });

  it('becomes a draft approved by someone else when approval is on', async () => {
    const book = await books(app, db);
    const entry = await posted(book.owner.browser, purchase(book));
    await book.owner.browser.patch('/api/company', { manualEntryApproval: true });
    const accountant = await book.join('accountant');
    const pending = await accountant.browser.post(`/api/entries/${entry.id}/reverse`, {
      date: today(),
      description: 'عكس القيد 1: خطأ',
    });
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body.entry).toBeNull();
    expect(pending.body.draft).toMatchObject({
      reversesEntryId: entry.id,
      state: 'draft',
      lines: [],
    });
    expect((await reverse(book, entry.id)).body.code).toBe('ENTRY_ALREADY_REVERSED');
    const draftId = pending.body.draft.id;
    const preview = await accountant.browser.post(`/api/drafts/${draftId}/preview`);
    expect(preview.body.lines).toHaveLength(3);
    await accountant.browser.post(`/api/drafts/${draftId}/submit`);
    const approved = await book.owner.browser.post(`/api/drafts/${draftId}/approve`);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.entry).toMatchObject({ reverses: { id: entry.id }, draftId });
  });

  it('needs entries.post to reverse when approval is off', async () => {
    const book = await books(app, db);
    const entry = await posted(book.owner.browser, purchase(book));
    const approver = await book.join('approver');
    expect(
      (
        await approver.browser.post(`/api/entries/${entry.id}/reverse`, {
          date: today(),
          description: 'عكس',
        })
      ).body.code,
    ).toBe('FORBIDDEN');
  });
});

describe('the copy (rule 10, acceptance step 4)', () => {
  it('copies the typed lines and the dealt rate; without it the parallel ledger shows its loss', async () => {
    const book = await books(app, db);
    const entry = await posted(book.owner.browser, purchase(book));
    const copy = await book.owner.browser.post(`/api/entries/${entry.id}/copy`);
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    expect(copy.body).toMatchObject({
      entryDate: today(),
      description: 'شراء دولار',
      copiedFromEntryId: entry.id,
      dealtRates: [{ base: 'USD', quote: 'SYP', rate: '122.5' }],
    });
    expect(copy.body.lines.map((l: { amountMinor: string }) => l.amountMinor)).toEqual([
      '10000',
      '-1225000',
    ]);
    const saved = await book.owner.browser.put(`/api/drafts/${copy.body.id}`, {
      ...purchase(book, false),
      updatedAt: copy.body.updatedAt,
    });
    expect(saved.status).toBe(200);
    const result = await book.owner.browser.post(`/api/drafts/${copy.body.id}/post`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(
      result.body.entry.lines.map(
        (l: {
          accountCode: string;
          ledger: string | null;
          bookMinor: string;
          parallelMinor: string;
        }) => [l.accountCode, l.ledger, l.bookMinor, l.parallelMinor],
      ),
    ).toEqual([
      ['111004', null, '1215000', '10000'],
      ['111003', null, '-1225000', '-10041'],
      ['541001', 'book', '10000', '0'],
      ['541001', 'parallel', '0', '41'],
    ]);
    // The loss account after both entries: the balance before a range opens it.
    const tomorrow = new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const loss = await book.owner.browser.get(
      `/api/accounts/${book.accounts.get('541001')}/lines`,
      { from: tomorrow },
    );
    expect(loss.body).toMatchObject({
      opening: {
        transaction: null,
        book: { amountMinor: '20000', currency: 'SYP' },
        parallel: { amountMinor: '41', currency: 'USD' },
      },
      lines: [],
      nextCursor: null,
    });
  });
});

describe('the entries of a rate row (S02 rule 15)', () => {
  it('lists the entries whose conversions used the row', async () => {
    const book = await books(app, db);
    const entry = await posted(book.owner.browser, purchase(book));
    const used = await book.owner.browser.get(`/api/rates/${book.rates.bulletin}/entries`);
    expect(used.body.entries.map((e: { id: string }) => e.id)).toEqual([entry.id]);
    // The dealt rate replaced the market row in the parallel ledger.
    expect(
      (await book.owner.browser.get(`/api/rates/${book.rates.market}/entries`)).body.entries,
    ).toEqual([]);
    expect((await book.owner.browser.get(`/api/rates/${uuidv7()}/entries`)).body.code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('files of a posted entry (rule 17, acceptance step 6)', () => {
  it('adds files to a posted entry, with entries.attach', async () => {
    const book = await books(app, db);
    const entry = await posted(book.owner.browser, purchase(book));
    const added = await book.owner.browser.upload(
      `/api/entries/${entry.id}/attachments`,
      files.pdf,
      'عقد.pdf',
    );
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body).toMatchObject({ entryId: entry.id, draftId: null });
    const approver = await book.join('approver');
    expect(
      (await approver.browser.upload(`/api/entries/${entry.id}/attachments`, files.pdf, 'a.pdf'))
        .body.code,
    ).toBe('FORBIDDEN');
    expect(
      (await book.owner.browser.get(`/api/entries/${entry.id}`)).body.attachments,
    ).toHaveLength(1);
  });
});

describe('archiving an account (S02 rule 6, S03)', () => {
  it('refuses an account with a balance in either ledger, and archives it at zero', async () => {
    const book = await books(app, db);
    const usdBank = book.accounts.get('111004') as string;
    const entry = await posted(book.owner.browser, purchase(book));
    const archive = () =>
      book.owner.browser.post(`/api/accounts/${usdBank}/archive`, { reason: 'حساب مغلق' });
    expect((await archive()).body.code).toBe('ACCOUNT_HAS_BALANCE');
    await reverse(book, entry.id);
    expect((await archive()).status).toBe(200);
  });

  it('refuses a balance in one currency that another currency cancels in the book (S02 rule 6)', async () => {
    // SYP books only: a suspense account with no currency restriction, holding +100.00 USD and
    // -12,150.00 SYP, whose book total is zero.
    const book = await books(app, db, {
      ledgers: {
        book: {
          currency: 'SYP',
          ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
        },
        parallel: null,
      },
    });
    const { browser } = book.owner;
    const suspense = await browser.post('/api/accounts', {
      parentId: book.accounts.get('111'),
      code: '111099',
      kind: 'postable',
      name: 'حساب معلّق تجريبي',
      statementLine: 'bs.cash',
      currency: null,
      isMonetary: true,
    });
    expect(suspense.status, JSON.stringify(suspense.body)).toBe(201);
    const id = suspense.body.id as string;
    await posted(browser, {
      entryDate: today(),
      description: 'إلى الحساب المعلّق',
      lines: [
        { accountId: id, dimensionValueIds: [], currency: 'USD', amountMinor: '10000', memo: null },
        line(book, '111004', 'USD', '-10000'),
      ],
    });
    await posted(browser, {
      entryDate: today(),
      description: 'من الحساب المعلّق',
      lines: [
        line(book, '111003', 'SYP', '1215000'),
        {
          accountId: id,
          dimensionValueIds: [],
          currency: 'SYP',
          amountMinor: '-1215000',
          memo: null,
        },
      ],
    });
    const lines = await browser.get(`/api/accounts/${id}/lines`);
    expect(lines.body.lines.at(-1).balance.book.amountMinor).toBe('0');
    expect(
      (await browser.post(`/api/accounts/${id}/archive`, { reason: 'حساب مغلق' })).body.code,
    ).toBe('ACCOUNT_HAS_BALANCE');
  });

  it('saves a draft on any line and refuses a zero amount at save (edge case 3)', async () => {
    const book = await books(app, db);
    const zero = await book.owner.browser.post('/api/drafts', {
      entryDate: today(),
      lines: [line(book, '111004', 'USD', '0')],
    });
    expect(zero.body.code).toBe('VALIDATION_FAILED');
    expect((await draftOf(book.owner.browser, { entryDate: today() })).id).toBeDefined();
  });
});
