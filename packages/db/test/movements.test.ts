import {
  PROJECT_MOVEMENT_KINDS as CONTRACT_KINDS,
  type CompanyLedgers,
  type CurrencyCode,
  type RecordMovement,
} from '@vertex-mizan/contracts';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cancelMovement,
  createCompanyBooks,
  createMaterial,
  createParty,
  createProject,
  journalEntries,
  type PersonActor,
  PROJECT_MOVEMENT_KINDS,
  post,
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
import { connect, refusal } from './connections.js';

// S13 (ADR 0024) on the migrated database (0079–0080): each movement recorded and posted through
// its path with the numbers of `projects/simple-movements`, the figures read from the ledger, the
// refusals of rules 2–9, a replay and a conflict, the cancellation and the guard that no other
// route reverses a movement's entry. All values are synthetic.

const { app } = connect();

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
      expensesMinor: '1020000',
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
