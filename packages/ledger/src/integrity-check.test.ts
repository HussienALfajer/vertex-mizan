import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type ChainEntry, type ChainLine, chainEntryValue, entryHash } from './integrity.js';
import {
  anchorResult,
  checkIntegrity,
  firstChainBreak,
  numberingProblems,
  periodBalanceProblems,
  periodTotalsOf,
  type StoredEntry,
  unbalancedEntries,
} from './integrity-check.js';

// Synthetic ids: a company, accounts and a dimension set key.
const COMPANY = '019a0000-0000-7000-8000-0000000000c1';
const CASH = '019a0000-0000-7000-8000-000000111003';
const BANK = '019a0000-0000-7000-8000-000000111004';
const PROJECT_KEY = '019a0000-0000-7000-8000-0000000000d1:019a0000-0000-7000-8000-0000000000d2';

const idOf = (n: number, tail: string) =>
  `019a0000-0000-7000-8000-${tail}${String(n).padStart(12 - tail.length, '0')}`;

/** A balanced two-line entry, SYP book and USD parallel. */
function entryOf(
  n: number,
  { amount = 10_000n, date = '2026-11-08', fiscalYear = 2026, number = n } = {},
): ChainEntry {
  const line = (lineNo: number, accountId: string, sign: bigint): ChainLine => ({
    lineNo,
    accountId,
    dimensionKey: lineNo === 1 ? PROJECT_KEY : '',
    kind: 'measured',
    ledger: null,
    currency: 'SYP',
    amountMinor: sign * amount,
    bookMinor: sign * amount,
    parallelMinor: sign * (amount / 100n),
    memo: null,
    conversions: [],
  });
  return {
    id: idOf(n, 'e'),
    companyId: COMPANY,
    requestId: idOf(n, 'a'),
    sequence: BigInt(n),
    fiscalYear,
    number,
    entryDate: date,
    postedAt: '2026-11-08T09:30:00.000Z',
    source: 'manual',
    sourceRef: null,
    hubDocument: null,
    description: `قيد ${n}`,
    reference: null,
    reversesEntryId: null,
    draftId: null,
    preparedByUserId: idOf(1, 'b'),
    approvedByUserId: null,
    postedByUserId: idOf(1, 'b'),
    postedByClientId: null,
    lines: [line(1, BANK, 1n), line(2, CASH, -1n)],
  };
}

/** Links entries as the posting function does: each hash over the content and the hash before. */
function chainOf(entries: readonly ChainEntry[]): StoredEntry[] {
  const chain: StoredEntry[] = [];
  let previousHash: string | null = null;
  for (const entry of entries) {
    const hash = entryHash(chainEntryValue(entry), previousHash);
    chain.push({ entry, previousHash, hash });
    previousHash = hash;
  }
  return chain;
}

const sound = (chain: readonly StoredEntry[]) => ({
  chain,
  head: {
    entryCount: BigInt(chain.length),
    lastEntryId: chain.at(-1)?.entry.id ?? null,
    lastHash: chain.at(-1)?.hash ?? null,
  },
  counters: [{ fiscalYear: 2026, lastNumber: chain.length }].filter(() => chain.length > 0),
  keepsParallel: true,
  periodBalances: periodTotalsOf(chain),
});

describe('checkIntegrity', () => {
  it('finds nothing wrong in books as the posting function keeps them', () => {
    const chain = chainOf([1, 2, 3].map((n) => entryOf(n)));
    expect(checkIntegrity(sound(chain))).toEqual({
      entryCount: 3,
      lineCount: 6,
      firstBreak: null,
      headMatchesChain: true,
      numbering: [],
      unbalanced: [],
      periodBalances: [],
    });
  });

  it('checks a company with no entries', () => {
    expect(checkIntegrity(sound([]))).toMatchObject({
      entryCount: 0,
      firstBreak: null,
      headMatchesChain: true,
      numbering: [],
    });
  });

  it('finds a head that is not the chain’s last entry', () => {
    const chain = chainOf([1, 2].map((n) => entryOf(n)));
    const input = sound(chain);
    for (const head of [
      { ...input.head, entryCount: 3n },
      { ...input.head, lastHash: chain[0]?.hash ?? null },
      { ...input.head, lastEntryId: chain[0]?.entry.id ?? null },
    ]) {
      expect(checkIntegrity({ ...input, head }).headMatchesChain).toBe(false);
    }
  });
});

describe('firstChainBreak', () => {
  const chain = chainOf([1, 2, 3, 4].map((n) => entryOf(n)));

  it('names the first entry whose content changed after posting', () => {
    const altered = chain.map((link, index) =>
      index === 2 ? { ...link, entry: { ...link.entry, description: 'معدّل' } } : link,
    );
    expect(firstChainBreak(altered)).toEqual({
      sequence: 3n,
      entryId: idOf(3, 'e'),
      fiscalYear: 2026,
      number: 3,
      reason: 'hash',
    });
  });

  it('names a removed entry by the link after it, and a reordered one by its sequence', () => {
    expect(firstChainBreak([chain[0], chain[2], chain[3]] as StoredEntry[])).toMatchObject({
      sequence: 3n,
      reason: 'sequence',
    });
    const relinked = chainOf([1, 3, 4].map((n) => ({ ...entryOf(n), sequence: BigInt(n) })));
    expect(firstChainBreak(relinked)).toMatchObject({ sequence: 3n, reason: 'sequence' });
    const swapped = [chain[0], chain[2], chain[1], chain[3]] as StoredEntry[];
    expect(firstChainBreak(swapped)).toMatchObject({ entryId: idOf(3, 'e'), reason: 'sequence' });
  });

  it('names an entry rehashed in place: the link after it no longer holds', () => {
    // A forger who recomputes an altered entry's hash breaks the next entry's link back.
    const forged = [...chain];
    const third = chain[2] as StoredEntry;
    const entry = { ...third.entry, description: 'معدّل' };
    forged[2] = { ...third, entry, hash: entryHash(chainEntryValue(entry), third.previousHash) };
    expect(firstChainBreak(forged)).toMatchObject({ sequence: 4n, reason: 'previous-hash' });
  });
});

describe('numberingProblems', () => {
  const year = (numbers: number[], fiscalYear = 2026) =>
    numbers.map((number, index) => ({
      entry: { ...entryOf(index + 1, { number, fiscalYear }) },
      previousHash: null,
      hash: '',
    }));

  it('reports the first number of each gap, each repeat and a counter that disagrees', () => {
    const chain = year([1, 2, 5, 6, 6, 9]);
    expect(numberingProblems(chain, [{ fiscalYear: 2026, lastNumber: 10 }])).toEqual([
      { fiscalYear: 2026, number: 3, problem: 'missing' },
      { fiscalYear: 2026, number: 6, problem: 'duplicate' },
      { fiscalYear: 2026, number: 7, problem: 'missing' },
      { fiscalYear: 2026, number: 10, problem: 'counter' },
    ]);
  });

  it('restarts the numbers each fiscal year and checks every year’s counter', () => {
    const chain = [...year([1, 2], 2026), ...year([1], 2027)];
    expect(
      numberingProblems(chain, [
        { fiscalYear: 2026, lastNumber: 2 },
        { fiscalYear: 2027, lastNumber: 1 },
      ]),
    ).toEqual([]);
    expect(numberingProblems(chain, [{ fiscalYear: 2026, lastNumber: 2 }])).toEqual([
      { fiscalYear: 2027, number: 0, problem: 'counter' },
    ]);
    expect(numberingProblems([], [{ fiscalYear: 2028, lastNumber: 4 }])).toEqual([
      { fiscalYear: 2028, number: 4, problem: 'counter' },
    ]);
  });
});

describe('unbalancedEntries', () => {
  const at = { entryId: idOf(1, 'e'), fiscalYear: 2026, number: 1 };

  it('reports each ledger whose lines do not sum to zero, with the residual', () => {
    const entry = entryOf(1);
    const [first, second] = entry.lines as [ChainLine, ChainLine];
    const tampered: ChainEntry = {
      ...entry,
      lines: [{ ...first, bookMinor: first.bookMinor + 1n, parallelMinor: 99n }, second],
    };
    expect(unbalancedEntries(chainOf([tampered]), true)).toEqual([
      { ...at, ledger: 'book', residualMinor: 1n, incompleteLines: 0 },
      { ...at, ledger: 'parallel', residualMinor: -1n, incompleteLines: 0 },
    ]);
  });

  it('reports an entry missing from the parallel ledger the company keeps', () => {
    // Balanced in the book ledger, with no parallel amount at all: the database refuses it.
    const entry = entryOf(1);
    const bookOnly = {
      ...entry,
      lines: entry.lines.map((line) => ({ ...line, parallelMinor: null })),
    };
    expect(unbalancedEntries(chainOf([bookOnly]), true)).toEqual([
      { ...at, ledger: 'parallel', residualMinor: 0n, incompleteLines: 2 },
    ]);
    const [first, second] = entry.lines as [ChainLine, ChainLine];
    const oneLine = { ...entry, lines: [first, { ...second, parallelMinor: null }] };
    expect(unbalancedEntries(chainOf([oneLine]), true)).toEqual([
      { ...at, ledger: 'parallel', residualMinor: first.parallelMinor, incompleteLines: 1 },
    ]);
    expect(checkIntegrity({ ...sound(chainOf([bookOnly])) }).unbalanced).toHaveLength(1);
  });

  it('checks no parallel ledger when the company keeps none, and refuses amounts in one', () => {
    const entry = entryOf(1);
    const syp = { ...entry, lines: entry.lines.map((line) => ({ ...line, parallelMinor: null })) };
    expect(unbalancedEntries(chainOf([syp]), false)).toEqual([]);
    expect(unbalancedEntries(chainOf([entry]), false)).toEqual([
      { ...at, ledger: 'parallel', residualMinor: 0n, incompleteLines: 2 },
    ]);
  });
});

describe('periodBalanceProblems', () => {
  const chain = chainOf([
    entryOf(1),
    entryOf(2, { date: '2026-12-01', amount: 30_000n }),
    entryOf(3, { date: '2026-12-15' }),
  ]);

  it('totals the lines per period, account, dimension set and currency', () => {
    expect(periodTotalsOf(chain)).toContainEqual({
      period: '2026-12',
      accountId: BANK,
      dimensionKey: PROJECT_KEY,
      currency: 'SYP',
      debitMinor: 40_000n,
      creditMinor: 0n,
      bookDebitMinor: 40_000n,
      bookCreditMinor: 0n,
      parallelDebitMinor: 400n,
      parallelCreditMinor: 0n,
      lineCount: 2,
    });
  });

  it('reports a different total, a missing balance and one no line explains', () => {
    const stored = periodTotalsOf(chain);
    const [first, second, ...rest] = stored as [
      (typeof stored)[number],
      (typeof stored)[number],
      ...typeof stored,
    ];
    const tampered = [
      { ...first, bookDebitMinor: first.bookDebitMinor + 1n },
      ...rest,
      { ...second, period: '2027-01' },
    ];
    expect(periodBalanceProblems(chain, tampered)).toEqual(
      [
        { ...keyOf(first), problem: 'different' },
        { ...keyOf(second), problem: 'missing' },
        { ...keyOf(second), period: '2027-01', problem: 'unexpected' },
      ].sort((a, b) => (`${a.period}|${a.accountId}` < `${b.period}|${b.accountId}` ? -1 : 1)),
    );
  });
});

function keyOf(row: { period: string; accountId: string; dimensionKey: string; currency: string }) {
  return {
    period: row.period,
    accountId: row.accountId,
    dimensionKey: row.dimensionKey,
    currency: row.currency,
  };
}

describe('anchorResult', () => {
  const chain = chainOf([1, 2, 3].map((n) => entryOf(n)));

  it('verifies the hash of the entry at the anchor’s count', () => {
    expect(anchorResult(chain, { entryCount: 2n, headHash: chain[1]?.hash ?? '' })).toBe(
      'verified',
    );
    expect(anchorResult(chain, { entryCount: 2n, headHash: chain[2]?.hash ?? '' })).toBe(
      'mismatch',
    );
    expect(anchorResult(chain, { entryCount: 4n, headHash: chain[2]?.hash ?? '' })).toBe('missing');
  });

  it('refuses an anchor of no entries, which no company is sent', () => {
    expect(() => anchorResult(chain, { entryCount: 0n, headHash: '' })).toThrow(RangeError);
  });

  it('fails on an entry altered before the anchor, even when the chain is rebuilt after it', () => {
    // The server's whole chain recomputed after a change: every link holds again, but the hash
    // at the emailed count is not the one the owner kept.
    const anchor = { entryCount: 3n, headHash: chain[2]?.hash ?? '' };
    const rebuilt = chainOf([entryOf(1), { ...entryOf(2), description: 'معدّل' }, entryOf(3)]);
    expect(firstChainBreak(rebuilt)).toBeNull();
    expect(anchorResult(rebuilt, anchor)).toBe('mismatch');
  });
});

describe('properties', () => {
  const amounts = fc.array(fc.bigInt({ min: 1n, max: 10n ** 12n }), {
    minLength: 1,
    maxLength: 12,
  });

  it('finds nothing wrong in any chain the posting function would build', () => {
    fc.assert(
      fc.property(amounts, (values) => {
        const chain = chainOf(values.map((amount, index) => entryOf(index + 1, { amount })));
        const findings = checkIntegrity(sound(chain));
        expect(findings.firstBreak).toBeNull();
        expect(findings.headMatchesChain).toBe(true);
        expect(findings.numbering).toEqual([]);
        expect(findings.unbalanced).toEqual([]);
        expect(findings.periodBalances).toEqual([]);
      }),
    );
  });

  it('breaks at the altered entry whichever amount of whichever line changes', () => {
    fc.assert(
      fc.property(
        amounts,
        fc.nat(),
        fc.constantFrom('amountMinor', 'bookMinor', 'parallelMinor'),
        fc.bigInt({ min: 1n, max: 1000n }),
        (values, at, field, delta) => {
          const chain = chainOf(values.map((amount, index) => entryOf(index + 1, { amount })));
          const index = at % chain.length;
          const link = chain[index] as StoredEntry;
          const [first, ...others] = link.entry.lines as [ChainLine, ...ChainLine[]];
          const altered = { ...first, [field]: (first[field] ?? 0n) + delta };
          const tampered = [...chain];
          tampered[index] = { ...link, entry: { ...link.entry, lines: [altered, ...others] } };
          expect(firstChainBreak(tampered)).toMatchObject({
            sequence: BigInt(index + 1),
            reason: 'hash',
          });
          // Stored balances still match the lines they were written from: the tampered line
          // shows as a different period total too.
          expect(checkIntegrity({ ...sound(chain), chain: tampered }).periodBalances).toHaveLength(
            1,
          );
        },
      ),
    );
  });
});
