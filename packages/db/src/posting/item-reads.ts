import type {
  CurrencyCode,
  ItemKind,
  ItemSource,
  Ledger,
  MovementKind,
} from '@vertex-mizan/contracts';
import { money } from '@vertex-mizan/contracts';
import type {
  CarriedAmounts,
  DueDateRow,
  StoredItem,
  StoredItemBalance,
  StoredMovement,
} from '@vertex-mizan/ledger';
import { asc, inArray, type SQL, sql } from 'drizzle-orm';
import type { Transaction } from '../client.js';
import { chartAccounts } from '../schema/chart.js';
import {
  openItemBalances,
  openItemDueDates,
  openItemMovements,
  openItems,
} from '../schema/open-items.js';

// Reads of the open items (S04 "Reports"), in the caller's company context: items with what they
// carry at a date, their due dates and balance rows, a client's movements for the statement, and
// what the integrity check compares. Amounts are summed in SQL, never in TypeScript (ADR 0007);
// the ageing's buckets and the check's comparisons are `packages/ledger`'s.

const bigintOf = (value: string | number | bigint | null): bigint =>
  value === null ? 0n : BigInt(value);

const nullableBigint = (value: string | number | bigint | null): bigint | null =>
  value === null ? null : BigInt(value);

/** An item with what it carries at the end of a date: its movements dated on or before it. */
export interface ItemAtDate {
  readonly id: string;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly kind: ItemKind;
  readonly reference: string;
  readonly source: ItemSource;
  readonly hubDocument: { type: string; id: string; number: string } | null;
  readonly clientValueId: string | null;
  readonly clientCode: string | null;
  readonly clientName: string | null;
  readonly currency: CurrencyCode;
  readonly documentDate: string;
  readonly openedByEntryId: string;
  readonly createdAt: Date;
  readonly openMinor: bigint;
  readonly bookMinor: bigint;
  /** Null when the company keeps no parallel ledger. */
  readonly parallelMinor: bigint | null;
  /** Whether a movement up to the date is a manual one on a Hub or opening item (rule 8). */
  readonly adjusted: boolean;
  /** Its movements up to the date: zero for an item opened after it. */
  readonly movementCount: number;
}

export interface ItemFilter {
  /** The end of this date (`YYYY-MM-DD`): movements dated after it are left out. */
  readonly asOf: string;
  readonly itemIds?: readonly string[];
  readonly accountIds?: readonly string[];
  readonly clientValueId?: string;
  readonly kind?: ItemKind;
  /** `open`: not zero at the date; `settled`: zero; `all` (default) both. */
  readonly state?: 'open' | 'settled' | 'all';
  /** A part of the reference, any case. */
  readonly text?: string;
  /** Include items with no movement up to the date (opened later): for one item's page only. */
  readonly includeUnopened?: boolean;
  /** Newest first by `(created_at, id)`, after this item; with `limit`. */
  readonly afterItemId?: string;
  readonly limit?: number;
}

/**
 * The items that match `filter`, with their open and carrying amounts at the end of `asOf` summed
 * from their movements (S04 "Periods": a past date is reproduced), newest first. An item with no
 * movement up to the date did not exist yet and is left out, unless `includeUnopened`.
 */
export async function readItemsAt(tx: Transaction, filter: ItemFilter): Promise<ItemAtDate[]> {
  const conditions: SQL[] = [];
  if (filter.itemIds) {
    if (filter.itemIds.length === 0) return [];
    conditions.push(
      sql`i.id in (${sql.join(
        filter.itemIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  }
  if (filter.accountIds && filter.accountIds.length > 0) {
    conditions.push(
      sql`i.account_id in (${sql.join(
        filter.accountIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  }
  if (filter.clientValueId) conditions.push(sql`i.client_value_id = ${filter.clientValueId}::uuid`);
  if (filter.kind) conditions.push(sql`i.kind = ${filter.kind}`);
  if (filter.text) {
    const pattern = `%${filter.text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    conditions.push(sql`i.reference ilike ${pattern}`);
  }
  if (!filter.includeUnopened) conditions.push(sql`m.item_id is not null`);
  if (filter.state === 'open') conditions.push(sql`coalesce(m.open_minor, 0) <> 0`);
  if (filter.state === 'settled') conditions.push(sql`coalesce(m.open_minor, 0) = 0`);
  if (filter.afterItemId) {
    conditions.push(
      sql`(i.created_at, i.id) < (select o.created_at, o.id from ${openItems} o where o.id = ${filter.afterItemId}::uuid)`,
    );
  }
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const limit = filter.limit === undefined ? sql`` : sql`limit ${filter.limit}`;
  const { rows } = await tx.execute<{
    id: string;
    account_id: string;
    account_code: string;
    account_name: string;
    kind: string;
    reference: string;
    source: string;
    hub_document: ItemAtDate['hubDocument'];
    client_value_id: string | null;
    client_code: string | null;
    client_name: string | null;
    currency: string;
    document_date: string;
    opened_by_entry_id: string;
    created_at: string;
    open_minor: string | null;
    book_minor: string | null;
    parallel_minor: string | null;
    has_parallel: boolean;
    adjusted: boolean | null;
    movement_count: number | null;
  }>(sql`
    with m as (
      select item_id,
        sum(amount_minor) as open_minor,
        sum(book_minor) as book_minor,
        sum(parallel_minor) as parallel_minor,
        bool_or(adjusted) as adjusted,
        count(*)::int as movement_count
      from ${openItemMovements}
      where entry_date <= ${filter.asOf}::date
      group by item_id
    )
    select i.id, i.account_id, a.code as account_code, a.name as account_name, i.kind,
      i.reference, i.source, i.hub_document, i.client_value_id, v.code as client_code,
      v.name as client_name, i.currency, i.document_date::text as document_date,
      i.opened_by_entry_id, to_json(i.created_at) #>> '{}' as created_at,
      m.open_minor::text, m.book_minor::text, m.parallel_minor::text,
      (select s.parallel_currency is not null from company_settings s) as has_parallel,
      m.adjusted, m.movement_count
    from ${openItems} i
    join ${chartAccounts} a on a.company_id = i.company_id and a.id = i.account_id
    left join dimension_values v on v.company_id = i.company_id and v.id = i.client_value_id
    left join m on m.item_id = i.id
    ${where}
    order by i.created_at desc, i.id desc
    ${limit}
  `);
  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    kind: row.kind as ItemKind,
    reference: row.reference,
    source: row.source as ItemSource,
    hubDocument: row.hub_document,
    clientValueId: row.client_value_id,
    clientCode: row.client_code,
    clientName: row.client_name,
    currency: row.currency as CurrencyCode,
    documentDate: row.document_date,
    openedByEntryId: row.opened_by_entry_id,
    createdAt: new Date(row.created_at),
    openMinor: bigintOf(row.open_minor),
    bookMinor: bigintOf(row.book_minor),
    parallelMinor: row.has_parallel ? bigintOf(row.parallel_minor) : null,
    adjusted: row.adjusted ?? false,
    movementCount: row.movement_count ?? 0,
  }));
}

/** A due-date row with who set it (rules 14–15). */
export interface ItemDueDate extends DueDateRow {
  readonly itemId: string;
  readonly setBy: 'opening' | 'user' | 'hub_event';
  readonly userId: string | null;
  readonly reason: string | null;
}

/** The due-date history of the items, oldest first by date and recording. */
export async function readDueDates(
  tx: Transaction,
  itemIds: readonly string[],
): Promise<ItemDueDate[]> {
  if (itemIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(openItemDueDates)
    .where(inArray(openItemDueDates.itemId, [...itemIds]))
    .orderBy(asc(openItemDueDates.effectiveOn), asc(openItemDueDates.createdAt));
  return rows.map((row) => ({
    itemId: row.itemId,
    dueOn: row.dueOn,
    effectiveOn: row.effectiveOn,
    recordedAt: row.createdAt.toISOString(),
    setBy: row.setBy as ItemDueDate['setBy'],
    userId: row.userId,
    reason: row.reason,
  }));
}

/**
 * What the items carry now, from their balance rows (the posting function's own read, without a
 * lock): for the preview's before and after (S04 "Screens"). An item without a row is absent.
 */
export async function readItemBalances(
  tx: Transaction,
  itemIds: readonly string[],
): Promise<Map<string, CarriedAmounts>> {
  if (itemIds.length === 0) return new Map();
  const rows = await tx
    .select({
      itemId: openItemBalances.itemId,
      currency: openItems.currency,
      openMinor: openItemBalances.openMinor,
      bookMinor: openItemBalances.bookMinor,
      parallelMinor: openItemBalances.parallelMinor,
    })
    .from(openItemBalances)
    .innerJoin(
      openItems,
      sql`${openItems.companyId} = ${openItemBalances.companyId} and ${openItems.id} = ${openItemBalances.itemId}`,
    )
    .where(inArray(openItemBalances.itemId, [...itemIds]));
  return new Map(
    rows.map((row) => [
      row.itemId,
      {
        transaction: money(row.openMinor, row.currency as CurrencyCode),
        bookMinor: row.bookMinor,
        parallelMinor: row.parallelMinor,
      },
    ]),
  );
}

/** A movement of an item with its entry and line, and what the item carries after it. */
export interface ItemMovementRow {
  readonly id: string;
  readonly itemId: string;
  readonly kind: MovementKind;
  readonly adjusted: boolean;
  readonly entryId: string;
  readonly fiscalYear: number;
  readonly number: number;
  readonly entryDate: string;
  readonly description: string;
  readonly lineNo: number;
  readonly memo: string | null;
  readonly amountMinor: bigint;
  readonly bookMinor: bigint;
  readonly parallelMinor: bigint | null;
  readonly balanceMinor: bigint;
  readonly balanceBookMinor: bigint;
  readonly balanceParallelMinor: bigint | null;
}

/**
 * An item's movements dated on or before `asOf`, in posting order (clearing follows posting order,
 * S04 edge case 18), each with the item's balance after it summed in SQL.
 */
export async function readItemMovements(
  tx: Transaction,
  itemId: string,
  asOf: string,
): Promise<ItemMovementRow[]> {
  const { rows } = await tx.execute<{
    id: string;
    item_id: string;
    kind: string;
    adjusted: boolean;
    entry_id: string;
    fiscal_year: number;
    number: number;
    entry_date: string;
    description: string;
    line_no: number;
    memo: string | null;
    amount_minor: string;
    book_minor: string;
    parallel_minor: string | null;
    balance_minor: string;
    balance_book_minor: string;
    balance_parallel_minor: string | null;
  }>(sql`
    select m.id, m.item_id, m.kind, m.adjusted, m.entry_id, e.fiscal_year, e.number,
      m.entry_date::text as entry_date, e.description, l.line_no, l.memo,
      m.amount_minor::text, m.book_minor::text, m.parallel_minor::text,
      (sum(m.amount_minor) over w)::text as balance_minor,
      (sum(m.book_minor) over w)::text as balance_book_minor,
      (sum(m.parallel_minor) over w)::text as balance_parallel_minor
    from ${openItemMovements} m
    join journal_entries e on e.company_id = m.company_id and e.id = m.entry_id
    join journal_lines l on l.company_id = m.company_id and l.id = m.line_id
    where m.item_id = ${itemId}::uuid and m.entry_date <= ${asOf}::date
    window w as (order by e.sequence, l.line_no rows between unbounded preceding and current row)
    order by e.sequence, l.line_no
  `);
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    kind: row.kind as MovementKind,
    adjusted: row.adjusted,
    entryId: row.entry_id,
    fiscalYear: row.fiscal_year,
    number: row.number,
    entryDate: row.entry_date,
    description: row.description,
    lineNo: row.line_no,
    memo: row.memo,
    amountMinor: BigInt(row.amount_minor),
    bookMinor: BigInt(row.book_minor),
    parallelMinor: nullableBigint(row.parallel_minor),
    balanceMinor: BigInt(row.balance_minor),
    balanceBookMinor: BigInt(row.balance_book_minor),
    balanceParallelMinor: nullableBigint(row.balance_parallel_minor),
  }));
}

/** A movement of a client's statement, with the running balances after it. */
export interface StatementMovementRow {
  readonly id: string;
  readonly entryId: string;
  readonly fiscalYear: number;
  readonly number: number;
  readonly entryDate: string;
  readonly description: string;
  readonly memo: string | null;
  readonly itemId: string;
  readonly itemReference: string;
  readonly itemKind: ItemKind;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly kind: MovementKind;
  readonly adjusted: boolean;
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
  readonly ledgerMinor: bigint;
  readonly balanceMinor: bigint;
  readonly ledgerBalanceMinor: bigint;
}

/** A client's balance in one item currency at a date, and in the selected ledger. */
export interface StatementBalanceRow {
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
  readonly ledgerMinor: bigint;
}

export interface ClientStatementRows {
  readonly opening: readonly StatementBalanceRow[];
  readonly openingLedgerMinor: bigint;
  readonly movements: readonly StatementMovementRow[];
  readonly closing: readonly StatementBalanceRow[];
  readonly closingLedgerMinor: bigint;
}

/**
 * A client's statement (S04 "Reports"): the movements of the client's items on every control
 * account dated from `from` (or the first) to `to`, by date then entry number then line, with the
 * client's running balance per item currency and in the ledger; the balances before `from` and at
 * the end of `to`. Opening plus movements equals closing, all summed in SQL.
 */
export async function readClientStatement(
  tx: Transaction,
  query: {
    readonly clientValueId: string;
    readonly from: string | null;
    readonly to: string;
    readonly ledger: Ledger;
    readonly currency: CurrencyCode | null;
  },
): Promise<ClientStatementRows> {
  const ledgerColumn =
    query.ledger === 'book' ? sql.raw('m.book_minor') : sql.raw('m.parallel_minor');
  const currency = query.currency === null ? sql`` : sql`and i.currency = ${query.currency}`;
  const scope = sql`i.client_value_id = ${query.clientValueId}::uuid ${currency}`;
  const balances = async (before: SQL) => {
    const { rows } = await tx.execute<{ currency: string; amount: string; ledger: string }>(sql`
      select i.currency, sum(m.amount_minor)::text as amount,
        coalesce(sum(${ledgerColumn}), 0)::text as ledger
      from ${openItemMovements} m
      join ${openItems} i on i.company_id = m.company_id and i.id = m.item_id
      where ${scope} and ${before}
      group by i.currency
      order by i.currency
    `);
    return rows.map((row) => ({
      currency: row.currency as CurrencyCode,
      amountMinor: BigInt(row.amount),
      ledgerMinor: BigInt(row.ledger),
    }));
  };
  const total = async (before: SQL) => {
    const { rows } = await tx.execute<{ ledger: string }>(sql`
      select coalesce(sum(${ledgerColumn}), 0)::text as ledger
      from ${openItemMovements} m
      join ${openItems} i on i.company_id = m.company_id and i.id = m.item_id
      where ${scope} and ${before}
    `);
    return BigInt(rows[0]?.ledger ?? '0');
  };
  const beforeFrom = query.from === null ? sql`false` : sql`m.entry_date < ${query.from}::date`;
  const toEnd = sql`m.entry_date <= ${query.to}::date`;
  const { rows } = await tx.execute<{
    id: string;
    entry_id: string;
    fiscal_year: number;
    number: number;
    entry_date: string;
    description: string;
    memo: string | null;
    item_id: string;
    item_reference: string;
    item_kind: string;
    account_id: string;
    account_code: string;
    account_name: string;
    kind: string;
    adjusted: boolean;
    currency: string;
    amount_minor: string;
    ledger_minor: string | null;
    balance_minor: string;
    ledger_balance_minor: string;
  }>(sql`
    select * from (
      select m.id, m.entry_id, e.fiscal_year, e.number, m.entry_date::text as entry_date,
        e.description, l.memo, l.line_no, m.item_id, i.reference as item_reference,
        i.kind as item_kind,
        i.account_id, a.code as account_code, a.name as account_name, m.kind, m.adjusted,
        i.currency, m.amount_minor::text, (${ledgerColumn})::text as ledger_minor,
        (sum(m.amount_minor) over (partition by i.currency order by m.entry_date, e.fiscal_year,
          e.number, l.line_no rows between unbounded preceding and current row))::text
          as balance_minor,
        (coalesce(sum(${ledgerColumn}) over (order by m.entry_date, e.fiscal_year, e.number,
          l.line_no rows between unbounded preceding and current row), 0))::text
          as ledger_balance_minor
      from ${openItemMovements} m
      join ${openItems} i on i.company_id = m.company_id and i.id = m.item_id
      join ${chartAccounts} a on a.company_id = i.company_id and a.id = i.account_id
      join journal_entries e on e.company_id = m.company_id and e.id = m.entry_id
      join journal_lines l on l.company_id = m.company_id and l.id = m.line_id
      where ${scope} and ${toEnd}
    ) s
    ${query.from === null ? sql`` : sql`where s.entry_date >= ${query.from}`}
    order by s.entry_date, s.fiscal_year, s.number, s.line_no
  `);
  return {
    opening: await balances(beforeFrom),
    openingLedgerMinor: await total(beforeFrom),
    movements: rows.map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      fiscalYear: row.fiscal_year,
      number: row.number,
      entryDate: row.entry_date,
      description: row.description,
      memo: row.memo,
      itemId: row.item_id,
      itemReference: row.item_reference,
      itemKind: row.item_kind as ItemKind,
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      kind: row.kind as MovementKind,
      adjusted: row.adjusted,
      currency: row.currency as CurrencyCode,
      amountMinor: BigInt(row.amount_minor),
      ledgerMinor: bigintOf(row.ledger_minor),
      balanceMinor: BigInt(row.balance_minor),
      ledgerBalanceMinor: BigInt(row.ledger_balance_minor),
    })),
    closing: await balances(toEnd),
    closingLedgerMinor: await total(toEnd),
  };
}

/** What the integrity check compares the control accounts and the item rows with (S04). */
export interface OpenItemState {
  readonly controlAccountIds: string[];
  readonly items: StoredItem[];
  readonly movements: StoredMovement[];
  readonly balances: StoredItemBalance[];
}

/** The control accounts, items, movements and balance rows as stored, in the caller's snapshot. */
export async function readOpenItemState(tx: Transaction): Promise<OpenItemState> {
  const accounts = await tx
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(sql`${chartAccounts.isControl}`);
  const items = await tx
    .select({ id: openItems.id, accountId: openItems.accountId, currency: openItems.currency })
    .from(openItems);
  const movements = await tx
    .select({
      itemId: openItemMovements.itemId,
      kind: openItemMovements.kind,
      entryDate: openItemMovements.entryDate,
      amountMinor: openItemMovements.amountMinor,
      bookMinor: openItemMovements.bookMinor,
      parallelMinor: openItemMovements.parallelMinor,
    })
    .from(openItemMovements);
  const balances = await tx
    .select({
      itemId: openItemBalances.itemId,
      openMinor: openItemBalances.openMinor,
      bookMinor: openItemBalances.bookMinor,
      parallelMinor: openItemBalances.parallelMinor,
      revaluationBookMinor: openItemBalances.revaluationBookMinor,
      revaluationParallelMinor: openItemBalances.revaluationParallelMinor,
      movementCount: openItemBalances.movementCount,
      lastMovementOn: openItemBalances.lastMovementOn,
    })
    .from(openItemBalances);
  return {
    controlAccountIds: accounts.map((account) => account.id),
    items: items.map((item) => ({ ...item, currency: item.currency as CurrencyCode })),
    movements: movements.map((movement) => ({ ...movement, kind: movement.kind as MovementKind })),
    balances,
  };
}

/**
 * Whether an account has an item that is not zero in its open amount or a ledger (S02 rule 6 with
 * S04: `ACCOUNT_HAS_BALANCE`).
 */
export async function accountHasOpenItems(tx: Transaction, accountId: string): Promise<boolean> {
  const { rows } = await tx.execute(sql`
    select 1 from ${openItemBalances} b
    join ${openItems} i on i.company_id = b.company_id and i.id = b.item_id
    where i.account_id = ${accountId}::uuid
      and (b.open_minor <> 0 or b.book_minor <> 0 or coalesce(b.parallel_minor, 0) <> 0)
    limit 1
  `);
  return rows.length > 0;
}
