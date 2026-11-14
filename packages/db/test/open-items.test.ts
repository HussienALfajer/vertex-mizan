import { createHash } from 'node:crypto';
import {
  type CompanyLedgers,
  type CurrencyCode,
  DomainError,
  DUE_DATE_SETTERS,
  ITEM_KINDS,
  ITEM_SOURCES,
  MOVEMENT_KINDS,
  type RateType,
} from '@vertex-mizan/contracts';
import { chainEntryValue, fiscalYearOf, periodOf, verifyChain } from '@vertex-mizan/ledger';
import { and, asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditEntries,
  chartAccounts,
  companySettings,
  createCompanyBooks,
  type Database,
  dimensionSets,
  dimensionTypes,
  dimensionValues,
  entriesUsingRate,
  entryNumberCounters,
  exchangeRates,
  journalEntries,
  journalLines,
  ledgerHeads,
  type ManualLineSpec,
  OPEN_ITEM_DUE_DATE_SETTERS,
  OPEN_ITEM_KINDS,
  OPEN_ITEM_MOVEMENT_KINDS,
  OPEN_ITEM_SOURCES,
  openItemBalances,
  openItemDueDates,
  openItemMovements,
  openItems,
  type PersonActor,
  periods,
  post,
  postingRequests,
  previewPosting,
  readChain,
  recordRate,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { addTestControlAccounts } from '../src/testing.js';
import { connect, refusal } from './connections.js';

// S04's open items on the migrated database (0019–0022): the posting function's item lines (manual
// document items opened and settled in proportion to what remains, running items found or made by
// client and moved at their average, reversals that move the same items, the running void's
// difference entry), every refusal, two settlements at once, and the writes the posting function
// never makes, forged by hand to prove the guards refuse them. The numbers are those of
// `receivables/manual-settlement`, `receivables/write-off` and `ad-funds/running-balance`; all
// values are synthetic.

const { app, owner } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-open-items-test',
  ipAddress: null,
  userAgent: null,
});

const policy = (rateType: RateType, acceptsTransactionRate = false) => ({
  rateType,
  acceptsTransactionRate,
});

/** Vertex Media's shape: SYP books at the bulletin, a USD parallel ledger at market. */
const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: policy('bulletin') },
  parallel: { currency: 'USD', ratePolicy: policy('market', true) },
};

const inCompany = <T>(
  companyId: string,
  work: (tx: Transaction) => Promise<T>,
  db: Database = app,
) => withCompany(db, companyId, work);

interface Books {
  readonly id: string;
  readonly accounts: Map<string, string>;
  readonly values: Map<string, string>;
}

/**
 * A company with Vertex Media's ledgers, the service-agency chart, clients `C1` and `C2`, service
 * `S1`, and the S04 example's rates: bulletins of 120 (3 November), 122 (10), 123 (19), 123.5 (25)
 * and 124 (26), and the market rate of 124 on 25 November.
 */
async function newBooks(): Promise<Books> {
  const id = uuidv7();
  await withCompany(app, id, async (tx) => {
    await createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة بنود تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'general',
        createdByUserId: personId,
      },
      actor(),
    );
    await addTestControlAccounts(tx, id, actor());
  });
  for (const [on, type, value] of [
    ['2026-11-03', 'bulletin', '120.0000'],
    ['2026-11-10', 'bulletin', '122.0000'],
    ['2026-11-19', 'bulletin', '123.0000'],
    ['2026-11-25', 'bulletin', '123.5000'],
    ['2026-11-25', 'market', '124.0000'],
    ['2026-11-26', 'bulletin', '124.0000'],
  ] as const) {
    await inCompany(id, (tx) =>
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
  return { id, accounts: new Map(accounts.map((row) => [row.code, row.id])), values };
}

/** A manual line: account code, currency, amount, and what it names. */
interface Spec {
  readonly code: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint;
  readonly dims?: readonly string[];
  readonly item?: string;
  readonly newItem?: { readonly reference: string; readonly dueOn: string | null };
  readonly memo?: string;
}

function specs(books: Books, lines: readonly Spec[]): ManualLineSpec[] {
  return lines.map((line) => ({
    accountId: books.accounts.get(line.code) ?? uuidv7(),
    dimensionValueIds: (line.dims ?? []).map((code) => books.values.get(code) ?? code),
    currency: line.currency,
    amountMinor: line.amount,
    memo: line.memo ?? null,
    ...(line.item !== undefined && { openItemId: line.item }),
    ...(line.newItem !== undefined && { newItem: line.newItem }),
  }));
}

function manual(books: Books, on: string, lines: readonly Spec[], key = uuidv7()) {
  return inCompany(books.id, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: key,
      entryDate: on,
      description: 'قيد بنود تجريبي',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: { kind: 'manual', today: '2026-11-30', dealtRates: [], lines: specs(books, lines) },
    }),
  );
}

const reverse = (books: Books, entryId: string, on: string) =>
  inCompany(books.id, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: `reversal:${entryId}`,
      entryDate: on,
      description: 'عكس قيد بنود تجريبي',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: { kind: 'reversal', entryId, today: '2026-11-30' },
    }),
  );

/** The S04 example's invoice: 1,000.00 USD to C1 on 3 November, item M-1 due 3 December. */
const invoice = (books: Books, reference = 'M-1', amount = 100_000n) =>
  manual(books, '2026-11-03', [
    {
      code: '112001',
      currency: 'USD',
      amount,
      dims: ['C1'],
      newItem: { reference, dueOn: '2026-12-03' },
    },
    { code: '411001', currency: 'USD', amount: -amount, dims: ['C1', 'S1'] },
  ]);

/** The business refusal of a posting, with what it names. */
async function refused(work: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, details: error.details };
    throw error;
  }
  throw new Error('expected a refusal');
}

async function itemByReference(books: Books, reference: string) {
  return inCompany(books.id, async (tx) => {
    const [item] = await tx.select().from(openItems).where(eq(openItems.reference, reference));
    if (!item) throw new Error(`no item ${reference}`);
    const [balance] = await tx
      .select()
      .from(openItemBalances)
      .where(eq(openItemBalances.itemId, item.id));
    return { item, balance };
  });
}

const balanceOf = async (books: Books, reference: string) => {
  const { balance } = await itemByReference(books, reference);
  return [balance?.openMinor, balance?.bookMinor, balance?.parallelMinor];
};

/** An entry's lines as rows: account code, currency, amount, book, parallel, movement kind. */
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

const count = async (books: Books) =>
  inCompany(books.id, async (tx) => ({
    requests: (await tx.select().from(postingRequests)).length,
    entries: (await tx.select().from(journalEntries)).length,
    items: (await tx.select().from(openItems)).length,
    movements: (await tx.select().from(openItemMovements)).length,
    dueDates: (await tx.select().from(openItemDueDates)).length,
  }));

/** The chain of a company verifies from its first entry, item ids included (S03 rule 19). */
async function chainHolds(books: Books) {
  const links = await inCompany(books.id, readChain);
  return verifyChain(
    links.map((link) => ({
      entry: chainEntryValue(link.entry),
      previousHash: link.previousHash,
      hash: link.hash,
    })),
  );
}

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: 'items.person@example.test', name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  personId = row.id;
});

describe('the open-item schema', () => {
  it('stores the kinds, sources, movements and due-date setters of packages/contracts', () => {
    expect([...OPEN_ITEM_KINDS]).toEqual([...ITEM_KINDS]);
    expect([...OPEN_ITEM_SOURCES]).toEqual([...ITEM_SOURCES]);
    expect([...OPEN_ITEM_MOVEMENT_KINDS]).toEqual([...MOVEMENT_KINDS]);
    expect([...OPEN_ITEM_DUE_DATE_SETTERS]).toEqual([...DUE_DATE_SETTERS]);
  });
});

describe('post(): manual document items (S04 rules 2, 4, 6, 7, 10)', () => {
  it('opens an item by a new measurement, with its movement, balance, due date and audit row', async () => {
    const books = await newBooks();
    const posted = await invoice(books);
    expect(await rowsOf(books, posted.id)).toEqual([
      ['112001', 'USD', 100_000n, 12_000_000n, 100_000n, 'open'],
      ['411001', 'USD', -100_000n, -12_000_000n, -100_000n, null],
    ]);
    const { item, balance } = await itemByReference(books, 'M-1');
    expect(item).toMatchObject({
      accountId: books.accounts.get('112001'),
      kind: 'document',
      source: 'manual',
      clientValueId: books.values.get('C1'),
      currency: 'USD',
      documentDate: '2026-11-03',
      openedByEntryId: posted.id,
      hubDocument: null,
    });
    expect(balance).toMatchObject({
      openMinor: 100_000n,
      bookMinor: 12_000_000n,
      parallelMinor: 100_000n,
      movementCount: 1,
      lastMovementOn: '2026-11-03',
    });
    const dueDates = await inCompany(books.id, (tx) => tx.select().from(openItemDueDates));
    expect(dueDates).toMatchObject([
      { itemId: item.id, dueOn: '2026-12-03', effectiveOn: '2026-11-03', setBy: 'opening' },
    ]);
    const [audit] = await inCompany(books.id, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.entityId, posted.id)),
    );
    expect(audit?.after).toMatchObject({
      items: [{ lineNo: 1, itemId: item.id, movement: 'open' }],
    });
    // A second invoice with no due date ages from its document date (rule 14).
    await manual(books, '2026-11-10', [
      {
        code: '112001',
        currency: 'USD',
        amount: 50_000n,
        dims: ['C1'],
        newItem: { reference: 'M-2', dueOn: null },
      },
      { code: '411001', currency: 'USD', amount: -50_000n, dims: ['C1', 'S1'] },
    ]);
    expect((await count(books)).dueDates).toBe(1);
  });

  it('settles the S04 example in proportion to what remains; a void reopens exactly what it cleared', async () => {
    const books = await newBooks();
    await invoice(books);
    const m1 = (await itemByReference(books, 'M-1')).item.id;
    const first = await manual(books, '2026-11-19', [
      { code: '111004', currency: 'USD', amount: 40_000n },
      { code: '112001', currency: 'USD', amount: -40_000n, item: m1 },
    ]);
    expect(await rowsOf(books, first.id)).toEqual([
      ['111004', 'USD', 40_000n, 4_920_000n, 40_000n, null],
      ['112001', 'USD', -40_000n, -4_800_000n, -40_000n, 'clear'],
      ['421001', 'SYP', -120_000n, -120_000n, 0n, null],
    ]);
    const final = await manual(books, '2026-11-25', [
      { code: '111003', currency: 'SYP', amount: 7_440_000n },
      { code: '112001', currency: 'USD', amount: -60_000n, item: m1 },
    ]);
    expect(await rowsOf(books, final.id)).toEqual([
      ['111003', 'SYP', 7_440_000n, 7_440_000n, 60_000n, null],
      ['112001', 'USD', -60_000n, -7_200_000n, -60_000n, 'clear'],
      ['421001', 'SYP', -240_000n, -240_000n, 0n, null],
    ]);
    expect(await balanceOf(books, 'M-1')).toEqual([0n, 0n, 0n]);
    const voided = await reverse(books, first.id, '2026-11-26');
    expect(await rowsOf(books, voided.id)).toEqual([
      ['111004', 'USD', -40_000n, -4_920_000n, -40_000n, null],
      ['112001', 'USD', 40_000n, 4_800_000n, 40_000n, 'clear'],
      ['421001', 'SYP', 120_000n, 120_000n, 0n, null],
    ]);
    expect(await balanceOf(books, 'M-1')).toEqual([40_000n, 4_800_000n, 40_000n]);
    const again = await manual(books, '2026-11-26', [
      { code: '111004', currency: 'USD', amount: 40_000n },
      { code: '112001', currency: 'USD', amount: -40_000n, item: m1 },
    ]);
    expect(await rowsOf(books, again.id)).toEqual([
      ['111004', 'USD', 40_000n, 4_960_000n, 40_000n, null],
      ['112001', 'USD', -40_000n, -4_800_000n, -40_000n, 'clear'],
      ['421001', 'SYP', -160_000n, -160_000n, 0n, null],
    ]);
    expect(await balanceOf(books, 'M-1')).toEqual([0n, 0n, 0n]);
    // Every entry hashes with its lines' items, and the integrity check reads them back alike.
    expect(await chainHolds(books)).toBeNull();
  });

  it('writes off an item at what it carries; the expense at the day and the gap realised', async () => {
    const books = await newBooks();
    await invoice(books);
    const m1 = (await itemByReference(books, 'M-1')).item.id;
    const writeOff = await manual(books, '2026-11-19', [
      { code: '532002', currency: 'USD', amount: 100_000n },
      { code: '112001', currency: 'USD', amount: -100_000n, item: m1 },
    ]);
    expect(await rowsOf(books, writeOff.id)).toEqual([
      ['532002', 'USD', 100_000n, 12_300_000n, 100_000n, null],
      ['112001', 'USD', -100_000n, -12_000_000n, -100_000n, 'clear'],
      ['421001', 'SYP', -300_000n, -300_000n, 0n, null],
    ]);
  });

  it('refuses what the rules refuse, naming the line, and leaves nothing behind', async () => {
    const books = await newBooks();
    const other = await newBooks();
    await invoice(books);
    await invoice(other);
    const m1 = (await itemByReference(books, 'M-1')).item.id;
    const foreign = (await itemByReference(other, 'M-1')).item.id;
    const before = await count(books);
    const cash = { code: '111004', currency: 'USD', amount: 10_000n } as const;
    const clear = (change: Partial<Spec>): Spec => ({
      code: '112001',
      currency: 'USD',
      amount: -10_000n,
      item: m1,
      ...change,
    });
    const refusals = {
      required: await refused(
        manual(books, '2026-11-19', [
          cash,
          { code: '112001', currency: 'USD', amount: -10_000n, dims: ['C1'] },
        ]),
      ),
      notControl: await refused(manual(books, '2026-11-19', [{ ...cash, item: m1 }, clear({})])),
      taken: await refused(
        manual(books, '2026-11-19', [
          {
            code: '112001',
            currency: 'USD',
            amount: 10_000n,
            dims: ['C1'],
            newItem: { reference: 'M-1', dueOn: null },
          },
          { code: '411001', currency: 'USD', amount: -10_000n, dims: ['C1', 'S1'] },
        ]),
      ),
      takenTwice: await refused(
        manual(books, '2026-11-19', [
          {
            code: '112001',
            currency: 'USD',
            amount: 10_000n,
            dims: ['C1'],
            newItem: { reference: 'M-9', dueOn: null },
          },
          {
            code: '112001',
            currency: 'USD',
            amount: 10_000n,
            dims: ['C1'],
            newItem: { reference: 'M-9', dueOn: null },
          },
          { code: '411001', currency: 'USD', amount: -20_000n, dims: ['C1', 'S1'] },
        ]),
      ),
      dueBefore: await refused(
        manual(books, '2026-11-19', [
          {
            code: '112001',
            currency: 'USD',
            amount: 10_000n,
            dims: ['C1'],
            newItem: { reference: 'M-8', dueOn: '2026-11-18' },
          },
          { code: '411001', currency: 'USD', amount: -10_000n, dims: ['C1', 'S1'] },
        ]),
      ),
      both: await refused(
        manual(books, '2026-11-19', [cash, clear({ newItem: { reference: 'M-7', dueOn: null } })]),
      ),
      currency: await refused(
        manual(books, '2026-11-19', [
          { code: '111003', currency: 'SYP', amount: 1_230_000n },
          clear({ currency: 'SYP', amount: -1_230_000n }),
        ]),
      ),
      client: await refused(manual(books, '2026-11-19', [cash, clear({ dims: ['C2'] })])),
      direction: await refused(
        manual(books, '2026-11-19', [{ ...cash, amount: -10_000n }, clear({ amount: 10_000n })]),
      ),
      exceeds: await refused(
        manual(books, '2026-11-19', [{ ...cash, amount: 100_001n }, clear({ amount: -100_001n })]),
      ),
      unknown: await refused(manual(books, '2026-11-19', [cash, clear({ item: uuidv7() })])),
      otherCompany: await refused(manual(books, '2026-11-19', [cash, clear({ item: foreign })])),
      runningItem: await refused(
        manual(books, '2026-11-19', [
          cash,
          { code: '213001', currency: 'USD', amount: -10_000n, dims: ['C1'], item: m1 },
        ]),
      ),
      advance: await refused(
        manual(books, '2026-11-19', [
          { code: '111004', currency: 'USD', amount: 50_000n },
          {
            code: '112001',
            currency: 'USD',
            amount: -50_000n,
            dims: ['C2'],
            newItem: { reference: 'ADV-1', dueOn: null },
          },
        ]),
      ),
      runningMore: await refused(
        manual(books, '2026-11-19', [
          cash,
          { code: '213001', currency: 'USD', amount: -10_000n, dims: ['C1', 'S1'] },
        ]),
      ),
    };
    expect(
      Object.fromEntries(Object.entries(refusals).map(([key, value]) => [key, value.code])),
    ).toEqual({
      required: 'OPEN_ITEM_REQUIRED',
      notControl: 'ACCOUNT_NOT_CONTROL',
      taken: 'OPEN_ITEM_REFERENCE_TAKEN',
      takenTwice: 'OPEN_ITEM_REFERENCE_TAKEN',
      dueBefore: 'VALIDATION_FAILED',
      both: 'VALIDATION_FAILED',
      currency: 'OPEN_ITEM_MISMATCH',
      client: 'OPEN_ITEM_MISMATCH',
      direction: 'OPEN_ITEM_DIRECTION',
      exceeds: 'RELEASE_EXCEEDS_BALANCE',
      unknown: 'NOT_FOUND',
      otherCompany: 'NOT_FOUND',
      runningItem: 'VALIDATION_FAILED',
      // An advance is a liability, never a credit item on a receivable account (ADR 0013).
      advance: 'OPEN_ITEM_DIRECTION',
      runningMore: 'VALIDATION_FAILED',
    });
    for (const [key, value] of Object.entries(refusals)) {
      expect(value.details, key).toMatchObject({
        lineNo: key === 'takenTwice' ? 2 : key === 'notControl' ? 1 : expect.any(Number),
      });
    }
    expect(await count(books)).toEqual(before);
    expect(await balanceOf(books, 'M-1')).toEqual([100_000n, 12_000_000n, 100_000n]);
  });

  it("refuses an opening's reversal while its settlements stand, and takes it once they are reversed", async () => {
    const books = await newBooks();
    const opened = await invoice(books);
    const m1 = (await itemByReference(books, 'M-1')).item.id;
    const receipt = await manual(books, '2026-11-19', [
      { code: '111004', currency: 'USD', amount: 40_000n },
      { code: '112001', currency: 'USD', amount: -40_000n, item: m1 },
    ]);
    expect((await refused(reverse(books, opened.id, '2026-11-24'))).code).toBe(
      'OPEN_ITEM_HAS_SETTLEMENTS',
    );
    await reverse(books, receipt.id, '2026-11-24');
    const reversal = await reverse(books, opened.id, '2026-11-24');
    expect(await rowsOf(books, reversal.id)).toEqual([
      ['112001', 'USD', -100_000n, -12_000_000n, -100_000n, 'open'],
      ['411001', 'USD', 100_000n, 12_000_000n, 100_000n, null],
    ]);
    expect(await balanceOf(books, 'M-1')).toEqual([0n, 0n, 0n]);
  });

  it('previews the lines and items post() would post, writing nothing', async () => {
    const books = await newBooks();
    await invoice(books);
    const m1 = (await itemByReference(books, 'M-1')).item.id;
    const before = await count(books);
    const lines = await inCompany(books.id, (tx) =>
      previewPosting(tx, {
        entryDate: '2026-11-19',
        content: {
          kind: 'manual',
          today: '2026-11-30',
          dealtRates: [],
          lines: specs(books, [
            { code: '111004', currency: 'USD', amount: 40_000n },
            { code: '112001', currency: 'USD', amount: -40_000n, item: m1 },
          ]),
        },
      }),
    );
    expect(lines.map((line) => [line.amountMinor, line.bookMinor, line.item])).toEqual([
      [40_000n, 4_920_000n, null],
      [
        -40_000n,
        -4_800_000n,
        { id: m1, movement: 'clear', adjusted: false, isNew: false, reference: null },
      ],
      [-120_000n, -120_000n, null],
    ]);
    expect(await count(books)).toEqual(before);
    const opening = await inCompany(books.id, (tx) =>
      previewPosting(tx, {
        entryDate: '2026-11-19',
        content: {
          kind: 'manual',
          today: '2026-11-30',
          dealtRates: [],
          lines: specs(books, [
            {
              code: '112001',
              currency: 'USD',
              amount: 10_000n,
              dims: ['C1'],
              newItem: { reference: 'M-9', dueOn: null },
            },
            { code: '411001', currency: 'USD', amount: -10_000n, dims: ['C1', 'S1'] },
          ]),
        },
      }),
    );
    expect(opening[0]?.item).toMatchObject({ movement: 'open', isNew: true, reference: 'M-9' });
    expect(await count(books)).toEqual(before);
  });

  it('serialises two settlements of one item: the second sees the first and is refused', async () => {
    const books = await newBooks();
    await invoice(books);
    const m1 = (await itemByReference(books, 'M-1')).item.id;
    const receipt = () =>
      manual(books, '2026-11-19', [
        { code: '111004', currency: 'USD', amount: 100_000n },
        { code: '112001', currency: 'USD', amount: -100_000n, item: m1 },
      ]);
    const results = await Promise.allSettled([receipt(), receipt()]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const failed = results.find((result) => result.status === 'rejected');
    expect((failed as PromiseRejectedResult).reason).toMatchObject({
      code: 'RELEASE_EXCEEDS_BALANCE',
    });
    expect(await balanceOf(books, 'M-1')).toEqual([0n, 0n, 0n]);
  });
});

describe('post(): running items (S04 rules 3, 9, 12, 13)', () => {
  it("finds or makes the client's item, and splits an offset that crosses zero", async () => {
    const books = await newBooks();
    await invoice(books);
    const m1 = (await itemByReference(books, 'M-1')).item.id;
    await manual(books, '2026-11-10', [
      { code: '111004', currency: 'USD', amount: 30_000n },
      { code: '213001', currency: 'USD', amount: -30_000n, dims: ['C1'] },
    ]);
    const { item } = await itemByReference(books, 'C1');
    expect(item).toMatchObject({ kind: 'running', clientValueId: books.values.get('C1') });
    const offset = await manual(books, '2026-11-19', [
      { code: '213001', currency: 'USD', amount: 40_000n, dims: ['C1'] },
      { code: '112001', currency: 'USD', amount: -40_000n, item: m1 },
    ]);
    expect(await rowsOf(books, offset.id)).toEqual([
      ['213001', 'USD', 30_000n, 3_660_000n, 30_000n, 'clear'],
      ['213001', 'USD', 10_000n, 1_230_000n, 10_000n, 'add'],
      ['112001', 'USD', -40_000n, -4_800_000n, -40_000n, 'clear'],
      ['421001', 'SYP', -90_000n, -90_000n, 0n, null],
    ]);
    expect(await balanceOf(books, 'C1')).toEqual([10_000n, 1_230_000n, 10_000n]);
    expect((await count(books)).items).toBe(2);
  });

  it('follows a void across zero with its difference entry, under its own request and audit row', async () => {
    const books = await newBooks();
    const deposit = await manual(books, '2026-11-03', [
      { code: '111004', currency: 'USD', amount: 100_000n },
      { code: '213001', currency: 'USD', amount: -100_000n, dims: ['C1'] },
    ]);
    await manual(books, '2026-11-10', [
      { code: '213001', currency: 'USD', amount: 30_000n, dims: ['C1'] },
      { code: '211001', currency: 'USD', amount: -30_000n, dims: ['C1'] },
    ]);
    expect(await balanceOf(books, 'C1')).toEqual([-70_000n, -8_400_000n, -70_000n]);
    const voided = await reverse(books, deposit.id, '2026-11-19');
    const entries = await inCompany(books.id, (tx) =>
      tx
        .select({ entry: journalEntries, key: postingRequests.idempotencyKey })
        .from(journalEntries)
        .innerJoin(postingRequests, eq(postingRequests.id, journalEntries.requestId))
        .orderBy(asc(journalEntries.sequence)),
    );
    const [, , reversal, difference] = entries;
    expect(reversal?.entry.id).toBe(voided.id);
    expect(difference?.key).toBe(`reversal:${deposit.id}:difference`);
    expect(difference?.entry.reversesEntryId).toBeNull();
    // As a new movement: 700.00 cleared at 8,400,000, then 300.00 × 123. Across zero, the item is
    // cleared from what the reversal left and the 300.00 measured anew (owner, 2026-11-06).
    expect(await rowsOf(books, difference?.entry.id as string)).toEqual([
      ['213001', 'USD', -30_000n, -3_600_000n, -30_000n, 'clear'],
      ['213001', 'USD', 30_000n, 3_690_000n, 30_000n, 'add'],
      ['421001', 'SYP', -90_000n, -90_000n, 0n, null],
    ]);
    // Its rate is recorded, so a correction of the 19 November bulletin lists the entry.
    const used = await inCompany(books.id, async (tx) => {
      const [row] = await tx
        .select({ id: exchangeRates.id })
        .from(exchangeRates)
        .where(
          and(eq(exchangeRates.effectiveOn, '2026-11-19'), eq(exchangeRates.type, 'bulletin')),
        );
      return entriesUsingRate(tx, row?.id as string);
    });
    expect(used.map((entry) => entry.id)).toContain(difference?.entry.id);
    expect(await balanceOf(books, 'C1')).toEqual([30_000n, 3_690_000n, 30_000n]);
    const audits = await inCompany(books.id, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'entry.posted')),
    );
    expect(audits).toHaveLength(4);
    expect(audits.find((row) => row.entityId === difference?.entry.id)?.after).toMatchObject({
      follows: voided.id,
    });
    // The difference goes with its reversal: neither is reversed by hand.
    expect((await refused(reverse(books, difference?.entry.id as string, '2026-11-25'))).code).toBe(
      'ENTRY_NOT_REVERSIBLE',
    );
    expect(await chainHolds(books)).toBeNull();
  });

  it('follows a void against the balance with a difference line on the item, reading no rate', async () => {
    const books = await newBooks();
    await manual(books, '2026-11-03', [
      { code: '111004', currency: 'USD', amount: 100_000n },
      { code: '213001', currency: 'USD', amount: -100_000n, dims: ['C1'] },
    ]);
    await manual(books, '2026-11-10', [
      { code: '213001', currency: 'USD', amount: 40_000n, dims: ['C1'] },
      { code: '211001', currency: 'USD', amount: -40_000n, dims: ['C1'] },
    ]);
    const second = await manual(books, '2026-11-19', [
      { code: '111004', currency: 'USD', amount: 70_000n },
      { code: '213001', currency: 'USD', amount: -70_000n, dims: ['C1'] },
    ]);
    await reverse(books, second.id, '2026-11-25');
    const [, , , , difference] = await inCompany(books.id, (tx) =>
      tx.select().from(journalEntries).orderBy(asc(journalEntries.sequence)),
    );
    // 15,810,000 × 700 / 1,300 = 8,513,077 cleared as a new movement; 96,923 more credit.
    expect(await rowsOf(books, difference?.id as string)).toEqual([
      ['213001', 'USD', 0n, -96_923n, 0n, 'difference'],
      ['541001', 'SYP', 96_923n, 96_923n, 0n, null],
    ]);
    expect(await balanceOf(books, 'C1')).toEqual([-60_000n, -7_296_923n, -60_000n]);
  });

  it('posts a void with the balance alone: the item regains what the movement cleared', async () => {
    const books = await newBooks();
    await manual(books, '2026-11-03', [
      { code: '111004', currency: 'USD', amount: 100_000n },
      { code: '213001', currency: 'USD', amount: -100_000n, dims: ['C1'] },
    ]);
    const refund = await manual(books, '2026-11-10', [
      { code: '213001', currency: 'USD', amount: 40_000n, dims: ['C1'] },
      { code: '111004', currency: 'USD', amount: -40_000n },
    ]);
    const before = (await count(books)).entries;
    await reverse(books, refund.id, '2026-11-19');
    expect((await count(books)).entries).toBe(before + 1);
    expect(await balanceOf(books, 'C1')).toEqual([-100_000n, -12_000_000n, -100_000n]);
  });
});

/** A line written by hand, with the movement it claims. */
interface ForgedLine {
  readonly code: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint;
  readonly book: bigint;
  readonly parallel: bigint | null;
  readonly kind?: string;
  readonly setId?: string;
  readonly movement?: {
    readonly itemId: string;
    readonly kind: string;
    readonly amount?: bigint;
    readonly adjusted?: boolean;
  };
}

/**
 * An entry written by hand as the app role, following every step of post() unless the forgery says
 * otherwise; the guards must refuse each departure (at the statement or at commit).
 */
async function forge(
  books: Books,
  lines: readonly ForgedLine[],
  options: {
    readonly reverses?: string;
    /** Items the entry opens, inserted after its lines and before its movements. */
    readonly items?: (entryId: string) => (typeof openItems.$inferInsert)[];
  } = {},
): Promise<string> {
  return inCompany(books.id, async (tx) => {
    const [head] = await tx.select().from(ledgerHeads).for('update');
    const [settings] = await tx.select().from(companySettings);
    if (!head || !settings) throw new Error('no head');
    const on = '2026-11-20';
    const fiscalYear = fiscalYearOf(on, settings.fiscalYearStartMonth);
    await tx
      .insert(periods)
      .values({ companyId: books.id, period: periodOf(on), fiscalYear, state: 'open' })
      .onConflictDoNothing({ target: [periods.companyId, periods.period] });
    const [counter] = await tx
      .insert(entryNumberCounters)
      .values({ companyId: books.id, fiscalYear, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [entryNumberCounters.companyId, entryNumberCounters.fiscalYear],
        set: { lastNumber: sql`${entryNumberCounters.lastNumber} + 1` },
      })
      .returning();
    const at = await tx.execute<{ at: string }>(
      sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`,
    );
    const now = new Date(at.rows[0]?.at as string);
    for (const line of lines) {
      await tx
        .update(chartAccounts)
        .set({ firstPostedAt: now })
        .where(
          and(
            eq(chartAccounts.id, books.accounts.get(line.code) as string),
            sql`${chartAccounts.firstPostedAt} is null`,
          ),
        );
    }
    let [empty] = await tx.select().from(dimensionSets).where(eq(dimensionSets.key, ''));
    if (!empty)
      [empty] = await tx.insert(dimensionSets).values({ companyId: books.id, key: '' }).returning();
    const [request] = await tx
      .insert(postingRequests)
      .values({
        companyId: books.id,
        client: 'manual',
        idempotencyKey: uuidv7(),
        payloadHash: '0'.repeat(64),
      })
      .returning();
    const id = uuidv7();
    const hash = createHash('sha256').update(id).digest('hex');
    const sequence = head.entryCount + 1n;
    await tx.insert(journalEntries).values({
      id,
      companyId: books.id,
      requestId: request?.id as string,
      sequence,
      fiscalYear,
      number: counter?.lastNumber as number,
      entryDate: on,
      postedAt: now,
      source: 'manual',
      description: 'قيد مزوّر',
      reversesEntryId: options.reverses ?? null,
      postedByUserId: personId,
      lineCount: lines.length,
      previousHash: head.lastHash,
      hash,
    });
    const stored = await tx
      .insert(journalLines)
      .values(
        lines.map((line, index) => ({
          companyId: books.id,
          entryId: id,
          lineNo: index + 1,
          accountId: books.accounts.get(line.code) as string,
          dimensionSetId: line.setId ?? (empty?.id as string),
          kind: line.kind ?? 'measured',
          ledger: null,
          currency: line.currency,
          amountMinor: line.amount,
          bookMinor: line.book,
          parallelMinor: line.parallel,
        })),
      )
      .returning({ id: journalLines.id });
    const items = options.items?.(id) ?? [];
    if (items.length > 0) await tx.insert(openItems).values(items);
    for (const [index, line] of lines.entries()) {
      if (line.movement === undefined) continue;
      await tx.insert(openItemMovements).values({
        companyId: books.id,
        itemId: line.movement.itemId,
        lineId: stored[index]?.id as string,
        entryId: id,
        entryDate: on,
        kind: line.movement.kind,
        adjusted: line.movement.adjusted ?? false,
        amountMinor: line.movement.amount ?? line.amount,
        bookMinor: line.book,
        parallelMinor: line.parallel,
      });
    }
    await tx
      .update(ledgerHeads)
      .set({ entryCount: sequence, lastEntryId: id, lastHash: hash })
      .where(eq(ledgerHeads.id, head.id));
    return id;
  });
}

describe('the open-item guards, against writes the posting function never makes', () => {
  /** A company with M-1 (1,000.00 USD at 120) on 112001 for C1, and the set its lines carry. */
  async function withItem() {
    const books = await newBooks();
    await invoice(books);
    const { item } = await itemByReference(books, 'M-1');
    return { books, item };
  }

  it('keeps items, movements and due dates append-only, and the balances written by their trigger, for every role', async () => {
    const { books, item } = await withItem();
    for (const db of [app, owner]) {
      for (const statement of [
        sql`update open_items set reference = 'M-X'`,
        sql`delete from open_items`,
        sql`truncate open_items cascade`,
        sql`update open_item_movements set amount_minor = 1`,
        sql`delete from open_item_movements`,
        sql`truncate open_item_movements`,
        sql`update open_item_due_dates set due_on = '2027-01-01'`,
        sql`delete from open_item_due_dates`,
        sql`truncate open_item_due_dates`,
        sql`delete from open_item_balances`,
        sql`truncate open_item_balances`,
        sql`update open_item_balances set open_minor = 0`,
        sql`insert into open_item_balances (id, company_id, item_id, open_minor, book_minor, parallel_minor, movement_count, last_movement_on) values (${uuidv7()}, ${books.id}, ${item.id}, 0, 0, 0, 1, '2026-11-03')`,
      ]) {
        expect(await refusal(inCompany(books.id, (tx) => tx.execute(statement), db))).toMatch(
          /refuse|written only by the trigger|permission denied|unique|duplicate/,
        );
      }
    }
    expect(await balanceOf(books, 'M-1')).toEqual([100_000n, 12_000_000n, 100_000n]);
  });

  it('refuses a line on a control account without its movement, and a movement unlike its line', async () => {
    const { books, item } = await withItem();
    const setId = item.dimensionSetId;
    const cash = {
      code: '111004',
      currency: 'USD',
      amount: 10_000n,
      book: 1_230_000n,
      parallel: 10_000n,
    } as const;
    const onItem = {
      code: '112001',
      currency: 'USD',
      amount: -10_000n,
      book: -1_200_000n,
      parallel: -10_000n,
      kind: 'carried',
      setId,
    } as const;
    const gain = {
      code: '421001',
      currency: 'SYP',
      amount: -30_000n,
      book: -30_000n,
      parallel: 0n,
      kind: 'difference',
    } as const;
    expect(await refusal(forge(books, [cash, onItem, { ...gain, kind: 'measured' }]))).toMatch(
      /item movements on an account that is a control account/,
    );
    expect(
      await refusal(
        forge(books, [
          cash,
          { ...onItem, movement: { itemId: item.id, kind: 'clear', amount: -9_999n } },
          { ...gain, kind: 'measured' },
        ]),
      ),
    ).toMatch(/a movement is its line's/);
    expect(
      await refusal(
        forge(books, [
          cash,
          { ...onItem, movement: { itemId: item.id, kind: 'open' } },
          { ...gain, kind: 'measured' },
        ]),
      ),
    ).toMatch(/does not fit|opens once/);
    expect(
      await refusal(
        forge(books, [
          cash,
          { ...onItem, movement: { itemId: item.id, kind: 'clear', adjusted: true } },
          { ...gain, kind: 'measured' },
        ]),
      ),
    ).toMatch(/adjusted exactly/);
    // A movement on a line of another account than its item's.
    expect(
      await refusal(
        forge(books, [
          { ...cash, movement: { itemId: item.id, kind: 'open' } },
          { ...onItem, movement: { itemId: item.id, kind: 'clear' } },
          { ...gain, kind: 'measured' },
        ]),
      ),
    ).toMatch(/a movement is its line's/);
  });

  it('refuses a document item that crosses zero, and a settled item left with a ledger amount (invariant 9)', async () => {
    const { books, item } = await withItem();
    const setId = item.dimensionSetId;
    expect(
      await refusal(
        forge(books, [
          {
            code: '111004',
            currency: 'USD',
            amount: 110_000n,
            book: 13_200_000n,
            parallel: 110_000n,
          },
          {
            code: '112001',
            currency: 'USD',
            amount: -110_000n,
            book: -13_200_000n,
            parallel: -110_000n,
            kind: 'carried',
            setId,
            movement: { itemId: item.id, kind: 'clear' },
          },
        ]),
      ),
    ).toMatch(/crosses zero against its opening/);
    expect(
      await refusal(
        forge(books, [
          {
            code: '111004',
            currency: 'USD',
            amount: 100_000n,
            book: 11_999_999n,
            parallel: 100_000n,
          },
          {
            code: '112001',
            currency: 'USD',
            amount: -100_000n,
            book: -11_999_999n,
            parallel: -100_000n,
            kind: 'carried',
            setId,
            movement: { itemId: item.id, kind: 'clear' },
          },
        ]),
      ),
    ).toMatch(/settled but not zero in every ledger/);
    expect(await balanceOf(books, 'M-1')).toEqual([100_000n, 12_000_000n, 100_000n]);
  });

  it("refuses an opening's reversal forged past the posting function while a settlement stands", async () => {
    const books = await newBooks();
    const opened = await invoice(books);
    const { item } = await itemByReference(books, 'M-1');
    await manual(books, '2026-11-19', [
      { code: '111004', currency: 'USD', amount: 40_000n },
      { code: '112001', currency: 'USD', amount: -40_000n, item: item.id },
    ]);
    const lines = await inCompany(books.id, (tx) =>
      tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, opened.id))
        .orderBy(asc(journalLines.lineNo)),
    );
    const [receivable, revenue] = lines;
    expect(
      await refusal(
        forge(
          books,
          [
            {
              code: '112001',
              currency: 'USD',
              amount: -100_000n,
              book: -12_000_000n,
              parallel: -100_000n,
              setId: receivable?.dimensionSetId as string,
              movement: { itemId: item.id, kind: 'open' },
            },
            {
              code: '411001',
              currency: 'USD',
              amount: 100_000n,
              book: 12_000_000n,
              parallel: 100_000n,
              setId: revenue?.dimensionSetId as string,
            },
          ],
          { reverses: opened.id },
        ),
      ),
    ).toMatch(/OPEN_ITEM_HAS_SETTLEMENTS/);
  });

  it('refuses an item made without its opening movement, or opened against its account', async () => {
    const { books, item } = await withItem();
    const forgedItem = (values: Partial<typeof openItems.$inferInsert>) =>
      inCompany(books.id, (tx) =>
        tx.insert(openItems).values({
          companyId: books.id,
          accountId: item.accountId,
          kind: 'document',
          reference: 'M-FORGED',
          source: 'manual',
          dimensionSetId: item.dimensionSetId,
          clientValueId: item.clientValueId,
          currency: 'USD',
          documentDate: item.documentDate,
          openedByEntryId: item.openedByEntryId,
          ...values,
        }),
      );
    // An old entry gains no line, so an item it is said to open never gets its opening movement.
    expect(await refusal(forgedItem({}))).toMatch(/not opened by a movement of its opening entry/);
    expect(
      await refusal(
        forgedItem({
          kind: 'running',
          accountId: books.accounts.get('213001') as string,
          reference: 'C1',
        }),
      ),
    ).toMatch(/not opened by a movement of its opening entry/);
    expect((await count(books)).items).toBe(1);
    // A forged entry opening a credit item on the receivable account, an advance.
    const advance = uuidv7();
    expect(
      await refusal(
        forge(
          books,
          [
            {
              code: '111004',
              currency: 'USD',
              amount: 50_000n,
              book: 6_150_000n,
              parallel: 50_000n,
            },
            {
              code: '112001',
              currency: 'USD',
              amount: -50_000n,
              book: -6_150_000n,
              parallel: -50_000n,
              setId: item.dimensionSetId,
              movement: { itemId: advance, kind: 'open' },
            },
          ],
          {
            items: (entryId) => [
              {
                id: advance,
                companyId: books.id,
                accountId: item.accountId,
                kind: 'document',
                reference: 'ADV-1',
                source: 'manual',
                dimensionSetId: item.dimensionSetId,
                clientValueId: item.clientValueId,
                currency: 'USD',
                documentDate: '2026-11-20',
                openedByEntryId: entryId,
              },
            ],
          },
        ),
      ),
    ).toMatch(/OPEN_ITEM_DIRECTION/);
  });

  it("refuses a person's due date on an item that is not manual, and a due date on a running item", async () => {
    const books = await newBooks();
    await manual(books, '2026-11-03', [
      { code: '111004', currency: 'USD', amount: 10_000n },
      { code: '213001', currency: 'USD', amount: -10_000n, dims: ['C1'] },
    ]);
    const { item } = await itemByReference(books, 'C1');
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.insert(openItemDueDates).values({
            companyId: books.id,
            itemId: item.id,
            dueOn: '2026-12-01',
            effectiveOn: '2026-11-03',
            setBy: 'opening',
          }),
        ),
      ),
    ).toMatch(/a due date is a document item's/);
  });
});
