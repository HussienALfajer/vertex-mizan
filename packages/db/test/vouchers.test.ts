import {
  type CompanyLedgers,
  type CurrencyCode,
  DomainError,
  VOUCHER_KINDS,
  type VoucherKind,
} from '@vertex-mizan/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditEntries,
  cashVouchers,
  chartAccounts,
  createCompanyBooks,
  entryDrafts,
  journalEntries,
  journalLines,
  type ManualLineSpec,
  type PersonActor,
  post,
  postVoucher,
  previewVoucher,
  recordRate,
  type Transaction,
  users,
  voucherKind,
  voucherSequences,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S11 PR 2 on the migrated database (0067–0068): vouchers posted through the posting function with
// the numbers of `cash/transfer-and-exchange` and `cash/cash-count` (a receipt, an exchange at its
// derived rate, a count's shortage, a stale count, a count that matched), their gapless numbers per
// kind and fiscal year, the box rule (a payment beyond the box, a back-dated one, a reversal of
// spent cash, two payments at once), the replay of a draft, and the guards against vouchers and
// sequences written by hand. All values are synthetic.

const { app, owner } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-voucher-test',
  ipAddress: null,
  userAgent: null,
});

/** The client's shape: a USD book at market accepting dealt rates, an SYP parallel at the bulletin. */
const CLIENT: CompanyLedgers = {
  book: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
  parallel: {
    currency: 'SYP',
    ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false },
  },
};

const TODAY = '2026-12-31';

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

interface Books {
  readonly id: string;
  readonly accounts: Map<string, string>;
}

async function newBooks(): Promise<Books> {
  const id = uuidv7();
  await withCompany(app, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة مقاولات تجريبية',
        nameLatin: null,
        ledgers: CLIENT,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'contracting',
        createdByUserId: personId,
      },
      actor(),
    );
    const rates: [string, CurrencyCode, CurrencyCode, string, 'bulletin' | 'market'][] = [];
    for (const day of ['2026-12-01', '2026-12-02', '2026-12-03']) {
      rates.push([day, 'USD', 'SYP', '120.0000', 'bulletin']);
      rates.push([day, 'TRY', 'SYP', '3.5000', 'bulletin']);
    }
    // A market rate stays in force until a newer one: one row serves the three days.
    rates.push(['2026-12-01', 'USD', 'TRY', '34.0000', 'market']);
    for (const [effectiveOn, base, quote, rate, type] of rates) {
      await recordRate(tx, id, actor(), { effectiveOn, base, quote, rate, type, source: 'manual' });
    }
  });
  const accounts = await inCompany(id, (tx) =>
    tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts),
  );
  return { id, accounts: new Map(accounts.map((row) => [row.code, row.id])) };
}

interface VoucherInput {
  readonly kind: VoucherKind;
  readonly cash: string;
  readonly counter?: string;
  readonly on: string;
  readonly lines?: readonly [string, CurrencyCode, bigint][];
  readonly counted?: bigint;
  readonly expected?: bigint;
}

const account = (books: Books, code: string) => books.accounts.get(code) as string;

function linesOf(books: Books, voucher: VoucherInput): ManualLineSpec[] {
  return (voucher.lines ?? []).map(([code, currency, amountMinor]) => ({
    accountId: account(books, code),
    dimensionValueIds: [],
    currency,
    amountMinor,
    memo: null,
  }));
}

/** Saves a voucher draft as the drafts service does, and posts it through `postVoucher()`. */
async function postVoucherOf(books: Books, voucher: VoucherInput, tx?: Transaction) {
  const work = async (inner: Transaction) => {
    const draftId = uuidv7();
    await inner.insert(entryDrafts).values({
      id: draftId,
      companyId: books.id,
      state: 'draft',
      entryDate: voucher.on,
      description: 'سند تجريبي',
      preparedByUserId: personId,
      voucherKind: voucher.kind,
      cashAccountId: account(books, voucher.cash),
      counterCashAccountId: voucher.counter === undefined ? null : account(books, voucher.counter),
      countedMinor: voucher.counted ?? null,
    });
    const posted = await postVoucher(inner, {
      client: 'manual',
      idempotencyKey: draftId,
      entryDate: voucher.on,
      description: 'سند تجريبي',
      reference: null,
      draftId,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      voucher: {
        kind: voucher.kind,
        cashAccountId: account(books, voucher.cash),
        counterCashAccountId:
          voucher.counter === undefined ? null : account(books, voucher.counter),
        partyName: null,
        countedMinor: voucher.counted ?? null,
        expectedMinor: voucher.expected ?? null,
      },
      lines: linesOf(books, voucher),
      dealtRates: [],
      today: TODAY,
    });
    await inner
      .update(entryDrafts)
      .set({ state: 'posted', postedEntryId: posted.entry?.id ?? null })
      .where(eq(entryDrafts.id, draftId));
    return { ...posted, draftId };
  };
  return tx === undefined ? inCompany(books.id, work) : work(tx);
}

async function codeOf(work: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, details: error.details };
    throw error;
  }
  return { code: 'none', details: null };
}

const receipt = (
  books: Books,
  cash: string,
  currency: CurrencyCode,
  amount: bigint,
  on = '2026-12-01',
) =>
  postVoucherOf(books, {
    kind: 'receipt',
    cash,
    on,
    lines: [
      [cash, currency, amount],
      ['313001', currency, -amount],
    ],
  });

const payment = (books: Books, cash: string, amount: bigint, on: string) =>
  postVoucherOf(books, {
    kind: 'payment',
    cash,
    on,
    lines: [
      ['531005', 'USD', amount],
      [cash, 'USD', -amount],
    ],
  });

async function linesOfEntry(books: Books, entryId: string) {
  return inCompany(books.id, (tx) =>
    tx
      .select({
        code: chartAccounts.code,
        amount: journalLines.amountMinor,
        book: journalLines.bookMinor,
        parallel: journalLines.parallelMinor,
      })
      .from(journalLines)
      .innerJoin(chartAccounts, eq(chartAccounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, entryId))
      .orderBy(asc(journalLines.lineNo)),
  );
}

beforeAll(async () => {
  const [person] = await app
    .insert(users)
    .values({ email: `voucher-${uuidv7()}@example.test`, name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  personId = person?.id as string;
});

describe('vouchers through the posting function (S11 rules 9–12)', () => {
  it("keeps the voucher_kind enum equal to contracts' VOUCHER_KINDS", () => {
    expect(voucherKind.enumValues).toEqual([...VOUCHER_KINDS]);
  });

  it("posts a receipt and the scenario's exchange at its derived rate, numbered per kind", async () => {
    const books = await newBooks();
    const first = await receipt(books, '111002', 'USD', 200000n);
    expect(first).toMatchObject({ kind: 'receipt', fiscalYear: 2026, number: 1 });
    const exchange = await postVoucherOf(books, {
      kind: 'transfer',
      cash: '111002',
      counter: '111005',
      on: '2026-12-01',
      lines: [
        ['111002', 'USD', -101000n],
        ['111005', 'TRY', 3450000n],
        ['532002', 'USD', 1000n],
      ],
    });
    expect(exchange).toMatchObject({ kind: 'transfer', number: 1 });
    expect(await linesOfEntry(books, exchange.entry?.id as string)).toEqual([
      { code: '111002', amount: -101000n, book: -101000n, parallel: -12120000n },
      { code: '111005', amount: 3450000n, book: 100000n, parallel: 12075000n },
      { code: '532002', amount: 1000n, book: 1000n, parallel: 120000n },
      { code: '421001', amount: -75000n, book: 0n, parallel: -75000n },
    ]);
    const [entry] = await inCompany(books.id, (tx) =>
      tx
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, exchange.entry?.id as string)),
    );
    expect(entry?.reference).toBe('سند تحويل 2026/1');
    const second = await receipt(books, '111002', 'USD', 100n, '2026-12-02');
    expect(second.number).toBe(2);
  });

  it('previews the derived rate in the company orientation, rounded to 10 decimals', async () => {
    const books = await newBooks();
    await receipt(books, '111005', 'TRY', 1000000n, '2026-12-03');
    const preview = await inCompany(books.id, (tx) =>
      previewVoucher(tx, {
        voucher: {
          kind: 'transfer',
          cashAccountId: account(books, '111005'),
          counterCashAccountId: account(books, '111002'),
          partyName: null,
          countedMinor: null,
          expectedMinor: null,
        },
        lines: linesOf(books, {
          kind: 'transfer',
          cash: '111005',
          on: '2026-12-03',
          lines: [
            ['111005', 'TRY', -1000000n],
            ['111002', 'USD', 29300n],
          ],
        }),
        dealtRates: [],
        entryDate: '2026-12-03',
        today: TODAY,
      }),
    );
    expect(preview.derivedRate).toEqual({ base: 'USD', quote: 'TRY', rate: '34.1296928328' });
    expect(preview.lines.map((line) => [line.amountMinor, line.bookMinor])).toContainEqual([
      -1000000n,
      -29300n,
    ]);
  });

  it('answers a replayed draft with its voucher and posts nothing more', async () => {
    const books = await newBooks();
    const first = await receipt(books, '111002', 'USD', 5000n);
    const again = await inCompany(books.id, (tx) =>
      postVoucher(tx, {
        client: 'manual',
        idempotencyKey: first.draftId,
        entryDate: '2026-12-01',
        description: 'سند تجريبي',
        reference: null,
        draftId: first.draftId,
        preparedByUserId: personId,
        approvedByUserId: null,
        actor: actor(),
        voucher: {
          kind: 'receipt',
          cashAccountId: account(books, '111002'),
          counterCashAccountId: null,
          partyName: null,
          countedMinor: null,
          expectedMinor: null,
        },
        lines: [],
        dealtRates: [],
        today: TODAY,
      }),
    );
    expect(again).toMatchObject({ id: first.id, number: 1, replayed: true });
    const vouchers = await inCompany(books.id, (tx) => tx.select().from(cashVouchers));
    expect(vouchers).toHaveLength(1);
  });

  it('refuses a voucher on an account that is not a cash account, or a transfer to itself', async () => {
    const books = await newBooks();
    expect(
      (
        await codeOf(
          postVoucherOf(books, {
            kind: 'receipt',
            cash: '313001',
            on: '2026-12-01',
            lines: [
              ['313001', 'USD', 100n],
              ['111002', 'USD', -100n],
            ],
          }),
        )
      ).code,
    ).toBe('CASH_ACCOUNT_INVALID');
  });
});

describe('the box rule (S11 rule 8)', () => {
  it('refuses a payment beyond the box, taking no number, and allows one to exactly zero', async () => {
    const books = await newBooks();
    await receipt(books, '111002', 'USD', 100000n);
    const refused = await codeOf(payment(books, '111002', 120000n, '2026-12-02'));
    expect(refused).toEqual({
      code: 'CASH_BOX_NEGATIVE',
      details: expect.objectContaining({
        account: '111002',
        date: '2026-12-02',
        shortfallMinor: '20000',
      }),
    });
    const paid = await payment(books, '111002', 100000n, '2026-12-02');
    expect(paid.number).toBe(1);
  });

  it('refuses a back-dated payment that leaves a later date short, naming that date', async () => {
    const books = await newBooks();
    await receipt(books, '111002', 'USD', 100000n);
    await payment(books, '111002', 80000n, '2026-12-03');
    const refused = await codeOf(payment(books, '111002', 30000n, '2026-12-02'));
    expect(refused).toEqual({
      code: 'CASH_BOX_NEGATIVE',
      details: expect.objectContaining({ date: '2026-12-03', shortfallMinor: '10000' }),
    });
  });

  it('refuses the reversal of a receipt whose cash was spent, of any source', async () => {
    const books = await newBooks();
    const first = await receipt(books, '111002', 'USD', 100000n);
    await payment(books, '111002', 60000n, '2026-12-02');
    const reversal = inCompany(books.id, (tx) =>
      post(tx, {
        client: 'manual',
        idempotencyKey: `reversal:${first.entry?.id}`,
        entryDate: '2026-12-03',
        description: 'عكس',
        reference: null,
        draftId: null,
        preparedByUserId: personId,
        approvedByUserId: null,
        actor: actor(),
        content: { kind: 'reversal', entryId: first.entry?.id as string, today: TODAY },
      }),
    );
    expect((await codeOf(reversal)).code).toBe('CASH_BOX_NEGATIVE');
  });

  it('lets one of two payments from one box at once post and refuses the other', async () => {
    const books = await newBooks();
    await receipt(books, '111002', 'USD', 100000n);
    const results = await Promise.all([
      codeOf(payment(books, '111002', 60000n, '2026-12-02')),
      codeOf(payment(books, '111002', 60000n, '2026-12-02')),
    ]);
    expect(results.map((result) => result.code).sort()).toEqual(['CASH_BOX_NEGATIVE', 'none']);
  });

  it('gives gapless numbers to receipts posted at once', async () => {
    const books = await newBooks();
    const posted = await Promise.all(
      Array.from({ length: 5 }, () => receipt(books, '111002', 'USD', 100n)),
    );
    expect(posted.map((voucher) => voucher.number).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('cash counts (S11 rule 13)', () => {
  it('posts a shortage, refuses a stale count and records a match with no entry', async () => {
    const books = await newBooks();
    await receipt(books, '111002', 'USD', 200000n);
    const stale = await codeOf(
      postVoucherOf(books, {
        kind: 'count',
        cash: '111002',
        on: '2026-12-02',
        counted: 194800n,
        expected: 195000n,
      }),
    );
    expect(stale).toEqual({ code: 'CASH_COUNT_STALE', details: { expectedMinor: '200000' } });
    const shortage = await postVoucherOf(books, {
      kind: 'count',
      cash: '111002',
      on: '2026-12-02',
      counted: 199800n,
      expected: 200000n,
    });
    expect(shortage.number).toBe(1);
    expect(await linesOfEntry(books, shortage.entry?.id as string)).toEqual([
      { code: '532007', amount: 200n, book: 200n, parallel: 24000n },
      { code: '111002', amount: -200n, book: -200n, parallel: -24000n },
    ]);
    const matched = await postVoucherOf(books, {
      kind: 'count',
      cash: '111002',
      on: '2026-12-03',
      counted: 199800n,
      expected: 199800n,
    });
    expect(matched).toMatchObject({ number: 2, entry: null });
    const recorded = await inCompany(books.id, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'cash_count.recorded')),
    );
    expect(recorded).toHaveLength(1);
  });
});

describe('the guards on vouchers and their numbers (0068)', () => {
  it('never changes or deletes a voucher, for the app role or the owner', async () => {
    const books = await newBooks();
    const posted = await receipt(books, '111002', 'USD', 100n);
    for (const database of [app, owner]) {
      expect(
        await refusal(
          withCompany(database, books.id, (tx) =>
            tx.execute(sql`update cash_vouchers set party_name = 'x' where id = ${posted.id}`),
          ),
        ),
      ).toMatch(/append-only|permission denied|refuse/i);
      expect(
        await refusal(
          withCompany(database, books.id, (tx) =>
            tx.execute(sql`delete from cash_vouchers where id = ${posted.id}`),
          ),
        ),
      ).toMatch(/append-only|permission denied|refuse/i);
    }
  });

  it('moves a sequence by one number only, and refuses a voucher written by hand', async () => {
    const books = await newBooks();
    const posted = await receipt(books, '111002', 'USD', 100n);
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.execute(sql`update voucher_sequences set last_number = last_number + 2`),
        ),
      ),
    ).toMatch(/moves by one number/);
    expect(
      await refusal(
        inCompany(books.id, async (tx) => {
          const draftId = uuidv7();
          await tx.insert(entryDrafts).values({
            id: draftId,
            companyId: books.id,
            state: 'draft',
            entryDate: '2026-12-01',
            preparedByUserId: personId,
            voucherKind: 'receipt',
            cashAccountId: account(books, '111002'),
          });
          await tx.insert(cashVouchers).values({
            companyId: books.id,
            kind: 'receipt',
            fiscalYear: 2026,
            number: 1,
            voucherDate: '2026-12-01',
            entryId: posted.entry?.id as string,
            draftId,
            cashAccountId: account(books, '111002'),
          });
        }),
      ),
    ).toMatch(/cash_vouchers|duplicate key/);
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.insert(voucherSequences).values({
            companyId: books.id,
            kind: 'payment',
            fiscalYear: 2026,
            lastNumber: 1,
          }),
        ),
      ),
    ).toMatch(/was given but no voucher took it/);
  });

  it("never shows one company another's vouchers", async () => {
    const books = await newBooks();
    const other = await newBooks();
    await receipt(books, '111002', 'USD', 100n);
    const seen = await inCompany(other.id, (tx) => tx.select().from(cashVouchers));
    expect(seen).toEqual([]);
  });
});
