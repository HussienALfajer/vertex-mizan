import { type CompanyLedgers, type CurrencyCode, DomainError } from '@vertex-mizan/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditEntries,
  chartAccounts,
  closePeriod,
  createCompanyBooks,
  dimensionTypes,
  dimensionValues,
  ledgerHeads,
  type ManualLineSpec,
  type PersonActor,
  periodEvents,
  periods,
  post,
  postRevaluation,
  previewRevaluation,
  readPeriod,
  readPeriods,
  recordRate,
  reopenPeriod,
  type Transaction,
  users,
  withCompany,
  writePeriodTransition,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S07's periods and close on the migrated database (0040–0041): the close in order with each
// refusal of rule 2 and an empty month given its row, the reopen of the latest closed month only
// (rule 3), postings refused in a closed month and before the first period while a month is closed
// (rule 4) and accepted in a reopened one, the checklist's items failing and passing, a close and a
// posting serialising on the ledger head (rule 5), the history and audit rows, isolation, and the
// guards against transitions and events written by hand. All values are synthetic.

const { app, owner } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-periods-test',
  ipAddress: null,
  userAgent: null,
});

const SYP: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: null,
};

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

async function newBooks(ledgers: CompanyLedgers): Promise<Books> {
  const id = uuidv7();
  await withCompany(app, id, (tx) =>
    createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة فترات تجريبية',
        nameLatin: null,
        ledgers,
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

interface Spec {
  readonly code: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint;
  readonly dims?: readonly string[];
  readonly newItem?: { readonly reference: string; readonly dueOn: string | null };
}

function specs(books: Books, lines: readonly Spec[]): ManualLineSpec[] {
  return lines.map((line) => ({
    accountId: books.accounts.get(line.code) as string,
    dimensionValueIds: (line.dims ?? []).map((code) => books.values.get(code) as string),
    currency: line.currency,
    amountMinor: line.amount,
    memo: null,
    ...(line.newItem !== undefined && { newItem: line.newItem }),
  }));
}

function manual(books: Books, on: string, lines: readonly Spec[], tx?: Transaction) {
  const request = (into: Transaction) =>
    post(into, {
      client: 'manual',
      idempotencyKey: uuidv7(),
      entryDate: on,
      description: 'قيد تجريبي',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: { kind: 'manual', today: '2027-01-31', dealtRates: [], lines: specs(books, lines) },
    });
  return tx === undefined ? inCompany(books.id, request) : request(tx);
}

/** An SYP expense the owner paid, dated `on`. */
const expense = (books: Books, on: string) =>
  manual(books, on, [
    { code: '531004', currency: 'SYP', amount: 5_000_000n },
    { code: '313001', currency: 'SYP', amount: -5_000_000n },
  ]);

const close = (books: Books, period: string, today = '2027-01-05') =>
  inCompany(books.id, (tx) =>
    closePeriod(tx, { period, reason: `إقفال ${period}`, today, actor: actor() }),
  );

const reopen = (books: Books, period: string, today = '2027-01-05') =>
  inCompany(books.id, (tx) =>
    reopenPeriod(tx, { period, reason: `إعادة فتح ${period}`, today, actor: actor() }),
  );

/** A refusal's code and details. */
async function refused(work: Promise<unknown>) {
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
    .values({ email: 'periods.person@example.test', name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  personId = row.id;
});

describe('closePeriod (S07 rules 2, 5, 7–9)', () => {
  it('closes in order from the first period, an empty month given its row, refusing in rule 2 order', async () => {
    const books = await newBooks(SYP);
    await expense(books, '2026-10-15');
    await expense(books, '2026-12-10');
    expect(await refused(close(books, '2026-12', '2026-12-20'))).toEqual({
      code: 'PERIOD_NOT_ENDED',
      details: { period: '2026-12' },
    });
    expect(await refused(close(books, '2026-12'))).toEqual({
      code: 'PERIOD_ORDER',
      details: { period: '2026-10' },
    });
    await close(books, '2026-10');
    expect(await refused(close(books, '2026-12'))).toEqual({
      code: 'PERIOD_ORDER',
      details: { period: '2026-11' },
    });
    const november = await close(books, '2026-11');
    expect(november).toMatchObject({ period: '2026-11', state: 'closed', firstPeriod: '2026-10' });
    expect(november.history).toEqual([
      expect.objectContaining({ kind: 'closed', reason: 'إقفال 2026-11', user: expect.anything() }),
    ]);
    expect(november.checklist.map((item) => [item.item, item.result])).toEqual([
      ['bulletins_recorded', 'passed'],
      ['closing_rates_recorded', 'passed'],
      ['no_drafts', 'passed'],
      ['open_items_agree', 'passed'],
      ['no_held_events', 'passed'],
      ['releases_posted', 'passed'],
      ['revaluation_current', 'passed'],
    ]);
    await close(books, '2026-12');
    expect(await refused(close(books, '2026-12'))).toEqual({
      code: 'PERIOD_CLOSED',
      details: { period: '2026-12' },
    });
    // A month before the first period is closed already (rule 4).
    expect(await refused(close(books, '2026-09'))).toMatchObject({ code: 'PERIOD_CLOSED' });
    const rows = await inCompany(books.id, (tx) =>
      tx
        .select({ period: periods.period, state: periods.state })
        .from(periods)
        .orderBy(asc(periods.period)),
    );
    expect(rows).toEqual([
      { period: '2026-10', state: 'closed' },
      { period: '2026-11', state: 'closed' },
      { period: '2026-12', state: 'closed' },
    ]);
    const audits = await inCompany(books.id, (tx) =>
      tx
        .select({ action: auditEntries.action, reason: auditEntries.reason })
        .from(auditEntries)
        .where(eq(auditEntries.action, 'period.closed')),
    );
    expect(audits).toHaveLength(3);
    expect(audits[0]?.reason).toBe('إقفال 2026-10');
  });

  it('fails the checklist on missing bulletins, a missing closing rate and a stale revaluation', async () => {
    const books = await newBooks(SYP_USD);
    await rate(books, '2026-11-01', '120.0000', 'bulletin');
    await rate(books, '2026-11-02', '125.0000', 'market');
    await manual(books, '2026-11-01', [
      {
        code: '112001',
        currency: 'USD',
        amount: 100_000n,
        dims: ['C1'],
        newItem: { reference: 'M-1', dueOn: '2026-12-01' },
      },
      { code: '411001', currency: 'USD', amount: -100_000n, dims: ['C1', 'S1'] },
    ]);
    const failed = await refused(close(books, '2026-11'));
    expect(failed).toEqual({
      code: 'CHECKLIST_FAILED',
      details: { items: 'bulletins_recorded,closing_rates_recorded,revaluation_current' },
    });
    const detail = await inCompany(books.id, (tx) => readPeriod(tx, '2026-11', '2027-01-05'));
    expect(detail.checklist.find((item) => item.item === 'bulletins_recorded')).toEqual({
      item: 'bulletins_recorded',
      result: 'failed',
      // every publication day of November after the 1st: 2–5, 8–12, 15–19, 22–26, 29, 30
      count: 21,
      ledgers: ['book'],
    });
    for (const day of ['02', '03', '04', '05', '08', '09', '10', '11', '12', '15', '16', '17']) {
      await rate(books, `2026-11-${day}`, '120.0000', 'bulletin');
    }
    for (const day of ['18', '19', '22', '23', '24', '25', '26', '29']) {
      await rate(books, `2026-11-${day}`, '120.0000', 'bulletin');
    }
    await rate(books, '2026-11-30', '125.0000', 'bulletin');
    expect(await refused(close(books, '2026-11'))).toEqual({
      code: 'CHECKLIST_FAILED',
      details: { items: 'revaluation_current' },
    });
    const { fingerprint } = await inCompany(books.id, (tx) =>
      previewRevaluation(tx, { period: '2026-11', ledger: 'book', today: '2026-12-01' }),
    );
    await inCompany(books.id, (tx) =>
      postRevaluation(tx, {
        period: '2026-11',
        ledger: 'book',
        fingerprint,
        today: '2026-12-01',
        actor: actor(),
      }),
    );
    const closed = await close(books, '2026-11');
    expect(closed.state).toBe('closed');
    const [stored] = await inCompany(books.id, (tx) =>
      tx.select({ checklist: periodEvents.checklist }).from(periodEvents),
    );
    expect(stored?.checklist).toEqual(closed.checklist);
  });

  it('serialises with a posting on the ledger head: the posting after the close is refused', async () => {
    const books = await newBooks(SYP);
    await expense(books, '2026-11-08');
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closing = () => {};
    const closed = new Promise<void>((resolve) => {
      closing = resolve;
    });
    const closer = inCompany(books.id, async (tx) => {
      await closePeriod(tx, {
        period: '2026-11',
        reason: 'إقفال',
        today: '2026-12-02',
        actor: actor(),
      });
      closing();
      await gate;
    });
    await closed;
    let settled = false;
    const posting = refused(expense(books, '2026-11-10')).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    release();
    await closer;
    expect(await posting).toEqual({ code: 'PERIOD_CLOSED', details: { period: '2026-11' } });
  });
});

describe('reopenPeriod and postings (S07 rules 1, 3, 4, 6)', () => {
  it('refuses closed months and months before the first, reopens the latest closed month only', async () => {
    const books = await newBooks(SYP);
    await expense(books, '2026-10-15');
    await expense(books, '2026-11-10');
    await close(books, '2026-10');
    await close(books, '2026-11');
    expect(await refused(expense(books, '2026-11-20'))).toMatchObject({ code: 'PERIOD_CLOSED' });
    expect(await refused(expense(books, '2026-09-30'))).toEqual({
      code: 'PERIOD_CLOSED',
      details: { period: '2026-09' },
    });
    const listed = await inCompany(books.id, (tx) =>
      readPeriods(tx, { from: '2026-09', to: '2026-12', today: '2026-12-15' }),
    );
    expect(listed.map((month) => [month.period, month.state, month.ended])).toEqual([
      ['2026-09', 'closed', true],
      ['2026-10', 'closed', true],
      ['2026-11', 'closed', true],
      ['2026-12', 'open', false],
    ]);
    expect(listed[2]?.lastEvent).toMatchObject({ kind: 'closed', reason: 'إقفال 2026-11' });
    expect(await refused(reopen(books, '2026-10'))).toEqual({
      code: 'PERIOD_ORDER',
      details: { period: '2026-11' },
    });
    expect(await refused(reopen(books, '2026-12'))).toEqual({
      code: 'PERIOD_NOT_CLOSED',
      details: { period: '2026-12' },
    });
    const reopened = await reopen(books, '2026-11');
    expect(reopened).toMatchObject({
      queuedEvents: 0,
      triggers: [{ kind: 'period', period: '2026-11' }],
      period: { state: 'reopened' },
    });
    await expense(books, '2026-11-20');
    expect(await refused(reopen(books, '2026-11'))).toMatchObject({ code: 'PERIOD_NOT_CLOSED' });
    const again = await close(books, '2026-11');
    expect(again.history.map((event) => event.kind)).toEqual(['closed', 'reopened', 'closed']);
    const listedAgain = await inCompany(books.id, (tx) => readPeriods(tx, { today: '2027-01-05' }));
    expect(listedAgain.map((month) => [month.period, month.state, month.failingItems])).toEqual([
      ['2026-10', 'closed', null],
      ['2026-11', 'closed', null],
      ['2026-12', 'open', 0],
      ['2027-01', 'open', null],
    ]);
  });

  it('refuses to close a month before the first period, which would move the first for good', async () => {
    const books = await newBooks(SYP);
    await expense(books, '2026-10-15');
    expect(await refused(close(books, '2016-10'))).toEqual({
      code: 'PERIOD_ORDER',
      details: { period: '2026-10' },
    });
    const rows = await inCompany(books.id, (tx) =>
      tx.select({ period: periods.period }).from(periods),
    );
    expect(rows).toEqual([{ period: '2026-10' }]);
  });

  it("answers another company's month as an empty month of the caller's", async () => {
    const [first, second] = [await newBooks(SYP), await newBooks(SYP)];
    await expense(first, '2026-10-15');
    await close(first, '2026-10');
    const seen = await inCompany(second.id, (tx) => readPeriod(tx, '2026-10', '2027-01-05'));
    expect(seen).toMatchObject({ state: 'open', firstPeriod: null, history: [] });
    await expense(second, '2026-10-20');
    const theirs = await inCompany(second.id, (tx) =>
      tx.select({ id: periodEvents.id }).from(periodEvents),
    );
    expect(theirs).toEqual([]);
  });
});

describe('the period guards (0041)', () => {
  /** A company with October posted, as the guards see it. */
  async function october() {
    const books = await newBooks(SYP);
    await expense(books, '2026-10-15');
    const [row] = await inCompany(books.id, (tx) => tx.select().from(periods));
    if (!row) throw new Error('no period');
    return { books, row };
  }

  const headOf = (tx: Transaction) =>
    tx.select({ entryCount: ledgerHeads.entryCount }).from(ledgerHeads);

  it('refuses a transition without its event, and an event without its transition, at commit', async () => {
    const { books, row } = await october();
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.update(periods).set({ state: 'closed' }).where(eq(periods.id, row.id)),
        ),
      ),
    ).toContain("a period's state is its latest event's");
    expect(
      await refusal(
        inCompany(books.id, async (tx) => {
          const [head] = await headOf(tx);
          await tx.insert(periodEvents).values({
            companyId: books.id,
            periodId: row.id,
            kind: 'closed',
            reason: 'إقفال بلا انتقال',
            userId: personId,
            checklist: [],
            headSequence: BigInt(head?.entryCount ?? 0),
          });
        }),
      ),
    ).toContain("a period's state is its latest event's");
  });

  it('refuses an event at another head, from a state its kind does not leave, or twice', async () => {
    const { books, row } = await october();
    const event = (kind: 'closed' | 'reopened', headSequence: bigint) => ({
      companyId: books.id,
      periodId: row.id,
      kind,
      reason: 'حدث مزور',
      userId: personId,
      checklist: kind === 'closed' ? [] : null,
      headSequence,
    });
    expect(
      await refusal(
        inCompany(books.id, (tx) => tx.insert(periodEvents).values(event('closed', 99n))),
      ),
    ).toContain('at its transaction time and head');
    expect(
      await refusal(
        inCompany(books.id, async (tx) => {
          const [head] = await headOf(tx);
          await tx.insert(periodEvents).values(event('reopened', BigInt(head?.entryCount ?? 0)));
        }),
      ),
    ).toContain('a reopened event from a period that is open');
    expect(
      await refusal(
        inCompany(books.id, async (tx) => {
          const [head] = await headOf(tx);
          const sequence = BigInt(head?.entryCount ?? 0);
          await tx.insert(periodEvents).values(event('closed', sequence));
          await tx.insert(periodEvents).values(event('closed', sequence));
        }),
      ),
    ).toContain('one event of a period per transaction');
  });

  it('refuses a close out of order, a reopen that is not the latest, and other changes of a period', async () => {
    const books = await newBooks(SYP);
    await expense(books, '2026-10-15');
    await expense(books, '2026-12-10');
    const transition = (period: string, kind: 'closed' | 'reopened') =>
      inCompany(books.id, async (tx) => {
        await writePeriodTransition(tx, {
          companyId: books.id,
          period,
          kind,
          reason: 'انتقال يدوي',
          userId: personId,
          checklist: kind === 'closed' ? [] : null,
        });
      });
    expect(await refusal(transition('2026-12', 'closed'))).toContain(
      'closes after every earlier month',
    );
    await transition('2026-10', 'closed');
    // November has no row: December still closes only after it.
    expect(await refusal(transition('2026-12', 'closed'))).toContain(
      'closes after every earlier month',
    );
    await transition('2026-11', 'closed');
    await transition('2026-12', 'closed');
    expect(await refusal(transition('2026-11', 'reopened'))).toContain(
      'reopens only as the latest closed month',
    );
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.update(periods).set({ fiscalYear: 2025 }).where(eq(periods.period, '2026-10')),
        ),
      ),
    ).toContain('changes only its state');
    expect(
      await refusal(
        inCompany(books.id, (tx) =>
          tx.insert(periods).values({
            companyId: books.id,
            period: '2026-09',
            fiscalYear: 2026,
            state: 'open',
          }),
        ),
      ),
    ).toContain('before the first period while a month is closed');
  });

  it('serialises raw writes on the ledger head: a reopen and a later close never both pass', async () => {
    const books = await newBooks(SYP);
    await expense(books, '2026-10-15');
    await expense(books, '2026-11-10');
    await expense(books, '2026-12-10');
    await close(books, '2026-10');
    await close(books, '2026-11');
    // A reopen of November written by hand, without the service's lock, held open.
    let release = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written = () => {};
    const reopenWritten = new Promise<void>((resolve) => {
      written = resolve;
    });
    const reopening = inCompany(books.id, async (tx) => {
      const [november] = await tx.select().from(periods).where(eq(periods.period, '2026-11'));
      const [head] = await headOf(tx);
      await tx.insert(periodEvents).values({
        companyId: books.id,
        periodId: november?.id as string,
        kind: 'reopened',
        reason: 'إعادة فتح يدوية',
        userId: personId,
        checklist: null,
        headSequence: BigInt(head?.entryCount ?? 0),
      });
      await tx
        .update(periods)
        .set({ state: 'reopened' })
        .where(eq(periods.id, november?.id as string));
      written();
      await until;
    });
    await reopenWritten;
    // A close of December written by hand at the same time waits for the head, then sees it.
    let settled = false;
    const closing = refusal(
      inCompany(books.id, async (tx) => {
        const [december] = await tx.select().from(periods).where(eq(periods.period, '2026-12'));
        await tx
          .update(periods)
          .set({ state: 'closed' })
          .where(eq(periods.id, december?.id as string));
      }),
    ).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    release();
    await reopening;
    expect(await closing).toContain('closes after every earlier month');
  });

  it('keeps the history append-only for the app role and the owner', async () => {
    const books = await newBooks(SYP);
    await expense(books, '2026-10-15');
    await close(books, '2026-10');
    for (const db of [app, owner]) {
      expect(
        await refusal(
          withCompany(db, books.id, (tx) => tx.update(periodEvents).set({ reason: 'سبب آخر' })),
        ),
      ).toMatch(/permission denied|refuse|append-only|cannot be changed/i);
      expect(await refusal(withCompany(db, books.id, (tx) => tx.delete(periodEvents)))).toMatch(
        /permission denied|refuse|append-only|cannot be changed/i,
      );
    }
    expect(
      await refusal(
        withCompany(owner, books.id, (tx) => tx.execute(sql`truncate period_events cascade`)),
      ),
    ).toMatch(/refuse|append-only|cannot be changed|permission denied/i);
  });
});
