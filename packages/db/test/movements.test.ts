import {
  PROJECT_MOVEMENT_KINDS as CONTRACT_KINDS,
  type CompanyLedgers,
  type CurrencyCode,
  type RecordMovement,
} from '@vertex-mizan/contracts';
import { eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cancelMovement,
  companySettings,
  createCompanyBooks,
  createMaterial,
  createParty,
  createProject,
  journalEntries,
  type PersonActor,
  PROJECT_MOVEMENT_KINDS,
  post,
  projectMovementCancellations,
  projectMovementSequences,
  projectMovements,
  readDashboard,
  readDayRates,
  readFigures,
  readMaterialCosts,
  readMovements,
  readParties,
  readProjects,
  recordDayRates,
  recordMovement,
  type Transaction,
  updateProject,
  users,
  withCompany,
} from '../src/index.js';
import { closeMonthByHand, connect, refusal } from './connections.js';

// S13 (ADR 0024) on the migrated database (0079–0081): each movement recorded and posted through
// its path with the numbers of `projects/simple-movements`, the figures read from the ledger, the
// refusals of rules 2–9, a replay and a conflict, the cancellation and the guard that no other
// route reverses a movement's entry. All values are synthetic.

const { app, owner } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'مالك تجريبي',
  sessionId: null,
  requestId: 'request-movements-test',
  ipAddress: null,
  userAgent: null,
});

const USD_ONLY: CompanyLedgers = {
  book: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
  parallel: null,
};

const TODAY = '2026-12-31';

interface Books {
  readonly id: string;
  readonly project: string;
  readonly client: string;
  readonly supplier: string;
  readonly steel: string;
}

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

async function newBooks(): Promise<Books> {
  const id = uuidv7();
  return inCompany(id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة مقاولات تجريبية',
        nameLatin: null,
        ledgers: USD_ONLY,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'contracting',
        createdByUserId: personId,
      },
      actor(),
    );
    await recordDayRates(tx, id, actor(), {
      date: '2026-12-01',
      rates: [
        { base: 'USD', quote: 'SYP', rate: '118.5' },
        { base: 'USD', quote: 'TRY', rate: '41' },
      ],
      reason: null,
    });
    const project = await createProject(tx, id, actor(), {
      name: 'فيلا تجريبية',
      clientId: null,
      clientName: 'عميل تجريبي',
      startDate: '2026-12-01',
      contractValue: null,
    });
    const [row] = await readProjects(tx, { id: project });
    const supplier = await createParty(tx, id, actor(), { type: 'supplier', name: 'مورد تجريبي' });
    const steel = (
      await createMaterial(
        tx,
        id,
        { code: 'STL', name: 'حديد تسليح', nameLatin: null, unit: 'طن' },
        actor(),
      )
    ).id;
    return { id, project, client: row?.client.id as string, supplier, steel };
  });
}

/** A movement's input with a fresh key; the project's unless it is a deposit. */
function movement(
  books: Books,
  kind: RecordMovement['kind'],
  fields: Partial<RecordMovement> & { currency?: CurrencyCode } = {},
): RecordMovement {
  return {
    requestKey: uuidv7(),
    kind,
    date: '2026-12-02',
    projectId: kind === 'deposit' ? null : books.project,
    supplierId: kind === 'owed_by_us' || kind === 'debt_paid' ? books.supplier : null,
    currency: 'USD',
    amountMinor: null,
    material: null,
    description: 'حركة تجريبية',
    dealtRate: null,
    ...fields,
  };
}

const record = (books: Books, input: RecordMovement) =>
  inCompany(books.id, (tx) =>
    recordMovement(tx, { companyId: books.id, actor: actor(), today: TODAY }, input),
  );

/** The lines of an entry as `[account code, currency, amount, book]`, in line order. */
async function linesOf(books: Books, entryId: string) {
  return inCompany(books.id, async (tx) => {
    const result = await tx.execute<{
      code: string;
      currency: string;
      amount: string;
      book: string;
    }>(
      sql`
        select a.code, l.currency, l.amount_minor::text as amount, l.book_minor::text as book
        from public.journal_lines l join public.chart_accounts a on a.id = l.account_id
        where l.entry_id = ${entryId} order by l.line_no`,
    );
    return result.rows.map((row) => [row.code, row.currency, row.amount, row.book]);
  });
}

async function movementEntry(books: Books, id: string): Promise<string> {
  const page = await inCompany(books.id, (tx) => readMovements(tx, { limit: 200 }));
  const found = page.movements.find((row) => row.id === id);
  if (found === undefined) throw new Error('no movement');
  return found.entryId;
}

beforeAll(async () => {
  const [person] = await app
    .insert(users)
    .values({ email: `movements-${uuidv7()}@example.test`, name: 'مالك تجريبي' })
    .returning({ id: users.id });
  personId = person?.id as string;
});

describe('recording movements', () => {
  it("posts each kind's entry and reads the project's figures from the ledger", async () => {
    const books = await newBooks();
    await record(books, movement(books, 'deposit', { amountMinor: '400000' }));
    const received = await record(books, movement(books, 'received', { amountMinor: '500000' }));
    const steel = await record(
      books,
      movement(books, 'expense', {
        material: { materialId: books.steel, quantity: '2.500', unitPrice: '820.0000' },
      }),
    );
    await record(books, movement(books, 'wages', { amountMinor: '120000' }));
    await record(
      books,
      movement(books, 'owed_by_us', {
        material: { materialId: books.steel, quantity: '10.000', unitPrice: '815.0000' },
      }),
    );
    await record(books, movement(books, 'debt_paid', { amountMinor: '300000' }));
    const owed = await record(books, movement(books, 'owed_to_us', { amountMinor: '400000' }));
    await record(
      books,
      movement(books, 'debt_collected', { amountMinor: '150000', date: '2026-12-03' }),
    );

    // projects/simple-movements: the receipt is revenue at once, the steel 2.500 × 820 = 2,050.00.
    expect(await linesOf(books, await movementEntry(books, received))).toEqual([
      ['111002', 'USD', '500000', '500000'],
      ['411001', 'USD', '-500000', '-500000'],
    ]);
    expect(await linesOf(books, await movementEntry(books, steel))).toEqual([
      ['511001', 'USD', '205000', '205000'],
      ['111002', 'USD', '-205000', '-205000'],
    ]);
    expect(await linesOf(books, await movementEntry(books, owed))).toEqual([
      ['112001', 'USD', '400000', '400000'],
      ['411001', 'USD', '-400000', '-400000'],
    ]);

    const figures = await inCompany(books.id, (tx) => readFigures(tx, books.project));
    expect(figures).toEqual({
      bookCurrency: 'USD',
      // 5,000.00 received + 4,000.00 owed to us
      revenueMinor: '900000',
      // 2,050.00 + 1,200.00 + 8,150.00
      costsMinor: '1140000',
      profitMinor: '-240000',
      receivedMinor: '500000',
      // the steel expense only; the steel bought on credit is owed by us (S13 "Reports")
      expensesMinor: '205000',
      wagesMinor: '120000',
      // 5,000.00 − 2,050.00 − 1,200.00 − 3,000.00 + 1,500.00; the deposit is not the project's
      netCashMinor: '25000',
      owedByUs: [{ currency: 'USD', amountMinor: '515000', bookMinor: '515000' }],
      owedToUs: [{ currency: 'USD', amountMinor: '250000', bookMinor: '250000' }],
      movementCount: 7,
    });
    const dashboard = await inCompany(books.id, (tx) => readDashboard(tx, TODAY));
    expect(dashboard.boxes).toEqual(
      [
        { currency: 'SYP', amountMinor: '0', bookMinor: '0' },
        // 4,000.00 + 250.00
        { currency: 'USD', amountMinor: '425000', bookMinor: '425000' },
        { currency: 'TRY', amountMinor: '0', bookMinor: '0' },
      ].sort((a, b) => a.currency.localeCompare(b.currency)),
    );
    expect(dashboard.projects).toEqual({ active: 1, finished: 0 });
    expect(dashboard.latestMovements).toHaveLength(8);

    const costs = await inCompany(books.id, (tx) => readMaterialCosts(tx, {}));
    expect(costs.materials).toEqual([
      {
        material: { id: books.steel, name: 'حديد تسليح', unit: 'طن' },
        quantity: '12.500',
        bookMinor: '1020000',
        byCurrency: [{ currency: 'USD', amountMinor: '1020000', bookMinor: '1020000' }],
        byProject: [
          {
            project: { id: books.project, name: 'فيلا تجريبية' },
            quantity: '12.500',
            bookMinor: '1020000',
          },
        ],
      },
    ]);
    const suppliers = await inCompany(books.id, (tx) => readParties(tx, 'supplier'));
    expect(suppliers[0]?.owedByUs).toEqual([
      { currency: 'USD', amountMinor: '515000', bookMinor: '515000' },
    ]);
    const clients = await inCompany(books.id, (tx) => readParties(tx, 'client'));
    expect(clients[0]?.owedToUs).toEqual([
      { currency: 'USD', amountMinor: '250000', bookMinor: '250000' },
    ]);
  });

  it('measures a SYP receipt at the rate of its day', async () => {
    const books = await newBooks();
    const id = await record(
      books,
      movement(books, 'received', { currency: 'SYP', amountMinor: '118500000' }),
    );
    // 1,185,000.00 SYP / 118.5 = 10,000.00 USD
    expect(await linesOf(books, await movementEntry(books, id))).toEqual([
      ['111001', 'SYP', '118500000', '1000000'],
      ['411001', 'SYP', '-118500000', '-1000000'],
    ]);
  });

  it('answers a replayed request with its first movement and refuses another under its key', async () => {
    const books = await newBooks();
    const input = movement(books, 'received', { amountMinor: '1000' });
    const first = await record(books, input);
    expect(await record(books, input)).toBe(first);
    expect(
      (await inCompany(books.id, (tx) => readMovements(tx, { limit: 50 }))).movements,
    ).toHaveLength(1);
    await expect(record(books, { ...input, amountMinor: '2000' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('posts one entry for two identical requests at once (rule 1)', async () => {
    const books = await newBooks();
    const input = movement(books, 'owed_to_us', { amountMinor: '1000' });
    const [first, second] = await Promise.all([record(books, input), record(books, input)]);
    expect(second).toBe(first);
    const page = await inCompany(books.id, (tx) => readMovements(tx, { limit: 50 }));
    expect(page.movements).toHaveLength(1);
  });

  it('refuses a receipt while the client owes the project, in any currency (rule 7)', async () => {
    const books = await newBooks();
    await record(books, movement(books, 'owed_to_us', { amountMinor: '400000' }));
    await expect(
      record(books, movement(books, 'received', { currency: 'SYP', amountMinor: '47400000' })),
    ).rejects.toMatchObject({ code: 'CLIENT_HAS_OPEN_DEBT' });
  });

  it('refuses more than is owed (rules 5 and 6)', async () => {
    const books = await newBooks();
    await record(books, movement(books, 'owed_to_us', { amountMinor: '1000' }));
    await expect(
      record(books, movement(books, 'debt_collected', { amountMinor: '1001' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await record(books, movement(books, 'owed_by_us', { amountMinor: '500' }));
    await record(books, movement(books, 'deposit', { amountMinor: '5000' }));
    await expect(
      record(books, movement(books, 'debt_paid', { amountMinor: '501' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a future date, an empty box and a finished project', async () => {
    const books = await newBooks();
    await expect(
      record(books, movement(books, 'received', { amountMinor: '1000', date: '2027-01-01' })),
    ).rejects.toMatchObject({ code: 'ENTRY_DATE_OUT_OF_RANGE' });
    await expect(
      record(books, movement(books, 'wages', { amountMinor: '1000' })),
    ).rejects.toMatchObject({ code: 'CASH_BOX_NEGATIVE' });
    await inCompany(books.id, (tx) =>
      updateProject(tx, books.id, actor(), books.project, { state: 'finished' }),
    );
    await expect(
      record(books, movement(books, 'received', { amountMinor: '1000' })),
    ).rejects.toMatchObject({ code: 'PROJECT_FINISHED' });
  });
});

describe('cancelling a movement', () => {
  it('reverses its entry, keeps it listed and counts it nowhere', async () => {
    const books = await newBooks();
    await record(books, movement(books, 'deposit', { amountMinor: '120000' }));
    const wages = await record(books, movement(books, 'wages', { amountMinor: '120000' }));
    const context = { companyId: books.id, actor: actor(), today: TODAY };
    await inCompany(books.id, (tx) => cancelMovement(tx, context, wages, { reason: 'سُجّلت خطأً' }));
    const figures = await inCompany(books.id, (tx) => readFigures(tx, books.project));
    expect(figures.wagesMinor).toBe('0');
    expect(figures.netCashMinor).toBe('0');
    expect(figures.movementCount).toBe(0);
    const page = await inCompany(books.id, (tx) => readMovements(tx, { limit: 50 }));
    expect(page.movements.find((row) => row.id === wages)?.cancellation).toMatchObject({
      reason: 'سُجّلت خطأً',
      on: TODAY,
    });
    await expect(
      inCompany(books.id, (tx) => cancelMovement(tx, context, wages, { reason: 'مرة ثانية' })),
    ).rejects.toMatchObject({ code: 'ENTRY_ALREADY_REVERSED' });
  });

  it('refuses a reversal of its entry by any other route', async () => {
    const books = await newBooks();
    const id = await record(books, movement(books, 'received', { amountMinor: '1000' }));
    const entryId = await movementEntry(books, id);
    const message = await refusal(
      inCompany(books.id, (tx) =>
        post(tx, {
          client: 'manual',
          idempotencyKey: `reversal:${entryId}`,
          entryDate: TODAY,
          description: 'عكس مباشر',
          reference: null,
          draftId: null,
          preparedByUserId: personId,
          approvedByUserId: null,
          actor: actor(),
          content: { kind: 'reversal', entryId, today: TODAY },
        }),
      ),
    );
    expect(message).toContain('is its cancellation');
    const entries = await inCompany(books.id, (tx) => tx.select().from(journalEntries));
    expect(entries.filter((entry) => entry.reversesEntryId === entryId)).toHaveLength(0);
  });
});

describe('the movement kinds', () => {
  it("are the contracts' kinds, in order", () => {
    expect([...PROJECT_MOVEMENT_KINDS]).toEqual([...CONTRACT_KINDS]);
  });
});

describe('the rates of a day', () => {
  it('reads the rate in force and whether today was recorded', async () => {
    const books = await newBooks();
    const rates = await inCompany(books.id, (tx) => readDayRates(tx, '2026-12-05'));
    expect(rates).toEqual({
      date: '2026-12-05',
      rates: [
        { base: 'USD', quote: 'SYP', rate: '118.5', effectiveOn: '2026-12-01' },
        { base: 'USD', quote: 'TRY', rate: '41', effectiveOn: '2026-12-01' },
      ],
      missing: true,
    });
    expect((await inCompany(books.id, (tx) => readDayRates(tx, '2026-12-01'))).missing).toBe(false);
  });
});

/** Rates recorded for a day: SYP per USD only, as a later day's market rate. */
const syp = (books: Books, date: string, rate: string) =>
  inCompany(books.id, (tx) =>
    recordDayRates(tx, books.id, actor(), {
      date,
      rates: [{ base: 'USD', quote: 'SYP', rate }],
      reason: null,
    }),
  );

/** An entry's lines as a sorted list, to compare without their order. */
const sorted = (lines: string[][]) => [...lines].sort((a, b) => a.join().localeCompare(b.join()));

describe('the approved SYP cases through the movement service', () => {
  it('pays a SYP debt at a later rate: a realised gain of 25.00 (case 4)', async () => {
    const books = await newBooks();
    await syp(books, '2026-12-02', '120');
    await record(
      books,
      movement(books, 'owed_by_us', {
        currency: 'SYP',
        amountMinor: '23700000',
        date: '2026-12-01',
      }),
    );
    await record(
      books,
      movement(books, 'deposit', { currency: 'SYP', amountMinor: '23700000', date: '2026-12-02' }),
    );
    const paid = await record(
      books,
      movement(books, 'debt_paid', {
        currency: 'SYP',
        amountMinor: '23700000',
        date: '2026-12-02',
      }),
    );
    expect(sorted(await linesOf(books, await movementEntry(books, paid)))).toEqual(
      sorted([
        ['211001', 'SYP', '23700000', '200000'],
        ['111001', 'SYP', '-23700000', '-197500'],
        ['421001', 'USD', '-2500', '-2500'],
      ]),
    );
    const figures = await inCompany(books.id, (tx) => readFigures(tx, books.project));
    expect(figures.owedByUs).toEqual([]);
    const dashboard = await inCompany(books.id, (tx) => readDashboard(tx, TODAY));
    expect(dashboard.exchangeDifferencesMinor).toBe('2500');
  });

  it('collects across two items, oldest due first: a loss of 62.50 (case 7)', async () => {
    const books = await newBooks();
    await syp(books, '2026-12-05', '120');
    await syp(books, '2026-12-07', '125');
    await record(
      books,
      movement(books, 'owed_to_us', {
        currency: 'SYP',
        amountMinor: '11850000',
        date: '2026-12-01',
      }),
    );
    await record(
      books,
      movement(books, 'owed_to_us', {
        currency: 'SYP',
        amountMinor: '6000000',
        date: '2026-12-05',
      }),
    );
    const collected = await record(
      books,
      movement(books, 'debt_collected', {
        currency: 'SYP',
        amountMinor: '15000000',
        date: '2026-12-07',
      }),
    );
    expect(sorted(await linesOf(books, await movementEntry(books, collected)))).toEqual(
      sorted([
        ['111001', 'SYP', '15000000', '120000'],
        ['112001', 'SYP', '-11850000', '-100000'],
        ['112001', 'SYP', '-3150000', '-26250'],
        ['541001', 'USD', '6250', '6250'],
      ]),
    );
    const figures = await inCompany(books.id, (tx) => readFigures(tx, books.project));
    expect(figures.owedToUs).toEqual([
      { currency: 'SYP', amountMinor: '2850000', bookMinor: '23750' },
    ]);
    const dashboard = await inCompany(books.id, (tx) => readDashboard(tx, TODAY));
    expect(dashboard.exchangeDifferencesMinor).toBe('-6250');
  });

  it("pays one project's debt to a supplier owed on two at the item's average (case 8)", async () => {
    const books = await newBooks();
    await syp(books, '2026-12-02', '120');
    const second = await inCompany(books.id, (tx) =>
      createProject(tx, books.id, actor(), {
        name: 'مشروع ثان',
        clientId: books.client,
        clientName: null,
        startDate: '2026-12-01',
        contractValue: null,
      }),
    );
    await record(
      books,
      movement(books, 'owed_by_us', {
        currency: 'SYP',
        amountMinor: '11850000',
        date: '2026-12-01',
      }),
    );
    await record(books, {
      ...movement(books, 'owed_by_us', {
        currency: 'SYP',
        amountMinor: '12000000',
        date: '2026-12-02',
      }),
      projectId: second,
    });
    await record(
      books,
      movement(books, 'deposit', { currency: 'SYP', amountMinor: '11850000', date: '2026-12-03' }),
    );
    const paid = await record(
      books,
      movement(books, 'debt_paid', {
        currency: 'SYP',
        amountMinor: '11850000',
        date: '2026-12-03',
      }),
    );
    expect(sorted(await linesOf(books, await movementEntry(books, paid)))).toEqual(
      sorted([
        ['211001', 'SYP', '11850000', '99371'],
        ['111001', 'SYP', '-11850000', '-98750'],
        ['421001', 'USD', '-621', '-621'],
      ]),
    );
    const first = await inCompany(books.id, (tx) => readFigures(tx, books.project));
    expect(first.owedByUs).toEqual([]);
    const other = await inCompany(books.id, (tx) => readFigures(tx, second));
    // 120,000.00 SYP at the item's average: 1,006.29 USD
    expect(other.owedByUs).toEqual([
      { currency: 'SYP', amountMinor: '12000000', bookMinor: '100629' },
    ]);
    const dashboard = await inCompany(books.id, (tx) => readDashboard(tx, TODAY));
    expect(dashboard.exchangeDifferencesMinor).toBe('621');
  });
});

describe('the refusals of rules 2, 5, 6 and 8', () => {
  it('settles a debt only once it exists: a back-dated collection is refused', async () => {
    const books = await newBooks();
    await record(books, movement(books, 'owed_to_us', { amountMinor: '1000', date: '2026-12-10' }));
    await expect(
      record(books, movement(books, 'debt_collected', { amountMinor: '1000', date: '2026-12-05' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // Nothing was due on 5 December: a receipt that day is revenue, not a collection.
    await record(books, movement(books, 'received', { amountMinor: '1000', date: '2026-12-05' }));
    await record(books, movement(books, 'owed_by_us', { amountMinor: '500', date: '2026-12-10' }));
    await record(books, movement(books, 'deposit', { amountMinor: '5000', date: '2026-12-01' }));
    await expect(
      record(books, movement(books, 'debt_paid', { amountMinor: '500', date: '2026-12-05' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a movement in a closed month and in a currency with no rate', async () => {
    const books = await newBooks();
    await record(books, movement(books, 'deposit', { amountMinor: '1000', date: '2026-11-20' }));
    await closeMonthByHand(app, books.id, '2026-11');
    await expect(
      record(books, movement(books, 'deposit', { amountMinor: '1000', date: '2026-11-25' })),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    await expect(
      record(
        books,
        movement(books, 'received', { currency: 'EUR', amountMinor: '1000', date: '2026-12-02' }),
      ),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(RATE_MISSING|CASH_ACCOUNT_INVALID)$/),
    });
  });

  it('refuses a cancellation the books cannot take back (rule 8)', async () => {
    const books = await newBooks();
    const context = { companyId: books.id, actor: actor(), today: TODAY };
    const cancel = (id: string) =>
      inCompany(books.id, (tx) => cancelMovement(tx, context, id, { reason: 'إلغاء تجريبي' }));
    // A deposit whose cash was spent.
    const deposit = await record(books, movement(books, 'deposit', { amountMinor: '1000' }));
    await record(books, movement(books, 'wages', { amountMinor: '1000' }));
    await expect(cancel(deposit)).rejects.toMatchObject({ code: 'CASH_BOX_NEGATIVE' });
    // An amount owed to us with a collection standing.
    const owed = await record(books, movement(books, 'owed_to_us', { amountMinor: '2000' }));
    await record(books, movement(books, 'debt_collected', { amountMinor: '500' }));
    await expect(cancel(owed)).rejects.toMatchObject({ code: 'OPEN_ITEM_HAS_SETTLEMENTS' });
    // A debt owed by us with a payment standing.
    const debt = await record(books, movement(books, 'owed_by_us', { amountMinor: '300' }));
    await record(books, movement(books, 'debt_paid', { amountMinor: '300' }));
    await expect(cancel(debt)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses movements and cancellations while approval is on', async () => {
    const books = await newBooks();
    const deposit = await record(books, movement(books, 'deposit', { amountMinor: '1000' }));
    await inCompany(books.id, (tx) =>
      tx.update(companySettings).set({ manualEntryApproval: true }),
    );
    await expect(
      record(books, movement(books, 'deposit', { amountMinor: '1000' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      inCompany(books.id, (tx) =>
        cancelMovement(tx, { companyId: books.id, actor: actor(), today: TODAY }, deposit, {
          reason: 'إلغاء تجريبي',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('the guards against forged writes', () => {
  /** A movement row as the service writes it, with `fields` changed. */
  async function forged(books: Books, fields: Partial<typeof projectMovements.$inferInsert>) {
    const id = await record(books, movement(books, 'deposit', { amountMinor: '100' }));
    const [row] = await inCompany(books.id, (tx) =>
      tx.select().from(projectMovements).where(eq(projectMovements.id, id)),
    );
    if (row === undefined) throw new Error('no movement');
    const { id: _id, createdAt: _created, ...rest } = row;
    return { ...rest, requestKey: uuidv7(), ...fields };
  }

  it('refuses, as the app role and the owner, a movement that does not record its entry', async () => {
    for (const db of [app, owner]) {
      const books = await newBooks();
      // The same entry again: not the one posted just before it, and its number not the next.
      const again = await forged(books, {});
      expect(
        await refusal(inCompany(books.id, (tx) => tx.insert(projectMovements).values(again))),
      ).toMatch(/duplicate key|project_movements/);
      // An older entry, after another posted.
      const older = await forged(books, {});
      await record(books, movement(books, 'deposit', { amountMinor: '100' }));
      await inCompany(books.id, (tx) =>
        tx
          .update(projectMovementSequences)
          .set({ lastNumber: sql`${projectMovementSequences.lastNumber} + 1` }),
      ).catch(() => undefined);
      expect(
        await refusal(
          withCompany(db, books.id, (tx) =>
            tx.insert(projectMovements).values({ ...older, number: older.number + 2 }),
          ),
        ),
      ).toMatch(/project_movements/);
    }
  });

  it('refuses a cancellation whose entry reverses another', async () => {
    const books = await newBooks();
    await record(books, movement(books, 'deposit', { amountMinor: '1000' }));
    const wages = await record(books, movement(books, 'wages', { amountMinor: '100' }));
    const other = await record(books, movement(books, 'wages', { amountMinor: '200' }));
    const context = { companyId: books.id, actor: actor(), today: TODAY };
    await inCompany(books.id, (tx) => cancelMovement(tx, context, other, { reason: 'إلغاء' }));
    const [cancellation] = await inCompany(books.id, (tx) =>
      tx.select().from(projectMovementCancellations),
    );
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.insert(projectMovementCancellations).values({
            companyId: books.id,
            movementId: wages,
            reversalEntryId: cancellation?.reversalEntryId as string,
            reason: 'مزوّر',
            createdByUserId: personId,
          }),
        ),
      ),
    ).toMatch(/project_movement_cancellations/);
  });

  it('never changes or deletes a movement, a cancellation or a sequence, for any role', async () => {
    const books = await newBooks();
    await record(books, movement(books, 'deposit', { amountMinor: '1000' }));
    const wages = await record(books, movement(books, 'wages', { amountMinor: '100' }));
    await inCompany(books.id, (tx) =>
      cancelMovement(tx, { companyId: books.id, actor: actor(), today: TODAY }, wages, {
        reason: 'إلغاء',
      }),
    );
    for (const db of [app, owner]) {
      const inIt = <T>(work: (tx: Transaction) => Promise<T>) => withCompany(db, books.id, work);
      expect(
        await refusal(inIt((tx) => tx.update(projectMovements).set({ description: 'تغيير' }))),
      ).toBeTruthy();
      expect(await refusal(inIt((tx) => tx.delete(projectMovements)))).toBeTruthy();
      expect(
        await refusal(
          inIt((tx) => tx.update(projectMovementCancellations).set({ reason: 'تغيير' })),
        ),
      ).toBeTruthy();
      expect(await refusal(inIt((tx) => tx.delete(projectMovementSequences)))).toBeTruthy();
      expect(
        await refusal(
          inIt((tx) =>
            tx
              .update(projectMovementSequences)
              .set({ lastNumber: sql`${projectMovementSequences.lastNumber} + 2` }),
          ),
        ),
      ).toBeTruthy();
    }
  });
});

describe('the figures, as properties (S13 "Reports")', () => {
  const step = fc.oneof(
    fc.record({
      kind: fc.constant('received' as const),
      amount: fc.integer({ min: 1, max: 9_000 }),
    }),
    fc.record({ kind: fc.constant('expense' as const), amount: fc.integer({ min: 1, max: 900 }) }),
    fc.record({ kind: fc.constant('wages' as const), amount: fc.integer({ min: 1, max: 900 }) }),
    fc.record({
      kind: fc.constant('owed_by_us' as const),
      amount: fc.integer({ min: 1, max: 900 }),
    }),
    fc.record({
      kind: fc.constant('owed_to_us' as const),
      amount: fc.integer({ min: 1, max: 900 }),
    }),
    fc.record({
      kind: fc.constant('debt_paid' as const),
      amount: fc.integer({ min: 1, max: 900 }),
    }),
    fc.record({
      kind: fc.constant('debt_collected' as const),
      amount: fc.integer({ min: 1, max: 900 }),
    }),
    fc.record({ kind: fc.constant('cancel' as const), amount: fc.nat() }),
  );

  it("keep a project's figures equal to its lines, items and boxes under any sequence", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 12 }), async (steps) => {
        const books = await newBooks();
        await record(books, movement(books, 'deposit', { amountMinor: '100000000' }));
        const recorded: string[] = [];
        for (const item of steps) {
          try {
            if (item.kind === 'cancel') {
              const id = recorded[item.amount % Math.max(recorded.length, 1)];
              if (id === undefined) continue;
              await inCompany(books.id, (tx) =>
                cancelMovement(tx, { companyId: books.id, actor: actor(), today: TODAY }, id, {
                  reason: 'إلغاء',
                }),
              );
            } else {
              recorded.push(
                await record(
                  books,
                  movement(books, item.kind, { amountMinor: String(item.amount) }),
                ),
              );
            }
          } catch {
            // A refusal leaves the books as they were; the properties hold either way.
          }
        }
        await inCompany(books.id, async (tx) => {
          const figures = await readFigures(tx, books.project);
          const ledger = await tx.execute<{
            revenue: string;
            costs: string;
            owed_to_us: string;
            boxes: string;
            deposits: string;
            supplier: string;
            project_cash: string;
          }>(sql`
            select
              (-coalesce((select sum(l.book_minor) from public.journal_lines l
                join public.chart_accounts a on a.id = l.account_id where a.code = '411001'), 0))::text
                as revenue,
              coalesce((select sum(l.book_minor) from public.journal_lines l
                join public.chart_accounts a on a.id = l.account_id
                where a.statement_line = 'is.direct_costs'), 0)::text as costs,
              coalesce((select sum(b.open_minor) from public.open_item_balances b
                join public.open_items i on i.id = b.item_id
                join public.chart_accounts a on a.id = i.account_id where a.code = '112001'), 0)::text
                as owed_to_us,
              coalesce((select sum(l.book_minor) from public.journal_lines l
                join public.chart_accounts a on a.id = l.account_id where a.cash_kind = 'box'), 0)::text
                as boxes,
              coalesce((select sum(l.book_minor) from public.journal_lines l
                join public.chart_accounts a on a.id = l.account_id
                where a.cash_kind = 'box' and l.entry_id in (
                  select m.entry_id from public.project_movements m where m.kind = 'deposit'
                  union all select x.reversal_entry_id from public.project_movement_cancellations x
                  join public.project_movements m on m.id = x.movement_id where m.kind = 'deposit')),
                0)::text as deposits,
              (coalesce((select sum(l.book_minor) from public.journal_lines l
                join public.chart_accounts a on a.id = l.account_id where a.cash_kind = 'box'), 0)
              - coalesce((select sum(l.book_minor) from public.journal_lines l
                join public.chart_accounts a on a.id = l.account_id
                where a.cash_kind = 'box' and l.entry_id in (
                  select m.entry_id from public.project_movements m where m.kind = 'deposit'
                  union all select x.reversal_entry_id from public.project_movement_cancellations x
                  join public.project_movements m on m.id = x.movement_id where m.kind = 'deposit')),
                0))::text as project_cash,
              (-coalesce((select sum(l.amount_minor) from public.journal_lines l
                join public.chart_accounts a on a.id = l.account_id where a.code = '211001'), 0))::text
                as supplier`);
          const row = ledger.rows[0];
          expect(figures.revenueMinor).toBe(row?.revenue);
          expect(figures.costsMinor).toBe(row?.costs);
          const owedToUs = figures.owedToUs.find((item) => item.currency === 'USD');
          expect(owedToUs?.amountMinor ?? '0').toBe(row?.owed_to_us);
          // The project's net cash and the deposits are the boxes, in one currency.
          expect(figures.netCashMinor).toBe(row?.project_cash);
          // Owed by us is nothing exactly when the project's supplier lines net to zero.
          expect(figures.owedByUs.length === 0).toBe(row?.supplier === '0');
        });
      }),
      { numRuns: 8 },
    );
  }, 180_000);
});
