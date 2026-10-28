import type { CurrencyCode, Ledger, RateSource, RateType } from '@vertex-mizan/contracts';
import type { ChainConversion, ChainEntry, ChainLine, EntrySource } from '@vertex-mizan/ledger';
import { asc, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import {
  dimensionSets,
  journalEntries,
  journalLines,
  lineConversions,
  periodBalances,
  periods,
} from '../schema/ledger.js';

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
