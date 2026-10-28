import type {
  Attachment,
  AttachmentContentType,
  CurrencyCode,
  Entry,
  EntryLine,
  EntrySource,
  EntrySummary,
  Ledger,
  LineConversion,
  LineKind,
  PersonRef,
  RateSource,
  RateType,
} from '@vertex-mizan/contracts';
import {
  chartAccounts,
  companySettings,
  dimensionSetValues,
  entryAttachments,
  journalEntries,
  journalLines,
  ledgersOf,
  lineConversions,
  rateText,
  type Transaction,
  users,
} from '@vertex-mizan/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { CodedException } from '../../core/errors/coded-exception.js';

type EntryRow = typeof journalEntries.$inferSelect;
type AttachmentRow = typeof entryAttachments.$inferSelect;
type ConversionRow = typeof lineConversions.$inferSelect;

/** The people of `ids` as the API names them; an id without a person keeps its id as the name. */
export async function peopleOf(
  tx: Transaction,
  ids: readonly (string | null)[],
): Promise<Map<string, PersonRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((row) => [row.id, row]));
}

export const personOf = (people: ReadonlyMap<string, PersonRef>, id: string): PersonRef =>
  people.get(id) ?? { id, name: id };

const personOrNull = (people: ReadonlyMap<string, PersonRef>, id: string | null) =>
  id === null ? null : personOf(people, id);

/** An attachment as the API answers it. */
export function attachmentOf(
  row: AttachmentRow,
  people: ReadonlyMap<string, PersonRef>,
): Attachment {
  return {
    id: row.id,
    draftId: row.draftId,
    entryId: row.entryId,
    fileName: row.fileName,
    contentType: row.contentType as AttachmentContentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    uploadedBy: personOf(people, row.uploadedByUserId),
    createdAt: row.createdAt.toISOString(),
  };
}

/** A conversion as stored or previewed, as the API answers it: the rate as the rate table shows it. */
export function conversionOf(
  row: Omit<ConversionRow, 'id' | 'companyId' | 'lineId' | 'createdAt'>,
): LineConversion {
  return {
    ledger: row.ledger as Ledger,
    basis: row.basis as LineConversion['basis'],
    quoteNo: row.quoteNo,
    rateId: row.rateId,
    base: row.base as CurrencyCode,
    quote: row.quote as CurrencyCode,
    rate: rateText(row.rate),
    rateType: row.rateType as RateType,
    rateSource: row.rateSource as RateSource,
    effectiveOn: row.effectiveOn,
  };
}

/** The code and name of each account of `ids`. */
export async function accountNames(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, { code: string; name: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: chartAccounts.id, code: chartAccounts.code, name: chartAccounts.name })
    .from(chartAccounts)
    .where(inArray(chartAccounts.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row]));
}

/** The values of each dimension set of `ids`, by set. */
export async function setValuesOf(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ setId: dimensionSetValues.setId, valueId: dimensionSetValues.valueId })
    .from(dimensionSetValues)
    .where(inArray(dimensionSetValues.setId, [...new Set(ids)]))
    .orderBy(asc(dimensionSetValues.typeId));
  const sets = new Map<string, string[]>();
  for (const row of rows) sets.set(row.setId, [...(sets.get(row.setId) ?? []), row.valueId]);
  return sets;
}

/** The company's ledger currencies, which every amount of an entry is in or measured into. */
export async function ledgerCurrencies(
  tx: Transaction,
): Promise<{ book: CurrencyCode; parallel: CurrencyCode | null }> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const ledgers = ledgersOf(settings);
  return { book: ledgers.book.currency, parallel: ledgers.parallel?.currency ?? null };
}

/** An entry row of the company, or `NOT_FOUND` (another company's id answers the same). */
export async function entryRow(tx: Transaction, id: string): Promise<EntryRow> {
  const [row] = await tx.select().from(journalEntries).where(eq(journalEntries.id, id));
  if (!row) throw new CodedException('NOT_FOUND', 'No such entry');
  return row;
}

/**
 * A posted entry with its lines (dimensions, conversions and their rate rows), its unarchived
 * attachments, its reversal links both ways, the people who prepared, approved and posted it,
 * and its place in the chain (`GET /api/entries/:id`).
 */
export async function readEntry(tx: Transaction, id: string): Promise<Entry> {
  const row = await entryRow(tx, id);
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, id))
    .orderBy(asc(journalLines.lineNo));
  const conversions =
    lines.length === 0
      ? []
      : await tx
          .select()
          .from(lineConversions)
          .where(
            inArray(
              lineConversions.lineId,
              lines.map((line) => line.id),
            ),
          )
          .orderBy(asc(lineConversions.ledger), asc(lineConversions.quoteNo));
  const accounts = await accountNames(
    tx,
    lines.map((line) => line.accountId),
  );
  const sets = await setValuesOf(
    tx,
    lines.map((line) => line.dimensionSetId),
  );
  const attachments = await tx
    .select()
    .from(entryAttachments)
    .where(and(eq(entryAttachments.entryId, id), isNull(entryAttachments.archivedAt)))
    .orderBy(asc(entryAttachments.createdAt));
  const linked = await tx
    .select({
      id: journalEntries.id,
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
      reversesEntryId: journalEntries.reversesEntryId,
    })
    .from(journalEntries)
    .where(
      sql`${journalEntries.id} = ${row.reversesEntryId} or ${journalEntries.reversesEntryId} = ${id}`,
    );
  const link = (entry: (typeof linked)[number] | undefined) =>
    entry ? { id: entry.id, fiscalYear: entry.fiscalYear, number: entry.number } : null;
  const people = await peopleOf(tx, [
    row.preparedByUserId,
    row.approvedByUserId,
    row.postedByUserId,
    ...attachments.map((attachment) => attachment.uploadedByUserId),
  ]);
  const currencies = await ledgerCurrencies(tx);
  return {
    id: row.id,
    fiscalYear: row.fiscalYear,
    number: row.number,
    sequence: row.sequence.toString(),
    entryDate: row.entryDate,
    postedAt: row.postedAt.toISOString(),
    source: row.source as EntrySource,
    sourceRef: row.sourceRef,
    description: row.description,
    reference: row.reference,
    reverses: link(linked.find((entry) => entry.id === row.reversesEntryId)),
    reversedBy: link(linked.find((entry) => entry.reversesEntryId === id)),
    draftId: row.draftId,
    preparedBy: personOrNull(people, row.preparedByUserId),
    approvedBy: personOrNull(people, row.approvedByUserId),
    postedBy: personOrNull(people, row.postedByUserId),
    bookCurrency: currencies.book,
    parallelCurrency: currencies.parallel,
    lines: lines.map(
      (line): EntryLine => ({
        lineNo: line.lineNo,
        accountId: line.accountId,
        accountCode: accounts.get(line.accountId)?.code ?? '',
        accountName: accounts.get(line.accountId)?.name ?? '',
        dimensionValueIds: sets.get(line.dimensionSetId) ?? [],
        kind: line.kind as LineKind,
        ledger: line.ledger as Ledger | null,
        currency: line.currency as CurrencyCode,
        amountMinor: line.amountMinor.toString(),
        bookMinor: line.bookMinor.toString(),
        parallelMinor: line.parallelMinor?.toString() ?? null,
        memo: line.memo,
        conversions: conversions
          .filter((conversion) => conversion.lineId === line.id)
          .map(conversionOf),
      }),
    ),
    attachments: attachments.map((attachment) => attachmentOf(attachment, people)),
    previousHash: row.previousHash,
    hash: row.hash,
  };
}

/** The columns of a journal row: an entry with its debit totals and reversal links. */
export const summaryColumns = {
  id: journalEntries.id,
  fiscalYear: journalEntries.fiscalYear,
  number: journalEntries.number,
  sequence: journalEntries.sequence,
  entryDate: journalEntries.entryDate,
  postedAt: journalEntries.postedAt,
  source: journalEntries.source,
  description: journalEntries.description,
  reference: journalEntries.reference,
  reversesEntryId: journalEntries.reversesEntryId,
  // Debits are the positive amounts of each ledger, summed in the database (ADR 0007: no float).
  bookDebit: sql<string>`(select coalesce(sum(l.book_minor), 0)::text from ${journalLines} l
    where l.company_id = journal_entries.company_id and l.entry_id = journal_entries.id
      and l.book_minor > 0)`,
  parallelDebit: sql<string>`(select coalesce(sum(l.parallel_minor), 0)::text from ${journalLines} l
    where l.company_id = journal_entries.company_id and l.entry_id = journal_entries.id
      and l.parallel_minor > 0)`,
  reversedByEntryId: sql<string | null>`(select r.id from ${journalEntries} r
    where r.company_id = journal_entries.company_id and r.reverses_entry_id = journal_entries.id)`,
};

/** A row read with `summaryColumns`. */
export interface SummaryRow {
  id: string;
  fiscalYear: number;
  number: number;
  sequence: bigint;
  entryDate: string;
  postedAt: Date;
  source: string;
  description: string;
  reference: string | null;
  reversesEntryId: string | null;
  bookDebit: string;
  parallelDebit: string;
  reversedByEntryId: string | null;
}

/** A journal row as the API answers it, with each total in its ledger's currency. */
export function summaryOf(
  row: SummaryRow,
  currencies: { book: CurrencyCode; parallel: CurrencyCode | null },
): EntrySummary {
  return {
    id: row.id,
    fiscalYear: row.fiscalYear,
    number: row.number,
    entryDate: row.entryDate,
    postedAt: row.postedAt.toISOString(),
    source: row.source as EntrySource,
    description: row.description,
    reference: row.reference,
    bookDebit: { amountMinor: row.bookDebit, currency: currencies.book },
    parallelDebit:
      currencies.parallel === null
        ? null
        : { amountMinor: row.parallelDebit, currency: currencies.parallel },
    reversesEntryId: row.reversesEntryId,
    reversedByEntryId: row.reversedByEntryId,
  };
}
