import {
  accountStatementQuerySchema,
  balanceSheetQuerySchema,
  type CompanyLedgers,
  DomainError,
  generalLedgerQuerySchema,
  incomeStatementQuerySchema,
  OPENING_STATES,
  reportLinesQuerySchema,
  saveOpeningSchema,
  trialBalanceQuerySchema,
} from '@vertex-mizan/contracts';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chartAccounts,
  closePeriod,
  companySettings,
  createCompanyBooks,
  dimensionTypes,
  dimensionValues,
  journalEntries,
  journalLines,
  OPENING_ROW_STATES,
  openItems,
  openingLines,
  openings,
  type PersonActor,
  periods,
  post,
  postOpening,
  readAccountStatement,
  readBalanceSheet,
  readGeneralLedger,
  readIncomeStatement,
  readOpening,
  readReportLines,
  readTrialBalance,
  recordRate,
  reverseOpening,
  saveOpening,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S10's opening in the database (rules 2–25, ADR 0019 as amended by ADR 0021): the books start's
// lock, the draft's versions, the checks, the posting through `post()`, the whole reversal while
// the opening is the only entry, nothing posted or closed before the opening, and the guards against
// forged rows. The scenario book holds the numbers (`opening/opening-entry.md`).

const { app, owner } = connect();

let personId = '';

const person = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'مالك تجريبي',
  sessionId: null,
  requestId: 'request-opening-test',
  ipAddress: null,
  userAgent: null,
});

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const inCompany = <T>(companyId: string, work: (tx: Transaction) => Promise<T>) =>
  withCompany(app, companyId, work);

/** A company with the general chart, its books starting on 1 October 2026. */
async function newCompany(booksStart: string | null = '2026-10-01') {
  const companyId = uuidv7();
  await withCompany(app, companyId, (tx) =>
    createCompanyBooks(
      tx,
      companyId,
      {
        name: 'شركة افتتاح تجريبية',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'general',
        createdByUserId: personId,
        booksStart,
      },
      person(),
    ),
  );
  return companyId;
}

async function recordRates(companyId: string) {
  await inCompany(companyId, async (tx) => {
    for (const [on, type, rate] of [
      ['2026-09-10', 'bulletin', '114.0000'],
      ['2026-09-30', 'bulletin', '115.0000'],
      ['2026-09-30', 'market', '118.0000'],
    ] as const) {
      await recordRate(tx, companyId, person(), {
        effectiveOn: on,
        base: 'USD',
        quote: 'SYP',
        rate,
        type,
        source: 'manual',
      });
    }
  });
}

async function accountId(tx: Transaction, code: string) {
  const [row] = await tx.select().from(chartAccounts).where(eq(chartAccounts.code, code));
  return row?.id as string;
}

/** A client value of the company, made for a receivable line. */
async function newClient(tx: Transaction, companyId: string) {
  const [type] = await tx
    .select({ id: dimensionTypes.id })
    .from(dimensionTypes)
    .where(eq(dimensionTypes.code, 'client'));
  const [row] = await tx
    .insert(dimensionValues)
    .values({ companyId, typeId: type?.id as string, code: 'C1', name: 'عميل تجريبي' })
    .returning({ id: dimensionValues.id });
  return row?.id as string;
}

/** The records of the worked example: SYP cash, capital and the result before the books start. */
async function save(tx: Transaction, version: number) {
  return saveOpening(
    tx,
    saveOpeningSchema.parse({
      version,
      lines: [
        { accountId: await accountId(tx, '111001'), currency: 'SYP', amount: '200000000' },
        {
          accountId: await accountId(tx, '311001'),
          currency: 'SYP',
          amount: '-100000000',
          parallel: '-1000000',
        },
      ],
    }),
    person(),
  );
}

/** A company with its rates recorded and its draft saved, ready to post. */
async function readyCompany() {
  const companyId = await newCompany();
  await recordRates(companyId);
  await inCompany(companyId, (tx) => save(tx, 0));
  return { companyId };
}

const manualEntry = async (tx: Transaction, on = '2026-10-05') =>
  post(tx, {
    client: 'manual',
    idempotencyKey: uuidv7(),
    entryDate: on,
    description: 'إيجار تجريبي',
    reference: null,
    draftId: null,
    preparedByUserId: personId,
    approvedByUserId: null,
    actor: person(),
    content: {
      kind: 'manual',
      today: on,
      dealtRates: [],
      lines: [
        {
          accountId: await accountId(tx, '531001'),
          dimensionValueIds: [],
          currency: 'SYP',
          amountMinor: 100n,
          memo: null,
        },
        {
          accountId: await accountId(tx, '111001'),
          dimensionValueIds: [],
          currency: 'SYP',
          amountMinor: -100n,
          memo: null,
        },
      ],
    },
  });

const codeOf = async (work: Promise<unknown>) => {
  try {
    await work;
    return 'none';
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
};

beforeAll(async () => {
  const [user] = await app
    .insert(users)
    .values({ email: `opening-${uuidv7()}@example.test`, name: 'مالك تجريبي' })
    .returning({ id: users.id });
  personId = user?.id as string;
});

describe('the opening (S10)', () => {
  it('keeps its lists equal to the contracts', () => {
    expect([...OPENING_ROW_STATES]).toEqual([...OPENING_STATES]);
  });

  it('refuses everything but the opening before it is posted (rule 3)', async () => {
    const companyId = await newCompany();
    expect(await codeOf(inCompany(companyId, (tx) => manualEntry(tx)))).toBe('OPENING_NOT_POSTED');
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(
          closePeriod(tx, {
            period: '2026-10',
            reason: 'إقفال',
            today: '2026-11-05',
            actor: person(),
          }),
        ),
      ),
    ).toBe('OPENING_NOT_POSTED');
    // The guard refuses it again, whoever writes.
    const [count] = await inCompany(companyId, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(journalEntries),
    );
    expect(count?.n).toBe(0);
  });

  it('locks the books start once an opening is saved, and never clears it (rule 2)', async () => {
    const companyId = await newCompany();
    await inCompany(companyId, (tx) =>
      tx.update(companySettings).set({ booksStart: '2026-11-01' }),
    );
    expect(
      await refusal(
        inCompany(companyId, (tx) => tx.update(companySettings).set({ booksStart: null })),
      ),
    ).toContain('BOOKS_START_LOCKED');
    expect(
      await refusal(
        inCompany(companyId, (tx) => tx.update(companySettings).set({ booksStart: '2026-11-15' })),
      ),
    ).toContain('company_settings_books_start');
    await inCompany(companyId, (tx) =>
      tx.update(companySettings).set({ booksStart: '2026-10-01' }),
    );
    await inCompany(companyId, (tx) => save(tx, 0));
    expect(
      await refusal(
        inCompany(companyId, (tx) => tx.update(companySettings).set({ booksStart: '2026-09-01' })),
      ),
    ).toContain('BOOKS_START_LOCKED');
  });

  it('checks before posting, and refuses a stale version or fingerprint (rules 16, 21, 23)', async () => {
    const companyId = await newCompany();
    // No rate recorded yet.
    await inCompany(companyId, (tx) => save(tx, 0));
    const view = await inCompany(companyId, readOpening);
    expect(view.checks.filter((check) => !check.passed).map((check) => check.check)).toEqual([
      'rates',
    ]);
    expect(view.lines).toEqual([]);
    expect(await codeOf(inCompany(companyId, (tx) => save(tx, 0)))).toBe('OPENING_CHANGED');
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(postOpening(tx, { fingerprint: view.fingerprint, actor: person() })),
      ),
    ).toBe('OPENING_CHECKS_FAILED');
    await recordRates(companyId);
    const rated = await inCompany(companyId, readOpening);
    expect(rated.checks.every((check) => check.passed)).toBe(true);
    // A rate recorded changed the fingerprint: the earlier one is stale.
    expect(rated.fingerprint).not.toBe(view.fingerprint);
    await inCompany(companyId, (tx) => save(tx, 1));
    // The save changed the version: the earlier fingerprint is stale.
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(postOpening(tx, { fingerprint: view.fingerprint, actor: person() })),
      ),
    ).toBe('OPENING_CHANGED');
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(postOpening(tx, { fingerprint: rated.fingerprint, actor: person() })),
      ),
    ).toBe('OPENING_CHANGED');
    // The balancing line on retained earnings closes each ledger (rules 18–19).
    const ready = await inCompany(companyId, readOpening);
    expect(ready.lines.map((line) => line.source)).toEqual(['records', 'records', 'balancing']);
  });

  it('posts once, and reverses whole only while it is the only entry (rules 23, 25)', async () => {
    const { companyId } = await readyCompany();
    const view = await inCompany(companyId, readOpening);
    expect(view.checks.every((check) => check.passed)).toBe(true);
    // Two owners at once: one posts, the other is refused.
    const answers = await Promise.all(
      [0, 1].map(() =>
        inCompany(companyId, (tx) =>
          postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
        ).then(
          () => 'posted',
          (error: unknown) => (error instanceof DomainError ? error.code : 'error'),
        ),
      ),
    );
    expect(answers.sort()).toEqual(['OPENING_POSTED', 'posted']);
    const [entry] = await inCompany(companyId, (tx) => tx.select().from(journalEntries));
    expect(entry).toMatchObject({ source: 'opening', entryDate: '2026-10-01', number: 1 });
    expect(await codeOf(inCompany(companyId, (tx) => save(tx, 1)))).toBe('OPENING_POSTED');
    // After posting, entries post; the whole reversal is refused once another entry stands.
    const reversed = await inCompany(companyId, (tx) =>
      reverseOpening(tx, { reason: 'تصحيح تجريبي', actor: person() }),
    );
    expect(reversed.entry.number).toBe(2);
    expect(await codeOf(inCompany(companyId, (tx) => manualEntry(tx)))).toBe('OPENING_NOT_POSTED');
    const again = await inCompany(companyId, readOpening);
    expect(again.version).toBe(0);
    expect(again.recordLines).toHaveLength(2);
    await inCompany(companyId, (tx) => save(tx, 0));
    const ready = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: ready.fingerprint, actor: person() }),
    );
    await inCompany(companyId, (tx) => manualEntry(tx));
    expect(
      await inCompany(companyId, (tx) =>
        codeOf(reverseOpening(tx, { reason: 'تصحيح ثانٍ', actor: person() })),
      ),
    ).toBe('OPENING_NOT_REVERSIBLE');
    const states = await inCompany(companyId, (tx) =>
      tx.select({ state: openings.state }).from(openings).orderBy(openings.createdAt),
    );
    expect(states.map((row) => row.state)).toEqual(['reversed', 'posted']);
  });

  it('refuses forged rows: states, versions and stated lines (guards)', async () => {
    const { companyId } = await readyCompany();
    // A version skipped, and a line of a version that is not the save's.
    expect(
      await refusal(inCompany(companyId, (tx) => tx.update(openings).set({ version: 5 }))),
    ).toContain('adds one to the version');
    expect(
      await refusal(
        inCompany(companyId, async (tx) => {
          const [opening] = await tx.select().from(openings);
          await tx.insert(openingLines).values({
            companyId,
            openingId: opening?.id as string,
            version: opening?.version as number,
            lineNo: 9,
            accountId: await accountId(tx, '111001'),
            currency: 'SYP',
            amountMinor: 1n,
          });
        }),
      ),
    ).toContain('written by the save');
    // Posted with no entry of its own.
    expect(
      await refusal(
        inCompany(companyId, (tx) =>
          tx.update(openings).set({
            state: 'posted',
            entryId: uuidv7(),
            postedByUserId: personId,
            postedAt: new Date(),
            fingerprint: 'a'.repeat(64),
          }),
        ),
      ),
    ).toMatch(/posted with its entry|foreign key/);
    expect(await refusal(withCompany(owner, companyId, (tx) => tx.delete(openings)))).toContain(
      'openings',
    );
    const view = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
    );
    await inCompany(companyId, (tx) => manualEntry(tx));
    // A stated line on a manual entry.
    expect(
      await refusal(
        inCompany(companyId, async (tx) => {
          const [manual] = await tx
            .select()
            .from(journalEntries)
            .where(eq(journalEntries.source, 'manual'));
          const [line] = await tx
            .select()
            .from(journalLines)
            .where(eq(journalLines.entryId, manual?.id as string));
          await tx.insert(journalLines).values({
            ...(line as typeof journalLines.$inferInsert),
            id: uuidv7(),
            lineNo: 9,
            kind: 'stated',
          });
        }),
      ),
    ).toContain('stated line is only on an opening entry');
    // Nothing is dated before the books start.
    expect(await codeOf(inCompany(companyId, (tx) => manualEntry(tx, '2026-09-30')))).toBe(
      'PERIOD_CLOSED',
    );
  });

  it('shows another company nothing of it', async () => {
    const { companyId } = await readyCompany();
    const other = await newCompany();
    const seen = await inCompany(other, (tx) => tx.select().from(openings));
    expect(seen).toEqual([]);
    const view = await inCompany(other, readOpening);
    expect(view.opening).toBeNull();
    expect(view.recordLines).toEqual([]);
    void companyId;
  });
});

/** A forged journal entry header, as no posting function writes it. */
const forgedEntry = (companyId: string, source: string, entryDate: string) => ({
  companyId,
  requestId: uuidv7(),
  sequence: 99n,
  fiscalYear: 2026,
  number: 99,
  entryDate,
  postedAt: new Date(),
  source,
  description: 'قيد مزوّر',
  lineCount: 2,
  hash: 'f'.repeat(64),
});

const postAlone = (tx: Transaction, view: Awaited<ReturnType<typeof readOpening>>) =>
  post(tx, {
    client: 'manual',
    idempotencyKey: `opening:${view.opening?.id}`,
    entryDate: view.booksStart,
    description: 'قيد الأرصدة الافتتاحية',
    reference: null,
    draftId: null,
    preparedByUserId: personId,
    approvedByUserId: null,
    actor: person(),
    content: { ...(view.content as NonNullable<typeof view.content>) },
  });

describe('the opening guards against forged writes (S10)', () => {
  it('refuses an entry before the opening and before the books start, for every role', async () => {
    const companyId = await newCompany();
    for (const database of [app, owner]) {
      expect(
        await refusal(
          withCompany(database, companyId, (tx) =>
            tx.insert(journalEntries).values(forgedEntry(companyId, 'manual', '2026-10-05')),
          ),
        ),
      ).toContain('OPENING_NOT_POSTED');
      expect(
        await refusal(
          withCompany(database, companyId, (tx) =>
            tx.insert(journalEntries).values(forgedEntry(companyId, 'opening', '2026-10-05')),
          ),
        ),
      ).toContain('dated on the books start');
    }
    const { companyId: posted } = await readyCompany();
    const view = await inCompany(posted, readOpening);
    await inCompany(posted, (tx) =>
      postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
    );
    expect(
      await refusal(
        withCompany(owner, posted, (tx) =>
          tx.insert(journalEntries).values(forgedEntry(posted, 'manual', '2026-09-30')),
        ),
      ),
    ).toContain('before the books start');
  });

  it('refuses an opening entry without its opening, and a close or a period before it', async () => {
    const { companyId } = await readyCompany();
    const view = await inCompany(companyId, readOpening);
    // The posting function's entry alone: the opening is not posted with it.
    expect(await refusal(inCompany(companyId, (tx) => postAlone(tx, view)))).toContain(
      'without its opening',
    );
    for (const database of [app, owner]) {
      expect(
        await refusal(
          withCompany(database, companyId, (tx) =>
            tx
              .insert(periods)
              .values({ companyId, period: '2026-09', fiscalYear: 2026, state: 'open' }),
          ),
        ),
      ).toContain('before the books start');
      expect(
        await refusal(
          withCompany(database, companyId, async (tx) => {
            await tx
              .insert(periods)
              .values({ companyId, period: '2026-10', fiscalYear: 2026, state: 'open' })
              .onConflictDoNothing();
            await tx.update(periods).set({ state: 'closed' }).where(eq(periods.period, '2026-10'));
          }),
        ),
      ).toContain('OPENING_NOT_POSTED');
    }
  });

  it('refuses a reversal by hand once another entry stands, and a posted opening changed', async () => {
    const { companyId } = await readyCompany();
    const view = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
    );
    const manual = await inCompany(companyId, (tx) => manualEntry(tx));
    expect(
      await refusal(
        inCompany(companyId, (tx) => tx.update(openings).set({ fingerprint: 'b'.repeat(64) })),
      ),
    ).toContain('does not go from posted to posted');
    expect(
      await refusal(
        inCompany(companyId, (tx) =>
          tx.update(openings).set({
            state: 'reversed',
            reversalEntryId: manual.id,
            reversedByUserId: personId,
            reversedAt: new Date(),
            reverseReason: 'عكس مزوّر',
          }),
        ),
      ),
    ).toContain('OPENING_NOT_REVERSIBLE');
  });

  it("refuses a reference the opening's standing item holds", async () => {
    const companyId = await newCompany();
    await recordRates(companyId);
    // A receivable of the records, opening its document item (S04 rule 6).
    await inCompany(companyId, async (tx) =>
      saveOpening(
        tx,
        saveOpeningSchema.parse({
          version: 0,
          lines: [
            {
              accountId: await accountId(tx, '112001'),
              dimensionValueIds: [await newClient(tx, companyId)],
              currency: 'USD',
              amount: '30000',
              itemReference: 'OLD-1',
            },
            {
              accountId: await accountId(tx, '311001'),
              currency: 'SYP',
              amount: '-100000000',
              parallel: '-1000000',
            },
          ],
        }),
        person(),
      ),
    );
    const view = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: view.fingerprint, actor: person() }),
    );
    for (const database of [app, owner]) {
      expect(
        await refusal(
          withCompany(database, companyId, async (tx) => {
            const [item] = await tx.select().from(openItems).where(eq(openItems.kind, 'document'));
            await tx.insert(openItems).values({
              ...(item as typeof openItems.$inferInsert),
              id: uuidv7(),
              source: 'manual',
              hubDocument: null,
            });
          }),
        ),
      ).toContain('stands on account');
    }
  });
});

describe('the opening at once (S10 rules 7, 16)', () => {
  it('answers two first saves at once with one', async () => {
    const companyId = await newCompany();
    const saves = await Promise.all(
      [0, 1].map(() => codeOf(inCompany(companyId, (tx) => save(tx, 0))).then((code) => code)),
    );
    expect(saves.sort()).toEqual(['OPENING_CHANGED', 'none']);
  });

  it('refuses an income statement account on the opening', async () => {
    const companyId = await newCompany();
    await recordRates(companyId);
    expect(
      await codeOf(
        inCompany(companyId, async (tx) =>
          saveOpening(
            tx,
            saveOpeningSchema.parse({
              version: 0,
              lines: [
                { accountId: await accountId(tx, '411001'), currency: 'SYP', amount: '-100' },
              ],
            }),
            person(),
          ),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('the opening in the reports (S10 rules 31–33)', () => {
  const NOW = new Date('2026-11-13T09:00:00Z');

  it('reads the opening entries as the opening balance, the period after them, and marks the reports', async () => {
    const { companyId } = await readyCompany();
    // Posted, reversed whole and posted again: entries 1, 2 and 3 on the books start.
    const first = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: first.fingerprint, actor: person() }),
    );
    await inCompany(companyId, (tx) =>
      reverseOpening(tx, { reason: 'تصحيح تجريبي', actor: person() }),
    );
    await inCompany(companyId, (tx) => save(tx, 0));
    const again = await inCompany(companyId, readOpening);
    await inCompany(companyId, (tx) =>
      postOpening(tx, { fingerprint: again.fingerprint, actor: person() }),
    );
    // A rent of the books start's own date, and one later: the period's lines.
    await inCompany(companyId, (tx) => manualEntry(tx, '2026-10-01'));
    await inCompany(companyId, (tx) => manualEntry(tx, '2026-10-05'));
    const cash = await inCompany(companyId, (tx) => accountId(tx, '111001'));

    for (const from of ['2026-10-01', '2026-09-01']) {
      const expectedMarks =
        from === '2026-10-01'
          ? ['opening_entry', 'period_open']
          : ['before_books_start', 'opening_entry', 'period_open'];
      const trial = await inCompany(companyId, (tx) =>
        readTrialBalance(
          tx,
          trialBalanceQuerySchema.parse({ from, to: '2026-10-31', compare: 'false' }),
          NOW,
        ),
      );
      expect(trial.header.booksStart).toBe('2026-10-01');
      expect([...trial.header.current.marks].sort()).toEqual(expectedMarks);
      expect(trial.rows.find((row) => row.account.id === cash)).toMatchObject({
        opening: '200000000',
        debits: '0',
        credits: '200',
        closing: '199999800',
      });
      expect(trial.totals.openingDebit).toBe(trial.totals.openingCredit);
      expect(trial.totals.debits).toBe('200');

      const ledger = await inCompany(companyId, (tx) =>
        readGeneralLedger(
          tx,
          generalLedgerQuerySchema.parse({
            from,
            to: '2026-10-31',
            codeFrom: '111001',
            codeTo: '111001',
          }),
          NOW,
        ),
      );
      expect([...ledger.header.current.marks].sort()).toEqual(expectedMarks);
      const [account] = ledger.accounts;
      expect(account?.opening).toBe('200000000');
      expect(account?.lines.map((line) => [line.entryDate, line.amount, line.balance])).toEqual([
        ['2026-10-01', '-100', '199999900'],
        ['2026-10-05', '-100', '199999800'],
      ]);

      const statement = await inCompany(companyId, (tx) =>
        readAccountStatement(
          tx,
          cash,
          accountStatementQuerySchema.parse({ from, to: '2026-10-31' }),
          NOW,
        ),
      );
      expect([...statement.header.current.marks].sort()).toEqual(expectedMarks);
      expect(statement.opening).toBe('200000000');
      expect(statement.lines).toHaveLength(2);
      expect(statement.currencies).toEqual([
        { currency: 'SYP', opening: '200000000', closing: '199999800' },
      ]);
    }

    // The drill-down: the opening column's lines sum to it; the period's leave them out.
    const lines = (query: Record<string, string>) =>
      inCompany(companyId, (tx) =>
        readReportLines(tx, reportLinesQuerySchema.parse({ account: cash, ...query }), NOW),
      );
    expect((await lines({ to: '2026-10-31', openingEntry: 'true' })).sum).toBe('200000000');
    expect((await lines({ from: '2026-10-01', to: '2026-10-31', side: 'debit' })).sum).toBe('0');
    expect((await lines({ from: '2026-10-01', to: '2026-10-31', side: 'credit' })).sum).toBe(
      '-200',
    );
    expect((await lines({ to: '2026-10-31' })).sum).toBe('199999800');

    // After the books start, the opening entry is in the balance before the range, unmarked.
    const november = await inCompany(companyId, (tx) =>
      readTrialBalance(
        tx,
        trialBalanceQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30', compare: 'false' }),
        NOW,
      ),
    );
    // No foreign balance in the book ledger: nothing to revalue (S09 rule 4).
    expect(november.header.current.marks).toEqual(['period_open']);
    expect(november.rows.find((row) => row.account.id === cash)?.opening).toBe('199999800');

    // Every income statement of 2026 says the result before the books start is in equity.
    const income = await inCompany(companyId, (tx) =>
      readIncomeStatement(
        tx,
        incomeStatementQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30' }),
        NOW,
      ),
    );
    expect(income.header.current.marks).toContain('pre_opening_result_in_equity');
    expect(income.header.compare?.marks).toContain('pre_opening_result_in_equity');
    expect(income.header.current.marks).not.toContain('before_books_start');
    const sheet = await inCompany(companyId, (tx) =>
      readBalanceSheet(tx, balanceSheetQuerySchema.parse({ asOf: '2026-10-31' }), NOW),
    );
    expect(sheet.header.current.marks).not.toContain('opening_entry');
    expect(sheet.totals.assets).toBe(sheet.totals.liabilitiesAndEquity);
  });

  it('marks nothing of S10 in a company without a books start', async () => {
    const companyId = await newCompany(null);
    await recordRates(companyId);
    await inCompany(companyId, (tx) => manualEntry(tx, '2026-10-05'));
    const trial = await inCompany(companyId, (tx) =>
      readTrialBalance(
        tx,
        trialBalanceQuerySchema.parse({ from: '2026-01-01', to: '2026-10-31', compare: 'false' }),
        NOW,
      ),
    );
    expect(trial.header.booksStart).toBeNull();
    expect(trial.header.current.marks).not.toContain('opening_entry');
    expect(trial.header.current.marks).not.toContain('before_books_start');
    const income = await inCompany(companyId, (tx) =>
      readIncomeStatement(
        tx,
        incomeStatementQuerySchema.parse({ from: '2026-01-01', to: '2026-10-31' }),
        NOW,
      ),
    );
    expect(income.header.current.marks).not.toContain('pre_opening_result_in_equity');
  });
});
