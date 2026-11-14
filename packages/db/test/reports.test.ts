import {
  type CompanyLedgers,
  createAccountSchema,
  DomainError,
  SERVICE_DEPARTMENT_SOURCES,
} from '@vertex-mizan/contracts';
import { and, eq } from 'drizzle-orm';
import fc from 'fast-check';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditEntries,
  chartAccounts,
  createAccount,
  createCompanyBooks,
  DEPARTMENT_SOURCES,
  dimensionTypes,
  dimensionValues,
  type PersonActor,
  post,
  readAccountStatement,
  readBalanceSheet,
  readGeneralLedger,
  readIncomeStatement,
  readJournal,
  readJournalBook,
  readProfitability,
  readReportLines,
  readServiceDepartments,
  readTrialBalance,
  serviceDepartments,
  setServiceDepartment,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { closeMonthByHand, connect, refusal } from './connections.js';

// S09 on the migrated database (0046–0047): the service departments, append-only under forced
// RLS with their guards (the values' types, the source, a Hub service's department from Hub only,
// no row in a closed month) as the app role and the owner; the accountant's row and Hub's (rules
// 32–34); and the reports' readers against the posted lines over generated books (rule 8): the
// trial balance's pairs balance and its rows are the lines' sums, at any date, the balance sheet
// balances, the income statement's result is classes 4–5, the journal book's totals are the trial
// balance's movements, a drill-down sums to its figure, a general ledger's pages run on, and
// another company reads nothing. All values are synthetic.

const { app, owner } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-reports-test',
  ipAddress: null,
  userAgent: null,
});

const SYP_ONLY: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: null,
};

const NOW = new Date('2027-01-15T10:00:00Z');

interface Books {
  readonly id: string;
  readonly accounts: Map<string, string>;
  readonly values: Map<string, string>;
}

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

/** An SYP company with the general chart, services S1 (by hand) and S2 (from Hub). */
async function newBooks(): Promise<Books> {
  const id = uuidv7();
  await withCompany(app, id, (tx) =>
    createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة تقارير تجريبية',
        nameLatin: null,
        ledgers: SYP_ONLY,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'general',
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
        { companyId: id, typeId: typeId('service'), code: 'S1', name: 'خدمة يدوية' },
        {
          companyId: id,
          typeId: typeId('service'),
          code: 'S2',
          name: 'خدمة من Hub',
          externalSource: 'hub',
          externalId: 'service-2',
        },
        { companyId: id, typeId: typeId('department'), code: 'design', name: 'التصميم' },
        { companyId: id, typeId: typeId('department'), code: 'video', name: 'الفيديو' },
      ])
      .returning({ id: dimensionValues.id, code: dimensionValues.code });
    return new Map(rows.map((row) => [row.code as string, row.id]));
  });
  const accounts = await inCompany(id, (tx) =>
    tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts),
  );
  return { id, accounts: new Map(accounts.map((row) => [row.code, row.id])), values };
}

/** A manual SYP entry of `(code, amount, values)` lines, posted through the posting function. */
function manual(
  books: Books,
  on: string,
  lines: readonly (readonly [string, bigint] | readonly [string, bigint, readonly string[]])[],
) {
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
      content: {
        kind: 'manual',
        today: '2026-12-31',
        dealtRates: [],
        lines: lines.map(([code, amount, values]) => ({
          accountId: books.accounts.get(code) as string,
          dimensionValueIds: (values ?? []).map((value) => books.values.get(value) as string),
          currency: 'SYP',
          amountMinor: amount,
          memo: null,
        })),
      },
    }),
  );
}

const departmentRow = (books: Books, fields: Partial<typeof serviceDepartments.$inferInsert>) => ({
  companyId: books.id,
  serviceValueId: books.values.get('S1') as string,
  departmentValueId: books.values.get('design') as string,
  effectiveFrom: '2026-12-01',
  source: 'manual',
  recordedByUserId: personId,
  reason: 'سبب تجريبي',
  ...fields,
});

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: 'reports.person@example.test', name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  personId = row.id;
});

describe('service_departments (S09 rules 32–34, 0047)', () => {
  it("takes the contracts' sources", () => {
    expect(DEPARTMENT_SOURCES).toEqual(SERVICE_DEPARTMENT_SOURCES);
  });

  it('is append-only for the app role and the owner, and isolated by company', async () => {
    const books = await newBooks();
    const other = await newBooks();
    const [row] = await inCompany(books.id, (tx) =>
      tx.insert(serviceDepartments).values(departmentRow(books, {})).returning(),
    );
    const id = row?.id as string;
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx
            .update(serviceDepartments)
            .set({ effectiveFrom: '2026-12-02' })
            .where(eq(serviceDepartments.id, id)),
        ),
      ),
    ).toMatch(/append-only|permission denied/);
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.delete(serviceDepartments).where(eq(serviceDepartments.id, id)),
        ),
      ),
    ).toMatch(/append-only|permission denied/);
    expect(
      await refusal(
        withCompany(owner, books.id, (tx) =>
          tx
            .update(serviceDepartments)
            .set({ effectiveFrom: '2026-12-02' })
            .where(eq(serviceDepartments.id, id)),
        ),
      ),
    ).toMatch(/append-only|refuse/i);
    expect(await inCompany(other.id, (tx) => tx.select().from(serviceDepartments))).toEqual([]);
    // Another company's department: the composite key refuses it.
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx
            .insert(serviceDepartments)
            .values(
              departmentRow(books, { departmentValueId: other.values.get('design') as string }),
            ),
        ),
      ),
    ).toMatch(/a department value|foreign key/);
  });

  it("refuses values of other types, a Hub service's row by hand, the wrong actor and a closed month", async () => {
    const books = await newBooks();
    const insert = (fields: Partial<typeof serviceDepartments.$inferInsert>) =>
      refusal(
        inCompany(books.id, (tx) =>
          tx.insert(serviceDepartments).values(departmentRow(books, fields)),
        ),
      );
    expect(await insert({ serviceValueId: books.values.get('C1') as string })).toMatch(
      /a service value/,
    );
    expect(await insert({ departmentValueId: books.values.get('S2') as string })).toMatch(
      /a department value/,
    );
    expect(await insert({ serviceValueId: books.values.get('S2') as string })).toMatch(
      /DIMENSION_FROM_HUB/,
    );
    expect(await insert({ reason: null })).toMatch(/service_departments_source_actor/);
    expect(await insert({ source: 'hub' })).toMatch(/service_departments_source_actor/);
    await manual(books, '2026-11-10', [
      ['111003', 1_000n],
      ['311001', -1_000n],
    ]);
    await closeMonthByHand(app, books.id, '2026-11');
    expect(await insert({ effectiveFrom: '2026-11-20' })).toMatch(/PERIOD_CLOSED/);
    // A month before the first period reads as closed while a month is closed.
    expect(await insert({ effectiveFrom: '2026-10-01' })).toMatch(/PERIOD_CLOSED/);
    const [ok] = await inCompany(books.id, (tx) =>
      tx
        .insert(serviceDepartments)
        .values(departmentRow(books, { effectiveFrom: '2026-12-05' }))
        .returning(),
    );
    expect(ok?.effectiveFrom).toBe('2026-12-05');
  });
});

describe('the dated department of a service (rules 32–34)', () => {
  it("sets a manual service's department with its audit row, and refuses what rule 34 refuses", async () => {
    const books = await newBooks();
    const set = (fields: { service?: string; department?: string; on?: string }) =>
      inCompany(books.id, (tx) =>
        setServiceDepartment(tx, {
          serviceValueId: books.values.get(fields.service ?? 'S1') as string,
          departmentValueId: books.values.get(fields.department ?? 'design') as string,
          effectiveFrom: fields.on ?? '2026-12-01',
          reason: 'خدمة يقدمها قسم التصميم',
          actor: actor(),
        }),
      );
    const code = async (work: Promise<unknown>) => {
      try {
        await work;
      } catch (error) {
        if (error instanceof DomainError) return error.code;
        throw error;
      }
      return 'none';
    };
    const history = await set({});
    expect(history.rows.map((row) => [row.department.code, row.effectiveFrom, row.source])).toEqual(
      [['design', '2026-12-01', 'manual']],
    );
    expect(history.rows[0]?.recordedBy?.name).toBe('محاسب تجريبي');
    const audit = await inCompany(books.id, (tx) =>
      tx.select().from(auditEntries).where(eq(auditEntries.action, 'service_department.set')),
    );
    expect(audit).toHaveLength(1);
    expect(await code(set({ service: 'S2' }))).toBe('DIMENSION_FROM_HUB');
    expect(await code(set({ service: 'C1' }))).toBe('NOT_FOUND');
    expect(await code(set({ department: 'S1' }))).toBe('VALIDATION_FAILED');
    await manual(books, '2026-11-10', [
      ['111003', 1_000n],
      ['311001', -1_000n],
    ]);
    await closeMonthByHand(app, books.id, '2026-11');
    expect(await code(set({ on: '2026-11-15' }))).toBe('PERIOD_CLOSED');
    const read = await inCompany(books.id, (tx) =>
      readServiceDepartments(tx, books.values.get('S1') as string),
    );
    expect(read.fromHub).toBe(false);
  });
});

describe('profitability by department (rules 20–23)', () => {
  it("gives a revenue line its service's department, and a cost line only its own", async () => {
    const books = await newBooks();
    const actorNow = actor();
    // A direct-cost account that requires no department, so a cost line can name a service only.
    await inCompany(books.id, async (tx) => {
      const [parent] = await tx
        .select({ id: chartAccounts.id })
        .from(chartAccounts)
        .where(eq(chartAccounts.code, '511'));
      const made = await createAccount(
        tx,
        books.id,
        createAccountSchema.parse({
          parentId: parent?.id,
          code: '511009',
          kind: 'postable',
          name: 'تكاليف مباشرة أخرى',
          statementLine: 'is.direct_costs',
        }),
        actorNow,
      );
      books.accounts.set('511009', made.id);
      await setServiceDepartment(tx, {
        serviceValueId: books.values.get('S1') as string,
        departmentValueId: books.values.get('design') as string,
        effectiveFrom: '2026-12-01',
        reason: 'خدمة يقدمها قسم التصميم',
        actor: actorNow,
      });
    });
    await manual(books, '2026-12-10', [
      ['111003', 100_000n],
      ['411001', -100_000n, ['C1', 'S1']],
    ]);
    await manual(books, '2026-12-11', [
      ['511009', 30_000n, ['S1']],
      ['111003', -30_000n],
    ]);
    const report = await inCompany(books.id, (tx) =>
      readProfitability(
        tx,
        { by: 'department', from: '2026-12-01', to: '2026-12-31', compare: false },
        NOW,
      ),
    );
    expect(report.header.ledger).toBe('book');
    expect(report.rows.map((row) => [row.value?.code ?? null, row.current])).toEqual([
      ['design', { revenue: '100000', directCosts: '0', contribution: '100000', margin: '100.0' }],
      [null, { revenue: '0', directCosts: '30000', contribution: '-30000', margin: null }],
    ]);
    const costs = await inCompany(books.id, (tx) =>
      readReportLines(
        tx,
        {
          ledger: 'book',
          from: '2026-12-01',
          to: '2026-12-31',
          statementLine: 'is.direct_costs',
          profitabilityBy: 'department',
          dims: [],
          openingEntry: false,
        },
        NOW,
      ),
    );
    expect(costs).toMatchObject({ sum: '30000', count: 1 });
  });
});

// --- The readers against the lines (rule 8) ---

/** Postable accounts with no required dimension or item, in every class. */
const CODES = ['111003', '111001', '211003', '311001', '422001', '531001'] as const;

const lineArbitrary = fc.tuple(
  fc.constantFrom(...CODES),
  fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }),
);

const entryArbitrary = fc.record({
  day: fc.integer({ min: 0, max: 60 }),
  lines: fc.array(lineArbitrary, { minLength: 1, maxLength: 4 }),
});

const dateOf = (day: number) => {
  const date = new Date(Date.UTC(2026, 10, 1 + day));
  return date.toISOString().slice(0, 10);
};

describe('the readers agree with the ledger (rule 8)', () => {
  it('over generated books, at a mid-month date and a month end', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(entryArbitrary, { minLength: 1, maxLength: 12 }),
        async (generated) => {
          const books = await newBooks();
          const posted: { date: string; code: string; amount: bigint }[] = [];
          for (const entry of generated) {
            const lines = entry.lines.filter(([, amount]) => amount !== 0n);
            const residual = lines.reduce((total, [, amount]) => total + amount, 0n);
            const all: [string, bigint][] = [...lines, ['111003', -residual]];
            const kept = all.filter(([, amount]) => amount !== 0n);
            if (kept.length < 2) continue;
            await manual(books, dateOf(entry.day), kept);
            for (const [code, amount] of kept)
              posted.push({ date: dateOf(entry.day), code, amount });
          }
          const read = <T>(work: (tx: Transaction) => Promise<T>) => inCompany(books.id, work);
          for (const [from, to] of [
            ['2026-11-01', '2026-11-30'],
            ['2026-11-12', '2026-12-17'],
            ['2026-12-01', '2026-12-31'],
          ] as const) {
            const tb = await read((tx) =>
              readTrialBalance(
                tx,
                { from, to, ledger: 'book', level: 4, nonZero: true, compare: false },
                NOW,
              ),
            );
            expect(tb.totals.openingDebit).toBe(tb.totals.openingCredit);
            expect(tb.totals.debits).toBe(tb.totals.credits);
            expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
            for (const row of tb.rows) {
              const lines = posted.filter((line) => line.code === row.account.code);
              const before = lines
                .filter((line) => line.date < from)
                .reduce((t, l) => t + l.amount, 0n);
              const within = lines.filter((line) => line.date >= from && line.date <= to);
              expect(BigInt(row.opening)).toBe(before);
              expect(BigInt(row.debits)).toBe(
                within.filter((l) => l.amount > 0n).reduce((t, l) => t + l.amount, 0n),
              );
              expect(BigInt(row.credits)).toBe(
                within.filter((l) => l.amount < 0n).reduce((t, l) => t - l.amount, 0n),
              );
              // A drill-down from the closing balance sums to it.
              const lines_ = await read((tx) =>
                readReportLines(
                  tx,
                  { ledger: 'book', to, account: row.account.id, dims: [], openingEntry: false },
                  NOW,
                ),
              );
              expect(lines_.sum).toBe(row.closing);
            }
            const income = await read((tx) =>
              readIncomeStatement(tx, { from, to, ledger: 'book', compare: false }, NOW),
            );
            const classes = posted
              .filter((line) => line.date >= from && line.date <= to && /^[45]/.test(line.code))
              .reduce((t, l) => t + l.amount, 0n);
            expect(BigInt(income.subtotals.profit)).toBe(-classes);
            const sheet = await read((tx) =>
              readBalanceSheet(tx, { asOf: to, ledger: 'book', compare: true }, NOW),
            );
            expect(sheet.totals.assets).toBe(sheet.totals.liabilitiesAndEquity);
            expect(sheet.compareTotals?.assets).toBe(sheet.compareTotals?.liabilitiesAndEquity);
          }
          // The journal book's totals for November and December are the trial balance's movements.
          const book = await read((tx) =>
            readJournalBook(
              tx,
              { fiscalYear: 2026, from: '2026-11', to: '2026-12', ledger: 'book' },
              NOW,
            ),
          );
          const tb = await read((tx) =>
            readTrialBalance(
              tx,
              {
                from: '2026-11-01',
                to: '2026-12-31',
                ledger: 'book',
                level: 1,
                nonZero: true,
                compare: false,
              },
              NOW,
            ),
          );
          const last = book.pages.at(-1);
          expect(last?.cumulative.debits ?? '0').toBe(tb.totals.debits);
          expect(book.official).toBe(false);
          // The journal lists every entry of the range in (entry_date, number) order.
          const journal = await read((tx) =>
            readJournal(tx, { from: '2026-11-01', to: '2026-12-31', ledger: 'book' }, NOW),
          );
          const dates = journal.entries.map((entry) => entry.entryDate);
          expect([...dates].sort()).toEqual(dates);
        },
      ),
      { numRuns: 6 },
    );
  }, 120_000);

  it('pages a general ledger and an account statement with running balances that run on', async () => {
    const books = await newBooks();
    for (let n = 1; n <= 110; n += 1) {
      await manual(books, dateOf(n % 50), [
        ['531001', BigInt(n) * 100n],
        ['111003', -BigInt(n) * 100n],
      ]);
    }
    const lines = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await inCompany(books.id, (tx) =>
        readGeneralLedger(
          tx,
          { from: '2026-11-01', to: '2026-12-31', ledger: 'book', cursor },
          NOW,
        ),
      );
      pages += 1;
      for (const account of page.accounts) {
        let balance = BigInt(account.opening);
        for (const line of account.lines) {
          balance += BigInt(line.amount);
          expect(BigInt(line.balance)).toBe(balance);
        }
        lines.push(...account.lines);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(pages).toBe(2);
    expect(lines).toHaveLength(220);
    const statement = await inCompany(books.id, (tx) =>
      readAccountStatement(
        tx,
        books.accounts.get('531001') as string,
        { from: '2026-11-15', to: '2026-12-31', ledger: 'book', dims: [] },
        NOW,
      ),
    );
    expect(BigInt(statement.closing)).toBe(BigInt(110 * 111 * 50));
    expect(statement.currencies.map((row) => row.currency)).toEqual(['SYP']);
  }, 30_000);

  it('reads nothing of another company', async () => {
    const books = await newBooks();
    const other = await newBooks();
    await manual(books, '2026-11-10', [
      ['111003', 5_000n],
      ['311001', -5_000n],
    ]);
    const tb = await inCompany(other.id, (tx) =>
      readTrialBalance(
        tx,
        {
          from: '2026-11-01',
          to: '2026-11-30',
          ledger: 'book',
          level: 4,
          nonZero: true,
          compare: false,
        },
        NOW,
      ),
    );
    expect(tb.rows).toEqual([]);
    const notFound = await refusal(
      inCompany(other.id, (tx) =>
        readAccountStatement(
          tx,
          books.accounts.get('111003') as string,
          { from: '2026-11-01', to: '2026-11-30', ledger: 'book', dims: [] },
          NOW,
        ),
      ),
    );
    expect(notFound).toMatch(/No such account/);
    expect(
      await refusal(
        inCompany(other.id, (tx) => readServiceDepartments(tx, books.values.get('S1') as string)),
      ),
    ).toMatch(/No such service/);
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          readTrialBalance(
            tx,
            {
              from: '2026-11-01',
              to: '2026-11-30',
              ledger: 'parallel',
              level: 4,
              nonZero: true,
              compare: false,
            },
            NOW,
          ),
        ),
      ),
    ).toMatch(/no parallel ledger/);
    const [row] = await inCompany(books.id, (tx) =>
      tx
        .select()
        .from(chartAccounts)
        .where(and(eq(chartAccounts.code, '111003'))),
    );
    expect(row?.code).toBe('111003');
  });
});
