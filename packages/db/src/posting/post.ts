import { createHash } from 'node:crypto';
import {
  type CompanyLedgers,
  type CrossRate,
  type CurrencyCode,
  checkCurrencyDate,
  DomainError,
  type ErrorCode,
  type ExchangeRate,
  exchangeRateSchema,
  type ItemKind,
  type ItemSource,
  type Ledger,
  type MovementKind,
  money,
  type RateSource,
  type RateType,
} from '@vertex-mizan/contracts';
import {
  balanceEntry,
  type CanonicalValue,
  type CarriedAmounts,
  type ChainConversion,
  type ChainEntry,
  type ChartAccount,
  type ChartLine,
  type Conversion,
  canonicalJson,
  chainEntryValue,
  checkDueDate,
  checkItemLine,
  checkLineAgainstChart,
  checkManualEntryDate,
  type Dimensions,
  type EntrySource,
  emptyBalance,
  entryHash,
  fiscalYearOf,
  type ItemState,
  keptLedgers,
  type Line,
  type LineDimensionValue,
  type MeasureContext,
  manualEntry,
  manualReversalLines,
  movementOn,
  periodOf,
  runningVoidDifferenceLines,
  type VoidedRunningItem,
} from '@vertex-mizan/ledger';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { accountRequiredDimensions, accountRoles, chartAccounts } from '../schema/chart.js';
import { companySettings } from '../schema/companies.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import {
  dimensionSets,
  dimensionSetValues,
  entryNumberCounters,
  journalEntries,
  journalLines,
  ledgerHeads,
  lineConversions,
  periods,
  postingRequests,
} from '../schema/ledger.js';
import {
  openItemBalances,
  openItemDueDates,
  openItemMovements,
  openItems,
} from '../schema/open-items.js';
import { exchangeRates, ratePairs } from '../schema/rates.js';
import { ledgersOf } from '../services/companies.js';
import { exchangeRateOf, publicationCalendar, rateSuperseded } from '../services/rates.js';

// The posting function (ADR 0005, ADR 0008, ADR 0012, S03 rules 1–3): the only writer of the
// ledger tables. The database guards every rule again for every role; this function checks first,
// so a refusal answers with its code, and builds every amount itself with `packages/ledger`.

/** A manual line as the accountant gives it: a transaction amount, never a ledger amount. */
export interface ManualLineSpec {
  readonly accountId: string;
  /** At most one value per dimension type. */
  readonly dimensionValueIds: readonly string[];
  readonly currency: CurrencyCode;
  /** Minor units, positive debit and negative credit; never zero. */
  readonly amountMinor: bigint;
  readonly memo: string | null;
  /**
   * The existing open item a line on a `document` control account moves (S04 rule 7): it then
   * takes the item's dimensions. A line on a `running` account names none: its item is the
   * client's (rule 9).
   */
  readonly openItemId?: string | null;
  /** The manual document item the line opens (S04 rule 6): its reference and due date. */
  readonly newItem?: { readonly reference: string; readonly dueOn: string | null } | null;
}

/** The rate a manual entry was dealt at for a pair, quoted in the company's orientation of it. */
export interface DealtRateSpec {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: string;
}

/**
 * What a request posts: line specifications the function measures, or an entry it reverses, never
 * posted amounts (`packages/ledger`: measured lines are built, never taken). `today` is the date in
 * Asia/Damascus at posting, from the caller's clock (S03 rule 6). Later specs add their own kinds.
 */
export type PostingContent =
  | {
      readonly kind: 'manual';
      readonly lines: readonly ManualLineSpec[];
      readonly dealtRates: readonly DealtRateSpec[];
      readonly today: string;
    }
  | { readonly kind: 'reversal'; readonly entryId: string; readonly today: string };

/** A request to post, once by its client's idempotency key (ADR 0005 invariant 5). */
export interface PostingRequest {
  /** `manual`, `system`, or an API client's id (S05). */
  readonly client: string;
  /**
   * A manual entry's draft id; a reversal's `reversal:<entry id>`, so an entry's second reversal
   * finds the first one's key and is refused.
   */
  readonly idempotencyKey: string;
  readonly entryDate: string;
  /** البيان, 1–500 characters. */
  readonly description: string;
  readonly reference: string | null;
  readonly draftId: string | null;
  readonly preparedByUserId: string | null;
  readonly approvedByUserId: string | null;
  /** Who posts: a person for a manual entry; the audit row's actor. */
  readonly actor: AuditActor;
  readonly content: PostingContent;
}

/** The posted entry; `replayed` when the request had posted it before and nothing posted now. */
export interface PostedEntryRef {
  readonly id: string;
  readonly fiscalYear: number;
  readonly number: number;
  readonly sequence: bigint;
  readonly hash: string;
  readonly replayed: boolean;
}

/**
 * A line ready to store: the ledger's line (with the item it moves, S04) and its memo; `adjusted`
 * marks a manual movement on an item whose source is not manual (rule 8).
 */
interface BuiltLine {
  readonly line: Line;
  readonly memo: string | null;
  readonly adjusted: boolean;
}

/** An item a manual line opens or makes in this posting (S04 rules 3 and 6). */
interface NewItem {
  readonly id: string;
  readonly accountId: string;
  readonly kind: ItemKind;
  readonly reference: string;
  readonly dimensions: Dimensions;
  readonly clientValueId: string | null;
  readonly currency: CurrencyCode;
  readonly dueOn: string | null;
}

/** What a request posts, built: its lines, the rate rows they used and the items it makes. */
interface Built {
  readonly lines: readonly BuiltLine[];
  readonly rateIds: ReadonlyMap<ExchangeRate, string>;
  readonly newItems: readonly NewItem[];
  /** The running items a reversal moves, for the difference entry of S04 rule 13. */
  readonly voided: readonly VoidedRunningItem[];
}

type Role = 'conversion_rounding' | 'fx_realised_gain' | 'fx_realised_loss';

/** Where a role's line goes until the role's account is read: replaced, or `ACCOUNT_ROLE_MISSING`. */
const roleTarget = (role: Role) => `role:${role}`;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function refuse(code: ErrorCode, message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError(code, message, details);
}

/** Runs a check of one manual line, naming the line in its refusal (`details.lineNo`). */
function onLine<T>(lineNo: number, check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof DomainError) {
      throw new DomainError(error.code, error.message, { ...error.details, lineNo });
    }
    throw error;
  }
}

/** The request as its payload hash covers it: everything it posts, not who or when. */
function payloadOf(request: PostingRequest): CanonicalValue {
  const { content } = request;
  return {
    client: request.client,
    entryDate: request.entryDate,
    description: request.description,
    reference: request.reference,
    draftId: request.draftId,
    preparedByUserId: request.preparedByUserId,
    approvedByUserId: request.approvedByUserId,
    content:
      content.kind === 'manual'
        ? {
            kind: content.kind,
            lines: content.lines.map((line) => ({
              accountId: line.accountId,
              dimensionValueIds: [...line.dimensionValueIds].sort(),
              currency: line.currency,
              amountMinor: line.amountMinor,
              memo: line.memo,
              // Only when set, so a request of S03's shape hashes as it did.
              ...(line.openItemId && { openItemId: line.openItemId }),
              ...(line.newItem && {
                newItem: { reference: line.newItem.reference, dueOn: line.newItem.dueOn },
              }),
            })),
            dealtRates: content.dealtRates.map((rate) => ({ ...rate })),
          }
        : { kind: content.kind, entryId: content.entryId },
  };
}

/** The company of the transaction's `withCompany` context. */
async function contextCompany(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ id: string | null }>(sql`select current_company_id() as id`);
  const id = result.rows[0]?.id;
  if (!id) throw new TypeError('post() runs inside withCompany');
  return id;
}

/** The transaction time to the millisecond, as the entry stores and hashes it. */
async function transactionTime(tx: Transaction): Promise<Date> {
  // As text: Drizzle's client returns timestamps of a raw query unparsed.
  const result = await tx.execute<{ at: string }>(
    sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`,
  );
  const at = result.rows[0]?.at;
  if (at === undefined) throw new Error('No transaction time');
  return new Date(at);
}

/** The chart as `checkLineAgainstChart` reads it, for the accounts of `ids`. */
async function chartOf(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, ChartAccount>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(chartAccounts)
    .where(inArray(chartAccounts.id, [...ids]));
  const required = await tx
    .select({
      accountId: accountRequiredDimensions.accountId,
      typeId: accountRequiredDimensions.dimensionTypeId,
    })
    .from(accountRequiredDimensions)
    .where(
      and(
        inArray(accountRequiredDimensions.accountId, [...ids]),
        isNull(accountRequiredDimensions.archivedAt),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        kind: row.kind as ChartAccount['kind'],
        currency: row.currency as CurrencyCode | null,
        blocked: row.blockedAt !== null,
        archived: row.archivedAt !== null,
        isControl: row.isControl,
        itemKind: row.itemKind as ItemKind | null,
        requiredDimensionTypeIds: required
          .filter((link) => link.accountId === row.id)
          .map((link) => link.typeId),
      },
    ]),
  );
}

/** The dimension values of `ids` with their types; an unknown one is `NOT_FOUND`. */
async function dimensionValuesOf(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, LineDimensionValue>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: dimensionValues.id,
      typeId: dimensionValues.typeId,
      typeCode: dimensionTypes.code,
      parentValueId: dimensionValues.parentValueId,
      archivedAt: dimensionValues.archivedAt,
    })
    .from(dimensionValues)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, dimensionValues.companyId),
        eq(dimensionTypes.id, dimensionValues.typeId),
      ),
    )
    .where(inArray(dimensionValues.id, [...ids]));
  const values = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        typeId: row.typeId,
        typeCode: row.typeCode,
        parentValueId: row.parentValueId,
        archived: row.archivedAt !== null,
      },
    ]),
  );
  for (const id of ids) {
    if (!values.has(id)) refuse('NOT_FOUND', 'Unknown dimension value', { valueId: id });
  }
  return values;
}

/** The accounts of the roles that are set (S02 rule 7). */
async function roleAccounts(tx: Transaction): Promise<Map<string, string>> {
  const rows = await tx
    .select({ role: accountRoles.role, accountId: accountRoles.accountId })
    .from(accountRoles)
    .where(isNull(accountRoles.archivedAt));
  return new Map(rows.map((row) => [roleTarget(row.role as Role), row.accountId]));
}

/**
 * The rate rows that can be in force on `on`: of each pair and type, the newest row effective on
 * or before it, never a superseded one (S02 rules 15–16), with each row's id.
 */
async function ratesOn(
  tx: Transaction,
  on: string,
): Promise<{ rates: ExchangeRate[]; ids: Map<ExchangeRate, string> }> {
  const rows = await tx
    .selectDistinctOn([exchangeRates.base, exchangeRates.quote, exchangeRates.type])
    .from(exchangeRates)
    .where(and(lte(exchangeRates.effectiveOn, on), sql`not ${rateSuperseded}`))
    .orderBy(
      asc(exchangeRates.base),
      asc(exchangeRates.quote),
      asc(exchangeRates.type),
      desc(exchangeRates.effectiveOn),
    );
  const ids = new Map<ExchangeRate, string>();
  const rates = rows.map((row) => {
    const rate = exchangeRateOf(row);
    ids.set(rate, row.id);
    return rate;
  });
  return { rates, ids };
}

/**
 * A manual entry's dealt rates (S03 rule 13) as rates of the entry date: positive, of two
 * currencies, never SYP before the new pound (`INVALID_RATE`, `SYP_BEFORE_REDENOMINATION`), and in
 * the orientation of the company's pair when it holds one (`RATE_ORIENTATION`).
 */
async function dealtRatesOf(
  tx: Transaction,
  specs: readonly DealtRateSpec[],
  on: string,
): Promise<ExchangeRate[]> {
  const dealt: ExchangeRate[] = [];
  for (const spec of specs) {
    const parsed = exchangeRateSchema.safeParse({
      effectiveOn: on,
      base: spec.base,
      quote: spec.quote,
      rate: spec.rate,
      type: 'market',
      source: 'manual',
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const named = issue?.code === 'custom' ? issue.params?.code : undefined;
      refuse(named === 'SYP_BEFORE_REDENOMINATION' ? named : 'INVALID_RATE', 'A dealt rate', {
        base: spec.base,
        quote: spec.quote,
      });
    }
    const [held] = await tx
      .select({ base: ratePairs.base, quote: ratePairs.quote })
      .from(ratePairs)
      .where(
        or(
          and(eq(ratePairs.base, spec.base), eq(ratePairs.quote, spec.quote)),
          and(eq(ratePairs.base, spec.quote), eq(ratePairs.quote, spec.base)),
        ),
      );
    if (held && held.base !== spec.base) {
      refuse('RATE_ORIENTATION', `The pair is held as ${held.base}/${held.quote}`, {
        base: held.base,
        quote: held.quote,
      });
    }
    dealt.push(parsed.data);
  }
  return dealt;
}

/** Puts each role's account on its lines, or refuses with `ACCOUNT_ROLE_MISSING`. */
function withRoleAccounts(lines: readonly Line[], roles: ReadonlyMap<string, string>): Line[] {
  return lines.map((line) => {
    if (!line.account.startsWith('role:')) return line;
    const account = roles.get(line.account);
    if (account === undefined) {
      refuse('ACCOUNT_ROLE_MISSING', `The company has no ${line.account.slice(5)} account`, {
        role: line.account.slice(5),
      });
    }
    return { ...line, account };
  });
}

/** Checks lines against the chart (S02 rule 8, S03 rule 16), each with its dimension values. */
async function checkAgainstChart(
  tx: Transaction,
  lines: readonly Line[],
  origin: ChartLine['origin'],
): Promise<void> {
  const chart = await chartOf(tx, [...new Set(lines.map((line) => line.account))]);
  const values = await dimensionValuesOf(tx, [
    ...new Set(lines.flatMap((line) => Object.values(line.dimensions))),
  ]);
  for (const line of lines) {
    checkLineAgainstChart({
      account: chart.get(line.account),
      currency: line.transaction.currency,
      dimensions: Object.values(line.dimensions).map((id) => values.get(id) as LineDimensionValue),
      origin,
    });
  }
}

/** An item as stored, with its dimensions and what it carries, as `packages/ledger` moves it. */
interface StoredItem {
  readonly accountId: string;
  readonly source: ItemSource;
  readonly currency: CurrencyCode;
  readonly dimensions: Dimensions;
  readonly state: ItemState;
}

/**
 * The items of `ids` with their dimensions and balance rows, read `FOR UPDATE` when posting, after
 * the ledger head and the period (S04 "API"): two settlements of one item serialise on its row,
 * and the second clears from what the first left. An unknown id is absent from the answer.
 */
async function itemsOf(
  tx: Transaction,
  ids: readonly string[],
  lock: boolean,
): Promise<Map<string, StoredItem>> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return new Map();
  const rows = await tx.select().from(openItems).where(inArray(openItems.id, unique));
  if (rows.length === 0) return new Map();
  const balancesQuery = tx
    .select()
    .from(openItemBalances)
    .where(inArray(openItemBalances.itemId, unique))
    .orderBy(asc(openItemBalances.itemId));
  const balances = lock ? await balancesQuery.for('update') : await balancesQuery;
  const values = await tx
    .select()
    .from(dimensionSetValues)
    .where(inArray(dimensionSetValues.setId, [...new Set(rows.map((row) => row.dimensionSetId))]));
  const openings = await tx
    .select({ itemId: openItemMovements.itemId, amountMinor: openItemMovements.amountMinor })
    .from(openItemMovements)
    .innerJoin(
      openItems,
      and(
        eq(openItems.companyId, openItemMovements.companyId),
        eq(openItems.id, openItemMovements.itemId),
        eq(openItems.openedByEntryId, openItemMovements.entryId),
      ),
    )
    .where(and(inArray(openItemMovements.itemId, unique), eq(openItemMovements.kind, 'open')));
  return new Map(
    rows.map((row) => {
      const balance = balances.find((candidate) => candidate.itemId === row.id);
      if (balance === undefined) throw new Error('An item without its balance row');
      const currency = row.currency as CurrencyCode;
      const opening = openings.find((candidate) => candidate.itemId === row.id)?.amountMinor;
      if (row.kind === 'document' && (opening === undefined || opening === 0n)) {
        throw new Error('A document item without its opening');
      }
      const carried: CarriedAmounts = {
        transaction: money(balance.openMinor, currency),
        bookMinor: balance.bookMinor,
        parallelMinor: balance.parallelMinor,
      };
      return [
        row.id,
        {
          accountId: row.accountId,
          source: row.source as ItemSource,
          currency,
          dimensions: Object.fromEntries(
            values
              .filter((value) => value.setId === row.dimensionSetId)
              .map((value) => [value.typeId, value.valueId]),
          ) as Dimensions,
          state: {
            id: row.id,
            kind: row.kind as ItemKind,
            direction: row.kind === 'document' ? ((opening as bigint) < 0n ? -1 : 1) : null,
            balance: carried,
          },
        },
      ];
    }),
  );
}

/** The client's running item on an account in a currency, if it has one (S04 rule 3). */
async function runningItemOf(
  tx: Transaction,
  accountId: string,
  clientValueId: string,
  currency: CurrencyCode,
): Promise<string | null> {
  const [found] = await tx
    .select({ id: openItems.id })
    .from(openItems)
    .where(
      and(
        eq(openItems.kind, 'running'),
        eq(openItems.accountId, accountId),
        eq(openItems.clientValueId, clientValueId),
        eq(openItems.currency, currency),
      ),
    );
  return found?.id ?? null;
}

/**
 * Whether an item has a movement its opening's reversal would leave standing (S04 rule 13): one of
 * an entry other than the opening's that is neither a reversal nor reversed.
 */
async function hasStandingSettlements(
  tx: Transaction,
  itemId: string,
  openingEntryId: string,
): Promise<boolean> {
  const result = await tx.execute<{ standing: boolean }>(sql`
    select exists (
      select 1 from ${openItemMovements} m
      join ${journalEntries} e on e.company_id = m.company_id and e.id = m.entry_id
      where m.item_id = ${itemId} and m.kind <> 'open' and m.entry_id <> ${openingEntryId}
        and e.reverses_entry_id is null
        and not exists (
          select 1 from ${journalEntries} r
          where r.company_id = m.company_id and r.reverses_entry_id = m.entry_id
        )
    ) as standing`);
  return result.rows[0]?.standing === true;
}

/** Refuses an item line on a running account that names more than its client (S04 rule 9). */
function clientOf(values: readonly LineDimensionValue[], accountId: string): LineDimensionValue {
  const client = values.find((value) => value.typeCode === 'client');
  if (client === undefined) {
    refuse('DIMENSION_REQUIRED', 'A line on a running account names its client', { accountId });
  }
  if (values.length > 1) {
    refuse('VALIDATION_FAILED', 'A line on a running account names only its client', {
      accountId,
    });
  }
  return client;
}

/**
 * A manual entry's lines (S03 rules 12–16, S04 rules 2–12): each typed line checked against the
 * chart first, with the item it names:
 * - an existing item (`openItemId`), whose account, currency and dimensions the line takes
 *   (`OPEN_ITEM_MISMATCH`), with a memo on a Hub or opening item (`OPEN_ITEM_MEMO_REQUIRED`,
 *   adjusted);
 * - a new manual document item (`newItem`), its reference free on the account
 *   (`OPEN_ITEM_REFERENCE_TAKEN`) and its due date not before the entry date;
 * - on a running account, the client's item in the line's currency, found or made.
 *
 * Then `packages/ledger` opens, clears and moves the items and measures every new amount anew per
 * ledger with the dealt rates; each ledger's residual is a realised difference when a line is
 * carried or the entry has several currencies, conversion rounding otherwise, on its role's
 * account. A refusal of one typed line names it in `details.lineNo`.
 */
async function manualLines(
  tx: Transaction,
  content: Extract<PostingContent, { kind: 'manual' }>,
  on: string,
  ledgers: CompanyLedgers,
  daysOff: readonly number[],
  lock: boolean,
): Promise<Built> {
  const specs = content.lines.map((spec, index) => {
    if (spec.amountMinor === 0n) {
      refuse('VALIDATION_FAILED', 'A line of zero amount', { lineNo: index + 1 });
    }
    if (spec.openItemId && spec.newItem) {
      refuse('VALIDATION_FAILED', 'A line opens an item or moves one, not both', {
        lineNo: index + 1,
      });
    }
    return spec;
  });
  const existing = await itemsOf(
    tx,
    specs.flatMap((spec) => (spec.openItemId ? [spec.openItemId] : [])),
    lock,
  );
  // The values of the lines and of the items they name, for the chart check and dimension sets.
  const values = await dimensionValuesOf(tx, [
    ...new Set([
      ...specs.flatMap((spec) => spec.dimensionValueIds),
      ...[...existing.values()].flatMap((item) => Object.values(item.dimensions)),
    ]),
  ]);
  const chart = await chartOf(tx, [...new Set(specs.map((spec) => spec.accountId))]);
  const keepsParallel = ledgers.parallel !== null;
  const newItems: NewItem[] = [];
  const running = new Map<string, ItemState>();
  const lines = [];
  const adjustedOf: boolean[] = [];
  for (const [index, spec] of specs.entries()) {
    const account = chart.get(spec.accountId);
    const named = spec.dimensionValueIds.map((id) => values.get(id) as LineDimensionValue);
    const namedDimensions = Object.fromEntries(
      named.map((value) => [value.typeId, value.id]),
    ) as Dimensions;
    const lineNo = index + 1;
    let dimensions = namedDimensions;
    let item: ItemState | undefined;
    let adjusted = false;
    if (spec.openItemId) {
      const stored = existing.get(spec.openItemId);
      if (stored === undefined) {
        refuse('NOT_FOUND', 'No such open item', { itemId: spec.openItemId, lineNo });
      }
      dimensions = stored.dimensions;
      onLine(lineNo, () => {
        checkLineAgainstChart({
          account,
          currency: spec.currency,
          dimensions: Object.values(stored.dimensions).map(
            (id) => values.get(id) as LineDimensionValue,
          ),
          origin: 'manual',
          item: 'existing',
        });
        adjusted = checkItemLine(
          {
            account: spec.accountId,
            currency: spec.currency,
            dimensions: namedDimensions,
            memo: spec.memo,
          },
          {
            account: stored.accountId,
            currency: stored.currency,
            dimensions: stored.dimensions,
            source: stored.source,
          },
        ).adjusted;
      });
      item = stored.state;
    } else if (spec.newItem) {
      const { reference, dueOn } = spec.newItem;
      onLine(lineNo, () => {
        checkLineAgainstChart({
          account,
          currency: spec.currency,
          dimensions: named,
          origin: 'manual',
          item: 'new',
        });
        if (dueOn !== null) checkDueDate(on, dueOn);
      });
      const [taken] = await tx
        .select({ id: openItems.id })
        .from(openItems)
        .where(
          and(
            eq(openItems.kind, 'document'),
            eq(openItems.accountId, spec.accountId),
            eq(openItems.reference, reference),
          ),
        );
      if (
        taken ||
        newItems.some(
          (other) => other.accountId === spec.accountId && other.reference === reference,
        )
      ) {
        refuse('OPEN_ITEM_REFERENCE_TAKEN', 'The reference is used on this account', {
          reference,
          lineNo,
        });
      }
      const [normal] = await tx
        .select({ balance: chartAccounts.normalBalance })
        .from(chartAccounts)
        .where(eq(chartAccounts.id, spec.accountId));
      const id = uuidv7();
      newItems.push({
        id,
        accountId: spec.accountId,
        kind: 'document',
        reference,
        dimensions,
        clientValueId: named.find((value) => value.typeCode === 'client')?.id ?? null,
        currency: spec.currency,
        dueOn,
      });
      item = {
        id,
        kind: 'document',
        direction: null,
        // A receivable opens as a debit: an advance is never a credit item on it (ADR 0013).
        opensAs: normal?.balance === 'credit' ? -1 : 1,
        balance: emptyBalance(spec.currency, keepsParallel),
      };
    } else {
      onLine(lineNo, () =>
        checkLineAgainstChart({
          account,
          currency: spec.currency,
          dimensions: named,
          origin: 'manual',
        }),
      );
      if (account?.itemKind === 'running') {
        const client = onLine(lineNo, () => clientOf(named, spec.accountId));
        const key = JSON.stringify([spec.accountId, client.id, spec.currency]);
        dimensions = { [client.typeId]: client.id };
        item = running.get(key);
        if (item === undefined) {
          const id = await runningItemOf(tx, spec.accountId, client.id, spec.currency);
          if (id !== null) {
            const stored = (await itemsOf(tx, [id], lock)).get(id);
            if (stored === undefined) throw new Error('A running item read and lost');
            adjusted = onLine(lineNo, () =>
              checkItemLine(
                { account: spec.accountId, currency: spec.currency, dimensions, memo: spec.memo },
                {
                  account: stored.accountId,
                  currency: stored.currency,
                  dimensions: stored.dimensions,
                  source: stored.source,
                },
              ),
            ).adjusted;
            item = stored.state;
          } else {
            const [code] = await tx
              .select({ code: dimensionValues.code })
              .from(dimensionValues)
              .where(eq(dimensionValues.id, client.id));
            const id = uuidv7();
            newItems.push({
              id,
              accountId: spec.accountId,
              kind: 'running',
              reference: code?.code ?? client.id,
              dimensions,
              clientValueId: client.id,
              currency: spec.currency,
              dueOn: null,
            });
            item = {
              id,
              kind: 'running',
              direction: null,
              balance: emptyBalance(spec.currency, keepsParallel),
            };
          }
          running.set(key, item);
        }
      }
    }
    lines.push({
      account: spec.accountId,
      dimensions,
      amount: money(spec.amountMinor, spec.currency),
      ...(item !== undefined && { item }),
    });
    adjustedOf.push(adjusted);
  }
  const { rates, ids } = await ratesOn(tx, on);
  const context: MeasureContext = {
    ledgers,
    on,
    rates,
    calendar: await publicationCalendar(tx, daysOff),
  };
  const built = manualEntry(
    { lines, dealtRates: await dealtRatesOf(tx, content.dealtRates, on) },
    context,
    {
      gain: { account: roleTarget('fx_realised_gain') },
      loss: { account: roleTarget('fx_realised_loss') },
    },
  );
  const balanced = withRoleAccounts(
    balanceEntry({
      on,
      ledgers,
      lines: built.lines,
      rounding: { account: roleTarget('conversion_rounding') },
    }),
    await roleAccounts(tx),
  );
  const typedOf = (index: number) => built.typed[index] ?? null;
  // The difference and rounding lines go on the role accounts: checked as manual lines too.
  await checkAgainstChart(
    tx,
    balanced.filter((_, index) => typedOf(index) === null),
    'manual',
  );
  return {
    lines: balanced.map((line, index) => {
      const typed = typedOf(index);
      return {
        line,
        memo: typed === null ? null : (specs[typed]?.memo ?? null),
        adjusted: typed === null ? false : (adjustedOf[typed] ?? false),
      };
    }),
    rateIds: ids,
    newItems,
    voided: [],
  };
}

/** A stored conversion as `packages/ledger` reads it: one rate, or the two quotes of a cross. */
function conversionOf(
  rows: readonly (typeof lineConversions.$inferSelect)[],
  on: string,
): Conversion | null {
  const sorted = [...rows].sort((a, b) => a.quoteNo - b.quoteNo);
  const rates = sorted.map(
    (row): ExchangeRate => ({
      effectiveOn: row.effectiveOn,
      base: row.base as CurrencyCode,
      quote: row.quote as CurrencyCode,
      rate: row.rate,
      type: row.rateType as RateType,
      source: row.rateSource as RateSource,
    }),
  );
  const [first, second] = rates;
  if (first === undefined) return null;
  if (sorted[0]?.basis === 'transaction') return { basis: 'transaction', rate: first };
  if (second === undefined) return { basis: 'policy', rate: first };
  const cross: CrossRate = { on, legs: [first, second] };
  return { basis: 'policy', rate: cross };
}

/**
 * The accountant's reversal of a posted entry (S03 rule 9, S04 rule 13): the original read with its
 * lines, dimensions, conversions and item movements; `manualReversalLines()` refuses what is not
 * reversible by hand and negates every line at its amounts, so no rate is read, and each line
 * moves its item back. An opening is reversed only once its item's other movements are
 * (`OPEN_ITEM_HAS_SETTLEMENTS`). Each account is checked again for its state only. The running
 * items it moves come back with what they carried before, for the difference entry of rule 13.
 */
async function reversalLines(
  tx: Transaction,
  content: Extract<PostingContent, { kind: 'reversal' }>,
  on: string,
  ledgers: CompanyLedgers,
  lock: boolean,
): Promise<Built> {
  const [original] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, content.entryId));
  if (!original) refuse('NOT_FOUND', 'No such entry', { entryId: content.entryId });
  const [reversal] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.reversesEntryId, original.id));
  // The difference entry of a void (S04 rule 13) is posted under `<the reversal's key>:difference`.
  const [request] = await tx
    .select({ key: postingRequests.idempotencyKey })
    .from(postingRequests)
    .where(eq(postingRequests.id, original.requestId));
  const followsReversal =
    request?.key.startsWith('reversal:') === true && request.key.endsWith(':difference');
  const stored = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, original.id))
    .orderBy(asc(journalLines.lineNo));
  const lineIds = stored.map((line) => line.id);
  const conversions = await tx
    .select()
    .from(lineConversions)
    .where(inArray(lineConversions.lineId, lineIds));
  const movements = await tx
    .select({
      lineId: openItemMovements.lineId,
      itemId: openItemMovements.itemId,
      kind: openItemMovements.kind,
    })
    .from(openItemMovements)
    .where(eq(openItemMovements.entryId, original.id));
  const setValues = await tx
    .select()
    .from(dimensionSetValues)
    .where(
      inArray(dimensionSetValues.setId, [...new Set(stored.map((line) => line.dimensionSetId))]),
    );
  const lines = stored.map((row): Line => {
    const movement = movements.find((candidate) => candidate.lineId === row.id);
    const fields = {
      account: row.accountId,
      dimensions: Object.fromEntries(
        setValues
          .filter((value) => value.setId === row.dimensionSetId)
          .map((value) => [value.typeId, value.valueId]),
      ) as Dimensions,
      transaction: money(row.amountMinor, row.currency as CurrencyCode),
      bookMinor: row.bookMinor,
      parallelMinor: row.parallelMinor,
      ...(movement !== undefined && {
        item: { id: movement.itemId, movement: movement.kind as MovementKind },
      }),
    };
    if (row.kind === 'difference' || row.kind === 'rounding') {
      return { ...fields, kind: row.kind, ledger: row.ledger as Ledger };
    }
    if (row.kind === 'carried') return { ...fields, kind: 'carried' };
    const of = (ledger: Ledger) =>
      conversionOf(
        conversions.filter((c) => c.lineId === row.id && c.ledger === ledger),
        original.entryDate,
      );
    return {
      ...fields,
      kind: 'measured',
      conversions: { book: of('book'), parallel: of('parallel') },
    };
  });
  const negated = manualReversalLines(
    {
      source: original.source as EntrySource,
      date: original.entryDate,
      isReversal: original.reversesEntryId !== null,
      reversed: reversal !== undefined,
      followsReversal,
      lines,
    },
    on,
  );
  await checkAgainstChart(tx, negated, 'reversal');
  // The reversal carries its own rounding lines, so balancing adds nothing (ADR 0007).
  const balanced = balanceEntry({
    on,
    ledgers,
    lines: negated,
    rounding: { account: roleTarget('conversion_rounding') },
  });
  if (balanced.length !== negated.length) throw new Error('A reversal needed a rounding line');
  const items = await itemsOf(
    tx,
    movements.map((movement) => movement.itemId),
    lock,
  );
  for (const movement of movements) {
    if (
      movement.kind === 'open' &&
      (await hasStandingSettlements(tx, movement.itemId, original.id))
    ) {
      refuse('OPEN_ITEM_HAS_SETTLEMENTS', 'Reverse the settlements of the item first', {
        itemId: movement.itemId,
      });
    }
  }
  const voided: VoidedRunningItem[] = [];
  for (const [id, item] of items) {
    if (item.state.kind !== 'running') continue;
    const reversed = movementOn(
      negated,
      id,
      item.currency,
      item.state.balance.parallelMinor !== null,
    );
    voided.push({
      id,
      target: { account: item.accountId, dimensions: item.dimensions },
      before: item.state.balance,
      reversed,
    });
  }
  const isManual = original.source === 'manual';
  return {
    lines: negated.map((line, index) => ({
      line,
      memo: stored[index]?.memo ?? null,
      adjusted: line.item !== undefined && isManual && items.get(line.item.id)?.source !== 'manual',
    })),
    rateIds: new Map(),
    newItems: [],
    voided,
  };
}

/**
 * The exchange-difference entry that follows a reversal's movements on running items (S04 rule 13,
 * ADR 0013): on each running item it moved against the balance or across zero, what brings the
 * item to the carrying amount of a new movement under rule 3 (across zero, the item cleared and
 * the excess measured anew at the policy rates of the reversal's date, with its conversions;
 * `RATE_MISSING` without a rate), and each ledger's residual as a realised gain or loss. Null when
 * no item needs one.
 */
async function voidDifferenceLines(
  tx: Transaction,
  voided: readonly VoidedRunningItem[],
  on: string,
  ledgers: CompanyLedgers,
  daysOff: readonly number[],
): Promise<Built | null> {
  if (voided.length === 0) return null;
  const { rates, ids } = await ratesOn(tx, on);
  const context: MeasureContext = {
    ledgers,
    on,
    rates,
    calendar: await publicationCalendar(tx, daysOff),
  };
  const differences = runningVoidDifferenceLines(voided, context, {
    gain: { account: roleTarget('fx_realised_gain') },
    loss: { account: roleTarget('fx_realised_loss') },
  });
  if (differences.length === 0) return null;
  const lines = withRoleAccounts(
    balanceEntry({
      on,
      ledgers,
      lines: differences,
      rounding: { account: roleTarget('conversion_rounding') },
    }),
    await roleAccounts(tx),
  );
  // The items' lines carry their item's account and dimensions; the realised lines are new.
  await checkAgainstChart(
    tx,
    lines.filter((line) => line.item !== undefined),
    'reversal',
  );
  await checkAgainstChart(
    tx,
    lines.filter((line) => line.item === undefined),
    'manual',
  );
  // The difference entry follows a manual reversal: a manual movement on a Hub or opening item is
  // adjusted in Mizan, as the reversal's own movements are (S04 rule 8).
  const sources = await tx
    .select({ id: openItems.id, source: openItems.source })
    .from(openItems)
    .where(
      inArray(
        openItems.id,
        voided.map((item) => item.id),
      ),
    );
  const adjusted = (line: Line) =>
    line.item !== undefined &&
    sources.find((item) => item.id === line.item?.id)?.source !== 'manual';
  return {
    lines: lines.map((line) => ({ line, memo: null, adjusted: adjusted(line) })),
    // Across zero, the excess is measured at the void date: its rate rows are recorded.
    rateIds: ids,
    newItems: [],
    voided: [],
  };
}

/** The conversions of a line as stored: one row per rate it used, two for a cross. */
function conversionsOf(
  line: Line,
  rateIds: ReadonlyMap<ExchangeRate, string>,
  measuredHere: boolean,
): ChainConversion[] {
  if (line.kind !== 'measured' || !measuredHere) return [];
  return (['book', 'parallel'] as const).flatMap((ledger) => {
    const conversion = line.conversions[ledger];
    if (conversion === null) return [];
    const rates = 'legs' in conversion.rate ? [...conversion.rate.legs] : [conversion.rate];
    return rates.map((rate, index) => {
      const rateId = conversion.basis === 'policy' ? rateIds.get(rate) : undefined;
      if (conversion.basis === 'policy' && rateId === undefined) {
        throw new Error('A policy rate without its row');
      }
      return {
        ledger,
        basis: conversion.basis,
        quoteNo: index + 1,
        rateId: rateId ?? null,
        base: rate.base,
        quote: rate.quote,
        rate: rate.rate,
        rateType: rate.type,
        rateSource: rate.source,
        effectiveOn: rate.effectiveOn,
      };
    });
  });
}

/** The key of a set of dimension values: its `type:value` ids, sorted by type. */
function dimensionKey(dimensions: Dimensions): string {
  return Object.entries(dimensions)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([type, value]) => `${type}:${value}`)
    .join(',');
}

/** The id of the company's set of these values, made the first time a line carries them. */
async function dimensionSetOf(
  tx: Transaction,
  companyId: string,
  dimensions: Dimensions,
): Promise<string> {
  const key = dimensionKey(dimensions);
  const [found] = await tx
    .select({ id: dimensionSets.id })
    .from(dimensionSets)
    .where(eq(dimensionSets.key, key));
  if (found) return found.id;
  const id = uuidv7();
  await tx.insert(dimensionSets).values({ id, companyId, key });
  const pairs = Object.entries(dimensions);
  if (pairs.length > 0) {
    await tx
      .insert(dimensionSetValues)
      .values(pairs.map(([typeId, valueId]) => ({ companyId, setId: id, typeId, valueId })));
  }
  return id;
}

/**
 * The dates of a request: a manual date up to the end of the current month in Damascus
 * (`ENTRY_DATE_OUT_OF_RANGE`), and no SYP amount before the new pound, in a ledger or on a line
 * (ADR 0005 invariant 8).
 */
function checkDates(on: string, content: PostingContent, ledgers: CompanyLedgers): void {
  checkManualEntryDate(on, content.today);
  for (const [, ledger] of keptLedgers(ledgers)) checkCurrencyDate(ledger.currency, on);
  if (content.kind === 'manual') {
    for (const [index, line] of content.lines.entries()) {
      onLine(index + 1, () => checkCurrencyDate(line.currency, on));
    }
  }
}

/**
 * The lines of a request, checked and built by `packages/ledger`, with the rate rows they used, the
 * items it makes and the running items a reversal moves. `lock` reads the items' balance rows
 * `FOR UPDATE` (posting, after the head and the period); the preview reads them without a lock.
 */
async function buildLines(
  tx: Transaction,
  content: PostingContent,
  on: string,
  ledgers: CompanyLedgers,
  daysOff: readonly number[],
  lock: boolean,
): Promise<Built> {
  return content.kind === 'manual'
    ? manualLines(tx, content, on, ledgers, daysOff, lock)
    : reversalLines(tx, content, on, ledgers, lock);
}

/** A line as the preview shows it: as `post()` would store it, with its conversions and item. */
export interface PreviewLine {
  readonly lineNo: number;
  readonly accountId: string;
  readonly dimensionValueIds: readonly string[];
  readonly kind: Line['kind'];
  readonly ledger: Ledger | null;
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
  readonly bookMinor: bigint;
  readonly parallelMinor: bigint | null;
  readonly memo: string | null;
  readonly conversions: readonly ChainConversion[];
  /**
   * The item the line moves and how (S04), `adjusted` for a manual movement on a Hub or opening
   * item (rule 8); an item the posting would make has the preview's own id and `isNew`, with its
   * reference (a running item's: its client's code).
   */
  readonly item: {
    readonly id: string;
    readonly movement: MovementKind;
    readonly adjusted: boolean;
    readonly isNew: boolean;
    readonly reference: string | null;
  } | null;
}

/**
 * The lines a request would post now (S03 rule 7), inside `withCompany`, built by the posting
 * function's own code with no write and no lock: the dates, the period (`PERIOD_CLOSED` when its
 * row is closed), the chart checks, the items, the measurement, the realised differences and the
 * rounding. It refuses as `post()` would; a refusal of one manual line names it in
 * `details.lineNo`.
 */
export async function previewPosting(
  tx: Transaction,
  request: Pick<PostingRequest, 'entryDate' | 'content'>,
): Promise<PreviewLine[]> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const ledgers = ledgersOf(settings);
  const on = request.entryDate;
  const { content } = request;
  checkDates(on, content, ledgers);
  const period = periodOf(on);
  const [periodRow] = await tx
    .select({ state: periods.state })
    .from(periods)
    .where(eq(periods.period, period));
  if (periodRow && periodRow.state !== 'open') {
    refuse('PERIOD_CLOSED', `The period ${period} is closed`, { period });
  }
  const built = await buildLines(tx, content, on, ledgers, settings.bulletinDaysOff, false);
  const made = new Map(built.newItems.map((item) => [item.id, item]));
  return built.lines.map(({ line, memo, adjusted }, index) => ({
    lineNo: index + 1,
    accountId: line.account,
    dimensionValueIds: Object.values(line.dimensions),
    kind: line.kind,
    ledger: line.kind === 'difference' || line.kind === 'rounding' ? line.ledger : null,
    currency: line.transaction.currency,
    amountMinor: line.transaction.amountMinor,
    bookMinor: line.bookMinor,
    parallelMinor: line.parallelMinor,
    memo,
    conversions: conversionsOf(line, built.rateIds, content.kind === 'manual'),
    item:
      line.item === undefined
        ? null
        : {
            ...line.item,
            adjusted,
            isNew: made.has(line.item.id),
            reference: made.get(line.item.id)?.reference ?? null,
          },
  }));
}

/** The company's ledger head as a posting moves it, entry by entry. */
interface Head {
  readonly id: string;
  entryCount: bigint;
  lastHash: string | null;
}

/** One entry to write: its request's row, its header fields and its built lines. */
interface EntryToWrite {
  readonly requestId: string;
  readonly description: string;
  readonly reference: string | null;
  readonly reversesEntryId: string | null;
  readonly draftId: string | null;
  readonly preparedByUserId: string | null;
  readonly approvedByUserId: string | null;
  readonly built: Built;
  /** What the audit row adds: the reversal a void's difference entry follows (S04 rule 13). */
  readonly follows: string | null;
}

/**
 * Writes one entry of a posting (steps 5–7 of `post()`): the accounts and the books marked as
 * used, the next number of the fiscal year of the entry date, the dimension sets, the hash, the
 * entry, its lines and conversions, the items it makes with their opening due dates, the item
 * movements of its lines, the `entry.posted` audit row with the items its lines moved, and the
 * head moved past it.
 */
async function writeEntry(
  tx: Transaction,
  companyId: string,
  head: Head,
  at: { readonly on: string; readonly fiscalYear: number; readonly settingsId: string },
  actor: AuditActor,
  entry: EntryToWrite,
): Promise<PostedEntryRef> {
  const { on, fiscalYear } = at;
  const { built, reversesEntryId } = entry;
  const postedAt = await transactionTime(tx);
  const accountIds = [...new Set(built.lines.map(({ line }) => line.account))];
  await tx
    .update(chartAccounts)
    .set({ firstPostedAt: postedAt })
    .where(and(inArray(chartAccounts.id, accountIds), isNull(chartAccounts.firstPostedAt)));
  await tx
    .update(companySettings)
    .set({ booksStartedAt: postedAt })
    .where(and(eq(companySettings.id, at.settingsId), isNull(companySettings.booksStartedAt)));
  const [counter] = await tx
    .insert(entryNumberCounters)
    .values({ companyId, fiscalYear, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [entryNumberCounters.companyId, entryNumberCounters.fiscalYear],
      set: { lastNumber: sql`${entryNumberCounters.lastNumber} + 1`, updatedAt: sql`now()` },
    })
    .returning({ lastNumber: entryNumberCounters.lastNumber });
  if (!counter) throw new Error('No entry number');
  const sets = new Map<string, string>();
  for (const dimensions of [
    ...built.lines.map(({ line }) => line.dimensions),
    ...built.newItems.map((item) => item.dimensions),
  ]) {
    const key = dimensionKey(dimensions);
    if (!sets.has(key)) sets.set(key, await dimensionSetOf(tx, companyId, dimensions));
  }

  const entryId = uuidv7();
  const sequence = head.entryCount + 1n;
  const lines = built.lines.map(({ line, memo }, index) => ({
    id: uuidv7(),
    lineNo: index + 1,
    accountId: line.account,
    dimensionSetId: sets.get(dimensionKey(line.dimensions)) as string,
    dimensionKey: dimensionKey(line.dimensions),
    kind: line.kind,
    ledger: line.kind === 'difference' || line.kind === 'rounding' ? line.ledger : null,
    currency: line.transaction.currency,
    amountMinor: line.transaction.amountMinor,
    bookMinor: line.bookMinor,
    parallelMinor: line.parallelMinor,
    memo,
    // The item a line moves joins its hashed value only when it has one (S04).
    ...(line.item !== undefined && { itemId: line.item.id }),
    // A reversal carries amounts: it used no rate (S02 rule 15 lists the entries that did).
    conversions: conversionsOf(line, built.rateIds, reversesEntryId === null),
  }));
  const header = {
    id: entryId,
    companyId,
    requestId: entry.requestId,
    sequence,
    fiscalYear,
    number: counter.lastNumber,
    entryDate: on,
    postedAt: postedAt.toISOString(),
    source: 'manual' as const,
    sourceRef: null,
    hubDocument: null,
    description: entry.description,
    reference: entry.reference,
    reversesEntryId,
    draftId: entry.draftId,
    preparedByUserId: entry.preparedByUserId,
    approvedByUserId: entry.approvedByUserId,
    postedByUserId: actor.kind === 'person' ? actor.userId : null,
    postedByClientId: null,
  };
  const chained: ChainEntry = { ...header, lines };
  const hash = entryHash(chainEntryValue(chained), head.lastHash);

  await tx.insert(journalEntries).values({
    ...header,
    postedAt,
    lineCount: lines.length,
    previousHash: head.lastHash,
    hash,
  });
  await tx.insert(journalLines).values(
    lines.map((line) => ({
      id: line.id,
      companyId,
      entryId,
      lineNo: line.lineNo,
      accountId: line.accountId,
      dimensionSetId: line.dimensionSetId,
      kind: line.kind,
      ledger: line.ledger,
      currency: line.currency,
      amountMinor: line.amountMinor,
      bookMinor: line.bookMinor,
      parallelMinor: line.parallelMinor,
      memo: line.memo,
    })),
  );
  const conversions = lines.flatMap((line) =>
    line.conversions.map((conversion) => ({ companyId, lineId: line.id, ...conversion })),
  );
  if (conversions.length > 0) await tx.insert(lineConversions).values(conversions);
  if (built.newItems.length > 0) {
    await tx.insert(openItems).values(
      built.newItems.map((item) => ({
        id: item.id,
        companyId,
        accountId: item.accountId,
        kind: item.kind,
        reference: item.reference,
        source: 'manual' as const,
        hubDocument: null,
        dimensionSetId: sets.get(dimensionKey(item.dimensions)) as string,
        clientValueId: item.clientValueId,
        currency: item.currency,
        documentDate: on,
        openedByEntryId: entryId,
      })),
    );
    const dueDates = built.newItems.flatMap((item) =>
      item.dueOn === null
        ? []
        : [
            {
              companyId,
              itemId: item.id,
              dueOn: item.dueOn,
              effectiveOn: on,
              setBy: 'opening' as const,
            },
          ],
    );
    if (dueDates.length > 0) await tx.insert(openItemDueDates).values(dueDates);
  }
  const movements = built.lines.flatMap(({ line, adjusted }, index) =>
    line.item === undefined
      ? []
      : [
          {
            companyId,
            itemId: line.item.id,
            lineId: (lines[index] as (typeof lines)[number]).id,
            entryId,
            entryDate: on,
            kind: line.item.movement,
            adjusted,
            amountMinor: line.transaction.amountMinor,
            bookMinor: line.bookMinor,
            parallelMinor: line.parallelMinor,
          },
        ],
  );
  if (movements.length > 0) await tx.insert(openItemMovements).values(movements);
  const items = built.lines.flatMap(({ line }, index) =>
    line.item === undefined
      ? []
      : [{ lineNo: index + 1, itemId: line.item.id, movement: line.item.movement }],
  );
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'entry.posted',
    entityType: 'journal_entry',
    entityId: entryId,
    after: {
      fiscalYear,
      number: counter.lastNumber,
      entryDate: on,
      source: header.source,
      description: entry.description,
      reference: entry.reference,
      lineCount: lines.length,
      ...(reversesEntryId !== null && { reverses: reversesEntryId }),
      ...(items.length > 0 && { items }),
      ...(entry.follows !== null && { follows: entry.follows }),
    },
  });
  await tx
    .update(ledgerHeads)
    .set({ entryCount: sequence, lastEntryId: entryId, lastHash: hash })
    .where(eq(ledgerHeads.id, head.id));
  head.entryCount = sequence;
  head.lastHash = hash;
  return { id: entryId, fiscalYear, number: counter.lastNumber, sequence, hash, replayed: false };
}

/**
 * Posts an entry, inside `withCompany` (S03 rules 1–3), in the lock order of ADR 0008:
 * 1. the posting request: its key posted before with the same payload answers that entry and posts
 *    nothing; with another payload it is `IDEMPOTENCY_CONFLICT`; a reversal's key
 *    (`reversal:<entry id>`) posted before is `ENTRY_ALREADY_REVERSED`;
 * 2. the company's ledger head `FOR UPDATE`, then its settings row `FOR UPDATE`;
 * 3. a manual date up to the end of the current month (`ENTRY_DATE_OUT_OF_RANGE`), then the
 *    period of the entry date, made open when missing, `FOR SHARE` (`PERIOD_CLOSED`);
 * 4. the lines, checked against the chart and built by `packages/ledger` (`balanceEntry()` last),
 *    the balance row of each item they move read `FOR UPDATE` (S04);
 * 5. the accounts and the books marked as used, the next number of the fiscal year of the entry
 *    date, the dimension sets;
 * 6. the hash over the entry as stored (`chainEntryValue()`) and the previous hash;
 * 7. the entry, its lines and conversions, its new items and their movements, the `entry.posted`
 *    audit row, then the head.
 * A reversal that moves a running item against its balance or across zero is followed, in the same
 * transaction, by its exchange-difference entry under its own request `<key>:difference` (S04
 * rule 13), with its own number and audit row; the answer is the reversal. Any refusal throws and
 * the caller's transaction rolls back, so no number is used up. The deferred guards check the
 * balance, the reversal, the items, the head and the number at commit.
 */
export async function post(tx: Transaction, request: PostingRequest): Promise<PostedEntryRef> {
  const companyId = await contextCompany(tx);
  const payloadHash = sha256(canonicalJson(payloadOf(request)));
  const [created] = await tx
    .insert(postingRequests)
    .values({
      companyId,
      client: request.client,
      idempotencyKey: request.idempotencyKey,
      payloadHash,
    })
    .onConflictDoNothing({
      target: [postingRequests.companyId, postingRequests.client, postingRequests.idempotencyKey],
    })
    .returning({ id: postingRequests.id });
  if (!created) {
    // A reversal's key is its original's: a second reversal, at once or later, is refused rather
    // than answered as the first (S03 rule 9, edge case 13; scenario manual/reversal).
    if (request.content.kind === 'reversal') {
      refuse('ENTRY_ALREADY_REVERSED', 'The entry has a reversal already', {
        entryId: request.content.entryId,
      });
    }
    return replay(tx, request, payloadHash);
  }

  const [headRow] = await tx.select().from(ledgerHeads).for('update');
  const [settings] = await tx.select().from(companySettings).for('update');
  if (!headRow || !settings) throw new Error('A company without its ledger head or settings');
  const ledgers = ledgersOf(settings);
  const on = request.entryDate;
  const { content } = request;
  checkDates(on, content, ledgers);
  const fiscalYear = fiscalYearOf(on, settings.fiscalYearStartMonth);
  const period = periodOf(on);
  await tx
    .insert(periods)
    .values({ companyId, period, fiscalYear, state: 'open' })
    .onConflictDoNothing({ target: [periods.companyId, periods.period] });
  const [periodRow] = await tx
    .select({ state: periods.state })
    .from(periods)
    .where(eq(periods.period, period))
    .for('share');
  if (periodRow?.state !== 'open') {
    refuse('PERIOD_CLOSED', `The period ${period} is closed`, { period });
  }

  const built = await buildLines(tx, content, on, ledgers, settings.bulletinDaysOff, true);
  const reversesEntryId = content.kind === 'reversal' ? content.entryId : null;
  const head: Head = { id: headRow.id, entryCount: headRow.entryCount, lastHash: headRow.lastHash };
  const at = { on, fiscalYear, settingsId: settings.id };
  const posted = await writeEntry(tx, companyId, head, at, request.actor, {
    requestId: created.id,
    description: request.description,
    reference: request.reference,
    reversesEntryId,
    draftId: request.draftId,
    preparedByUserId: request.preparedByUserId,
    approvedByUserId: request.approvedByUserId,
    built,
    follows: null,
  });
  const difference = await voidDifferenceLines(
    tx,
    built.voided,
    on,
    ledgers,
    settings.bulletinDaysOff,
  );
  if (difference !== null) {
    const differenceKey = `${request.idempotencyKey}:difference`;
    const [differenceRequest] = await tx
      .insert(postingRequests)
      .values({
        companyId,
        client: request.client,
        idempotencyKey: differenceKey,
        payloadHash: sha256(
          canonicalJson({ client: request.client, follows: posted.id, entryDate: on }),
        ),
      })
      .returning({ id: postingRequests.id });
    if (!differenceRequest) throw new Error('No posting request for the difference entry');
    await writeEntry(tx, companyId, head, at, request.actor, {
      requestId: differenceRequest.id,
      description: request.description,
      reference: request.reference,
      reversesEntryId: null,
      draftId: null,
      preparedByUserId: request.preparedByUserId,
      approvedByUserId: request.approvedByUserId,
      built: difference,
      follows: posted.id,
    });
  }
  return posted;
}

/** A request posted before: its entry, when its payload is the same (ADR 0005 invariant 5). */
async function replay(
  tx: Transaction,
  request: PostingRequest,
  payloadHash: string,
): Promise<PostedEntryRef> {
  const [first] = await tx
    .select()
    .from(postingRequests)
    .where(
      and(
        eq(postingRequests.client, request.client),
        eq(postingRequests.idempotencyKey, request.idempotencyKey),
      ),
    );
  if (!first) throw new Error('A posting request neither made nor found');
  if (first.payloadHash !== payloadHash) {
    refuse('IDEMPOTENCY_CONFLICT', 'The key was used with another request', {
      idempotencyKey: request.idempotencyKey,
    });
  }
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.requestId, first.id));
  if (!entry) throw new Error('A posting request without its entry');
  return {
    id: entry.id,
    fiscalYear: entry.fiscalYear,
    number: entry.number,
    sequence: entry.sequence,
    hash: entry.hash,
    replayed: true,
  };
}
