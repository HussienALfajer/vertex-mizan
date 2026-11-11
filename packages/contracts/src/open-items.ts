import { z } from 'zod';
import { cursorSchema } from './audit.js';
import { currencyCodeSchema, ledgerSchema } from './money.js';
import { entryNumberSchema, minorUnitsSchema, personRefSchema } from './wire.js';

/**
 * Open items behind the control accounts (S04, ADR 0013): the item kind of a control account,
 * where an item comes from, the kinds of its movements and who set a due date. The item tables are
 * `packages/db`'s `open-items` module; the item lines are `packages/ledger`'s `itemLines()`.
 */

/**
 * The item kind of a control account (ADR 0013): `document`, one item per invoice or document,
 * opened once and cleared toward zero; `running`, one item per client and currency, carried at
 * its average and allowed to cross zero (ADR 0007).
 */
export const ITEM_KINDS = ['document', 'running'] as const;

export const itemKindSchema = z.enum(ITEM_KINDS).meta({ id: 'ItemKind' });

export type ItemKind = z.infer<typeof itemKindSchema>;

/** Where an item comes from: a manual line, a Hub event (S05) or the opening balances (S10). */
export const ITEM_SOURCES = ['manual', 'hub_event', 'opening'] as const;

export type ItemSource = (typeof ITEM_SOURCES)[number];

/**
 * The kinds of an item's movement: `open`, a document item's opening; `add`, a new measurement on
 * a running item; `clear`, a carried clearing; `difference`, a running void's exchange difference
 * (S04 rule 13); `revaluation` (S07), a month-end revaluation's line or its reversal's, with a
 * transaction amount of zero and an amount in one ledger only.
 */
export const MOVEMENT_KINDS = ['open', 'add', 'clear', 'difference', 'revaluation'] as const;

export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Who set a document item's due date: the opening, a person (S04 rule 15) or a Hub event (S05). */
export const DUE_DATE_SETTERS = ['opening', 'user', 'hub_event'] as const;

export type DueDateSetter = (typeof DUE_DATE_SETTERS)[number];

/** A manual item's reference, or Hub's document number: 1–100 characters after trimming. */
export const itemReferenceSchema = z.string().trim().min(1).max(100);

// The schemas of the receivables API (S04 "API"): items, their movements and due dates, the
// ageing, client funds and the client statement. Amounts are `MinorUnits` strings (S03).

/** An item's state (rule 1): open while its open transaction amount is not zero, settled at zero. */
export const OPEN_ITEM_STATES = ['open', 'settled'] as const;

export const openItemStateSchema = z.enum(OPEN_ITEM_STATES).meta({ id: 'OpenItemState' });

export type OpenItemState = z.infer<typeof openItemStateSchema>;

export const itemSourceSchema = z.enum(ITEM_SOURCES).meta({ id: 'ItemSource' });

export const movementKindSchema = z.enum(MOVEMENT_KINDS).meta({ id: 'MovementKind' });

export const dueDateSetterSchema = z.enum(DUE_DATE_SETTERS).meta({ id: 'DueDateSetter' });

/** A client as the receivables screens name it: the dimension value, its code and name. */
export const clientRefSchema = z
  .object({ id: z.uuid(), code: z.string().nullable(), name: z.string() })
  .meta({ id: 'ClientRef' });

export type ClientRef = z.infer<typeof clientRefSchema>;

/** An account as the receivables screens name it. */
export const accountRefSchema = z
  .object({ id: z.uuid(), code: z.string(), name: z.string() })
  .meta({ id: 'AccountRef' });

export type AccountRef = z.infer<typeof accountRefSchema>;

/**
 * What an item carries at a date: its open transaction amount (in the item's currency) and its
 * carrying amount in each ledger, without revaluations (ADR 0013); `parallelMinor` is null when
 * the company keeps no parallel ledger.
 */
export const itemAmountsSchema = z
  .object({
    openMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema,
    parallelMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'ItemAmounts' });

export type ItemAmounts = z.infer<typeof itemAmountsSchema>;

/** Hub's document behind an item from Hub (S05): its type, id and number. */
export const hubDocumentRefSchema = z
  .object({ type: z.string(), id: z.string(), number: z.string() })
  .meta({ id: 'HubDocumentRef' });

const isoDate = () => z.iso.date();

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * Account ids in a query, comma-separated. Kept as text so the query converts to JSON Schema both
 * ways; `ageingAccountIds()` reads them.
 */
const idListSchema = z
  .string()
  .regex(new RegExp(`^${UUID}(,${UUID})*$`), 'Expected account ids, comma-separated')
  .optional();

/**
 * `GET /api/open-items`: items by account, client, state and reference text, as of a date (default
 * today in Damascus); pages of 100 by reference.
 */
export const openItemQuerySchema = z
  .object({
    account: z.uuid().optional(),
    client: z.uuid().optional(),
    state: z.enum([...OPEN_ITEM_STATES, 'all']).default('open'),
    text: z.string().trim().min(1).max(100).optional(),
    asOf: isoDate().optional(),
    cursor: cursorSchema.optional(),
  })
  .meta({ id: 'OpenItemQuery' });

export type OpenItemQuery = z.infer<typeof openItemQuerySchema>;

/** An item as the lists show it, at the query's date. */
export const openItemSummarySchema = z
  .object({
    id: z.uuid(),
    account: accountRefSchema,
    kind: itemKindSchema,
    reference: z.string(),
    source: itemSourceSchema,
    client: clientRefSchema.nullable(),
    currency: currencyCodeSchema,
    documentDate: isoDate(),
    /** The due date in force at the date (rule 14); null for a running item, which has none. */
    dueOn: isoDate().nullable(),
    state: openItemStateSchema,
    amounts: itemAmountsSchema,
    /** A manual movement on an item whose source is not manual: "معدّل في ميزان" (rule 8). */
    adjusted: z.boolean(),
  })
  .meta({ id: 'OpenItemSummary' });

export type OpenItemSummary = z.infer<typeof openItemSummarySchema>;

export const openItemPageSchema = z
  .object({ items: z.array(openItemSummarySchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'OpenItemPage' });

export type OpenItemPage = z.infer<typeof openItemPageSchema>;

/** One movement of an item with its entry, and what the item carries after it. */
export const openItemMovementSchema = z
  .object({
    id: z.uuid(),
    kind: movementKindSchema,
    adjusted: z.boolean(),
    entryId: z.uuid(),
    ...entryNumberSchema.shape,
    entryDate: isoDate(),
    description: z.string(),
    lineNo: z.int().min(1),
    memo: z.string().nullable(),
    /** The movement's three amounts: the open amount's change and each ledger's. */
    amounts: itemAmountsSchema,
    /** What the item carries after the movement. */
    balance: itemAmountsSchema,
  })
  .meta({ id: 'OpenItemMovement' });

export type OpenItemMovement = z.infer<typeof openItemMovementSchema>;

/** A row of a document item's due-date history (rules 14–15). */
export const openItemDueDateSchema = z
  .object({
    dueOn: isoDate(),
    effectiveOn: isoDate(),
    setBy: dueDateSetterSchema,
    by: personRefSchema.nullable(),
    reason: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'OpenItemDueDate' });

export type OpenItemDueDate = z.infer<typeof openItemDueDateSchema>;

/** `GET /api/open-items/:id?asOf=`: the item at the date, its movements up to it, its due dates. */
export const openItemQueryAsOfSchema = z
  .object({ asOf: isoDate().optional() })
  .meta({ id: 'OpenItemAsOfQuery' });

export type OpenItemAsOfQuery = z.infer<typeof openItemQueryAsOfSchema>;

/** One item with its movements, oldest first, and its due-date history. */
export const openItemSchema = z
  .object({
    ...openItemSummarySchema.shape,
    asOf: isoDate(),
    hubDocument: hubDocumentRefSchema.nullable(),
    /** The inbox id of the Hub event that opened the item (S05 "Screens"). */
    hubEventId: z.uuid().nullable(),
    openedByEntryId: z.uuid(),
    bookCurrency: currencyCodeSchema,
    parallelCurrency: currencyCodeSchema.nullable(),
    movements: z.array(openItemMovementSchema),
    dueDates: z.array(openItemDueDateSchema),
  })
  .meta({ id: 'OpenItem' });

export type OpenItem = z.infer<typeof openItemSchema>;

/**
 * `PUT /api/open-items/:id/due-date` (rule 15): a manual item's new due date, any date, effective
 * on the day of the change, with a reason.
 */
export const changeDueDateSchema = z
  .object({ dueOn: isoDate(), reason: z.string().trim().min(1).max(1000) })
  .meta({ id: 'ChangeDueDate' });

export type ChangeDueDate = z.infer<typeof changeDueDateSchema>;

/**
 * The ageing buckets by days past due (rule 16, owner 2026-10-28): not yet due (≤ 0), 1–30, 31–60,
 * 61–90, 91–180, over 180.
 */
export const AGEING_BUCKETS = [
  'not_due',
  'days_1_30',
  'days_31_60',
  'days_61_90',
  'days_91_180',
  'over_180',
] as const;

export const ageingBucketSchema = z.enum(AGEING_BUCKETS).meta({ id: 'AgeingBucket' });

export type AgeingBucket = z.infer<typeof ageingBucketSchema>;

/** The bucket of a number of days past due (rule 16). */
export function ageingBucketOf(daysPastDue: number): AgeingBucket {
  if (!Number.isInteger(daysPastDue)) throw new RangeError('Days past due are whole days');
  if (daysPastDue <= 0) return 'not_due';
  if (daysPastDue <= 30) return 'days_1_30';
  if (daysPastDue <= 60) return 'days_31_60';
  if (daysPastDue <= 90) return 'days_61_90';
  if (daysPastDue <= 180) return 'days_91_180';
  return 'over_180';
}

/** An amount per bucket, in one currency. */
export const bucketAmountsSchema = z
  .object(
    Object.fromEntries(AGEING_BUCKETS.map((bucket) => [bucket, minorUnitsSchema])) as Record<
      AgeingBucket,
      typeof minorUnitsSchema
    >,
  )
  .meta({ id: 'BucketAmounts' });

export type BucketAmounts = z.infer<typeof bucketAmountsSchema>;

/**
 * `GET /api/receivables/ageing` and its export: as of a date (default today in Damascus), in the
 * book or the parallel ledger, on the chosen asset control accounts (default: the document
 * accounts on `bs.trade_receivables`), optionally for one client.
 */
export const ageingQuerySchema = z
  .object({
    asOf: isoDate().optional(),
    ledger: ledgerSchema.default('book'),
    accounts: idListSchema,
    client: z.uuid().optional(),
  })
  .meta({ id: 'AgeingQuery' });

export type AgeingQuery = z.infer<typeof ageingQuerySchema>;

/** The ageing query's account ids, each once, lowercase; none for the default accounts. */
export function ageingAccountIds(query: Pick<AgeingQuery, 'accounts'>): string[] {
  return query.accounts
    ? [...new Set(query.accounts.split(',').map((id) => id.toLowerCase()))]
    : [];
}

/** An item in the ageing: its due date in force, days past due, bucket and amounts at the date. */
export const ageingItemSchema = z
  .object({
    itemId: z.uuid(),
    account: accountRefSchema,
    reference: z.string(),
    currency: currencyCodeSchema,
    documentDate: isoDate(),
    dueOn: isoDate(),
    daysPastDue: z.int(),
    bucket: ageingBucketSchema,
    /** The open amount in the item's currency. */
    openMinor: minorUnitsSchema,
    /** The carrying amount in the selected ledger's currency. */
    carryingMinor: minorUnitsSchema,
    adjusted: z.boolean(),
  })
  .meta({ id: 'AgeingItem' });

export type AgeingItem = z.infer<typeof ageingItemSchema>;

/** A client's row: the buckets and total in the ledger's currency, and its items. */
export const ageingClientSchema = z
  .object({
    client: clientRefSchema.nullable(),
    buckets: bucketAmountsSchema,
    totalMinor: minorUnitsSchema,
    items: z.array(ageingItemSchema),
  })
  .meta({ id: 'AgeingClient' });

export type AgeingClient = z.infer<typeof ageingClientSchema>;

/** The totals of the items in one transaction currency, by bucket. */
export const ageingCurrencyTotalSchema = z
  .object({
    currency: currencyCodeSchema,
    buckets: bucketAmountsSchema,
    totalMinor: minorUnitsSchema,
  })
  .meta({ id: 'AgeingCurrencyTotal' });

export type AgeingCurrencyTotal = z.infer<typeof ageingCurrencyTotalSchema>;

/** The receivables ageing as of a date (rule 16). */
export const ageingReportSchema = z
  .object({
    asOf: isoDate(),
    ledger: ledgerSchema,
    ledgerCurrency: currencyCodeSchema,
    accounts: z.array(accountRefSchema),
    clients: z.array(ageingClientSchema),
    buckets: bucketAmountsSchema,
    totalMinor: minorUnitsSchema,
    currencyTotals: z.array(ageingCurrencyTotalSchema),
  })
  .meta({ id: 'AgeingReport' });

export type AgeingReport = z.infer<typeof ageingReportSchema>;

/** `GET /api/client-funds`: as of a date, the totals in the selected ledger. */
export const clientFundsQuerySchema = z
  .object({ asOf: isoDate().optional(), ledger: ledgerSchema.default('book') })
  .meta({ id: 'ClientFundsQuery' });

export type ClientFundsQuery = z.infer<typeof clientFundsQuerySchema>;

/**
 * A running item at the date (rule 17): the balance and both ledgers' carrying amounts. A debit
 * balance is a receivable from the client ("مستحق من العميل"), never netted against other clients.
 */
export const clientFundSchema = z
  .object({
    itemId: z.uuid(),
    account: accountRefSchema,
    client: clientRefSchema,
    currency: currencyCodeSchema,
    amounts: itemAmountsSchema,
    receivable: z.boolean(),
  })
  .meta({ id: 'ClientFund' });

export type ClientFund = z.infer<typeof clientFundSchema>;

/** The client funds as of a date, with the totals of each ledger. */
export const clientFundsSchema = z
  .object({
    asOf: isoDate(),
    ledger: ledgerSchema,
    bookCurrency: currencyCodeSchema,
    parallelCurrency: currencyCodeSchema.nullable(),
    funds: z.array(clientFundSchema),
    /** The credit balances (funds held) and the debit balances (receivables) apart. */
    heldMinor: minorUnitsSchema,
    receivableMinor: minorUnitsSchema,
  })
  .meta({ id: 'ClientFunds' });

export type ClientFunds = z.infer<typeof clientFundsSchema>;

/** `GET /api/clients/:valueId/statement` and its export: a date range, a ledger, a currency. */
export const clientStatementQuerySchema = z
  .object({
    from: isoDate().optional(),
    to: isoDate().optional(),
    ledger: ledgerSchema.default('book'),
    currency: currencyCodeSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'The range ends before it starts',
    path: ['to'],
  })
  .meta({ id: 'ClientStatementQuery' });

export type ClientStatementQuery = z.infer<typeof clientStatementQuerySchema>;

/** A balance in one item currency, with its amount in the selected ledger. */
export const statementBalanceSchema = z
  .object({
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    ledgerMinor: minorUnitsSchema,
  })
  .meta({ id: 'StatementBalance' });

export type StatementBalance = z.infer<typeof statementBalanceSchema>;

/** A movement of the client's items with its entry and the running balances after it. */
export const clientStatementLineSchema = z
  .object({
    movementId: z.uuid(),
    entryId: z.uuid(),
    ...entryNumberSchema.shape,
    entryDate: isoDate(),
    description: z.string(),
    memo: z.string().nullable(),
    itemId: z.uuid(),
    itemReference: z.string(),
    itemKind: itemKindSchema,
    account: accountRefSchema,
    kind: movementKindSchema,
    adjusted: z.boolean(),
    currency: currencyCodeSchema,
    amountMinor: minorUnitsSchema,
    /** The movement in the selected ledger's currency. */
    ledgerMinor: minorUnitsSchema,
    /** The client's balance in the movement's currency after it. */
    balanceMinor: minorUnitsSchema,
    /** The client's balance in the selected ledger after it, every currency together. */
    ledgerBalanceMinor: minorUnitsSchema,
  })
  .meta({ id: 'ClientStatementLine' });

export type ClientStatementLine = z.infer<typeof clientStatementLineSchema>;

/**
 * A client's statement: the client's items on every control account, the opening balance per item
 * currency, every movement in the range by date then entry number, and the closing balance;
 * opening plus movements equals closing (S04 "Reports").
 */
export const clientStatementSchema = z
  .object({
    client: clientRefSchema,
    from: isoDate().nullable(),
    to: isoDate(),
    ledger: ledgerSchema,
    ledgerCurrency: currencyCodeSchema,
    currency: currencyCodeSchema.nullable(),
    opening: z.array(statementBalanceSchema),
    openingLedgerMinor: minorUnitsSchema,
    lines: z.array(clientStatementLineSchema),
    closing: z.array(statementBalanceSchema),
    closingLedgerMinor: minorUnitsSchema,
  })
  .meta({ id: 'ClientStatement' });

export type ClientStatement = z.infer<typeof clientStatementSchema>;

/** `/api/clients/:valueId/statement`. */
export const clientParamsSchema = z.object({ valueId: z.uuid() }).meta({ id: 'ClientParams' });
