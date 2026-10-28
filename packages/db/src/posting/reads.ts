import type { CurrencyCode, Ledger, RateSource, RateType } from '@vertex-mizan/contracts';
import type {
  ChainConversion,
  ChainEntry,
  ChainLine,
  EntrySource,
  StoredCounter,
  StoredHead,
  StoredPeriodBalance,
} from '@vertex-mizan/ledger';
import { asc, eq, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { companySettings } from '../schema/companies.js';
import {
  dimensionSets,
  entryNumberCounters,
  journalEntries,
  journalLines,
  ledgerHeads,
  lineConversions,
  periodBalances,
  periods,
} from '../schema/ledger.js';
import { chainAnchors } from '../schema/trust.js';

// Reads of the ledger as stored, in the caller's company context: the chain as the integrity
// check verifies it, and the period balances rebuilt from the lines (ADR 0008, ADR 0012).

/** A stored entry of the chain with its hashes. */
export interface StoredChainLink {
  readonly entry: ChainEntry;
  readonly previousHash: string | null;
  readonly hash: string;
}

/**
 * The company's chain in posting order (`sequence`), each entry with its lines, conversions and
 * dimension keys as stored, typed as `chainEntryValue()` hashes them.
 */
export async function readChain(tx: Transaction): Promise<StoredChainLink[]> {
  const entries = await tx.select().from(journalEntries).orderBy(asc(journalEntries.sequence));
  const lines = await tx
    .select({ line: journalLines, key: dimensionSets.key })
    .from(journalLines)
    .innerJoin(
      dimensionSets,
      sql`${dimensionSets.companyId} = ${journalLines.companyId} and ${dimensionSets.id} = ${journalLines.dimensionSetId}`,
    )
    .orderBy(asc(journalLines.entryId), asc(journalLines.lineNo));
  const conversions = await tx.select().from(lineConversions);
  const conversionsByLine = new Map<string, ChainConversion[]>();
  for (const row of conversions) {
    const list = conversionsByLine.get(row.lineId) ?? [];
    list.push({
      ledger: row.ledger as Ledger,
      basis: row.basis as ChainConversion['basis'],
      quoteNo: row.quoteNo,
      rateId: row.rateId,
      base: row.base as CurrencyCode,
      quote: row.quote as CurrencyCode,
      rate: row.rate,
      rateType: row.rateType as RateType,
      rateSource: row.rateSource as RateSource,
      effectiveOn: row.effectiveOn,
    });
    conversionsByLine.set(row.lineId, list);
  }
  const linesByEntry = new Map<string, ChainLine[]>();
  for (const { line, key } of lines) {
    const list = linesByEntry.get(line.entryId) ?? [];
    list.push({
      lineNo: line.lineNo,
      accountId: line.accountId,
      dimensionKey: key,
      kind: line.kind as ChainLine['kind'],
      ledger: line.ledger as Ledger | null,
      currency: line.currency as CurrencyCode,
      amountMinor: line.amountMinor,
      bookMinor: line.bookMinor,
      parallelMinor: line.parallelMinor,
      memo: line.memo,
      conversions: conversionsByLine.get(line.id) ?? [],
    });
    linesByEntry.set(line.entryId, list);
  }
  return entries.map((row) => ({
    entry: {
      id: row.id,
      companyId: row.companyId,
      requestId: row.requestId,
      sequence: row.sequence,
      fiscalYear: row.fiscalYear,
      number: row.number,
      entryDate: row.entryDate,
      postedAt: row.postedAt.toISOString(),
      source: row.source as EntrySource,
      sourceRef: row.sourceRef,
      hubDocument: (row.hubDocument ?? null) as ChainEntry['hubDocument'],
      description: row.description,
      reference: row.reference,
      reversesEntryId: row.reversesEntryId,
      draftId: row.draftId,
      preparedByUserId: row.preparedByUserId,
      approvedByUserId: row.approvedByUserId,
      postedByUserId: row.postedByUserId,
      postedByClientId: row.postedByClientId,
      lines: linesByEntry.get(row.id) ?? [],
    },
    previousHash: row.previousHash,
    hash: row.hash,
  }));
}

/** A period's totals for an account, dimension set and currency (ADR 0008). */
export interface PeriodTotals {
  readonly periodId: string;
  readonly accountId: string;
  readonly dimensionSetId: string;
  readonly currency: string;
  readonly debitMinor: bigint;
  readonly creditMinor: bigint;
  readonly bookDebitMinor: bigint;
  readonly bookCreditMinor: bigint;
  readonly parallelDebitMinor: bigint | null;
  readonly parallelCreditMinor: bigint | null;
  readonly lineCount: number;
}

const byKey = (a: PeriodTotals, b: PeriodTotals) =>
  `${a.periodId}|${a.accountId}|${a.dimensionSetId}|${a.currency}` <
  `${b.periodId}|${b.accountId}|${b.dimensionSetId}|${b.currency}`
    ? -1
    : 1;

const minor = (value: string | null) => (value === null ? null : BigInt(value));

/**
 * The period balances recomputed from the lines, a read-only query (ADR 0012): each line adds a
 * debit to the debit total and a credit to the credit total of its entry's period, by the sign of
 * each amount separately. The integrity check and a property test compare them with the table.
 */
export async function rebuildPeriodBalances(tx: Transaction): Promise<PeriodTotals[]> {
  const result = await tx.execute<{
    period_id: string;
    account_id: string;
    dimension_set_id: string;
    currency: string;
    debit_minor: string;
    credit_minor: string;
    book_debit_minor: string;
    book_credit_minor: string;
    parallel_debit_minor: string | null;
    parallel_credit_minor: string | null;
    line_count: string;
  }>(sql`
    select p.id as period_id, l.account_id, l.dimension_set_id, l.currency,
           sum(greatest(l.amount_minor, 0))::text as debit_minor,
           sum(greatest(-l.amount_minor, 0))::text as credit_minor,
           sum(greatest(l.book_minor, 0))::text as book_debit_minor,
           sum(greatest(-l.book_minor, 0))::text as book_credit_minor,
           sum(case when l.parallel_minor is null then null
                    else greatest(l.parallel_minor, 0) end)::text as parallel_debit_minor,
           sum(case when l.parallel_minor is null then null
                    else greatest(-l.parallel_minor, 0) end)::text as parallel_credit_minor,
           count(*)::text as line_count
    from ${journalLines} l
    join ${journalEntries} e on e.company_id = l.company_id and e.id = l.entry_id
    join ${periods} p on p.company_id = e.company_id and p.period = to_char(e.entry_date, 'YYYY-MM')
    group by p.id, l.account_id, l.dimension_set_id, l.currency`);
  return result.rows
    .map((row) => ({
      periodId: row.period_id,
      accountId: row.account_id,
      dimensionSetId: row.dimension_set_id,
      currency: row.currency,
      debitMinor: BigInt(row.debit_minor),
      creditMinor: BigInt(row.credit_minor),
      bookDebitMinor: BigInt(row.book_debit_minor),
      bookCreditMinor: BigInt(row.book_credit_minor),
      parallelDebitMinor: minor(row.parallel_debit_minor),
      parallelCreditMinor: minor(row.parallel_credit_minor),
      lineCount: Number(row.line_count),
    }))
    .sort(byKey);
}

/** The period balances as the table holds them, in the order of `rebuildPeriodBalances()`. */
export async function readPeriodBalances(tx: Transaction): Promise<PeriodTotals[]> {
  const rows = await tx.select().from(periodBalances);
  return rows
    .map((row) => ({
      periodId: row.periodId,
      accountId: row.accountId,
      dimensionSetId: row.dimensionSetId,
      currency: row.currency,
      debitMinor: row.debitMinor,
      creditMinor: row.creditMinor,
      bookDebitMinor: row.bookDebitMinor,
      bookCreditMinor: row.bookCreditMinor,
      parallelDebitMinor: row.parallelDebitMinor,
      parallelCreditMinor: row.parallelCreditMinor,
      lineCount: row.lineCount,
    }))
    .sort(byKey);
}

/** A posted entry, as a list names it. */
export interface EntryRef {
  readonly id: string;
  readonly sequence: bigint;
  readonly fiscalYear: number;
  readonly number: number;
  readonly entryDate: string;
}

/**
 * The entries whose conversions used a rate row (S02 rule 15), in posting order: what a correction
 * of that row lists for the accountant to judge. A reversal carries amounts, so it never appears.
 */
export async function entriesUsingRate(tx: Transaction, rateId: string): Promise<EntryRef[]> {
  return tx
    .selectDistinct({
      id: journalEntries.id,
      sequence: journalEntries.sequence,
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
      entryDate: journalEntries.entryDate,
    })
    .from(lineConversions)
    .innerJoin(
      journalLines,
      sql`${journalLines.companyId} = ${lineConversions.companyId} and ${journalLines.id} = ${lineConversions.lineId}`,
    )
    .innerJoin(
      journalEntries,
      sql`${journalEntries.companyId} = ${journalLines.companyId} and ${journalEntries.id} = ${journalLines.entryId}`,
    )
    .where(eq(lineConversions.rateId, rateId))
    .orderBy(asc(journalEntries.sequence));
}

/** A daily anchor as stored (`chain_anchors`). */
export interface StoredAnchor {
  readonly anchoredOn: string;
  readonly entryCount: bigint;
  readonly headEntryId: string;
  readonly headHash: string;
}

/** What the integrity check compares with the chain, read in the caller's snapshot. */
export interface LedgerState {
  /** Whether the company keeps a parallel ledger, from its settings. */
  readonly keepsParallel: boolean;
  readonly head: StoredHead;
  readonly counters: StoredCounter[];
  /** Keyed by period and dimension key, as the lines carry them, with the set's id. */
  readonly periodBalances: (StoredPeriodBalance & { readonly dimensionSetId: string })[];
  /** Every dimension set's id by its key. */
  readonly dimensionSetIds: ReadonlyMap<string, string>;
  /** The daily anchors, oldest first. */
  readonly anchors: StoredAnchor[];
}

/**
 * The ledger state as stored (ADR 0012) and the company's anchors, for the integrity check (S03
 * rule 19): which ledgers the company keeps, the head, the counters, the period balances and the
 * anchors.
 */
export async function readLedgerState(tx: Transaction): Promise<LedgerState> {
  const [settings] = await tx
    .select({ parallelCurrency: companySettings.parallelCurrency })
    .from(companySettings);
  const [head] = await tx.select().from(ledgerHeads);
  const counters = await tx
    .select({
      fiscalYear: entryNumberCounters.fiscalYear,
      lastNumber: entryNumberCounters.lastNumber,
    })
    .from(entryNumberCounters);
  const sets = await tx
    .select({ id: dimensionSets.id, key: dimensionSets.key })
    .from(dimensionSets);
  const balances = await tx
    .select({ balance: periodBalances, period: periods.period })
    .from(periodBalances)
    .innerJoin(
      periods,
      sql`${periods.companyId} = ${periodBalances.companyId} and ${periods.id} = ${periodBalances.periodId}`,
    );
  const keys = new Map(sets.map((set) => [set.id, set.key]));
  const anchors = await tx
    .select({
      anchoredOn: chainAnchors.anchoredOn,
      entryCount: chainAnchors.entryCount,
      headEntryId: chainAnchors.headEntryId,
      headHash: chainAnchors.headHash,
    })
    .from(chainAnchors)
    .orderBy(asc(chainAnchors.anchoredOn));
  return {
    keepsParallel: (settings?.parallelCurrency ?? null) !== null,
    head: {
      entryCount: head?.entryCount ?? 0n,
      lastEntryId: head?.lastEntryId ?? null,
      lastHash: head?.lastHash ?? null,
    },
    counters,
    periodBalances: balances.map(({ balance, period }) => ({
      period,
      accountId: balance.accountId,
      dimensionSetId: balance.dimensionSetId,
      // A set the table names always exists (a composite key); its id is never a key.
      dimensionKey: keys.get(balance.dimensionSetId) ?? balance.dimensionSetId,
      currency: balance.currency as CurrencyCode,
      debitMinor: balance.debitMinor,
      creditMinor: balance.creditMinor,
      bookDebitMinor: balance.bookDebitMinor,
      bookCreditMinor: balance.bookCreditMinor,
      parallelDebitMinor: balance.parallelDebitMinor,
      parallelCreditMinor: balance.parallelCreditMinor,
      lineCount: balance.lineCount,
    })),
    dimensionSetIds: new Map(sets.map((set) => [set.key, set.id])),
    anchors,
  };
}
