import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { chartAccounts } from './chart.js';
import { companyId, createdAt, id, idIsUuidV7, updatedAt } from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES } from './companies.js';
import { dimensionValues } from './dimensions.js';
import { dimensionSets, journalEntries, journalLines } from './ledger.js';

// The open-items module (S04, ADR 0013): the items behind the control accounts, their movements
// and due dates (append-only) and each item's balance (ledger state), company tables under forced
// RLS. The posting function `post()` is the only writer of items and movements; a movement's
// trigger is the only writer of the balances, and the guards of the S04 migration hold every rule
// for every role, pinned in `GUARDS`.

/** `ITEM_KINDS` of `@vertex-mizan/contracts`; a test keeps them equal. */
export const OPEN_ITEM_KINDS = ['document', 'running'] as const;

/** `ITEM_SOURCES` of contracts; a test keeps them equal. */
export const OPEN_ITEM_SOURCES = ['manual', 'hub_event', 'opening'] as const;

/**
 * `MOVEMENT_KINDS` of contracts; a test keeps them equal. `revaluation` (S07): a month-end
 * revaluation's line on the item, or its reversal's, kept apart from the carrying amount.
 */
export const OPEN_ITEM_MOVEMENT_KINDS = [
  'open',
  'add',
  'clear',
  'difference',
  'revaluation',
] as const;

/** `DUE_DATE_SETTERS` of contracts; a test keeps them equal. */
export const OPEN_ITEM_DUE_DATE_SETTERS = ['opening', 'user', 'hub_event'] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * An open item (S04 "Data"): one per document on a `document` control account, by its reference;
 * one per client and currency on a `running` account. Its kind is its account's, its dimension set
 * and currency every line of it carries; `opened_by_entry_id` is the entry of its first line.
 */
export const openItems = pgTable(
  'open_items',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    accountId: uuid().notNull(),
    kind: text().notNull(),
    /** A manual document's reference, Hub's document number, or a running item's client code. */
    reference: text().notNull(),
    source: text().notNull(),
    /** Hub's document (type, id and number) for an item from Hub (S05). */
    hubDocument: jsonb(),
    dimensionSetId: uuid().notNull(),
    /** The client of the item's dimension set; a running item always has one. */
    clientValueId: uuid(),
    currency: text().notNull(),
    documentDate: date().notNull(),
    openedByEntryId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('open_items', t.id),
    unique('open_items_company_id_id_key').on(t.companyId, t.id),
    foreignKey({
      name: 'open_items_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    foreignKey({
      name: 'open_items_dimension_set_fk',
      columns: [t.companyId, t.dimensionSetId],
      foreignColumns: [dimensionSets.companyId, dimensionSets.id],
    }),
    foreignKey({
      name: 'open_items_client_fk',
      columns: [t.companyId, t.clientValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    foreignKey({
      name: 'open_items_opened_by_entry_fk',
      columns: [t.companyId, t.openedByEntryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    // A document's reference is unique on its account (S04 rule 6); an opening's items per opening
    // entry, since the new opening after a whole reversal opens them again (S10 rule 25), and
    // `open_item_reference_rules()` holds every reference unique among the items standing.
    uniqueIndex('open_items_document_reference_key')
      .on(t.companyId, t.accountId, t.reference)
      .where(sql`${t.kind} = 'document' and ${t.source} <> 'opening'`),
    uniqueIndex('open_items_opening_reference_key')
      .on(t.companyId, t.accountId, t.reference, t.openedByEntryId)
      .where(sql`${t.kind} = 'document' and ${t.source} = 'opening'`),
    uniqueIndex('open_items_running_key')
      .on(t.companyId, t.accountId, t.clientValueId, t.currency)
      .where(sql`${t.kind} = 'running'`),
    uniqueIndex('open_items_hub_document_key')
      .on(
        t.companyId,
        t.accountId,
        sql`(${t.hubDocument} ->> 'type')`,
        sql`(${t.hubDocument} ->> 'id')`,
        t.reference,
      )
      .where(sql`${t.hubDocument} is not null and ${t.source} <> 'opening'`),
    // The items of an account, by client: the ageing and the statements (S04 "Volume").
    index('open_items_company_account_idx').on(t.companyId, t.accountId, t.clientValueId),
    index('open_items_company_dimension_set_idx').on(t.companyId, t.dimensionSetId),
    index('open_items_company_client_idx').on(t.companyId, t.clientValueId),
    index('open_items_company_opened_by_entry_idx').on(t.companyId, t.openedByEntryId),
    // A Hub document's items, the opening's included (S10 rule 30).
    index('open_items_company_hub_document_idx')
      .on(t.companyId, sql`(${t.hubDocument} ->> 'type')`, sql`(${t.hubDocument} ->> 'id')`)
      .where(sql`${t.hubDocument} is not null`),
    check('open_items_kind', sql`${t.kind} in (${listed(OPEN_ITEM_KINDS)})`),
    check('open_items_source', sql`${t.source} in (${listed(OPEN_ITEM_SOURCES)})`),
    check('open_items_reference_length', sql`char_length(${t.reference}) between 1 and 100`),
    check('open_items_currency', sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`),
    check(
      'open_items_running_client',
      sql`${t.kind} = 'document' or ${t.clientValueId} is not null`,
    ),
    check(
      'open_items_hub_document',
      sql`${t.hubDocument} is null
        or (${t.source} in ('hub_event', 'opening') and jsonb_typeof(${t.hubDocument}) = 'object')`,
    ),
  ],
);

/**
 * One movement of an item: the one line on a control account that moves it, with that line's three
 * amounts and its entry's date (S04 "Data"). `adjusted` marks a manual movement on an item whose
 * source is not manual (rule 8).
 */
export const openItemMovements = pgTable(
  'open_item_movements',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    itemId: uuid().notNull(),
    lineId: uuid().notNull(),
    entryId: uuid().notNull(),
    entryDate: date().notNull(),
    kind: text().notNull(),
    adjusted: boolean().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    bookMinor: bigint({ mode: 'bigint' }).notNull(),
    parallelMinor: bigint({ mode: 'bigint' }),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('open_item_movements', t.id),
    unique('open_item_movements_line_key').on(t.companyId, t.lineId),
    foreignKey({
      name: 'open_item_movements_item_fk',
      columns: [t.companyId, t.itemId],
      foreignColumns: [openItems.companyId, openItems.id],
    }),
    foreignKey({
      name: 'open_item_movements_line_fk',
      columns: [t.companyId, t.lineId],
      foreignColumns: [journalLines.companyId, journalLines.id],
    }),
    foreignKey({
      name: 'open_item_movements_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    // An item's movements as of a date: the ageing and statements of a past date (S04 "Volume").
    index('open_item_movements_company_item_idx').on(t.companyId, t.itemId, t.entryDate),
    index('open_item_movements_company_entry_idx').on(t.companyId, t.entryId),
    check('open_item_movements_kind', sql`${t.kind} in (${listed(OPEN_ITEM_MOVEMENT_KINDS)})`),
  ],
);

/**
 * A document item's due date from a date on (S04 rule 14): the newest row with `effective_on` on or
 * before a date is in force on it. Set at the opening, by a person with a reason (rule 15), or by
 * Hub (S05).
 */
export const openItemDueDates = pgTable(
  'open_item_due_dates',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    itemId: uuid().notNull(),
    dueOn: date().notNull(),
    effectiveOn: date().notNull(),
    setBy: text().notNull(),
    /** The person who changed it; kept by id with no key to `users`, as drafts keep them. */
    userId: uuid(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('open_item_due_dates', t.id),
    foreignKey({
      name: 'open_item_due_dates_item_fk',
      columns: [t.companyId, t.itemId],
      foreignColumns: [openItems.companyId, openItems.id],
    }),
    index('open_item_due_dates_company_item_idx').on(
      t.companyId,
      t.itemId,
      t.effectiveOn,
      t.createdAt,
    ),
    check('open_item_due_dates_set_by', sql`${t.setBy} in (${listed(OPEN_ITEM_DUE_DATE_SETTERS)})`),
    check(
      'open_item_due_dates_user',
      sql`(${t.setBy} = 'user') = (${t.userId} is not null)
        and (${t.setBy} <> 'user' or ${t.reason} is not null)`,
    ),
    check(
      'open_item_due_dates_reason_length',
      sql`${t.reason} is null or char_length(${t.reason}) between 1 and 1000`,
    ),
  ],
);

/**
 * What an item carries (ADR 0012 `ledger-state`): its open transaction amount and its carrying
 * amount in each ledger, the sum of its movements other than revaluations; and apart, the sum of
 * its `revaluation` movements in each ledger (S07, ADR 0007: a carrying amount never includes a
 * revaluation, which reverses the next day). Written only by the trigger on movements; the posting
 * function reads it `FOR UPDATE` to clear the item at its carrying amount.
 */
export const openItemBalances = pgTable(
  'open_item_balances',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    itemId: uuid().notNull(),
    openMinor: bigint({ mode: 'bigint' }).notNull(),
    bookMinor: bigint({ mode: 'bigint' }).notNull(),
    parallelMinor: bigint({ mode: 'bigint' }),
    /**
     * The item's revaluation movements in each ledger (S07). Zero with no revaluation standing, and
     * zero in the parallel ledger of a company that keeps none: a column added to rows the trigger
     * alone writes takes its default, so it is never null.
     */
    revaluationBookMinor: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
    revaluationParallelMinor: bigint({ mode: 'bigint' }).notNull().default(sql`0`),
    movementCount: integer().notNull(),
    lastMovementOn: date().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('open_item_balances', t.id),
    unique('open_item_balances_item_key').on(t.companyId, t.itemId),
    foreignKey({
      name: 'open_item_balances_item_fk',
      columns: [t.companyId, t.itemId],
      foreignColumns: [openItems.companyId, openItems.id],
    }),
    check('open_item_balances_movement_count', sql`${t.movementCount} >= 1`),
  ],
);
