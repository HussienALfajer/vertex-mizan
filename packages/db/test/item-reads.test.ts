import type { CompanyLedgers, CurrencyCode } from '@vertex-mizan/contracts';
import { openItemProblems } from '@vertex-mizan/ledger';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  accountHasOpenItems,
  chartAccounts,
  createCompanyBooks,
  dimensionTypes,
  dimensionValues,
  openItems,
  type PersonActor,
  post,
  readClientStatement,
  readDueDates,
  readItemBalances,
  readItemMovements,
  readItemsAt,
  readLedgerState,
  readOpenItemState,
  recordRate,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect } from './connections.js';

// The reads of the open items (S04 "Reports") on the migrated database: items at a date, their
// due dates, movements and balance rows, a client's statement, the integrity check's state and the
// archiving check, over the S04 example (`receivables/manual-settlement`). Synthetic values only.

const { app } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-item-reads-test',
  ipAddress: null,
  userAgent: null,
});

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

interface Books {
  readonly id: string;
  readonly accounts: Map<string, string>;
  readonly values: Map<string, string>;
}

const inCompany = <T>(books: Books, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, books.id, work);

/** Vertex Media's ledgers, the service-agency chart, clients C1 and C2, service S1, the rates. */
async function newBooks(): Promise<Books> {
  const id = uuidv7();
  await withCompany(app, id, (tx) =>
    createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة قراءات تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: personId,
      },
      actor(),
    ),
  );
  for (const [on, type, value] of [
    ['2026-11-03', 'bulletin', '120.0000'],
    ['2026-11-19', 'bulletin', '123.0000'],
    ['2026-11-25', 'bulletin', '123.5000'],
    ['2026-11-25', 'market', '124.0000'],
  ] as const) {
    await withCompany(app, id, (tx) =>
      recordRate(tx, id, actor(), {
        effectiveOn: on,
        base: 'USD',
        quote: 'SYP',
        rate: value,
        type,
        source: 'manual',
      }),
    );
  }
  return withCompany(app, id, async (tx) => {
    const types = await tx.select().from(dimensionTypes);
    const typeId = (code: string) => types.find((type) => type.code === code)?.id as string;
    const values = await tx
      .insert(dimensionValues)
      .values([
        { companyId: id, typeId: typeId('client'), code: 'C1', name: 'عميل تجريبي' },
        { companyId: id, typeId: typeId('client'), code: 'C2', name: 'عميل تجريبي آخر' },
        { companyId: id, typeId: typeId('service'), code: 'S1', name: 'خدمة تجريبية' },
      ])
      .returning({ id: dimensionValues.id, code: dimensionValues.code });
    const accounts = await tx
      .select({ id: chartAccounts.id, code: chartAccounts.code })
      .from(chartAccounts);
    return {
      id,
      accounts: new Map(accounts.map((row) => [row.code, row.id])),
      values: new Map(values.map((row) => [row.code as string, row.id])),
    };
  });
}

interface Spec {
  readonly code: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint;
  readonly dims?: readonly string[];
  readonly item?: string;
  readonly newItem?: { readonly reference: string; readonly dueOn: string | null };
}

const account = (books: Books, code: string) => books.accounts.get(code) as string;
const client = (books: Books, code: string) => books.values.get(code) as string;

function manual(books: Books, on: string, lines: readonly Spec[]) {
  return inCompany(books, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: uuidv7(),
      entryDate: on,
      description: 'قيد قراءات تجريبي',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: {
        kind: 'manual',
        today: '2026-11-30',
        dealtRates: [],
        lines: lines.map((line) => ({
          accountId: account(books, line.code),
          dimensionValueIds: (line.dims ?? []).map((code) => client(books, code)),
          currency: line.currency,
          amountMinor: line.amount,
          memo: null,
          ...(line.item !== undefined && { openItemId: line.item }),
          ...(line.newItem !== undefined && { newItem: line.newItem }),
        })),
      },
    }),
  );
}

/** The S04 example: M-1 (1,000.00 USD to C1, due 3 December), receipts of 400 and 600. */
async function example(books: Books) {
  await manual(books, '2026-11-03', [
    {
      code: '112001',
      currency: 'USD',
      amount: 100_000n,
      dims: ['C1'],
      newItem: { reference: 'M-1', dueOn: '2026-12-03' },
    },
    { code: '411001', currency: 'USD', amount: -100_000n, dims: ['C1', 'S1'] },
  ]);
  const [m1] = await inCompany(books, (tx) =>
    tx.select({ id: openItems.id }).from(openItems).where(eq(openItems.reference, 'M-1')),
  );
  if (!m1) throw new Error('no M-1');
  await manual(books, '2026-11-19', [
    { code: '111004', currency: 'USD', amount: 40_000n },
    { code: '112001', currency: 'USD', amount: -40_000n, item: m1.id },
  ]);
  await manual(books, '2026-11-25', [
    { code: '111003', currency: 'SYP', amount: 7_440_000n },
    { code: '112001', currency: 'USD', amount: -60_000n, item: m1.id },
  ]);
  return m1.id;
}

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: 'item.reads@example.test', name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  personId = row.id;
});

describe('readItemsAt', () => {
  it('reads what an item carries at the end of any date, from its movements', async () => {
    const books = await newBooks();
    const m1 = await example(books);
    const at = (asOf: string, extra = {}) =>
      inCompany(books, (tx) => readItemsAt(tx, { asOf, ...extra }));
    expect(await at('2026-11-02')).toEqual([]);
    const amounts = (rows: Awaited<ReturnType<typeof at>>) =>
      rows.map((row) => [row.reference, row.openMinor, row.bookMinor, row.parallelMinor]);
    expect(amounts(await at('2026-11-03'))).toEqual([['M-1', 100_000n, 12_000_000n, 100_000n]]);
    expect(amounts(await at('2026-11-19'))).toEqual([['M-1', 60_000n, 7_200_000n, 60_000n]]);
    expect(amounts(await at('2026-11-25'))).toEqual([['M-1', 0n, 0n, 0n]]);
    const [row] = await at('2026-11-19');
    expect(row).toMatchObject({
      id: m1,
      accountCode: '112001',
      kind: 'document',
      source: 'manual',
      clientCode: 'C1',
      currency: 'USD',
      documentDate: '2026-11-03',
      adjusted: false,
      movementCount: 2,
    });
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(await at('2026-11-25', { state: 'open' })).toEqual([]);
    expect(amounts(await at('2026-11-19', { state: 'open' }))).toHaveLength(1);
    expect(amounts(await at('2026-11-25', { state: 'settled' }))).toHaveLength(1);
    expect(await at('2026-11-02', { includeUnopened: true, itemIds: [m1] })).toMatchObject([
      { id: m1, openMinor: 0n, movementCount: 0 },
    ]);
    expect(await at('2026-11-30', { text: 'm-' })).toHaveLength(1);
    expect(await at('2026-11-30', { text: '%' })).toEqual([]);
    expect(await at('2026-11-30', { clientValueId: client(books, 'C2') })).toEqual([]);
    expect(await at('2026-11-30', { kind: 'running' })).toEqual([]);
    expect(await at('2026-11-30', { accountIds: [account(books, '113001')] })).toEqual([]);
    expect(await at('2026-11-30', { itemIds: [] })).toEqual([]);
  });

  it('pages newest first after an item', async () => {
    const books = await newBooks();
    for (const reference of ['P-1', 'P-2', 'P-3']) {
      await manual(books, '2026-11-03', [
        {
          code: '112001',
          currency: 'USD',
          amount: 10_000n,
          dims: ['C1'],
          newItem: { reference, dueOn: null },
        },
        { code: '411001', currency: 'USD', amount: -10_000n, dims: ['C1', 'S1'] },
      ]);
    }
    const all = await inCompany(books, (tx) => readItemsAt(tx, { asOf: '2026-11-30' }));
    expect(all.map((row) => row.reference)).toEqual(['P-3', 'P-2', 'P-1']);
    const next = await inCompany(books, (tx) =>
      readItemsAt(tx, { asOf: '2026-11-30', afterItemId: all[0]?.id ?? '', limit: 1 }),
    );
    expect(next.map((row) => row.reference)).toEqual(['P-2']);
  });
});

describe('an item’s movements, due dates and balance row', () => {
  it('lists each movement with its entry and the balance after it', async () => {
    const books = await newBooks();
    const m1 = await example(books);
    const movements = await inCompany(books, (tx) => readItemMovements(tx, m1, '2026-11-30'));
    expect(
      movements.map((row) => [row.kind, row.entryDate, row.amountMinor, row.balanceBookMinor]),
    ).toEqual([
      ['open', '2026-11-03', 100_000n, 12_000_000n],
      ['clear', '2026-11-19', -40_000n, 7_200_000n],
      ['clear', '2026-11-25', -60_000n, 0n],
    ]);
    expect((await inCompany(books, (tx) => readItemMovements(tx, m1, '2026-11-19'))).length).toBe(
      2,
    );
    expect(await inCompany(books, (tx) => readDueDates(tx, [m1]))).toMatchObject([
      { itemId: m1, dueOn: '2026-12-03', effectiveOn: '2026-11-03', setBy: 'opening' },
    ]);
    expect(await inCompany(books, (tx) => readDueDates(tx, []))).toEqual([]);
    const balances = await inCompany(books, (tx) => readItemBalances(tx, [m1, uuidv7()]));
    expect([...balances.entries()]).toEqual([
      [m1, { transaction: { amountMinor: 0n, currency: 'USD' }, bookMinor: 0n, parallelMinor: 0n }],
    ]);
  });
});

describe('readClientStatement', () => {
  it('lists the client’s movements with running balances, and opening plus movements is closing', async () => {
    const books = await newBooks();
    await example(books);
    const statement = (from: string | null, to: string, ledger: 'book' | 'parallel' = 'book') =>
      inCompany(books, (tx) =>
        readClientStatement(tx, {
          clientValueId: client(books, 'C1'),
          from,
          to,
          ledger,
          currency: null,
        }),
      );
    const whole = await statement(null, '2026-11-30');
    expect(whole.opening).toEqual([]);
    expect(whole.openingLedgerMinor).toBe(0n);
    expect(
      whole.movements.map((row) => [row.entryDate, row.kind, row.ledgerMinor, row.balanceMinor]),
    ).toEqual([
      ['2026-11-03', 'open', 12_000_000n, 100_000n],
      ['2026-11-19', 'clear', -4_800_000n, 60_000n],
      ['2026-11-25', 'clear', -7_200_000n, 0n],
    ]);
    expect(whole.closing).toEqual([{ currency: 'USD', amountMinor: 0n, ledgerMinor: 0n }]);
    const late = await statement('2026-11-19', '2026-11-30', 'parallel');
    expect(late.opening).toEqual([
      { currency: 'USD', amountMinor: 100_000n, ledgerMinor: 100_000n },
    ]);
    expect(late.movements.map((row) => [row.ledgerMinor, row.ledgerBalanceMinor])).toEqual([
      [-40_000n, 60_000n],
      [-60_000n, 0n],
    ]);
    expect(late.closingLedgerMinor).toBe(0n);
    const other = await inCompany(books, (tx) =>
      readClientStatement(tx, {
        clientValueId: client(books, 'C2'),
        from: null,
        to: '2026-11-30',
        ledger: 'book',
        currency: null,
      }),
    );
    expect(other.movements).toEqual([]);
  });
});

describe('another company’s ids', () => {
  it('reads nothing of them inside a company', async () => {
    const books = await newBooks();
    const other = await newBooks();
    const theirs = await example(other);
    const asOf = '2026-11-30';
    const reads = await inCompany(books, async (tx) => ({
      byId: await readItemsAt(tx, { asOf, itemIds: [theirs], includeUnopened: true }),
      byAccount: await readItemsAt(tx, { asOf, accountIds: [account(other, '112001')] }),
      byClient: await readItemsAt(tx, { asOf, clientValueId: client(other, 'C1') }),
      movements: await readItemMovements(tx, theirs, asOf),
      dueDates: await readDueDates(tx, [theirs]),
      balances: await readItemBalances(tx, [theirs]),
      statement: await readClientStatement(tx, {
        clientValueId: client(other, 'C1'),
        from: null,
        to: asOf,
        ledger: 'book',
        currency: null,
      }),
      state: await readOpenItemState(tx),
      open: await accountHasOpenItems(tx, account(other, '112001')),
    }));
    expect(reads).toEqual({
      byId: [],
      byAccount: [],
      byClient: [],
      movements: [],
      dueDates: [],
      balances: new Map(),
      statement: {
        opening: [],
        openingLedgerMinor: 0n,
        movements: [],
        closing: [],
        closingLedgerMinor: 0n,
      },
      state: expect.objectContaining({ items: [], movements: [], balances: [] }),
      open: false,
    });
  });
});

describe('the integrity check’s state and the archiving check', () => {
  it('reads the books as the posting function keeps them, which the comparisons pass', async () => {
    const books = await newBooks();
    const m1 = await example(books);
    const { state, ledger } = await inCompany(books, async (tx) => ({
      state: await readOpenItemState(tx),
      ledger: await readLedgerState(tx),
    }));
    expect(state.items).toEqual([{ id: m1, accountId: account(books, '112001'), currency: 'USD' }]);
    expect(state.movements).toHaveLength(3);
    expect(state.controlAccountIds).toContain(account(books, '213001'));
    expect(openItemProblems({ ...state, periodBalances: ledger.periodBalances })).toEqual({
      controlAccounts: [],
      itemBalances: [],
    });
  });

  it('finds an account with an open item, and none once it is settled', async () => {
    const books = await newBooks();
    await manual(books, '2026-11-03', [
      {
        code: '112001',
        currency: 'USD',
        amount: 10_000n,
        dims: ['C1'],
        newItem: { reference: 'A-1', dueOn: null },
      },
      { code: '411001', currency: 'USD', amount: -10_000n, dims: ['C1', 'S1'] },
    ]);
    const receivable = account(books, '112001');
    expect(await inCompany(books, (tx) => accountHasOpenItems(tx, receivable))).toBe(true);
    expect(await inCompany(books, (tx) => accountHasOpenItems(tx, account(books, '113001')))).toBe(
      false,
    );
  });
});
