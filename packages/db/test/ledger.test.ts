import { createHash } from 'node:crypto';
import {
  type CompanyLedgers,
  type CurrencyCode,
  DomainError,
  money,
  type RateType,
} from '@vertex-mizan/contracts';
import {
  chainEntryValue,
  ENTRY_SOURCES,
  fiscalYearOf,
  type Line,
  negate,
  periodOf,
  verifyChain,
} from '@vertex-mizan/ledger';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditEntries,
  chartAccounts,
  companySettings,
  createCompanyBooks,
  type Database,
  type DealtRateSpec,
  dimensionSets,
  dimensionSetValues,
  dimensionTypes,
  dimensionValues,
  entryNumberCounters,
  JOURNAL_ENTRY_SOURCES,
  JOURNAL_LINE_KINDS,
  journalEntries,
  journalLines,
  ledgerHeads,
  lineConversions,
  type PersonActor,
  type PostedEntryRef,
  periods,
  post,
  postingRequests,
  readChain,
  readPeriodBalances,
  rebuildPeriodBalances,
  recordRate,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect, refusal } from './connections.js';

// S03's ledger on the migrated database (0010–0012): the posting function and every guard of
// ADR 0005, 0008 and 0012, as the app role (and the owner where a grant would hide a trigger):
// manual entries, reversals, numbers by fiscal year, the chain, the period balances, replays,
// closed periods, concurrency, and the writes the posting function never makes, forged by hand to
// prove the database refuses them. All values are synthetic.

const { app, owner, superuser } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب تجريبي',
  sessionId: null,
  requestId: 'request-ledger-test',
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

/** SYP books with no parallel ledger. */
const SYP: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: policy('bulletin') },
  parallel: null,
};

const inCompany = <T>(
  companyId: string,
  work: (tx: Transaction) => Promise<T>,
  db: Database = app,
) => withCompany(db, companyId, work);

/** A company with the service-agency chart, through the shared company service. */
async function newCompany(ledgers = SYP_USD, fiscalYearStartMonth = 1): Promise<string> {
  const id = uuidv7();
  await withCompany(app, id, (tx) =>
    createCompanyBooks(
      tx,
      id,
      {
        name: 'شركة دفاتر تجريبية',
        nameLatin: null,
        ledgers,
        fiscalYearStartMonth,
        policyNote: 'مذكرة سياسة تجريبية.',
        template: 'service-agency',
        createdByUserId: personId,
      },
      actor(),
    ),
  );
  return id;
}

/** A USD/SYP rate row through the rate service. */
const rate = (companyId: string, effectiveOn: string, type: RateType, value: string) =>
  inCompany(companyId, (tx) =>
    recordRate(tx, companyId, actor(), {
      effectiveOn,
      base: 'USD',
      quote: 'SYP',
      rate: value,
      type,
      source: 'manual',
    }),
  );

/** The bulletin and market rates of Sunday 8 November 2026 (S03's example). */
async function week(companyId: string) {
  return {
    bulletin: await rate(companyId, '2026-11-08', 'bulletin', '121.5000'),
    market: await rate(companyId, '2026-11-08', 'market', '122.0000'),
  };
}

async function accountIds(companyId: string): Promise<Map<string, string>> {
  const rows = await inCompany(companyId, (tx) =>
    tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts),
  );
  return new Map(rows.map((row) => [row.code, row.id]));
}

type LineSpec = readonly [code: string, currency: CurrencyCode, amount: bigint, dims?: string[]];

interface Manual {
  on?: string;
  today?: string;
  key?: string;
  dealt?: DealtRateSpec[];
  lines: readonly LineSpec[];
}

async function postManual(companyId: string, entry: Manual): Promise<PostedEntryRef> {
  const ids = await accountIds(companyId);
  return inCompany(companyId, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: entry.key ?? uuidv7(),
      entryDate: entry.on ?? '2026-11-08',
      description: 'قيد تجريبي',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: {
        kind: 'manual',
        today: entry.today ?? '2026-11-30',
        dealtRates: entry.dealt ?? [],
        lines: entry.lines.map(([code, currency, amountMinor, dims = []]) => ({
          accountId: ids.get(code) ?? uuidv7(),
          dimensionValueIds: dims,
          currency,
          amountMinor,
          memo: null,
        })),
      },
    }),
  );
}

const reverse = (companyId: string, entryId: string, on: string, today = '2026-12-31') =>
  inCompany(companyId, (tx) =>
    post(tx, {
      client: 'manual',
      idempotencyKey: `reversal:${entryId}`,
      entryDate: on,
      description: 'عكس قيد تجريبي',
      reference: null,
      draftId: null,
      preparedByUserId: personId,
      approvedByUserId: null,
      actor: actor(),
      content: { kind: 'reversal', entryId, today },
    }),
  );

/** The code of a business refusal. */
async function code(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
}

const linesOf = (companyId: string, entryId: string) =>
  inCompany(companyId, (tx) =>
    tx
      .select({ line: journalLines, code: chartAccounts.code })
      .from(journalLines)
      .innerJoin(
        chartAccounts,
        and(
          eq(chartAccounts.companyId, journalLines.companyId),
          eq(chartAccounts.id, journalLines.accountId),
        ),
      )
      .where(eq(journalLines.entryId, entryId))
      .orderBy(asc(journalLines.lineNo)),
  );

/** The chain of a company verifies from its first entry (S03 rule 19). */
async function chainHolds(companyId: string) {
  const links = await inCompany(companyId, readChain);
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
    .values({ email: 'ledger.person@example.test', name: 'محاسب تجريبي' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  personId = row.id;
});

describe('the ledger schema', () => {
  it("stores the sources and line kinds of packages/ledger's entries", () => {
    expect([...JOURNAL_ENTRY_SOURCES]).toEqual([...ENTRY_SOURCES]);
    const kinds: readonly Line['kind'][] = JOURNAL_LINE_KINDS;
    expect(kinds).toEqual(['measured', 'carried', 'difference', 'rounding']);
  });
});

describe('post(): manual entries (S03 rules 1–16)', () => {
  it('posts measured lines with their rate rows, the number, the chain, the period balances and one audit row', async () => {
    const company = await newCompany();
    const { bulletin } = await week(company);
    const posted = await postManual(company, {
      lines: [
        ['531004', 'USD', 10_000n],
        ['111004', 'USD', -10_000n],
      ],
    });
    expect(posted).toMatchObject({ fiscalYear: 2026, number: 1, sequence: 1n, replayed: false });

    const lines = await linesOf(company, posted.id);
    expect(
      lines.map(({ line, code }) => [
        code,
        line.kind,
        line.amountMinor,
        line.bookMinor,
        line.parallelMinor,
      ]),
    ).toEqual([
      ['531004', 'measured', 10_000n, 1_215_000n, 10_000n],
      ['111004', 'measured', -10_000n, -1_215_000n, -10_000n],
    ]);
    const state = await inCompany(company, async (tx) => ({
      entry: (await tx.select().from(journalEntries))[0],
      conversions: await tx.select().from(lineConversions),
      head: (await tx.select().from(ledgerHeads))[0],
      counters: await tx.select().from(entryNumberCounters),
      periods: await tx.select().from(periods),
      audit: await tx.select().from(auditEntries).where(eq(auditEntries.action, 'entry.posted')),
      used: await tx
        .select({ code: chartAccounts.code })
        .from(chartAccounts)
        .where(sql`${chartAccounts.firstPostedAt} is not null`),
      settings: (await tx.select().from(companySettings))[0],
      rebuilt: await rebuildPeriodBalances(tx),
      balances: await readPeriodBalances(tx),
    }));
    expect(state.entry).toMatchObject({
      id: posted.id,
      source: 'manual',
      entryDate: '2026-11-08',
      previousHash: null,
      hash: posted.hash,
      lineCount: 2,
      postedByUserId: personId,
    });
    // Each USD line converts in the book ledger at the bulletin row; USD is the parallel's own.
    expect(state.conversions).toHaveLength(2);
    for (const conversion of state.conversions) {
      expect(conversion).toMatchObject({
        ledger: 'book',
        basis: 'policy',
        quoteNo: 1,
        rateId: bulletin.id,
        rate: '121.5000000000',
        rateType: 'bulletin',
      });
    }
    expect(state.head).toMatchObject({
      entryCount: 1n,
      lastEntryId: posted.id,
      lastHash: posted.hash,
    });
    expect(state.counters).toMatchObject([{ fiscalYear: 2026, lastNumber: 1 }]);
    expect(state.periods).toMatchObject([{ period: '2026-11', fiscalYear: 2026, state: 'open' }]);
    expect(state.audit).toMatchObject([
      { entityType: 'journal_entry', entityId: posted.id, actorUserId: personId },
    ]);
    expect(state.used.map((row) => row.code).sort()).toEqual(['111004', '531004']);
    expect(state.settings?.booksStartedAt).toBeInstanceOf(Date);
    expect(state.balances).toEqual(state.rebuilt);
    expect(state.balances).toHaveLength(2);
    expect(await chainHolds(company)).toBe(null);
  });

  it("posts the spec's currency purchase at a dealt rate: a book loss, the dealt rate on its conversion", async () => {
    const company = await newCompany();
    const { bulletin } = await week(company);
    const posted = await postManual(company, {
      dealt: [{ base: 'USD', quote: 'SYP', rate: '122.5000' }],
      lines: [
        ['111004', 'USD', 10_000n],
        ['111003', 'SYP', -1_225_000n],
      ],
    });
    const lines = await linesOf(company, posted.id);
    expect(
      lines.map(({ line, code }) => [
        code,
        line.kind,
        line.ledger,
        line.currency,
        line.amountMinor,
        line.bookMinor,
        line.parallelMinor,
      ]),
    ).toEqual([
      ['111004', 'measured', null, 'USD', 10_000n, 1_215_000n, 10_000n],
      ['111003', 'measured', null, 'SYP', -1_225_000n, -1_225_000n, -10_000n],
      ['541001', 'difference', 'book', 'SYP', 10_000n, 10_000n, 0n],
    ]);
    const conversions = await inCompany(company, (tx) =>
      tx.select().from(lineConversions).orderBy(asc(lineConversions.ledger)),
    );
    expect(conversions).toMatchObject([
      { ledger: 'book', basis: 'policy', rateId: bulletin.id },
      {
        ledger: 'parallel',
        basis: 'transaction',
        rateId: null,
        rate: '122.5000000000',
        rateType: 'market',
        rateSource: 'manual',
        effectiveOn: '2026-11-08',
      },
    ]);
  });

  it('answers a replay with the first entry and posts nothing; another payload is IDEMPOTENCY_CONFLICT', async () => {
    const company = await newCompany(SYP);
    const key = uuidv7();
    const entry = {
      key,
      lines: [
        ['531001', 'SYP', 500_000n],
        ['111003', 'SYP', -500_000n],
      ] as LineSpec[],
    };
    const first = await postManual(company, entry);
    const again = await postManual(company, entry);
    expect(again).toEqual({ ...first, replayed: true });
    expect(
      await code(
        postManual(company, {
          key,
          lines: [
            ['531001', 'SYP', 600_000n],
            ['111003', 'SYP', -600_000n],
          ],
        }),
      ),
    ).toBe('IDEMPOTENCY_CONFLICT');
    const counts = await inCompany(company, async (tx) => ({
      requests: (await tx.select().from(postingRequests)).length,
      entries: (await tx.select().from(journalEntries)).length,
      head: (await tx.select().from(ledgerHeads))[0]?.entryCount,
    }));
    expect(counts).toEqual({ requests: 1, entries: 1, head: 1n });
  });

  it('refuses what the rules refuse, and leaves no request, number or period behind', async () => {
    const company = await newCompany();
    await week(company);
    const ids = await accountIds(company);
    const refusals = {
      // No bulletin for Monday 9 November, a publication day (S02 rule 16).
      rate: await code(
        postManual(company, {
          on: '2026-11-09',
          lines: [
            ['531004', 'USD', 100n],
            ['111004', 'USD', -100n],
          ],
        }),
      ),
      unbalanced: await code(
        postManual(company, {
          lines: [
            ['531001', 'SYP', 100n],
            ['111003', 'SYP', -90n],
          ],
        }),
      ),
      control: await code(
        postManual(company, {
          lines: [
            ['112001', 'SYP', 100n],
            ['111003', 'SYP', -100n],
          ],
        }),
      ),
      header: await code(
        postManual(company, {
          lines: [
            ['111', 'SYP', 100n],
            ['111003', 'SYP', -100n],
          ],
        }),
      ),
      unknown: await code(
        postManual(company, {
          lines: [
            ['999999', 'SYP', 100n],
            ['111003', 'SYP', -100n],
          ],
        }),
      ),
      currency: await code(
        postManual(company, {
          lines: [
            ['111004', 'SYP', 100n],
            ['111003', 'SYP', -100n],
          ],
        }),
      ),
      dimension: await code(
        postManual(company, {
          lines: [
            ['411001', 'SYP', -100n],
            ['111003', 'SYP', 100n],
          ],
        }),
      ),
      date: await code(
        postManual(company, {
          on: '2026-12-01',
          today: '2026-11-30',
          lines: [
            ['531001', 'SYP', 100n],
            ['111003', 'SYP', -100n],
          ],
        }),
      ),
      dealt: await code(
        postManual(company, {
          dealt: [{ base: 'USD', quote: 'TRY', rate: '41.5000' }],
          lines: [
            ['111004', 'USD', 10_000n],
            ['111003', 'SYP', -1_225_000n],
          ],
        }),
      ),
      orientation: await code(
        postManual(company, {
          dealt: [{ base: 'SYP', quote: 'USD', rate: '0.0080' }],
          lines: [
            ['111004', 'USD', 10_000n],
            ['111003', 'SYP', -1_225_000n],
          ],
        }),
      ),
      zero: await code(
        postManual(company, {
          lines: [
            ['531001', 'SYP', 0n],
            ['531002', 'SYP', 100n],
            ['111003', 'SYP', -100n],
          ],
        }),
      ),
      syp: await code(
        postManual(company, {
          on: '2025-12-31',
          lines: [
            ['531001', 'SYP', 100n],
            ['111003', 'SYP', -100n],
          ],
        }),
      ),
    };
    expect(refusals).toEqual({
      rate: 'RATE_MISSING',
      unbalanced: 'ENTRY_UNBALANCED',
      control: 'ACCOUNT_IS_CONTROL',
      header: 'ACCOUNT_NOT_POSTABLE',
      unknown: 'NOT_FOUND',
      currency: 'ACCOUNT_CURRENCY_MISMATCH',
      dimension: 'DIMENSION_REQUIRED',
      date: 'ENTRY_DATE_OUT_OF_RANGE',
      dealt: 'DEALT_RATE_NOT_ACCEPTED',
      orientation: 'RATE_ORIENTATION',
      zero: 'VALIDATION_FAILED',
      syp: 'SYP_BEFORE_REDENOMINATION',
    });
    expect(ids.size).toBeGreaterThan(0);
    const left = await inCompany(company, async (tx) => ({
      requests: (await tx.select().from(postingRequests)).length,
      counters: (await tx.select().from(entryNumberCounters)).length,
      periods: (await tx.select().from(periods)).length,
      head: (await tx.select().from(ledgerHeads))[0]?.entryCount,
      used: (
        await tx.select().from(chartAccounts).where(sql`${chartAccounts.firstPostedAt} is not null`)
      ).length,
    }));
    expect(left).toEqual({ requests: 0, counters: 0, periods: 0, head: 0n, used: 0 });
  });
});

describe('post(): reversals (S03 rule 9)', () => {
  it('negates every line exactly at its posted amounts, reads no rate, and nets every account to zero', async () => {
    const company = await newCompany();
    await week(company);
    const original = await postManual(company, {
      lines: [
        ['111004', 'USD', 10_000n],
        ['111003', 'SYP', -1_225_000n],
      ],
    });
    // December has no rate at all: a reversal carries amounts and needs none (ADR 0007).
    const reversal = await reverse(company, original.id, '2026-12-01');
    expect(reversal).toMatchObject({ fiscalYear: 2026, number: 2, sequence: 2n });
    const before = await linesOf(company, original.id);
    const after = await linesOf(company, reversal.id);
    expect(
      after.map(({ line, code }) => [
        code,
        line.kind,
        line.ledger,
        line.amountMinor,
        line.bookMinor,
        line.parallelMinor,
      ]),
    ).toEqual(
      before.map(({ line, code }) => {
        const negated = negate({
          transaction: money(line.amountMinor, line.currency as CurrencyCode),
          bookMinor: line.bookMinor,
          parallelMinor: line.parallelMinor,
        });
        return [
          code,
          line.kind,
          line.ledger,
          negated.transaction.amountMinor,
          negated.bookMinor,
          negated.parallelMinor,
        ];
      }),
    );
    const state = await inCompany(company, async (tx) => ({
      entry: (await tx.select().from(journalEntries).where(eq(journalEntries.id, reversal.id)))[0],
      conversions: await tx
        .select()
        .from(lineConversions)
        .where(
          inArray(
            lineConversions.lineId,
            after.map(({ line }) => line.id),
          ),
        ),
      audit: await tx.select().from(auditEntries).where(eq(auditEntries.entityId, reversal.id)),
      totals: await tx.execute<{ book: string; parallel: string }>(
        sql`select coalesce(sum(book_minor), 0)::text as book, coalesce(sum(parallel_minor), 0)::text as parallel
            from journal_lines group by account_id having sum(book_minor) <> 0 or sum(parallel_minor) <> 0`,
      ),
    }));
    expect(state.entry).toMatchObject({ reversesEntryId: original.id, entryDate: '2026-12-01' });
    expect(state.conversions).toEqual([]);
    expect(state.audit).toMatchObject([
      { action: 'entry.posted', after: { reverses: original.id } },
    ]);
    expect(state.totals.rows).toEqual([]);
    expect(await chainHolds(company)).toBe(null);
  });

  it('reverses an entry once, never a reversal, and never before its original', async () => {
    const company = await newCompany(SYP);
    const entry = {
      lines: [
        ['531001', 'SYP', 500_000n],
        ['111003', 'SYP', -500_000n],
      ] as LineSpec[],
    };
    const first = await postManual(company, entry);
    const second = await postManual(company, { ...entry, on: '2026-11-20' });
    const reversal = await reverse(company, first.id, '2026-11-25');
    // The reversal's key is `reversal:<entry id>`: the same request again, or another under that
    // key, is a second reversal, refused; so is one under another key (the entry is reversed).
    expect(await code(reverse(company, first.id, '2026-11-25'))).toBe('ENTRY_ALREADY_REVERSED');
    expect(await code(reverse(company, first.id, '2026-11-26'))).toBe('ENTRY_ALREADY_REVERSED');
    expect(
      await code(
        inCompany(company, (tx) =>
          post(tx, {
            client: 'manual',
            idempotencyKey: uuidv7(),
            entryDate: '2026-11-26',
            description: 'عكس ثانٍ',
            reference: null,
            draftId: null,
            preparedByUserId: personId,
            approvedByUserId: null,
            actor: actor(),
            content: { kind: 'reversal', entryId: first.id, today: '2026-11-30' },
          }),
        ),
      ),
    ).toBe('ENTRY_ALREADY_REVERSED');
    expect(await code(reverse(company, reversal.id, '2026-11-26'))).toBe('ENTRY_NOT_REVERSIBLE');
    expect(await code(reverse(company, second.id, '2026-11-19'))).toBe('REVERSAL_BEFORE_ORIGINAL');
    expect(await code(reverse(company, second.id, '2026-12-01', '2026-11-30'))).toBe(
      'ENTRY_DATE_OUT_OF_RANGE',
    );
  });
});

describe('post(): numbers, periods and concurrency (ADR 0008, ADR 0012)', () => {
  it('numbers each fiscal year from 1 by the entry date, a back-dated entry continuing its year', async () => {
    const company = await newCompany(SYP, 7);
    const entry = (on: string) =>
      postManual(company, {
        on,
        today: '2026-07-15',
        lines: [
          ['531001', 'SYP', 5_000n],
          ['111003', 'SYP', -5_000n],
        ],
      });
    const june = await entry('2026-06-30');
    const july = await entry('2026-07-01');
    const back = await entry('2026-06-15');
    expect(
      [june, july, back].map(({ fiscalYear, number, sequence }) => [fiscalYear, number, sequence]),
    ).toEqual([
      [2025, 1, 1n],
      [2026, 1, 2n],
      [2025, 2, 3n],
    ]);
    const rows = await inCompany(company, (tx) =>
      tx.select().from(periods).orderBy(asc(periods.period)),
    );
    expect(rows.map((row) => [row.period, row.fiscalYear])).toEqual([
      ['2026-06', 2025],
      ['2026-07', 2026],
    ]);
    expect(await chainHolds(company)).toBe(null);
  });

  it('refuses a posting into a closed period, and a close and a posting never interleave', async () => {
    const company = await newCompany(SYP);
    const entry = (on: string) =>
      postManual(company, {
        on,
        lines: [
          ['531001', 'SYP', 5_000n],
          ['111003', 'SYP', -5_000n],
        ],
      });
    await entry('2026-11-08');
    // S07 brings the close; here the superuser closes the period, holding it while a posting comes.
    const closer = await superuser.connect();
    try {
      await closer.query('begin');
      await closer.query('alter table periods disable trigger period_rules');
      await closer.query(
        `update periods set state = 'closed' where company_id = $1 and period = '2026-11'`,
        [company],
      );
      let settled = false;
      const posting = code(entry('2026-11-10')).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await closer.query('alter table periods enable always trigger period_rules');
      await closer.query('commit');
      expect(await posting).toBe('PERIOD_CLOSED');
    } finally {
      closer.release();
    }
    expect(await code(entry('2026-11-30'))).toBe('PERIOD_CLOSED');
    expect((await entry('2026-12-01').catch(() => null)) ?? 'refused').toBe('refused');
    expect(
      await postManual(company, {
        on: '2026-12-01',
        today: '2026-12-01',
        lines: [
          ['531001', 'SYP', 5_000n],
          ['111003', 'SYP', -5_000n],
        ],
      }),
    ).toMatchObject({ number: 2 });
  });

  it('posts from many connections at once: gapless numbers in posting order and an unbroken chain', async () => {
    const company = await newCompany(SYP);
    const posted = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        postManual(company, {
          lines: [
            ['531001', 'SYP', BigInt(index + 1) * 1_000n],
            ['111003', 'SYP', -BigInt(index + 1) * 1_000n],
          ],
        }),
      ),
    );
    const order = [...posted].sort((a, b) => (a.sequence < b.sequence ? -1 : 1));
    expect(order.map((entry) => entry.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(order.map((entry) => entry.sequence)).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
    expect(await chainHolds(company)).toBe(null);
  });

  it('posts a double submit once, and lets one of two reversals at once through', async () => {
    const company = await newCompany(SYP);
    const key = uuidv7();
    const entry = {
      key,
      lines: [
        ['531001', 'SYP', 7_000n],
        ['111003', 'SYP', -7_000n],
      ] as LineSpec[],
    };
    const [first, second] = await Promise.all([
      postManual(company, entry),
      postManual(company, entry),
    ]);
    expect(first?.id).toBe(second?.id);
    expect([first?.replayed, second?.replayed].sort()).toEqual([false, true]);
    const twice = await Promise.allSettled([
      reverse(company, first?.id as string, '2026-11-09'),
      inCompany(company, (tx) =>
        post(tx, {
          client: 'manual',
          idempotencyKey: uuidv7(),
          entryDate: '2026-11-09',
          description: 'عكس آخر',
          reference: null,
          draftId: null,
          preparedByUserId: personId,
          approvedByUserId: null,
          actor: actor(),
          content: { kind: 'reversal', entryId: first?.id as string, today: '2026-11-30' },
        }),
      ),
    ]);
    expect(twice.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = twice.find((result) => result.status === 'rejected');
    expect(failed?.status === 'rejected' && (failed.reason as DomainError).code).toBe(
      'ENTRY_ALREADY_REVERSED',
    );
  });
});

// The writes below are what post() never does; each is made by hand, as a runtime role could try.

const APPEND_ONLY = [
  'posting_requests',
  'journal_entries',
  'journal_lines',
  'line_conversions',
  'dimension_sets',
  'dimension_set_values',
] as const;
const LEDGER_STATE = [
  'ledger_heads',
  'entry_number_counters',
  'periods',
  'period_balances',
] as const;

/** A company with one entry in every ledger table: a USD expense carrying a department. */
async function ledgerCompany(): Promise<{ company: string; entry: PostedEntryRef }> {
  const company = await newCompany();
  await week(company);
  const department = await inCompany(company, async (tx) => {
    const [type] = await tx
      .select()
      .from(dimensionTypes)
      .where(eq(dimensionTypes.code, 'department'));
    const [value] = await tx
      .insert(dimensionValues)
      .values({ companyId: company, typeId: type?.id as string, code: 'D1', name: 'قسم تجريبي' })
      .returning();
    return value?.id as string;
  });
  const entry = await postManual(company, {
    lines: [
      ['531004', 'USD', 10_000n, [department]],
      ['111004', 'USD', -10_000n],
    ],
  });
  return { company, entry };
}

describe('the ledger guards, as each role (ADR 0005, ADR 0008, ADR 0012)', () => {
  it('refuses every change to the append-only ledger, for the app role and the owner', async () => {
    const { company } = await ledgerCompany();
    for (const table of APPEND_ONLY) {
      const name = sql.identifier(table);
      for (const statement of [
        sql`update ${name} set created_at = created_at`,
        sql`delete from ${name}`,
        sql`truncate ${name}`,
      ]) {
        expect(await refusal(inCompany(company, (tx) => tx.execute(statement))), table).toMatch(
          /permission denied/,
        );
      }
      expect(
        await refusal(
          inCompany(
            company,
            (tx) => tx.execute(sql`update ${name} set created_at = created_at`),
            owner,
          ),
        ),
      ).toBe(`${table} is append-only: UPDATE refused`);
      expect(
        await refusal(inCompany(company, (tx) => tx.execute(sql`delete from ${name}`), owner)),
      ).toBe(`${table} is append-only: DELETE refused`);
      expect(
        await refusal(inCompany(company, (tx) => tx.execute(sql`truncate ${name}`), owner)),
        // A table other tables reference is refused by its foreign keys before its trigger fires.
      ).toMatch(
        new RegExp(`${table} is append-only: TRUNCATE refused|cannot truncate a table referenced`),
      );
    }
  });

  it('never deletes the ledger state, for any role', async () => {
    const { company } = await ledgerCompany();
    for (const table of LEDGER_STATE) {
      const name = sql.identifier(table);
      expect(
        await refusal(inCompany(company, (tx) => tx.execute(sql`delete from ${name}`))),
        table,
      ).toMatch(/permission denied/);
      expect(
        await refusal(inCompany(company, (tx) => tx.execute(sql`truncate ${name}`))),
        table,
      ).toMatch(/permission denied/);
      expect(
        await refusal(inCompany(company, (tx) => tx.execute(sql`delete from ${name}`), owner)),
      ).toBe(`${table} is never deleted: DELETE refused`);
      expect(
        await refusal(inCompany(company, (tx) => tx.execute(sql`truncate ${name}`), owner)),
      ).toMatch(
        new RegExp(
          `${table} is never deleted: TRUNCATE refused|cannot truncate a table referenced`,
        ),
      );
    }
  });

  it('moves the ledger state only as an append does', async () => {
    const { company } = await ledgerCompany();
    const write = (statement: ReturnType<typeof sql>) =>
      refusal(inCompany(company, (tx) => tx.execute(statement)));
    expect(await write(sql`update period_balances set line_count = line_count + 1`)).toBe(
      'period_balances: written only by the trigger on journal_lines',
    );
    expect(
      await write(sql`insert into period_balances (id, company_id, period_id, account_id, dimension_set_id, currency, debit_minor, credit_minor, book_debit_minor, book_credit_minor, line_count)
        select ${uuidv7()}, company_id, period_id, account_id, dimension_set_id, 'EUR', 0, 0, 0, 0, 1 from period_balances limit 1`),
    ).toBe('period_balances: written only by the trigger on journal_lines');
    expect(await write(sql`update ledger_heads set entry_count = entry_count + 1`)).toMatch(
      /moves by one entry that follows it/,
    );
    expect(await write(sql`update ledger_heads set updated_at = now()`)).toMatch(
      /moves by one entry that follows it/,
    );
    expect(await write(sql`update entry_number_counters set last_number = last_number + 2`)).toBe(
      'entry_number_counters: a counter moves by one number at a time',
    );
    expect(await write(sql`update entry_number_counters set last_number = last_number + 1`)).toBe(
      'entry number 2 of fiscal year 2026 was given but no entry took it',
    );
    expect(
      await write(
        sql`insert into entry_number_counters (id, company_id, fiscal_year, last_number) values (${uuidv7()}, ${company}, 2027, 5)`,
      ),
    ).toBe("entry_number_counters: a fiscal year's numbers start at 1");
    expect(await write(sql`update periods set state = 'closed'`)).toBe(
      'periods: period 2026-11 changes only through the close (S07)',
    );
    expect(
      await write(
        sql`insert into periods (id, company_id, period, fiscal_year, state) values (${uuidv7()}, ${company}, '2027-01', 2027, 'closed')`,
      ),
    ).toBe('periods: period 2027-01 is made open, in the fiscal year of its month');
    expect(
      await write(
        sql`insert into periods (id, company_id, period, fiscal_year, state) values (${uuidv7()}, ${company}, '2027-01', 2026, 'open')`,
      ),
    ).toBe('periods: period 2027-01 is made open, in the fiscal year of its month');
    expect(
      await write(
        sql`insert into ledger_heads (id, company_id, entry_count) values (${uuidv7()}, ${company}, 3)`,
      ),
    ).toBe('ledger_heads: a head starts with no entry');
  });
});

/** A line written by hand: amounts as given, on the account of `code`. */
interface ForgedLine {
  readonly code: string;
  readonly currency: CurrencyCode;
  readonly amount: bigint;
  readonly book: bigint;
  readonly parallel: bigint | null;
  readonly kind?: string;
  readonly ledger?: string | null;
  readonly setId?: string;
}

interface Forgery {
  readonly on?: string;
  readonly lines: readonly ForgedLine[];
  readonly lineCount?: number;
  readonly reverses?: string;
  /** The previous hash; the head's by default. */
  readonly previousHash?: string | null;
  /** The entry number; the one the counter gives by default. */
  readonly number?: number;
  readonly postedAt?: Date;
  readonly moveHead?: boolean;
  readonly markUsed?: boolean;
}

/**
 * An entry written by hand as the app role, following every step of post() unless the forgery
 * says otherwise; the guards must refuse each departure (at the statement or at commit).
 */
async function forge(company: string, forgery: Forgery): Promise<string> {
  const ids = await accountIds(company);
  return inCompany(company, async (tx) => {
    const [head] = await tx.select().from(ledgerHeads).for('update');
    const [settings] = await tx.select().from(companySettings);
    if (!head || !settings) throw new Error('no head');
    const on = forgery.on ?? '2026-11-08';
    const fiscalYear = fiscalYearOf(on, settings.fiscalYearStartMonth);
    await tx
      .insert(periods)
      .values({ companyId: company, period: periodOf(on), fiscalYear, state: 'open' })
      .onConflictDoNothing({ target: [periods.companyId, periods.period] });
    const [counter] = await tx
      .insert(entryNumberCounters)
      .values({ companyId: company, fiscalYear, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [entryNumberCounters.companyId, entryNumberCounters.fiscalYear],
        set: { lastNumber: sql`${entryNumberCounters.lastNumber} + 1` },
      })
      .returning();
    const at = await tx.execute<{ at: string }>(
      sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`,
    );
    const now = new Date(at.rows[0]?.at as string);
    const accounts = forgery.lines.map((line) => ids.get(line.code) as string);
    if (forgery.markUsed !== false) {
      await tx
        .update(chartAccounts)
        .set({ firstPostedAt: now })
        .where(
          and(
            inArray(chartAccounts.id, accounts),
            eq(chartAccounts.kind, 'postable'),
            sql`${chartAccounts.firstPostedAt} is null`,
          ),
        );
      await tx
        .update(companySettings)
        .set({ booksStartedAt: now })
        .where(sql`${companySettings.booksStartedAt} is null`);
    }
    let [empty] = await tx.select().from(dimensionSets).where(eq(dimensionSets.key, ''));
    if (!empty)
      [empty] = await tx.insert(dimensionSets).values({ companyId: company, key: '' }).returning();
    const [request] = await tx
      .insert(postingRequests)
      .values({
        companyId: company,
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
      companyId: company,
      requestId: request?.id as string,
      sequence,
      fiscalYear,
      number: forgery.number ?? (counter?.lastNumber as number),
      entryDate: on,
      postedAt: forgery.postedAt ?? now,
      source: 'manual',
      description: 'قيد مزوّر',
      reversesEntryId: forgery.reverses ?? null,
      postedByUserId: personId,
      lineCount: forgery.lineCount ?? forgery.lines.length,
      previousHash: forgery.previousHash === undefined ? head.lastHash : forgery.previousHash,
      hash,
    });
    await tx.insert(journalLines).values(
      forgery.lines.map((line, index) => ({
        companyId: company,
        entryId: id,
        lineNo: index + 1,
        accountId: accounts[index] as string,
        dimensionSetId: line.setId ?? (empty?.id as string),
        kind: line.kind ?? 'measured',
        ledger: line.ledger ?? null,
        currency: line.currency,
        amountMinor: line.amount,
        bookMinor: line.book,
        parallelMinor: line.parallel,
      })),
    );
    if (forgery.moveHead !== false) {
      await tx
        .update(ledgerHeads)
        .set({ entryCount: sequence, lastEntryId: id, lastHash: hash })
        .where(eq(ledgerHeads.id, head.id));
    }
    return id;
  });
}

const DEBIT: ForgedLine = {
  code: '531001',
  currency: 'SYP',
  amount: 10_000n,
  book: 10_000n,
  parallel: 82n,
};
const CREDIT: ForgedLine = {
  code: '111003',
  currency: 'SYP',
  amount: -10_000n,
  book: -10_000n,
  parallel: -82n,
};

describe('forged entries, refused by the database (ADR 0005 invariants 1–8)', () => {
  it('lets a forged entry that follows every rule through, so each refusal below is its own', async () => {
    const company = await newCompany();
    await forge(company, { lines: [DEBIT, CREDIT] });
    await forge(company, { lines: [DEBIT, CREDIT] });
    expect(await chainHolds(company)).not.toBe(null); // the forger's hashes are not chainEntryValue's
  });

  it('refuses an entry that does not balance or is not complete (invariant 1)', async () => {
    const company = await newCompany();
    const balance = /does not balance/;
    expect(await refusal(forge(company, { lines: [DEBIT, { ...CREDIT, book: -9_999n }] }))).toMatch(
      balance,
    );
    expect(
      await refusal(forge(company, { lines: [DEBIT, { ...CREDIT, parallel: -81n }] })),
    ).toMatch(balance);
    expect(
      await refusal(forge(company, { lines: [DEBIT, { ...CREDIT, parallel: null }] })),
    ).toMatch(balance);
    expect(
      await refusal(
        forge(company, { lines: [{ ...DEBIT, book: 0n, parallel: 0n }], lineCount: 2 }),
      ),
    ).toMatch(balance);
    expect(await refusal(forge(company, { lines: [DEBIT, CREDIT], lineCount: 3 }))).toMatch(
      balance,
    );
    const posted = await forge(company, { lines: [DEBIT, CREDIT] });
    const ids = await accountIds(company);
    expect(
      await refusal(
        inCompany(company, async (tx) => {
          const [set] = await tx.select().from(dimensionSets);
          await tx.insert(journalLines).values({
            companyId: company,
            entryId: posted,
            lineNo: 3,
            accountId: ids.get('531001') as string,
            dimensionSetId: set?.id as string,
            kind: 'measured',
            currency: 'SYP',
            amountMinor: 0n,
            bookMinor: 0n,
            parallelMinor: 0n,
          });
        }),
      ),
    ).toMatch(balance);
  });

  it('refuses a broken chain, a number not given, a posting time not its own, a head left behind', async () => {
    const company = await newCompany();
    await forge(company, { lines: [DEBIT, CREDIT] });
    expect(
      await refusal(forge(company, { lines: [DEBIT, CREDIT], previousHash: 'f'.repeat(64) })),
    ).toMatch(/follows the head/);
    expect(await refusal(forge(company, { lines: [DEBIT, CREDIT], previousHash: null }))).toMatch(
      /follows the head/,
    );
    expect(await refusal(forge(company, { lines: [DEBIT, CREDIT], number: 5 }))).toMatch(
      /takes the number/,
    );
    expect(
      await refusal(
        forge(company, { lines: [DEBIT, CREDIT], postedAt: new Date('2026-11-08T00:00:00Z') }),
      ),
    ).toMatch(/transaction time/);
    expect(await refusal(forge(company, { lines: [DEBIT, CREDIT], moveHead: false }))).toMatch(
      /did not move past it/,
    );
  });

  it('refuses a line on a header, an unused or another-currency account, without its dimensions, or SYP before the new pound (invariant 8)', async () => {
    const company = await newCompany();
    expect(await refusal(forge(company, { lines: [{ ...DEBIT, code: '531' }, CREDIT] }))).toMatch(
      /postable account marked as used/,
    );
    expect(await refusal(forge(company, { lines: [DEBIT, CREDIT], markUsed: false }))).toMatch(
      /in started books|postable account marked as used/,
    );
    expect(
      await refusal(forge(company, { lines: [DEBIT, { ...CREDIT, code: '111004' }] })),
    ).toMatch(/takes USD lines, not SYP/);
    expect(
      await refusal(forge(company, { lines: [{ ...DEBIT, code: '521001' }, CREDIT] })),
    ).toMatch(/every dimension its account/);
    expect(await refusal(forge(company, { on: '2025-12-31', lines: [DEBIT, CREDIT] }))).toMatch(
      /no SYP amount is dated before 2026-01-01/,
    );
  });

  it('refuses a reversal that does not negate its original exactly, a second one, or one of a reversal (invariant 3)', async () => {
    const company = await newCompany();
    const original = await forge(company, { lines: [DEBIT, CREDIT] });
    const negated = (line: ForgedLine): ForgedLine => ({
      ...line,
      amount: -line.amount,
      book: -line.book,
      parallel: line.parallel === null ? null : -line.parallel,
    });
    const exact = [negated(DEBIT), negated(CREDIT)];
    expect(
      await refusal(
        forge(company, {
          reverses: original,
          lines: [negated(DEBIT), { ...negated(CREDIT), parallel: 81n }],
        }),
      ),
    ).toMatch(/does not balance|does not reverse/);
    expect(
      await refusal(
        forge(company, {
          reverses: original,
          lines: [{ ...negated(DEBIT), code: '531002' }, negated(CREDIT)],
        }),
      ),
    ).toMatch(/does not reverse/);
    expect(
      await refusal(
        forge(company, {
          reverses: original,
          lines: [...exact, { ...DEBIT, amount: 0n, book: 0n, parallel: 0n }],
        }),
      ),
    ).toMatch(/does not reverse/);
    expect(
      await refusal(forge(company, { reverses: original, on: '2026-11-07', lines: exact })),
    ).toMatch(/does not reverse/);
    const reversal = await forge(company, { reverses: original, lines: exact });
    expect(await refusal(forge(company, { reverses: original, lines: exact }))).toMatch(
      /journal_entries_reverses_key/,
    );
    expect(await refusal(forge(company, { reverses: reversal, lines: [DEBIT, CREDIT] }))).toMatch(
      /does not reverse/,
    );
  });

  it('refuses a conversion added to a posted entry, a reversal or a one-ledger line', async () => {
    const company = await newCompany();
    const { bulletin } = await week(company);
    const posted = await postManual(company, {
      lines: [
        ['531004', 'USD', 10_000n],
        ['111004', 'USD', -10_000n],
      ],
    });
    const reversal = await reverse(company, posted.id, '2026-11-08', '2026-11-30');
    const [measured] = await linesOf(company, posted.id);
    const [negated] = await linesOf(company, reversal.id);
    const conversion = (lineId: string) =>
      refusal(
        inCompany(company, (tx) =>
          tx.insert(lineConversions).values({
            companyId: company,
            lineId,
            ledger: 'book',
            basis: 'policy',
            quoteNo: 2,
            rateId: bulletin.id,
            base: 'USD',
            quote: 'SYP',
            rate: '121.5000',
            rateType: 'bulletin',
            rateSource: 'manual',
            effectiveOn: '2026-11-08',
          }),
        ),
      );
    const added = /a conversion is added only to a measured line of the entry being posted/;
    expect(await conversion(measured?.line.id as string)).toMatch(added);
    expect(await conversion(negated?.line.id as string)).toMatch(added);
    const forged = await forge(company, {
      lines: [
        DEBIT,
        CREDIT,
        {
          code: '541003',
          currency: 'SYP',
          amount: 0n,
          book: 0n,
          parallel: 0n,
          kind: 'rounding',
          ledger: 'book',
        },
      ],
    });
    const [, , rounding] = await linesOf(company, forged);
    expect(await conversion(rounding?.line.id as string)).toMatch(added);
  });

  it('refuses a posting request stored without its entry, which would hold its key for good', async () => {
    const company = await newCompany(SYP);
    const key = uuidv7();
    expect(
      await refusal(
        inCompany(company, (tx) =>
          tx.insert(postingRequests).values({
            companyId: company,
            client: 'manual',
            idempotencyKey: key,
            payloadHash: '0'.repeat(64),
          }),
        ),
      ),
    ).toMatch(/was stored without its entry/);
    // The key stays free: the draft posts under it.
    expect(
      await postManual(company, {
        key,
        lines: [
          ['531001', 'SYP', 1_000n],
          ['111003', 'SYP', -1_000n],
        ],
      }),
    ).toMatchObject({ number: 1, replayed: false });
  });

  it('refuses a dimension set whose key names other values than it holds', async () => {
    const company = await newCompany();
    const [type, value] = await inCompany(company, async (tx) => {
      const [department] = await tx
        .select()
        .from(dimensionTypes)
        .where(eq(dimensionTypes.code, 'department'));
      const [row] = await tx
        .insert(dimensionValues)
        .values({
          companyId: company,
          typeId: department?.id as string,
          code: 'D2',
          name: 'قسم آخر',
        })
        .returning();
      return [department?.id as string, row?.id as string];
    });
    const lying = (key: string, values: { typeId: string; valueId: string }[]) =>
      refusal(
        inCompany(company, async (tx) => {
          const [set] = await tx
            .insert(dimensionSets)
            .values({ companyId: company, key })
            .returning();
          if (values.length > 0) {
            await tx
              .insert(dimensionSetValues)
              .values(
                values.map((pair) => ({ companyId: company, setId: set?.id as string, ...pair })),
              );
          }
        }),
      );
    const holds = /does not hold the values its key names/;
    expect(await lying(`${type}:${value}`, [])).toMatch(holds);
    expect(await lying('', [{ typeId: type, valueId: value }])).toMatch(holds);
    expect(await lying(`${type}:${uuidv7()}`, [{ typeId: type, valueId: value }])).toMatch(holds);
  });
});
