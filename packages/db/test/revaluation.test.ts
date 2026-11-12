import { type CompanyLedgers, type CurrencyCode, DomainError } from '@vertex-mizan/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditEntries,
  chartAccounts,
  createCompanyBooks,
  type Database,
  dimensionTypes,
  dimensionValues,
  journalEntries,
  journalLines,
  type ManualLineSpec,
  openItemBalances,
  openItemMovements,
  openItems,
  type PersonActor,
  post,
  postRevaluation,
  previewRevaluation,
  recordRate,
  revaluations,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { closeMonthByHand, connect, refusal } from './connections.js';

// S07's month-end revaluation on the migrated database (0038–0039): the preview and the posting of
// each ledger with the numbers of `currency/month-end-revaluation` (a USD receivable gaining in the
// book ledger, an SYP bank balance losing in the parallel ledger, both reversed on the next day and
// a payment after it realising the whole movement), the refusals of rules 11, 16 and 17, a double
// submit and two postings at once, an adjusting revaluation after a back-dated payment, a blocked
// account and an archived value revalued, the hand reversal refused, and the guards against
// revaluation rows written by hand. All values are synthetic.

const { app, owner } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-revaluation-test',
  ipAddress: null,
  userAgent: null,
});

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

interface Books {
  readonly id: string;
  readonly accounts: Map<string, string>;
  readonly values: Map<string, string>;
}

async function rate(books: Books, on: string, value: string, type: 'bulletin' | 'market') {
  await inCompany(books.id, (tx) =>
    recordRate(tx, books.id, actor(), {
      effectiveOn: on,
      base: 'USD',
      quote: 'SYP',
      rate: value,
      type,
      source: 'manual',
    }),
  );
}

/** Vertex Media's ledgers and chart, clients C1, C2 and service S1, and the scenario's rates. */
async function newBooks(): Promise<Books> {
  const id = uuidv7();
  await withCompany(app, id, (tx) =>
    createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة إعادة تقييم تجريبية',
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
  const values = await inCompany(id, async (tx) => {
    const types = await tx.select().from(dimensionTypes);
    const typeId = (code: string) => types.find((type) => type.code === code)?.id as string;
    const rows = await tx
      .insert(dimensionValues)
      .values([
        { companyId: id, typeId: typeId('client'), code: 'C1', name: 'عميل تجريبي' },
        { companyId: id, typeId: typeId('client'), code: 'C2', name: 'عميل تجريبي آخر' },
        { companyId: id, typeId: typeId('service'), code: 'S1', name: 'خدمة تجريبية' },
      ])
      .returning({ id: dimensionValues.id, code: dimensionValues.code });
    return new Map(rows.map((row) => [row.code as string, row.id]));
  });
  const accounts = await inCompany(id, (tx) =>
    tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts),
  );
  const books = { id, accounts: new Map(accounts.map((row) => [row.code, row.id])), values };
  await rate(books, '2026-11-03', '120.0000', 'bulletin');
  await rate(books, '2026-11-30', '125.0000', 'bulletin');
  await rate(books, '2026-12-10', '126.0000', 'bulletin');
  await rate(books, '2026-11-02', '125.0000', 'market');
  await rate(books, '2026-11-25', '128.0000', 'market');
  return books;
}

interface Spec {
  readonly code: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint;
  readonly dims?: readonly string[];
  readonly item?: string;
  readonly newItem?: { readonly reference: string; readonly dueOn: string | null };
}

function specs(books: Books, lines: readonly Spec[]): ManualLineSpec[] {
  return lines.map((line) => ({
    accountId: books.accounts.get(line.code) as string,
    dimensionValueIds: (line.dims ?? []).map((code) => books.values.get(code) as string),
    currency: line.currency,
    amountMinor: line.amount,
    memo: null,
    ...(line.item !== undefined && { openItemId: line.item }),
    ...(line.newItem !== undefined && { newItem: line.newItem }),
  }));
}

function manual(books: Books, on: string, lines: readonly Spec[], today = '2026-12-31') {
  return inCompany(books.id, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: uuidv7(),
      entryDate: on,
      description: 'قيد تجريبي',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: { kind: 'manual', today, dealtRates: [], lines: specs(books, lines) },
    }),
  );
}

/** M-1 (1,000.00 USD at 120) and 1,250,000.00 SYP paid into the SYP bank (10,000.00 USD at 125). */
async function scenario(books: Books) {
  await manual(books, '2026-11-03', [
    {
      code: '112001',
      currency: 'USD',
      amount: 100000n,
      dims: ['C1'],
      newItem: { reference: 'M-1', dueOn: '2026-12-03' },
    },
    { code: '411001', currency: 'USD', amount: -100000n, dims: ['C1', 'S1'] },
  ]);
  await manual(books, '2026-11-03', [
    { code: '111003', currency: 'SYP', amount: 125000000n },
    { code: '311001', currency: 'SYP', amount: -125000000n },
  ]);
}

const preview = (books: Books, ledger: 'book' | 'parallel', today = '2026-12-01') =>
  inCompany(books.id, (tx) => previewRevaluation(tx, { period: '2026-11', ledger, today }));

const revalue = (
  books: Books,
  ledger: 'book' | 'parallel',
  fingerprint: string,
  today = '2026-12-01',
) =>
  inCompany(books.id, (tx) =>
    postRevaluation(tx, { period: '2026-11', ledger, fingerprint, today, actor: actor() }),
  );

async function previewAndPost(books: Books, ledger: 'book' | 'parallel') {
  const { fingerprint } = await preview(books, ledger);
  return revalue(books, ledger, fingerprint);
}

/** An entry's lines: account code, currency, amount, book, parallel, movement kind. */
async function rowsOf(books: Books, entryId: string) {
  const rows = await inCompany(books.id, (tx) =>
    tx
      .select({ line: journalLines, code: chartAccounts.code, movement: openItemMovements.kind })
      .from(journalLines)
      .innerJoin(
        chartAccounts,
        and(
          eq(chartAccounts.companyId, journalLines.companyId),
          eq(chartAccounts.id, journalLines.accountId),
        ),
      )
      .leftJoin(
        openItemMovements,
        and(
          eq(openItemMovements.companyId, journalLines.companyId),
          eq(openItemMovements.lineId, journalLines.id),
        ),
      )
      .where(eq(journalLines.entryId, entryId))
      .orderBy(asc(journalLines.lineNo)),
  );
  return rows.map(({ line, code, movement }) => [
    code,
    line.currency,
    line.amountMinor,
    line.bookMinor,
    line.parallelMinor,
    movement,
  ]);
}

async function item(books: Books, reference: string) {
  return inCompany(books.id, async (tx) => {
    const [row] = await tx.select().from(openItems).where(eq(openItems.reference, reference));
    if (!row) throw new Error(`no item ${reference}`);
    const [balance] = await tx
      .select()
      .from(openItemBalances)
      .where(eq(openItemBalances.itemId, row.id));
    if (!balance) throw new Error('no balance');
    return { id: row.id, balance };
  });
}

async function refused(work: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, details: error.details };
    throw error;
  }
  throw new Error('expected a refusal');
}

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: 'revaluation.person@example.test', name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  personId = row.id;
});

describe('previewRevaluation (S07 rules 10–12, 15)', () => {
  it('reads each ledger with the scenario numbers and the closing rates with their rows', async () => {
    const books = await newBooks();
    await scenario(books);
    const book = await preview(books, 'book');
    expect(book).toMatchObject({
      ledgerCurrency: 'SYP',
      lastDay: '2026-11-30',
      ended: true,
      state: 'to_post',
      gainMinor: '500000',
      lossMinor: '0',
      posted: [],
    });
    expect(book.closingRates).toMatchObject([
      {
        currency: 'USD',
        rateType: 'bulletin',
        rows: [{ rate: '125', effectiveOn: '2026-11-30' }],
      },
    ]);
    expect(book.balances).toMatchObject([
      {
        accountCode: '112001',
        item: { reference: 'M-1' },
        values: [{ typeCode: 'client', code: 'C1' }],
        currency: 'USD',
        transactionMinor: '100000',
        carryingMinor: '12000000',
        targetMinor: '12500000',
        revaluedMinor: '0',
        differenceMinor: '500000',
      },
    ]);
    const parallel = await preview(books, 'parallel');
    expect(parallel.balances).toMatchObject([
      {
        accountCode: '111003',
        item: null,
        currency: 'SYP',
        carryingMinor: '1000000',
        targetMinor: '976563',
        differenceMinor: '-23437',
      },
    ]);
    expect(parallel.closingRates[0]?.rows).toMatchObject([
      { rate: '128', effectiveOn: '2026-11-25' },
    ]);
    expect((await preview(books, 'book', '2026-11-30')).ended).toBe(false);
  });

  it('finds a month before any balance current, with nothing to revalue', async () => {
    const books = await newBooks();
    await scenario(books);
    const october = await inCompany(books.id, (tx) =>
      previewRevaluation(tx, { period: '2026-10', ledger: 'book', today: '2026-12-01' }),
    );
    expect(october).toMatchObject({ state: 'current', balances: [], closingRates: [] });
  });
});

describe('postRevaluation (S07 rules 13–18)', () => {
  it('posts each ledger with its reversal, and a payment after it realises the whole movement', async () => {
    const books = await newBooks();
    await scenario(books);
    const book = await previewAndPost(books, 'book');
    expect(book).toMatchObject({ posted: true, revaluation: { adjusting: false, ledger: 'book' } });
    expect(await rowsOf(books, book.entryId as string)).toEqual([
      ['112001', 'USD', 0n, 500000n, 0n, 'revaluation'],
      ['421002', 'SYP', -500000n, -500000n, 0n, null],
    ]);
    expect(await rowsOf(books, book.reversalEntryId as string)).toEqual([
      ['112001', 'USD', 0n, -500000n, 0n, 'revaluation'],
      ['421002', 'SYP', 500000n, 500000n, 0n, null],
    ]);
    const parallel = await previewAndPost(books, 'parallel');
    expect(await rowsOf(books, parallel.entryId as string)).toEqual([
      ['111003', 'SYP', 0n, 0n, -23437n, null],
      ['541002', 'USD', 23437n, 0n, 23437n, null],
    ]);
    const [entry, reversal] = await inCompany(books.id, (tx) =>
      Promise.all(
        [book.entryId, book.reversalEntryId].map(async (id) => {
          const [row] = await tx
            .select()
            .from(journalEntries)
            .where(eq(journalEntries.id, id as string));
          return row;
        }),
      ),
    );
    expect([entry?.entryDate, entry?.source, reversal?.entryDate, reversal?.source]).toEqual([
      '2026-11-30',
      'revaluation',
      '2026-12-01',
      'revaluation',
    ]);
    expect(entry?.description).toBe('إعادة تقييم آخر الشهر 2026-11 — الدفتر الأساسي');
    // The item carries 120,000.00 SYP, its revaluations apart and reversed.
    const m1 = await item(books, 'M-1');
    expect([
      m1.balance.openMinor,
      m1.balance.bookMinor,
      m1.balance.revaluationBookMinor,
      m1.balance.revaluationParallelMinor,
    ]).toEqual([100000n, 12000000n, 0n, 0n]);
    expect((await preview(books, 'book')).state).toBe('current');
    // Paid on 10 December at 126: cleared at its carrying amount, 6,000.00 SYP realised.
    const payment = await manual(books, '2026-12-10', [
      { code: '111004', currency: 'USD', amount: 100000n },
      { code: '112001', currency: 'USD', amount: -100000n, item: m1.id },
    ]);
    expect(await rowsOf(books, payment.id)).toEqual([
      ['111004', 'USD', 100000n, 12600000n, 100000n, null],
      ['112001', 'USD', -100000n, -12000000n, -100000n, 'clear'],
      ['421001', 'SYP', -600000n, -600000n, 0n, null],
    ]);
    const audit = await inCompany(books.id, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'revaluation.posted')),
    );
    expect(audit).toHaveLength(2);
    expect(audit[0]?.after).toMatchObject({ period: '2026-11', ledger: 'book', adjusting: false });
  });

  it('refuses a month not ended, a changed preview and a missing closing rate', async () => {
    const books = await newBooks();
    await scenario(books);
    const { fingerprint } = await preview(books, 'book');
    expect((await refused(revalue(books, 'book', fingerprint, '2026-11-30'))).code).toBe(
      'PERIOD_NOT_ENDED',
    );
    // A corrected closing bulletin after the preview changes it.
    await inCompany(books.id, (tx) =>
      recordRate(tx, books.id, actor(), {
        effectiveOn: '2026-11-30',
        base: 'USD',
        quote: 'SYP',
        rate: '125.5000',
        type: 'bulletin',
        source: 'manual',
        reason: 'تصحيح نشرة تجريبي',
      }),
    );
    const changed = await refused(revalue(books, 'book', fingerprint));
    expect(changed.code).toBe('REVALUATION_CHANGED');
    expect(changed.details).toEqual({ fingerprint: (await preview(books, 'book')).fingerprint });

    const noBulletin = await newBooks();
    await scenario(noBulletin);
    await rate(noBulletin, '2026-12-02', '126.0000', 'bulletin');
    await manual(noBulletin, '2026-12-02', [
      { code: '111004', currency: 'USD', amount: 100n },
      { code: '313001', currency: 'USD', amount: -100n },
    ]);
    // December's 31st is a Thursday, a publication day, with no bulletin.
    const december = await inCompany(noBulletin.id, (tx) =>
      previewRevaluation(tx, { period: '2026-12', ledger: 'book', today: '2027-01-01' }),
    );
    expect(december).toMatchObject({
      state: 'rate_missing',
      missingRates: [{ currency: 'USD', to: 'SYP', rateType: 'bulletin', on: '2026-12-31' }],
    });
    expect(december.balances.every((balance) => balance.targetMinor === null)).toBe(true);
    const missing = await refused(
      inCompany(noBulletin.id, (tx) =>
        postRevaluation(tx, {
          period: '2026-12',
          ledger: 'book',
          fingerprint: december.fingerprint,
          today: '2027-01-01',
          actor: actor(),
        }),
      ),
    );
    expect(missing).toMatchObject({ code: 'RATE_MISSING', details: { on: '2026-12-31' } });
  });

  it('answers a double submit and two postings at once with the first result', async () => {
    const books = await newBooks();
    await scenario(books);
    const { fingerprint } = await preview(books, 'book');
    const [first, second] = await Promise.all([
      revalue(books, 'book', fingerprint),
      revalue(books, 'book', fingerprint),
    ]);
    expect(second).toEqual(first);
    expect(await revalue(books, 'book', fingerprint)).toEqual(first);
    const rows = await inCompany(books.id, (tx) => tx.select().from(revaluations));
    expect(rows).toHaveLength(1);
    // A current revaluation posts nothing.
    const now = await preview(books, 'book');
    expect(await revalue(books, 'book', now.fingerprint)).toEqual({
      posted: false,
      revaluation: null,
      entryId: null,
      reversalEntryId: null,
    });
  });

  it('adjusts a revaluation a back-dated payment made stale, gross (acceptance step 5)', async () => {
    const books = await newBooks();
    await scenario(books);
    await rate(books, '2026-11-26', '120.0000', 'bulletin');
    await previewAndPost(books, 'book');
    const m1 = await item(books, 'M-1');
    await manual(books, '2026-11-26', [
      { code: '111004', currency: 'USD', amount: 10000n },
      { code: '112001', currency: 'USD', amount: -10000n, item: m1.id },
    ]);
    const stale = await preview(books, 'book');
    expect(stale.state).toBe('to_post');
    expect(
      stale.balances.map((b) => [
        b.accountCode,
        b.carryingMinor,
        b.revaluedMinor,
        b.differenceMinor,
      ]),
    ).toEqual([
      ['111004', '1200000', '0', '50000'],
      ['112001', '10800000', '500000', '-50000'],
    ]);
    const adjusting = await revalue(books, 'book', stale.fingerprint);
    expect(adjusting.revaluation?.adjusting).toBe(true);
    expect(await rowsOf(books, adjusting.entryId as string)).toEqual([
      ['111004', 'USD', 0n, 50000n, 0n, null],
      ['421002', 'SYP', -50000n, -50000n, 0n, null],
      ['112001', 'USD', 0n, -50000n, 0n, 'revaluation'],
      ['541002', 'SYP', 50000n, 50000n, 0n, null],
    ]);
    const after = await preview(books, 'book');
    expect([after.state, after.posted.length]).toEqual(['current', 2]);
  });

  it('revalues a blocked account and an archived value, and refuses the hand reversal', async () => {
    const books = await newBooks();
    await manual(books, '2026-11-03', [
      { code: '111006', currency: 'USD', amount: 20000n },
      { code: '211001', currency: 'USD', amount: -20000n, dims: ['C2'] },
    ]);
    await inCompany(books.id, async (tx) => {
      await tx
        .update(chartAccounts)
        .set({ blockedAt: new Date(), blockedReason: 'حساب موقوف تجريبي' })
        .where(eq(chartAccounts.code, '111006'));
      await tx
        .update(dimensionValues)
        .set({ archivedAt: new Date() })
        .where(eq(dimensionValues.code, 'C2'));
    });
    const view = await preview(books, 'book');
    expect(
      view.balances.map((b) => [
        b.accountCode,
        b.blocked,
        b.values[0]?.archived ?? null,
        b.differenceMinor,
      ]),
    ).toEqual([
      ['111006', true, null, '100000'],
      ['211001', false, true, '-100000'],
    ]);
    const posted = await revalue(books, 'book', view.fingerprint);
    expect(posted.posted).toBe(true);
    const handReversal = await refused(
      inCompany(books.id, (tx) =>
        post(tx, {
          client: 'manual',
          idempotencyKey: `reversal:${posted.entryId}`,
          entryDate: '2026-12-05',
          description: 'عكس يدوي',
          reference: null,
          draftId: null,
          preparedByUserId: personId,
          approvedByUserId: null,
          actor: actor(),
          content: { kind: 'reversal', entryId: posted.entryId as string, today: '2026-12-05' },
        }),
      ),
    );
    expect(handReversal.code).toBe('ENTRY_NOT_REVERSIBLE');
  });
});

describe('a month closed, an item settled on the last day, and a state that recurs', () => {
  it('refuses the preview and the posting of a closed month (rule 16)', async () => {
    const books = await newBooks();
    await scenario(books);
    const { fingerprint } = await preview(books, 'book');
    await closeMonthByHand(app, books.id, '2026-11');
    expect((await refused(preview(books, 'book'))).code).toBe('PERIOD_CLOSED');
    expect((await refused(revalue(books, 'book', fingerprint))).code).toBe('PERIOD_CLOSED');
  });

  it('takes back the revaluation of an item settled in full on the last day, and posts a state that recurs anew (edge case 3, rule 17)', async () => {
    const books = await newBooks();
    await scenario(books);
    const first = await previewAndPost(books, 'book');
    const m1 = await item(books, 'M-1');
    // Paid in full on 30 November at the closing bulletin of 125, after the revaluation: the
    // item's open amount and carrying amount are zero while its revaluation stands (invariant 9).
    const payment = await manual(books, '2026-11-30', [
      { code: '111004', currency: 'USD', amount: 100000n },
      { code: '112001', currency: 'USD', amount: -100000n, item: m1.id },
    ]);
    const settled = await item(books, 'M-1');
    expect([
      settled.balance.openMinor,
      settled.balance.bookMinor,
      settled.balance.revaluationBookMinor,
    ]).toEqual([0n, 0n, 0n]);
    const stale = await preview(books, 'book');
    expect(
      stale.balances
        .filter((b) => b.differenceMinor !== '0')
        .map((b) => [b.accountCode, b.differenceMinor]),
    ).toEqual([['112001', '-500000']]);
    const adjusting = await revalue(books, 'book', stale.fingerprint);
    expect(await rowsOf(books, adjusting.entryId as string)).toEqual([
      ['112001', 'USD', 0n, -500000n, 0n, 'revaluation'],
      ['541002', 'SYP', 500000n, 500000n, 0n, null],
    ]);
    expect((await preview(books, 'book')).state).toBe('current');
    // The payment was a mistake: reversed on the same day, the books read as they did before the
    // first revaluation, and the month is revalued anew rather than answered as that posting.
    await inCompany(books.id, (tx) =>
      post(tx, {
        client: 'manual',
        idempotencyKey: `reversal:${payment.id}`,
        entryDate: '2026-11-30',
        description: 'عكس دفعة خاطئة',
        reference: null,
        draftId: null,
        preparedByUserId: personId,
        approvedByUserId: null,
        actor: actor(),
        content: { kind: 'reversal', entryId: payment.id, today: '2026-12-01' },
      }),
    );
    const recurred = await preview(books, 'book');
    expect(
      recurred.balances
        .filter((b) => b.differenceMinor !== '0')
        .map((b) => [b.accountCode, b.differenceMinor]),
    ).toEqual([['112001', '500000']]);
    expect(recurred.fingerprint).not.toBe(first.revaluation?.fingerprint);
    const again = await revalue(books, 'book', recurred.fingerprint);
    expect(again).toMatchObject({ posted: true, revaluation: { adjusting: true } });
    expect(again.entryId).not.toBe(first.entryId);
    const after = await preview(books, 'book');
    expect([after.state, after.posted.length]).toEqual(['current', 3]);
  });
});

describe('the guards of revaluations (0039)', () => {
  it('refuse a change for every role, a row without its revaluation entry and a revaluation movement on another entry', async () => {
    const books = await newBooks();
    await scenario(books);
    const posted = await previewAndPost(books, 'book');
    expect(posted.revaluation?.userId).toBe(personId);
    const write = (statement: ReturnType<typeof sql>, db: Database = app) =>
      refusal(withCompany(db, books.id, (tx) => tx.execute(statement)));
    // The app role holds no UPDATE or DELETE; the owner, which does, meets refuse_change().
    expect(await write(sql`update revaluations set adjusting = true`)).toMatch(/permission denied/);
    expect(await write(sql`delete from revaluations`)).toMatch(/permission denied/);
    expect(await write(sql`update revaluations set adjusting = true`, owner)).toMatch(
      /revaluations is append-only: UPDATE refused/,
    );
    expect(await write(sql`delete from revaluations`, owner)).toMatch(
      /revaluations is append-only: DELETE refused/,
    );
    // A row naming a manual entry.
    const manualEntry = await manual(books, '2026-11-04', [
      { code: '111003', currency: 'SYP', amount: 100n },
      { code: '311001', currency: 'SYP', amount: -100n },
    ]);
    for (const db of [app, owner]) {
      expect(
        await write(
          sql`insert into revaluations
            (id, company_id, period_id, ledger, entry_id, reversal_entry_id, adjusting, fingerprint, rates, user_id)
            select ${uuidv7()}, company_id, period_id, 'book', ${manualEntry.id}, reversal_entry_id, true,
                   ${'b'.repeat(64)}, '[]'::jsonb, user_id
            from revaluations`,
          db,
        ),
      ).toMatch(/revaluations: a revaluation entry on its period's last day/);
      // A revaluation movement on a manual entry's line.
      expect(
        await write(
          sql`insert into open_item_movements
            (id, company_id, item_id, line_id, entry_id, entry_date, kind, adjusted, amount_minor, book_minor, parallel_minor)
            select ${uuidv7()}, m.company_id, m.item_id, m.line_id, m.entry_id, m.entry_date, 'revaluation', false,
                   m.amount_minor, m.book_minor, m.parallel_minor
            from open_item_movements m where m.kind = 'open'`,
          db,
        ),
      ).toMatch(
        /open_item_movements: a revaluation movement does not fit a document item on a measured line of a manual entry/,
      );
    }
  });
});
