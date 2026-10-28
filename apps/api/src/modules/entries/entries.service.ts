import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountLine,
  AccountLinesPage,
  AccountLinesQuery,
  Attachment,
  AttachmentContentType,
  CurrencyCode,
  DealtRate,
  Draft,
  Entry,
  EntryPage,
  EntryQuery,
  Ledger,
  LineKind,
  MoneyAmount,
  PageQuery,
  ReversalResult,
  ReverseEntry,
} from '@vertex-mizan/contracts';
import {
  chartAccounts,
  type Database,
  dimensionSetValues,
  entryAttachments,
  exchangeRates,
  journalEntries,
  journalLines,
  lineConversions,
  onUniqueViolation,
  post,
  previewPosting,
  rateText,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, type SQL, sql } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { todayInDamascus } from '../../core/clock/today.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { FileStore } from '../../core/files/file-store.js';
import type { UploadedAttachment } from '../../core/files/upload.js';
import { decodeCursor, pageOf } from '../../core/http/cursor.js';
import { insertDraft, readDraft } from '../drafts/draft-shape.js';
import { storeAttachment } from '../drafts/drafts.service.js';
import { approvalIsOn } from '../drafts/posting.js';
import {
  entryRow,
  ledgerCurrencies,
  readEntry,
  setValuesOf,
  summaryColumns,
  summaryOf,
} from './entry-shape.js';

const PAGE_SIZE = 100;
const LINES_PAGE_SIZE = 200;

/** A file to answer with: its bytes, type and the name it is downloaded as. */
export interface AttachmentFile {
  readonly body: Buffer;
  readonly contentType: AttachmentContentType;
  readonly fileName: string;
}

/** `%`, `_` and `\` taken literally in an `ilike` pattern. */
const literal = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

/**
 * Posted entries (S03 rules 9–10, 17, "Screens"): the journal, an entry with its lines, the
 * accountant's reversal and copy, the files added after posting, an account's lines with running
 * balances, and the entries that used a rate row (S02 rule 15). Reversals post through `post()`
 * only; reads run inside the company context.
 */
@Injectable()
export class EntriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
  ) {}

  /** `GET /api/entries`: the journal by entry date, newest first. */
  async list(access: CompanyRouteAccess, query: EntryQuery): Promise<EntryPage> {
    return withCompany(this.db, access.company.id, (tx) =>
      this.page(
        tx,
        [
          query.from ? gte(journalEntries.entryDate, query.from) : undefined,
          query.to ? lte(journalEntries.entryDate, query.to) : undefined,
          query.fiscalYear ? eq(journalEntries.fiscalYear, query.fiscalYear) : undefined,
          query.number ? eq(journalEntries.number, query.number) : undefined,
          query.source ? eq(journalEntries.source, query.source) : undefined,
          query.account
            ? sql`exists (select 1 from ${journalLines} l
              where l.company_id = journal_entries.company_id and l.entry_id = journal_entries.id
                and l.account_id = ${query.account})`
            : undefined,
          query.text
            ? or(
                ilike(journalEntries.description, `%${literal(query.text)}%`),
                ilike(journalEntries.reference, `%${literal(query.text)}%`),
              )
            : undefined,
        ],
        query.cursor,
      ),
    );
  }

  /** `GET /api/entries/:id`. */
  async get(access: CompanyRouteAccess, id: string): Promise<Entry> {
    return withCompany(this.db, access.company.id, (tx) => readEntry(tx, id));
  }

  /**
   * `POST /api/entries/:id/reverse` (rule 9): with approval off, the reversal posts now
   * (`entries.post`); with it on, it becomes a draft waiting for submission. Either way the
   * posting function's own checks decide first: a manual entry, not a reversal, reversed once, on
   * or after its date and within rule 6, into an open period.
   */
  async reverse(
    access: CompanyRouteAccess,
    id: string,
    input: ReverseEntry,
  ): Promise<ReversalResult> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      await entryRow(tx, id);
      const actor = actorOf(access);
      const today = todayInDamascus();
      if (await approvalIsOn(tx)) {
        await previewPosting(tx, {
          entryDate: input.date,
          content: { kind: 'reversal', entryId: id, today },
        });
        const draftId = await onUniqueViolation(
          () =>
            insertDraft(
              tx,
              companyId,
              actor,
              {
                entryDate: input.date,
                description: input.description,
                reference: null,
                dealtRates: [],
                lines: [],
              },
              { reversesEntryId: id },
            ),
          { entry_drafts_open_reversal_key: 'ENTRY_ALREADY_REVERSED' },
        );
        return { entry: null, draft: await readDraft(tx, draftId) };
      }
      if (!access.company.permissions.includes('entries.post')) {
        throw new CodedException('FORBIDDEN', 'Reversing needs entries.post');
      }
      const reversal = await post(tx, {
        client: 'manual',
        idempotencyKey: `reversal:${id}`,
        entryDate: input.date,
        description: input.description,
        reference: null,
        draftId: null,
        preparedByUserId: actor.userId,
        approvedByUserId: null,
        actor,
        content: { kind: 'reversal', entryId: id, today },
      });
      return { entry: await readEntry(tx, reversal.id), draft: null };
    });
  }

  /**
   * `POST /api/entries/:id/copy` (rule 10): a new draft dated today with the entry's typed lines
   * (account, dimensions, currency, transaction amount, memo) and dealt rates, its description and
   * reference; its rounding and difference lines are measured again at posting, so not copied.
   */
  async copy(access: CompanyRouteAccess, id: string): Promise<Draft> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const entry = await entryRow(tx, id);
      const lines = await tx
        .select()
        .from(journalLines)
        .where(
          and(eq(journalLines.entryId, id), inArray(journalLines.kind, ['measured', 'carried'])),
        )
        .orderBy(asc(journalLines.lineNo));
      const sets = await setValuesOf(
        tx,
        lines.map((line) => line.dimensionSetId),
      );
      const dealt =
        lines.length === 0
          ? []
          : await tx
              .selectDistinct({
                base: lineConversions.base,
                quote: lineConversions.quote,
                rate: lineConversions.rate,
              })
              .from(lineConversions)
              .where(
                and(
                  inArray(
                    lineConversions.lineId,
                    lines.map((line) => line.id),
                  ),
                  eq(lineConversions.basis, 'transaction'),
                ),
              );
      const draftId = await insertDraft(
        tx,
        companyId,
        actorOf(access),
        {
          entryDate: todayInDamascus(),
          description: entry.description,
          reference: entry.reference,
          dealtRates: dealt.map(
            (rate): DealtRate => ({
              base: rate.base as CurrencyCode,
              quote: rate.quote as CurrencyCode,
              rate: rateText(rate.rate),
            }),
          ),
          lines: lines.map((line) => ({
            accountId: line.accountId,
            dimensionValueIds: sets.get(line.dimensionSetId) ?? [],
            currency: line.currency as CurrencyCode,
            amountMinor: line.amountMinor.toString(),
            memo: line.memo,
          })),
        },
        { copiedFromEntryId: id },
      );
      return readDraft(tx, draftId);
    });
  }

  /**
   * `POST /api/entries/:id/attachments` (rule 17): a file added to a posted entry, never removed.
   * The entry's files are counted under a transaction lock of the entry, since its row is never
   * updated (append-only).
   */
  async attach(
    access: CompanyRouteAccess,
    id: string,
    upload: UploadedAttachment | undefined,
  ): Promise<Attachment> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      await entryRow(tx, id);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`attachments:${id}`}, 0))`,
      );
      return storeAttachment(tx, this.files, companyId, actorOf(access), { entryId: id }, upload);
    });
  }

  /**
   * `GET /api/attachments/:id`: a posted entry's file to anyone with `entries.read`, a draft's to
   * `drafts.read` only; read from its storage key, never from a path given.
   */
  async download(access: CompanyRouteAccess, id: string): Promise<AttachmentFile> {
    const companyId = access.company.id;
    const row = await withCompany(this.db, companyId, async (tx) => {
      const [found] = await tx.select().from(entryAttachments).where(eq(entryAttachments.id, id));
      return found;
    });
    if (!row) throw new CodedException('NOT_FOUND', 'No such attachment');
    if (row.entryId === null && !access.company.permissions.includes('drafts.read')) {
      throw new CodedException('FORBIDDEN', 'A draft’s file needs drafts.read');
    }
    return {
      body: await this.files.read(companyId, row.id),
      contentType: row.contentType as AttachmentContentType,
      fileName: row.fileName,
    };
  }

  /**
   * `GET /api/accounts/:id/lines`: an account's lines in a date range, oldest first, filtered by
   * dimension values and currency, with the balance before the range and a running balance per
   * ledger (and in the transaction currency when one currency is asked). The sums run in the
   * database, in `bigint`.
   */
  async accountLines(
    access: CompanyRouteAccess,
    id: string,
    query: AccountLinesQuery,
  ): Promise<AccountLinesPage> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const [account] = await tx
        .select({ id: chartAccounts.id })
        .from(chartAccounts)
        .where(eq(chartAccounts.id, id));
      if (!account) throw new CodedException('NOT_FOUND', 'No such account');
      const currencies = await ledgerCurrencies(tx);
      const filters = sql.join(
        [
          sql`l.account_id = ${id}`,
          query.currency ? sql`l.currency = ${query.currency}` : sql`true`,
          ...query.dims.map(
            (valueId) => sql`exists (select 1 from ${dimensionSetValues} v
              where v.company_id = l.company_id and v.set_id = l.dimension_set_id
                and v.value_id = ${valueId})`,
          ),
        ],
        sql` and `,
      );
      const [opening] = (
        await tx.execute<{ amount: string; book: string; parallel: string | null }>(sql`
          select coalesce(sum(l.amount_minor), 0)::text as amount,
            coalesce(sum(l.book_minor), 0)::text as book,
            sum(l.parallel_minor)::text as parallel
          from ${journalLines} l
          join ${journalEntries} e on e.company_id = l.company_id and e.id = l.entry_id
          where ${filters} and ${query.from ? sql`e.entry_date < ${query.from}` : sql`false`}`)
      ).rows;
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = (
        await tx.execute<{
          id: string;
          entry_id: string;
          fiscal_year: number;
          number: number;
          entry_date: string;
          description: string;
          line_no: number;
          dimension_set_id: string;
          kind: string;
          ledger: string | null;
          currency: string;
          amount_minor: string;
          book_minor: string;
          parallel_minor: string | null;
          memo: string | null;
          amount_run: string;
          book_run: string;
          parallel_run: string | null;
          position: string;
        }>(sql`
          with ranged as (
            select l.id, l.entry_id, e.fiscal_year, e.number, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date,
              e.description, l.line_no, l.dimension_set_id, l.kind, l.ledger, l.currency,
              l.amount_minor::text, l.book_minor::text, l.parallel_minor::text, l.memo,
              e.entry_date as sort_date, e.sequence as sort_sequence,
              (${opening?.amount ?? '0'}::bigint + sum(l.amount_minor) over running)::text as amount_run,
              (${opening?.book ?? '0'}::bigint + sum(l.book_minor) over running)::text as book_run,
              (coalesce(${opening?.parallel ?? null}::bigint, 0)
                + sum(l.parallel_minor) over running)::text as parallel_run,
              row_number() over running as position
            from ${journalLines} l
            join ${journalEntries} e on e.company_id = l.company_id and e.id = l.entry_id
            where ${filters}
              and ${query.from ? sql`e.entry_date >= ${query.from}` : sql`true`}
              and ${query.to ? sql`e.entry_date <= ${query.to}` : sql`true`}
            window running as (order by e.entry_date, e.sequence, l.line_no
              rows between unbounded preceding and current row)
          )
          select * from ranged
          where ${cursor ? sql`position > (select r.position from ranged r where r.id = ${cursor.id})` : sql`true`}
          order by position
          limit ${LINES_PAGE_SIZE + 1}`)
      ).rows;
      const sets = await setValuesOf(
        tx,
        rows.map((row) => row.dimension_set_id),
      );
      const money = (amountMinor: string, currency: CurrencyCode): MoneyAmount => ({
        amountMinor,
        currency,
      });
      const transaction = (amount: string) =>
        query.currency ? money(amount, query.currency) : null;
      const parallel = (amount: string | null) =>
        currencies.parallel === null ? null : money(amount ?? '0', currencies.parallel);
      const page = pageOf(
        rows.map((row) => ({ ...row, createdAt: new Date(0) })),
        LINES_PAGE_SIZE,
        (row): AccountLine => ({
          entryId: row.entry_id,
          fiscalYear: row.fiscal_year,
          number: row.number,
          entryDate: row.entry_date,
          description: row.description,
          lineNo: row.line_no,
          dimensionValueIds: sets.get(row.dimension_set_id) ?? [],
          kind: row.kind as LineKind,
          ledger: row.ledger as Ledger | null,
          currency: row.currency as CurrencyCode,
          amountMinor: row.amount_minor,
          bookMinor: row.book_minor,
          parallelMinor: row.parallel_minor,
          memo: row.memo,
          balance: {
            transaction: transaction(row.amount_run),
            book: money(row.book_run, currencies.book),
            parallel: parallel(row.parallel_run),
          },
        }),
      );
      return {
        accountId: id,
        opening: {
          transaction: transaction(opening?.amount ?? '0'),
          book: money(opening?.book ?? '0', currencies.book),
          parallel: parallel(opening?.parallel ?? null),
        },
        lines: page.entries,
        nextCursor: page.nextCursor,
      };
    });
  }

  /** `GET /api/rates/:id/entries` (S02 rule 15): the entries whose conversions used the row. */
  async rateEntries(access: CompanyRouteAccess, id: string, query: PageQuery): Promise<EntryPage> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const [rate] = await tx
        .select({ id: exchangeRates.id })
        .from(exchangeRates)
        .where(eq(exchangeRates.id, id));
      if (!rate) throw new CodedException('NOT_FOUND', 'No such rate row');
      return this.page(
        tx,
        [
          sql`exists (select 1 from ${lineConversions} c
            join ${journalLines} l on l.company_id = c.company_id and l.id = c.line_id
            where l.company_id = journal_entries.company_id and l.entry_id = journal_entries.id
              and c.rate_id = ${id})`,
        ],
        query.cursor,
      );
    });
  }

  /** A page of journal rows matching `filters`, by entry date then posting order, newest first. */
  private async page(
    tx: Transaction,
    filters: (SQL | undefined)[],
    cursorText: string | undefined,
  ): Promise<EntryPage> {
    const cursor = cursorText ? decodeCursor(cursorText) : null;
    const rows = await tx
      .select(summaryColumns)
      .from(journalEntries)
      .where(
        and(
          ...filters,
          cursor
            ? sql`(${journalEntries.entryDate}, ${journalEntries.sequence}) <
                (select c.entry_date, c.sequence from ${journalEntries} c where c.id = ${cursor.id})`
            : undefined,
        ),
      )
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.sequence))
      .limit(PAGE_SIZE + 1);
    const currencies = await ledgerCurrencies(tx);
    const page = pageOf(
      rows.map((row) => ({ ...row, createdAt: row.postedAt })),
      PAGE_SIZE,
      (row) => summaryOf(row, currencies),
    );
    return { entries: page.entries, nextCursor: page.nextCursor };
  }
}
