import type { AnchorResult, CurrencyCode, Ledger } from '@vertex-mizan/contracts';
import { type ChainEntry, chainEntryValue, entryHash } from './integrity.js';
import { periodOf } from './periods.js';

/**
 * The integrity check's pure parts (S03 rule 19, ADR 0005, ADR 0008): the company's ledger as
 * stored, recomputed from its first entry. The API reads the chain, the head, the counters and the
 * period balances in one snapshot and passes them here; nothing here trusts a stored total.
 */

/** A posted entry with its hashes, as stored, in posting order. */
export interface StoredEntry {
  readonly entry: ChainEntry;
  readonly previousHash: string | null;
  readonly hash: string;
}

/** The ledger head as stored (`ledger_heads`). */
export interface StoredHead {
  readonly entryCount: bigint;
  readonly lastEntryId: string | null;
  readonly lastHash: string | null;
}

/** A fiscal year's counter as stored (`entry_number_counters`). */
export interface StoredCounter {
  readonly fiscalYear: number;
  readonly lastNumber: number;
}

/**
 * A period balance (`period_balances`), keyed by the period (`YYYY-MM`) and the dimension set's
 * key, as the lines carry it.
 */
export interface StoredPeriodBalance {
  readonly period: string;
  readonly accountId: string;
  readonly dimensionKey: string;
  readonly currency: CurrencyCode;
  readonly debitMinor: bigint;
  readonly creditMinor: bigint;
  readonly bookDebitMinor: bigint;
  readonly bookCreditMinor: bigint;
  readonly parallelDebitMinor: bigint | null;
  readonly parallelCreditMinor: bigint | null;
  readonly lineCount: number;
}

export interface IntegrityInput {
  readonly chain: readonly StoredEntry[];
  readonly head: StoredHead;
  readonly counters: readonly StoredCounter[];
  readonly periodBalances: readonly StoredPeriodBalance[];
}

/** Where the chain first breaks: the sequence out of order, the link back, or the content. */
export interface ChainBreakAt {
  readonly sequence: bigint;
  readonly entryId: string;
  readonly fiscalYear: number;
  readonly number: number;
  readonly reason: 'sequence' | 'previous-hash' | 'hash';
}

export interface NumberingProblem {
  readonly fiscalYear: number;
  /** The missing number (the first of a gap), the repeated one, or the counter's last number. */
  readonly number: number;
  readonly problem: 'missing' | 'duplicate' | 'counter';
}

export interface UnbalancedEntry {
  readonly entryId: string;
  readonly fiscalYear: number;
  readonly number: number;
  readonly ledger: Ledger;
  readonly residualMinor: bigint;
}

export interface PeriodBalanceProblem {
  readonly period: string;
  readonly accountId: string;
  readonly dimensionKey: string;
  readonly currency: CurrencyCode;
  readonly problem: 'different' | 'missing' | 'unexpected';
}

export interface IntegrityFindings {
  readonly entryCount: number;
  readonly lineCount: number;
  readonly firstBreak: ChainBreakAt | null;
  readonly headMatchesChain: boolean;
  readonly numbering: readonly NumberingProblem[];
  readonly unbalanced: readonly UnbalancedEntry[];
  readonly periodBalances: readonly PeriodBalanceProblem[];
}

/**
 * The first break of the chain: an entry whose sequence is not its place, whose previous hash is
 * not the stored hash before it (null for the first), or whose hash is not the hash of its content
 * (`chainEntryValue()`, `entryHash()`). Null when every link holds.
 */
export function firstChainBreak(chain: readonly StoredEntry[]): ChainBreakAt | null {
  let previous: string | null = null;
  for (const [index, link] of chain.entries()) {
    const { entry } = link;
    const at = (reason: ChainBreakAt['reason']): ChainBreakAt => ({
      sequence: entry.sequence,
      entryId: entry.id,
      fiscalYear: entry.fiscalYear,
      number: entry.number,
      reason,
    });
    if (entry.sequence !== BigInt(index + 1)) return at('sequence');
    if (link.previousHash !== previous) return at('previous-hash');
    if (entryHash(chainEntryValue(entry), link.previousHash) !== link.hash) return at('hash');
    previous = link.hash;
  }
  return null;
}

/**
 * The numbers of each fiscal year against 1, 2, 3 … (ADR 0005 invariant 6): the first number of
 * each gap, each repeated number, and a counter whose last number is not the year's highest (or a
 * year with entries and no counter, reported with 0).
 */
export function numberingProblems(
  chain: readonly StoredEntry[],
  counters: readonly StoredCounter[],
): NumberingProblem[] {
  const byYear = new Map<number, number[]>();
  for (const { entry } of chain) {
    const numbers = byYear.get(entry.fiscalYear) ?? [];
    numbers.push(entry.number);
    byYear.set(entry.fiscalYear, numbers);
  }
  const lastNumbers = new Map(counters.map((counter) => [counter.fiscalYear, counter.lastNumber]));
  const years = [...new Set([...byYear.keys(), ...lastNumbers.keys()])].sort((a, b) => a - b);
  const problems: NumberingProblem[] = [];
  for (const fiscalYear of years) {
    const numbers = (byYear.get(fiscalYear) ?? []).sort((a, b) => a - b);
    let expected = 1;
    for (const [index, number] of numbers.entries()) {
      if (index > 0 && number === numbers[index - 1]) {
        problems.push({ fiscalYear, number, problem: 'duplicate' });
        continue;
      }
      if (number > expected) problems.push({ fiscalYear, number: expected, problem: 'missing' });
      expected = number + 1;
    }
    const highest = numbers.at(-1) ?? 0;
    const counted = lastNumbers.get(fiscalYear) ?? 0;
    if (counted !== highest) problems.push({ fiscalYear, number: counted, problem: 'counter' });
  }
  return problems;
}

/**
 * Entries whose lines do not sum to zero in the book ledger, or in the parallel ledger when the
 * company keeps one (ADR 0005 invariant 1), with the residual.
 */
export function unbalancedEntries(chain: readonly StoredEntry[]): UnbalancedEntry[] {
  const found: UnbalancedEntry[] = [];
  for (const { entry } of chain) {
    let book = 0n;
    let parallel = 0n;
    let keepsParallel = false;
    for (const line of entry.lines) {
      book += line.bookMinor;
      if (line.parallelMinor !== null) {
        keepsParallel = true;
        parallel += line.parallelMinor;
      }
    }
    const of = (ledger: Ledger, residualMinor: bigint): UnbalancedEntry => ({
      entryId: entry.id,
      fiscalYear: entry.fiscalYear,
      number: entry.number,
      ledger,
      residualMinor,
    });
    if (book !== 0n) found.push(of('book', book));
    if (keepsParallel && parallel !== 0n) found.push(of('parallel', parallel));
  }
  return found;
}

type Totals = Omit<StoredPeriodBalance, 'period' | 'accountId' | 'dimensionKey' | 'currency'>;

const debit = (amount: bigint) => (amount > 0n ? amount : 0n);
const credit = (amount: bigint) => (amount < 0n ? -amount : 0n);

/**
 * The period balances recomputed from the lines (ADR 0012), as `rebuildPeriodBalances()` of
 * `packages/db` does in SQL: per period of the entry date, account, dimension set and transaction
 * currency, each amount's positive part to the debit total and its negative part to the credit
 * total; the parallel totals are null only when no line of the key has a parallel amount.
 */
export function periodTotalsOf(chain: readonly StoredEntry[]): StoredPeriodBalance[] {
  const totals = new Map<string, StoredPeriodBalance>();
  for (const { entry } of chain) {
    const period = periodOf(entry.entryDate);
    for (const line of entry.lines) {
      const key = balanceKey(period, line.accountId, line.dimensionKey, line.currency);
      const before: StoredPeriodBalance = totals.get(key) ?? {
        period,
        accountId: line.accountId,
        dimensionKey: line.dimensionKey,
        currency: line.currency,
        debitMinor: 0n,
        creditMinor: 0n,
        bookDebitMinor: 0n,
        bookCreditMinor: 0n,
        parallelDebitMinor: null,
        parallelCreditMinor: null,
        lineCount: 0,
      };
      const parallel = line.parallelMinor;
      totals.set(key, {
        ...before,
        debitMinor: before.debitMinor + debit(line.amountMinor),
        creditMinor: before.creditMinor + credit(line.amountMinor),
        bookDebitMinor: before.bookDebitMinor + debit(line.bookMinor),
        bookCreditMinor: before.bookCreditMinor + credit(line.bookMinor),
        parallelDebitMinor:
          parallel === null
            ? before.parallelDebitMinor
            : (before.parallelDebitMinor ?? 0n) + debit(parallel),
        parallelCreditMinor:
          parallel === null
            ? before.parallelCreditMinor
            : (before.parallelCreditMinor ?? 0n) + credit(parallel),
        lineCount: before.lineCount + 1,
      });
    }
  }
  return [...totals.values()];
}

function balanceKey(period: string, accountId: string, dimensionKey: string, currency: string) {
  return `${period}|${accountId}|${dimensionKey}|${currency}`;
}

const TOTAL_FIELDS = [
  'debitMinor',
  'creditMinor',
  'bookDebitMinor',
  'bookCreditMinor',
  'parallelDebitMinor',
  'parallelCreditMinor',
  'lineCount',
] as const satisfies readonly (keyof Totals)[];

/**
 * The stored period balances against the lines: a key whose totals differ, a key the lines need
 * and the table lacks (`missing`), and a stored key no line explains (`unexpected`).
 */
export function periodBalanceProblems(
  chain: readonly StoredEntry[],
  stored: readonly StoredPeriodBalance[],
): PeriodBalanceProblem[] {
  const storedByKey = new Map(
    stored.map((row) => [
      balanceKey(row.period, row.accountId, row.dimensionKey, row.currency),
      row,
    ]),
  );
  const problems: PeriodBalanceProblem[] = [];
  const problem = (row: StoredPeriodBalance, kind: PeriodBalanceProblem['problem']) =>
    problems.push({
      period: row.period,
      accountId: row.accountId,
      dimensionKey: row.dimensionKey,
      currency: row.currency,
      problem: kind,
    });
  for (const computed of periodTotalsOf(chain)) {
    const key = balanceKey(
      computed.period,
      computed.accountId,
      computed.dimensionKey,
      computed.currency,
    );
    const row = storedByKey.get(key);
    storedByKey.delete(key);
    if (row === undefined) problem(computed, 'missing');
    else if (TOTAL_FIELDS.some((field) => row[field] !== computed[field])) {
      problem(computed, 'different');
    }
  }
  for (const row of storedByKey.values()) problem(row, 'unexpected');
  return problems.sort((a, b) =>
    balanceKey(a.period, a.accountId, a.dimensionKey, a.currency) <
    balanceKey(b.period, b.accountId, b.dimensionKey, b.currency)
      ? -1
      : 1,
  );
}

/**
 * What an anchor (a stored daily anchor or one pasted from an email) finds in the chain: the entry
 * at its count must have its hash. The chain is checked from its first entry separately, so an
 * anchor that matches proves nothing up to it changed since it was taken.
 */
export function anchorResult(
  chain: readonly StoredEntry[],
  anchor: { readonly entryCount: bigint; readonly headHash: string },
): AnchorResult {
  if (anchor.entryCount < 1n) throw new RangeError('An anchor counts at least one entry');
  if (anchor.entryCount > BigInt(chain.length)) return 'missing';
  const link = chain[Number(anchor.entryCount) - 1];
  return link?.hash === anchor.headHash ? 'verified' : 'mismatch';
}

/** The whole check but the anchors: chain, head, numbers, balances, period balances. */
export function checkIntegrity(input: IntegrityInput): IntegrityFindings {
  const { chain, head } = input;
  const last = chain.at(-1);
  return {
    entryCount: chain.length,
    lineCount: chain.reduce((count, { entry }) => count + entry.lines.length, 0),
    firstBreak: firstChainBreak(chain),
    headMatchesChain:
      head.entryCount === BigInt(chain.length) &&
      head.lastEntryId === (last?.entry.id ?? null) &&
      head.lastHash === (last?.hash ?? null),
    numbering: numberingProblems(chain, input.counters),
    unbalanced: unbalancedEntries(chain),
    periodBalances: periodBalanceProblems(chain, input.periodBalances),
  };
}
