import type { CompanyLedgers, CurrencyCode } from '@vertex-mizan/contracts';
import { type ChainEntry, chainEntryValue, verifyChain } from '@vertex-mizan/ledger';
import { sql } from 'drizzle-orm';
import fc from 'fast-check';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chartAccounts,
  createCompanyBooks,
  journalEntries,
  type PersonActor,
  type PostedEntryRef,
  type PostingRequest,
  post,
  readChain,
  readPeriodBalances,
  rebuildPeriodBalances,
  recordRate,
  type Transaction,
  users,
  withCompany,
} from '../src/index.js';
import { connect } from './connections.js';

// ADR 0005's properties of the posting function, on the real database: any sequence of manual
// entries in one or two currencies and of reversals posts entries balanced in both ledgers, with
// gapless numbers and an unbroken chain that any altered field breaks; an entry and its reversal
// net to zero on every account; the period balances equal the lines; and a replay posts nothing.
// All values are synthetic.

const { app } = connect();

let personId = '';

const actor = (): PersonActor => ({
  kind: 'person',
  userId: personId,
  name: 'محاسب مولّد',
  sessionId: null,
  requestId: 'request-properties',
  ipAddress: null,
  userAgent: null,
});

const SYP_USD: CompanyLedgers = {
  book: { currency: 'SYP', ratePolicy: { rateType: 'bulletin', acceptsTransactionRate: false } },
  parallel: { currency: 'USD', ratePolicy: { rateType: 'market', acceptsTransactionRate: true } },
};

const DAYS = ['2026-11-08', '2026-11-10'] as const;

/** Accounts of the service-agency chart that take each currency, with no required dimension. */
const ACCOUNTS: Record<'USD' | 'SYP', readonly string[]> = {
  USD: ['111004', '111002', '531001', '531003'],
  SYP: ['111003', '111001', '531002', '532001'],
};

const amount = fc.bigInt({ min: 1n, max: 50_000_000n });

/** An entry in one currency: debits and credits that sum to zero in it. */
const oneCurrency = fc
  .record({
    currency: fc.constantFrom('USD' as const, 'SYP' as const),
    amounts: fc.array(fc.tuple(amount, fc.boolean()), { minLength: 1, maxLength: 3 }),
    accounts: fc.array(fc.nat(3), { minLength: 4, maxLength: 4 }),
    day: fc.constantFrom(...DAYS),
  })
  .map(({ currency, amounts, accounts, day }) => {
    const signed = amounts.map(([value, debit]) => (debit ? value : -value));
    const rest = -signed.reduce((sum, value) => sum + value, 0n);
    const all = rest === 0n ? signed : [...signed, rest];
    return {
      kind: 'manual' as const,
      day,
      lines: all.map((value, index) => ({
        code: ACCOUNTS[currency][accounts[index] ?? 0] as string,
        currency: currency as CurrencyCode,
        amount: value,
      })),
    };
  })
  .filter((entry) => entry.lines.length >= 2);

/** A currency purchase or sale between the USD and SYP banks, at the policy rates. */
const exchange = fc
  .record({ usd: amount, syp: amount, buy: fc.boolean(), day: fc.constantFrom(...DAYS) })
  .map(({ usd, syp, buy, day }) => ({
    kind: 'manual' as const,
    day,
    lines: [
      { code: '111004', currency: 'USD' as CurrencyCode, amount: buy ? usd : -usd },
      { code: '111003', currency: 'SYP' as CurrencyCode, amount: buy ? -syp : syp },
    ],
  }));

/** A reversal of one of the entries posted before, picked by its position. */
const reversal = fc.nat(20).map((pick) => ({ kind: 'reversal' as const, pick }));

const operations = fc.array(fc.oneof(oneCurrency, exchange, reversal), {
  minLength: 1,
  maxLength: 6,
});

type Operation = typeof operations extends fc.Arbitrary<(infer T)[]> ? T : never;

async function newCompany(): Promise<{ company: string; ids: Map<string, string> }> {
  const company = uuidv7();
  await withCompany(app, company, async (tx) => {
    await createCompanyBooks(
      tx,
      company,
      {
        name: 'شركة مولّدة',
        nameLatin: null,
        ledgers: SYP_USD,
        fiscalYearStartMonth: 1,
        policyNote: 'مذكرة مولّدة.',
        template: 'service-agency',
        createdByUserId: personId,
      },
      actor(),
    );
    for (const day of DAYS) {
      for (const [type, value] of [
        ['bulletin', '121.5000'],
        ['market', '122.0000'],
      ] as const) {
        await recordRate(tx, company, actor(), {
          effectiveOn: day,
          base: 'USD',
          quote: 'SYP',
          rate: day === DAYS[0] ? value : `${value.slice(0, 3)}.7500`,
          type,
          source: 'manual',
        });
      }
    }
  });
  const rows = await withCompany(app, company, (tx) =>
    tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts),
  );
  return { company, ids: new Map(rows.map((row) => [row.code, row.id])) };
}

function requestOf(
  operation: Operation,
  ids: Map<string, string>,
  posted: readonly { ref: PostedEntryRef; day: string; reversed: boolean }[],
): { request: PostingRequest; day: string; reverses: number | null } | null {
  const common = {
    client: 'manual',
    description: 'قيد مولّد',
    reference: null,
    draftId: null,
    preparedByUserId: personId,
    approvedByUserId: null,
    actor: actor(),
  };
  if (operation.kind === 'reversal') {
    const candidates = posted
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !entry.reversed && entry.day !== 'reversal');
    const chosen = candidates[operation.pick % Math.max(candidates.length, 1)];
    if (chosen === undefined) return null;
    return {
      request: {
        ...common,
        idempotencyKey: `reversal:${chosen.entry.ref.id}`,
        entryDate: DAYS[1],
        content: { kind: 'reversal', entryId: chosen.entry.ref.id, today: '2026-11-30' },
      },
      day: 'reversal',
      reverses: chosen.index,
    };
  }
  return {
    request: {
      ...common,
      idempotencyKey: uuidv7(),
      entryDate: operation.day,
      content: {
        kind: 'manual',
        today: '2026-11-30',
        dealtRates: [],
        lines: operation.lines.map((line) => ({
          accountId: ids.get(line.code) as string,
          dimensionValueIds: [],
          currency: line.currency,
          amountMinor: line.amount,
          memo: null,
        })),
      },
    },
    day: operation.day,
    reverses: null,
  };
}

/** Each account's totals over some entries: transaction per currency, book and parallel. */
async function totalsOf(tx: Transaction, entryIds: readonly string[]) {
  const listed = sql.join(
    entryIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await tx.execute<{
    account_id: string;
    amount: string;
    book: string;
    parallel: string;
  }>(
    sql`select account_id, currency, sum(amount_minor)::text as amount, sum(book_minor)::text as book,
               sum(parallel_minor)::text as parallel
        from journal_lines where entry_id in (${listed}) group by account_id, currency`,
  );
  return result.rows;
}

beforeAll(async () => {
  const [row] = await app
    .insert(users)
    .values({ email: 'posting.properties@example.test', name: 'محاسب مولّد' })
    .returning({ id: users.id });
  if (!row) throw new Error('no user inserted');
  personId = row.id;
});

describe('the posting function, as properties (ADR 0005)', () => {
  it('posts any sequence of entries and reversals balanced, numbered, chained and summed', async () => {
    await fc.assert(
      fc.asyncProperty(operations, fc.nat(1_000), async (sequence, alterAt) => {
        const { company, ids } = await newCompany();
        const posted: { ref: PostedEntryRef; day: string; reversed: boolean }[] = [];
        const requests: PostingRequest[] = [];
        const pairs: [string, string][] = [];
        for (const operation of sequence) {
          const made = requestOf(operation, ids, posted);
          if (made === null) continue;
          const ref = await withCompany(app, company, (tx) => post(tx, made.request));
          requests.push(made.request);
          if (made.reverses !== null) {
            const original = posted[made.reverses];
            if (original) {
              original.reversed = true;
              pairs.push([original.ref.id, ref.id]);
            }
          }
          posted.push({ ref, day: made.day, reversed: false });
        }

        const state = await withCompany(app, company, async (tx) => ({
          entries: await tx.select().from(journalEntries),
          books: await tx.execute<{ entry_id: string; book: string; parallel: string }>(
            sql`select entry_id, sum(book_minor)::text as book, sum(parallel_minor)::text as parallel
                from journal_lines group by entry_id`,
          ),
          rebuilt: await rebuildPeriodBalances(tx),
          balances: await readPeriodBalances(tx),
          chain: await readChain(tx),
          pairs: await Promise.all(pairs.map((pair) => totalsOf(tx, pair))),
        }));

        // Every entry balances in both ledgers (invariant 1).
        expect(state.books.rows.every((row) => row.book === '0' && row.parallel === '0')).toBe(
          true,
        );
        // Gapless numbers in posting order (invariant 6): one fiscal year here.
        expect(state.entries.map((entry) => entry.number).sort((a, b) => a - b)).toEqual(
          state.entries.map((_, index) => index + 1),
        );
        // An entry and its reversal net to zero on every account (invariant 3).
        for (const totals of state.pairs) {
          for (const row of totals)
            expect([row.amount, row.book, row.parallel]).toEqual(['0', '0', '0']);
        }
        // The period balances are the lines' (ADR 0008, ADR 0012).
        expect(state.balances).toEqual(state.rebuilt);
        // The chain holds, and fails at the first altered entry (S03 rule 19).
        const links = state.chain.map((link) => ({
          entry: chainEntryValue(link.entry),
          previousHash: link.previousHash,
          hash: link.hash,
        }));
        expect(verifyChain(links)).toBe(null);
        if (state.chain.length > 0) {
          const index = alterAt % state.chain.length;
          const link = state.chain[index] as (typeof state.chain)[number];
          const [line, ...others] = link.entry.lines;
          const alterations: ChainEntry[] = [
            { ...link.entry, description: `${link.entry.description}.` },
            { ...link.entry, entryDate: '2026-11-09' },
            { ...link.entry, number: link.entry.number + 1 },
            ...(line ? [{ ...link.entry, lines: [{ ...line, memo: 'm' }, ...others] }] : []),
          ];
          for (const altered of alterations) {
            const broken = links.map((original, at) =>
              at === index ? { ...original, entry: chainEntryValue(altered) } : original,
            );
            expect(verifyChain(broken)).toEqual({ index, reason: 'hash' });
          }
        }
        // A replay of every request answers its entry and posts nothing (invariant 5); a
        // reversal's again is a second reversal, refused (S03 rule 9).
        for (const [index, request] of requests.entries()) {
          const again = withCompany(app, company, (tx) => post(tx, request));
          if (request.content.kind === 'reversal') {
            await expect(again).rejects.toMatchObject({ code: 'ENTRY_ALREADY_REVERSED' });
          } else {
            expect(await again).toEqual({ ...posted[index]?.ref, replayed: true });
          }
        }
        const after = await withCompany(app, company, (tx) => tx.select().from(journalEntries));
        expect(after).toHaveLength(state.entries.length);
      }),
      { numRuns: 15, includeErrorInReport: true },
    );
  }, 120_000);
});
