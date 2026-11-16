import { createHash } from 'node:crypto';
import {
  type ClosingRate,
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
  type ProjectDocumentKind,
  type RateSource,
  type RateType,
  type VoucherKind,
} from '@vertex-mizan/contracts';
import {
  balanceAtEnd,
  balanceEntry,
  balancingLine,
  boxShortfall,
  buildProjectDocument,
  type CanonicalValue,
  type CarriedAmounts,
  type ChainConversion,
  type ChainCovered,
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
  checkVoucherShape,
  countDifference,
  counterpartyOf,
  countLines,
  type Dimensions,
  dealtRateAccepted,
  derivedDealtRate,
  type EntrySource,
  emptyBalance,
  entryHash,
  firstDayOfNextMonth,
  fiscalYearOf,
  type ItemState,
  keptLedgers,
  type Line,
  type LineDimensionValue,
  type LineQuantity,
  type MeasureContext,
  manualEntry,
  manualReversalLines,
  measuredLine,
  moveItem,
  movementOn,
  netChanges,
  type ProjectDocumentInput,
  periodOf,
  type RevaluedBalance,
  type RunningTarget,
  resolveLineAmount,
  revaluationLines,
  revaluationReversalLines,
  reverseLines,
  runningVoidDifferenceLines,
  type VoidedRunningItem,
} from '@vertex-mizan/ledger';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { cashVouchers, voucherSequences } from '../schema/cash.js';
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
  periodEvents,
  periods,
  postingRequests,
  revaluations,
} from '../schema/ledger.js';
import {
  openItemBalances,
  openItemDueDates,
  openItemMovements,
  openItems,
} from '../schema/open-items.js';
import { openings } from '../schema/opening.js';
import {
  advanceApplications,
  lineQuantities,
  projectDocumentSequences,
  projectDocuments,
} from '../schema/project-documents.js';
import { materials, projectTerms, subcontracts } from '../schema/projects.js';
import { exchangeRates, ratePairs } from '../schema/rates.js';
import { ledgersOf } from '../services/companies.js';
import { exchangeRateOf, publicationCalendar, rateSuperseded } from '../services/rates.js';
import { isClosedPeriod, readClosedPeriods } from './periods.js';

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
  /**
   * The line's material and quantity (S12 rules 4–6): required on an account that requires a
   * material, its amount then their product; never on a line that moves an item.
   */
  readonly quantity?: LineQuantity | null;
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
  | { readonly kind: 'reversal'; readonly entryId: string; readonly today: string }
  /**
   * A ledger's month-end revaluation of `period` (S07 rules 10–14), dated on its last day: the
   * balances with the differences the revaluation service found under the head lock, in the same
   * transaction, from what the books hold and the closing rates; `revaluationLines()` makes each
   * difference two difference lines in `ledger` only. Each balance's `account` is an account id,
   * its `dimensions` value ids by type id and its `item` an open item id. The posting writes the
   * entry, its reversal on the next month's first day and the revaluation's row with the preview's
   * `fingerprint` and the closing `rates`. No caller outside `packages/db` builds one.
   */
  | {
      readonly kind: 'revaluation';
      readonly period: string;
      readonly ledger: Ledger;
      readonly fingerprint: string;
      readonly rates: readonly ClosingRate[];
      readonly balances: readonly RevaluedBalance[];
      readonly today: string;
    }
  /**
   * The opening entry (S10 rules 17–19, 23; ADR 0019), dated on the books start: its lines in their
   * order, each a new measurement at the rates in force on `measuredOn` (the eve) or `stated` with
   * the book and parallel amounts the opening service computed or the records give, and the items
   * the measured ones open (source `opening`); the balancing line on the retained-earnings role's
   * account is added here, so each ledger balances on its own. Posted by the opening service only,
   * under `opening:<opening id>`.
   */
  | {
      readonly kind: 'opening';
      readonly openingId: string;
      readonly measuredOn: string;
      readonly lines: readonly OpeningLineSpec[];
      readonly today: string;
    }
  /**
   * The opening's whole reversal (S10 rule 25): the opening entry negated line by line on the books
   * start, each item moved back; no rate read. Its source is `opening`.
   */
  | { readonly kind: 'opening_reversal'; readonly entryId: string; readonly today: string }
  /**
   * A project document (S12 rules 4–13, 21; ADR 0023): its header and lines as the draft holds
   * them; `buildProjectDocument()` derives the entry under the head lock, from the accounts of
   * `contracting@1` and the items it reads, and the posting numbers the document per kind and
   * fiscal year and writes it with its quantities and advance applications.
   */
  | {
      readonly kind: 'project_document';
      readonly document: ProjectDocumentSpec;
      readonly lines: readonly DocumentLineSpec[];
      readonly today: string;
    };

/** A project document's header as it posts (S12 "Drafts"). */
export interface ProjectDocumentSpec {
  readonly kind: ProjectDocumentKind;
  /** The project: a value of the `contract` dimension of kind `project`. */
  readonly contractValueId: string;
  /** The supplier of a purchase, a subcontract billing or a supplier's release; null otherwise. */
  readonly counterpartyValueId: string | null;
  /** A purchase's or a wage sheet's; a billing's and a release's are their terms' (null here). */
  readonly currency: CurrencyCode | null;
  /** A retention release's side (S12 rules 19–20); null on other kinds. */
  readonly side: 'client' | 'supplier' | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  /** A billing's cumulative certified value (S12 rule 14). */
  readonly cumulativeMinor: bigint | null;
  /** A billing's retention as typed, or a supplier's release's amount (S12 rules 15, 20). */
  readonly retentionMinor: bigint | null;
  /** The advance a purchase applies or a billing recovers, as typed; null for none or computed. */
  readonly advanceMinor: bigint | null;
  readonly supplierReference: string | null;
}

/**
 * A project document's line as typed: a purchase's cost line on its account, or a wage sheet's
 * line (its account the wages account, its one dimension value the worker). Its amount is typed
 * only on a price adjustment, a lump sum or a line with no quantity.
 */
export interface DocumentLineSpec {
  readonly accountId: string | null;
  readonly dimensionValueIds: readonly string[];
  readonly amountMinor: bigint | null;
  readonly memo: string | null;
  readonly quantity: LineQuantity | null;
  /** A purchase line's covered part as typed (S12 rule 12). */
  readonly advanceMinor: bigint | null;
  /** A client's release line: the retention item released, its amount the line's (S12 rule 19). */
  readonly openItemId?: string | null;
}

/**
 * A line of the opening entry (S10 rules 14–17): the accountant's. A measured line on a document
 * control account opens `newItem`; on a running one, the client's item. A stated line gives its
 * book and parallel amounts (the parallel null exactly without a parallel ledger).
 */
export interface OpeningLineSpec {
  readonly accountId: string;
  readonly dimensionValueIds: readonly string[];
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
  readonly memo: string | null;
  readonly stated?: { readonly bookMinor: bigint; readonly parallelMinor: bigint | null };
  readonly newItem?: {
    readonly reference: string;
    readonly dueOn: string | null;
    /** The document's own date: the eve, or the date the records give. */
    readonly documentDate: string;
  };
}

type MeasuredContent = Extract<PostingContent, { kind: 'manual' }>;

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
  /**
   * A voucher draft's header (S11 rule 9): the posting takes the voucher's next number of its kind
   * and fiscal year, writes the voucher with the entry and puts its number in an empty reference.
   * Set only by `postVoucher()`, with the draft id.
   */
  readonly voucher?: VoucherSpec;
}

/**
 * A voucher draft's header as it posts (S11 rules 9–13): its kind and cash account, a transfer's
 * destination, the party as printed, and a count's counted amount and the expected balance its
 * preview showed (null in a preview).
 */
export interface VoucherSpec {
  readonly kind: VoucherKind;
  readonly cashAccountId: string;
  readonly counterCashAccountId: string | null;
  readonly partyName: string | null;
  readonly countedMinor: bigint | null;
  readonly expectedMinor: bigint | null;
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
  /** Its value of the account's counterparty type (S11, ADR 0022). */
  readonly counterpartyValueId: string | null;
  readonly currency: CurrencyCode;
  readonly dueOn: string | null;
  /** Its document date: the entry date, or the opening's (S10). */
  readonly documentDate: string;
}

/** What a request posts, built: its lines, the rate rows they used and the items it makes. */
interface Built {
  readonly lines: readonly BuiltLine[];
  readonly rateIds: ReadonlyMap<ExchangeRate, string>;
  readonly newItems: readonly NewItem[];
  /** The running items a reversal moves, for the difference entry of S04 rule 13. */
  readonly voided: readonly VoidedRunningItem[];
  /** Each line's material and quantity (S12 rule 4), by line; absent when none has one. */
  readonly quantities?: readonly (LineQuantity | null)[];
  /** The line that clears an applied advance, which the covered lines name (S12 rule 12). */
  readonly advanceLine?: number | null;
  /** The project document the lines post (S12 rule 21). */
  readonly document?: BuiltDocumentRow;
}

/** What a project document's row takes from its build (S12 "Data"). */
interface BuiltDocumentRow {
  readonly kind: ProjectDocumentKind;
  readonly contractValueId: string;
  /** The supplier, or the project's client on a progress billing and a client's release. */
  readonly counterpartyValueId: string | null;
  readonly currency: CurrencyCode;
  readonly side: 'client' | 'supplier' | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  /** A purchase's or a sheet's lines summed; a billing's period's value; a release's amount. */
  readonly totalMinor: bigint;
  readonly advanceMinor: bigint | null;
  /** What the counterparties are credited or charged: the total less the deductions. */
  readonly netMinor: bigint;
  readonly supplierReference: string | null;
  /** A billing's number within its project or subcontract (S12 rule 16). */
  readonly projectSequence: number | null;
  readonly cumulativeMinor: bigint | null;
  readonly previousMinor: bigint | null;
  readonly retentionMinor: bigint | null;
  /** The contract's or the subcontract's value, for the preview's warning (S12 rule 14). */
  readonly contractValueMinor: bigint | null;
  /** A billing's rates as its terms or subcontract state them, kept on the document (0075). */
  readonly retentionBp: number | null;
  readonly advanceRecoveryBp: number | null;
}

/** A project document's number in its kind and fiscal year, taken before its lines (S12 rule 21). */
interface DocumentNumber {
  readonly fiscalYear: number;
  readonly number: number;
}

type Role =
  | 'conversion_rounding'
  | 'fx_realised_gain'
  | 'fx_realised_loss'
  | 'fx_unrealised_gain'
  | 'fx_unrealised_loss'
  | 'retained_earnings';

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

/** A request's lines as its payload hash covers them. */
function linesPayload(lines: readonly ManualLineSpec[]): CanonicalValue {
  return lines.map((line) => ({
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
    ...(line.quantity && { quantity: quantityPayload(line.quantity) }),
  }));
}

function quantityPayload(quantity: LineQuantity): CanonicalValue {
  return {
    materialId: quantity.materialId,
    unit: quantity.unit,
    quantity: quantity.quantity,
    unitPrice: quantity.unitPrice,
  };
}

/** What a request posts, as its payload hash covers it. */
function contentPayload(content: PostingContent): CanonicalValue {
  switch (content.kind) {
    case 'manual':
      return {
        kind: content.kind,
        lines: linesPayload(content.lines),
        dealtRates: content.dealtRates.map((rate) => ({ ...rate })),
      };
    case 'reversal':
      return { kind: content.kind, entryId: content.entryId };
    case 'revaluation':
      return {
        kind: content.kind,
        period: content.period,
        ledger: content.ledger,
        fingerprint: content.fingerprint,
        balances: content.balances.map((balance) => ({
          accountId: balance.account,
          dimensionValueIds: Object.values(balance.dimensions).sort(),
          itemId: balance.item ?? null,
          currency: balance.currency,
          transactionMinor: balance.transactionMinor,
          carryingMinor: balance.carryingMinor,
          revaluedMinor: balance.revaluedMinor,
          targetMinor: balance.targetMinor,
          differenceMinor: balance.differenceMinor,
        })),
      };
    case 'opening':
      return {
        kind: content.kind,
        openingId: content.openingId,
        measuredOn: content.measuredOn,
        lines: content.lines.map((line) => ({
          accountId: line.accountId,
          dimensionValueIds: [...line.dimensionValueIds].sort(),
          currency: line.currency,
          amountMinor: line.amountMinor,
          memo: line.memo,
          ...(line.stated !== undefined && {
            stated: { bookMinor: line.stated.bookMinor, parallelMinor: line.stated.parallelMinor },
          }),
          ...(line.newItem !== undefined && {
            newItem: {
              reference: line.newItem.reference,
              dueOn: line.newItem.dueOn,
              documentDate: line.newItem.documentDate,
            },
          }),
        })),
      };
    case 'opening_reversal':
      return { kind: content.kind, entryId: content.entryId };
    case 'project_document':
      return {
        kind: content.kind,
        document: { ...content.document },
        lines: content.lines.map((line) => ({
          accountId: line.accountId,
          dimensionValueIds: [...line.dimensionValueIds].sort(),
          amountMinor: line.amountMinor,
          memo: line.memo,
          quantity: line.quantity === null ? null : quantityPayload(line.quantity),
          advanceMinor: line.advanceMinor,
        })),
      };
  }
}

/** The request as its payload hash covers it: everything it posts, not who or when. */
function payloadOf(request: PostingRequest): CanonicalValue {
  return {
    client: request.client,
    entryDate: request.entryDate,
    description: request.description,
    reference: request.reference,
    draftId: request.draftId,
    preparedByUserId: request.preparedByUserId,
    approvedByUserId: request.approvedByUserId,
    content: contentPayload(request.content),
    // Only when set, so a request of S03's shape hashes as it did.
    ...(request.voucher !== undefined && {
      voucher: {
        kind: request.voucher.kind,
        cashAccountId: request.voucher.cashAccountId,
        counterCashAccountId: request.voucher.counterCashAccountId,
        partyName: request.voucher.partyName,
        countedMinor: request.voucher.countedMinor,
        expectedMinor: request.voucher.expectedMinor,
      },
    }),
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
        counterpartyType: row.counterpartyType,
        requiredDimensionTypeIds: required
          .filter((link) => link.accountId === row.id)
          .map((link) => link.typeId),
      },
    ]),
  );
}

/** The accounts of `ids` that require a material (S12 rule 4). */
async function requiringMaterial(tx: Transaction, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: chartAccounts.id })
    .from(chartAccounts)
    .where(and(inArray(chartAccounts.id, [...ids]), eq(chartAccounts.requiresMaterial, true)));
  return new Set(rows.map((row) => row.id));
}

/**
 * Checks the materials of lines' quantities (S12 rules 3–4): each the company's, not archived
 * (`MATERIAL_REQUIRED`, naming it), and the line in its unit (`VALIDATION_FAILED`). Refusals name
 * the line.
 */
async function checkMaterials(
  tx: Transaction,
  quantities: readonly (LineQuantity | null)[],
): Promise<void> {
  const ids = [
    ...new Set(
      quantities.flatMap((q) => (q === null || q.materialId === null ? [] : [q.materialId])),
    ),
  ];
  const rows =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: materials.id,
            code: materials.code,
            unit: materials.unit,
            archivedAt: materials.archivedAt,
          })
          .from(materials)
          .where(inArray(materials.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [index, quantity] of quantities.entries()) {
    if (quantity === null || quantity.materialId === null) continue;
    const material = byId.get(quantity.materialId);
    if (material === undefined || material.archivedAt !== null) {
      refuse('MATERIAL_REQUIRED', 'The line names an archived or unknown material', {
        lineNo: index + 1,
        materialId: quantity.materialId,
        ...(material !== undefined && { material: material.code }),
      });
    }
    if (material.unit !== quantity.unit) {
      refuse('VALIDATION_FAILED', "A material's line is in the material's unit", {
        lineNo: index + 1,
        unit: material.unit,
      });
    }
  }
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
export async function ratesOn(
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
          // An opening item the accountant opened, with no Hub document, is the accountant's own:
          // a manual line moves it as a manual item, with no memo (S10 rule 12;
          // `opening/opening-entry.md`, owner 2026-11-12).
          source:
            row.source === 'opening' && row.hubDocument === null
              ? 'manual'
              : (row.source as ItemSource),
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

/** The counterparty's running item on an account in a currency, if it has one (S04 rule 3). */
async function runningItemOf(
  tx: Transaction,
  accountId: string,
  counterpartyValueId: string,
  currency: CurrencyCode,
): Promise<string | null> {
  const [found] = await tx
    .select({ id: openItems.id })
    .from(openItems)
    .where(
      and(
        eq(openItems.kind, 'running'),
        eq(openItems.accountId, accountId),
        eq(openItems.counterpartyValueId, counterpartyValueId),
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

/** The value of a line on a control account that is its counterparty, if it names one. */
function counterpartyValueOf(
  account: ChartAccount | undefined,
  values: readonly LineDimensionValue[],
): string | null {
  if (account?.counterpartyType == null) return null;
  return values.find((value) => value.typeCode === account.counterpartyType)?.id ?? null;
}

/**
 * A manual entry's lines (S03 rules 12–16, S04 rules 2–12): each typed line checked against the
 * chart first, with the item it names:
 * - an existing item (`openItemId`), whose account, currency and dimensions the line takes
 *   (`OPEN_ITEM_MISMATCH`), with a memo on a Hub or opening item (`OPEN_ITEM_MEMO_REQUIRED`,
 *   adjusted): items Hub opened before its removal (ADR 0021) stay its records;
 * - a new manual document item (`newItem`), its reference free on the account
 *   (`OPEN_ITEM_REFERENCE_TAKEN`) and its due date not before the entry date;
 * - on a running account, the counterparty's item in the line's currency, found or made (S11 rule
 *   4, ADR 0022): keyed by the line's value of the account's counterparty type, its dimension set
 *   that value alone, while the line keeps every dimension it carries (a contract, rule 3).
 *
 * Then `packages/ledger` opens, clears and moves the items and measures every new amount anew per
 * ledger with the dealt rates; each ledger's residual is a realised difference when a line is
 * carried or the entry has several currencies, conversion rounding otherwise, on its role's
 * account. A refusal of one typed line names it in `details.lineNo`.
 */
async function manualLines(
  tx: Transaction,
  content: MeasuredContent,
  on: string,
  ledgers: CompanyLedgers,
  daysOff: readonly number[],
  lock: boolean,
): Promise<Built> {
  const origin = 'manual';
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
  const requiring = await requiringMaterial(tx, [...new Set(specs.map((spec) => spec.accountId))]);
  // S12 rules 4–6: every line's quantity, on any manual entry or voucher.
  const typedQuantities = specs.map((spec, index) => {
    const lineNo = index + 1;
    const { quantity } = onLine(lineNo, () =>
      resolveLineAmount(
        {
          requiresMaterial: requiring.has(spec.accountId),
          currency: spec.currency,
          amountMinor: spec.amountMinor,
          quantity: spec.quantity ?? null,
        },
        lineNo,
      ),
    );
    if (
      quantity !== null &&
      (spec.openItemId || spec.newItem || chart.get(spec.accountId)?.isControl)
    ) {
      refuse('VALIDATION_FAILED', 'A line that moves an item carries no quantity', { lineNo });
    }
    return quantity;
  });
  await checkMaterials(tx, typedQuantities);
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
          origin,
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
          origin,
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
        counterpartyValueId: counterpartyValueOf(account, named),
        currency: spec.currency,
        dueOn,
        documentDate: on,
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
          origin,
        }),
      );
      if (account?.itemKind === 'running') {
        const counterparty = onLine(lineNo, () => counterpartyOf(account, named));
        const key = JSON.stringify([spec.accountId, counterparty.id, spec.currency]);
        const itemDimensions = { [counterparty.typeId]: counterparty.id };
        item = running.get(key);
        if (item === undefined) {
          const id = await runningItemOf(tx, spec.accountId, counterparty.id, spec.currency);
          if (id !== null) {
            const stored = (await itemsOf(tx, [id], lock)).get(id);
            if (stored === undefined) throw new Error('A running item read and lost');
            adjusted = onLine(lineNo, () =>
              checkItemLine(
                {
                  account: spec.accountId,
                  currency: spec.currency,
                  dimensions: itemDimensions,
                  memo: spec.memo,
                },
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
              .where(eq(dimensionValues.id, counterparty.id));
            const id = uuidv7();
            newItems.push({
              id,
              accountId: spec.accountId,
              kind: 'running',
              reference: code?.code ?? counterparty.id,
              dimensions: itemDimensions,
              counterpartyValueId: counterparty.id,
              currency: spec.currency,
              dueOn: null,
              documentDate: on,
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
  // A correction against retained earnings takes the residual there (S10 rule 28, IAS 8.42).
  const roles = await roleAccounts(tx);
  const retainedEarnings = roles.get(roleTarget('retained_earnings'));
  const { rates, ids } = await ratesOn(tx, on);
  const context: MeasureContext = {
    ledgers,
    on,
    rates,
    calendar: await publicationCalendar(tx, daysOff),
  };
  const dealtRates = await dealtRatesOf(tx, content.dealtRates, on);
  const built = manualEntry(
    {
      lines,
      ...(retainedEarnings !== undefined && { retainedEarnings }),
      dealtRates,
    },
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
    roles,
  );
  const typedOf = (index: number) => built.typed[index] ?? null;
  // The difference and rounding lines go on the role accounts: checked as manual lines too.
  await checkAgainstChart(
    tx,
    balanced.filter((_, index) => typedOf(index) === null),
    origin,
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
    ...(typedQuantities.some((quantity) => quantity !== null) && {
      quantities: balanced.map((_, index) => {
        const typed = typedOf(index);
        return typed === null ? null : (typedQuantities[typed] ?? null);
      }),
    }),
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
/** A posted entry with its lines as `packages/ledger` reads them, for a reversal or a change. */
async function storedEntry(tx: Transaction, entryId: string) {
  const [original] = await tx.select().from(journalEntries).where(eq(journalEntries.id, entryId));
  if (!original) refuse('NOT_FOUND', 'No such entry', { entryId });
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
  // S12: the lines' quantities and the advance's covered parts, which a reversal carries back.
  const quantityRows = await tx
    .select()
    .from(lineQuantities)
    .where(eq(lineQuantities.entryId, original.id));
  const applicationRows = await tx
    .select()
    .from(advanceApplications)
    .where(eq(advanceApplications.entryId, original.id));
  const quantities = stored.map((row): LineQuantity | null => {
    const found = quantityRows.find((candidate) => candidate.lineId === row.id);
    return found === undefined
      ? null
      : {
          materialId: found.materialId,
          unit: found.unit,
          quantity: found.quantity,
          unitPrice: found.unitPrice,
        };
  });
  const advanceIds = [...new Set(applicationRows.map((row) => row.advanceLineId))];
  if (advanceIds.length > 1) throw new Error('An entry with two advance lines');
  const advanceLine =
    advanceIds[0] === undefined ? null : stored.findIndex((row) => row.id === advanceIds[0]);
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
    if (row.kind === 'carried' || row.kind === 'stated') return { ...fields, kind: row.kind };
    const of = (ledger: Ledger) =>
      conversionOf(
        conversions.filter((c) => c.lineId === row.id && c.ledger === ledger),
        original.entryDate,
      );
    const application = applicationRows.find((candidate) => candidate.lineId === row.id);
    return {
      ...fields,
      kind: 'measured',
      conversions: { book: of('book'), parallel: of('parallel') },
      ...(application !== undefined && {
        covered: {
          transaction: money(application.amountMinor, row.currency as CurrencyCode),
          bookMinor: application.bookMinor,
          parallelMinor: application.parallelMinor,
        },
      }),
    };
  });
  return { original, stored, lines, movements, quantities, advanceLine };
}

/** A quantity negated, as a reversal carries it (S12 rule 4): `"12.500"` → `"-12.500"`. */
function negatedQuantity(quantity: LineQuantity): LineQuantity {
  const text = quantity.quantity;
  const negated = text.startsWith('-')
    ? text.slice(1)
    : /^0(\.0+)?$/.test(text)
      ? text
      : `-${text}`;
  return { ...quantity, quantity: negated };
}

/**
 * S12 rule 22: a billing is cancelled only while it is the latest uncancelled billing of its
 * project or subcontract (`PROJECT_DOCUMENT_NOT_LATEST`), so the cumulative chain stays true.
 */
async function checkLatestBilling(tx: Transaction, entryId: string): Promise<void> {
  const result = await tx.execute<{ later: boolean }>(sql`
    select exists (
      select 1 from ${projectDocuments} d
      join ${projectDocuments} l on l.company_id = d.company_id and l.kind = d.kind
        and l.contract_value_id = d.contract_value_id
        and (d.kind = 'progress_billing' or l.counterparty_value_id = d.counterparty_value_id)
        and l.project_sequence > d.project_sequence
      where d.entry_id = ${entryId} and d.project_sequence is not null
        and not exists (
          select 1 from ${journalEntries} r
          where r.company_id = l.company_id and r.reverses_entry_id = l.entry_id)
    ) as later`);
  if (result.rows[0]?.later === true) {
    refuse('PROJECT_DOCUMENT_NOT_LATEST', 'Cancel the later billings of the project first', {
      entryId,
    });
  }
}

/**
 * A billing's or a retention release's cancellation is exact (owner, 2026-11-16): its reversal
 * gives back to each running item exactly what it moved, with no S04 rule 13 difference entry, so a
 * project's share of an advance or a retention stays the sum of its lines. To keep that true, it
 * is refused (`OPEN_ITEM_HAS_SETTLEMENTS`) while a later clearing of a running item it moved stands
 * uncancelled: a payment of the supplier on `211002`, or a release or recovery of the same
 * project's share on `211006`, `114002` or `212002` (as a client's billing with a receipt is,
 * S12 rule 22); also a later S04 rule 13 difference on such an item, and a later addition to
 * `211002` after the document itself cleared it (a net across the supplier's debit balance).
 * Answers whether the entry is such a document's.
 */
async function checkExactCancellation(
  tx: Transaction,
  entryId: string,
  sequence: bigint,
): Promise<boolean> {
  const [document] = await tx
    .select({ kind: projectDocuments.kind, contractValueId: projectDocuments.contractValueId })
    .from(projectDocuments)
    .where(eq(projectDocuments.entryId, entryId));
  if (
    document === undefined ||
    (document.kind !== 'progress_billing' &&
      document.kind !== 'subcontract_billing' &&
      document.kind !== 'retention_release')
  ) {
    return false;
  }
  const result = await tx.execute<{ later: boolean }>(sql`
    select exists (
      select 1
      from ${openItemMovements} mine
      join ${openItems} i on i.company_id = mine.company_id and i.id = mine.item_id
      join ${chartAccounts} a on a.company_id = i.company_id and a.id = i.account_id
      join ${openItemMovements} m on m.company_id = i.company_id and m.item_id = i.id
      join ${journalEntries} e on e.company_id = m.company_id and e.id = m.entry_id
      join ${journalLines} l on l.company_id = m.company_id and l.id = m.line_id
      where mine.entry_id = ${entryId} and i.kind = 'running'
        and e.sequence > ${sequence} and e.reverses_entry_id is null
        and not exists (
          select 1 from ${journalEntries} r
          where r.company_id = e.company_id and r.reverses_entry_id = e.id)
        and (
          -- An S04 rule 13 difference, which carries no project, always: its own kind, or any
          -- movement of a difference entry (across zero it clears and adds), posted under its
          -- reversal's key followed by ':difference'.
          m.kind = 'difference'
          or exists (
            select 1 from ${postingRequests} p
            where p.company_id = e.company_id and p.id = e.request_id
              and p.idempotency_key like '%:difference')
          -- A clearing: of a project's share only when its line carries the project.
          or (m.kind = 'clear' and (a.code not in ('211006', '114002', '212002') or exists (
            select 1 from ${dimensionSetValues} v
            where v.company_id = l.company_id and v.set_id = l.dimension_set_id
              and v.value_id = ${document.contractValueId})))
          -- An addition after the document itself cleared the item (a net across a supplier's
          -- debit balance): the exact reversal would leave the item off its rule 3 amounts.
          or (m.kind = 'add' and a.code not in ('211006', '114002', '212002') and exists (
            select 1 from ${openItemMovements} own
            where own.company_id = mine.company_id and own.entry_id = ${entryId}
              and own.item_id = i.id and own.kind = 'clear'))
        )
    ) as later`);
  if (result.rows[0]?.later === true) {
    refuse('OPEN_ITEM_HAS_SETTLEMENTS', 'Reverse the later payments or releases first', {
      entryId,
    });
  }
  return true;
}

async function reversalLines(
  tx: Transaction,
  content: Extract<PostingContent, { kind: 'reversal' }>,
  on: string,
  ledgers: CompanyLedgers,
  lock: boolean,
): Promise<Built> {
  const { original, stored, lines, movements, quantities, advanceLine } = await storedEntry(
    tx,
    content.entryId,
  );
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
  const posted = {
    source: original.source as EntrySource,
    date: original.entryDate,
    isReversal: original.reversesEntryId !== null,
    reversed: reversal !== undefined,
    followsReversal,
    lines,
  };
  // The accountant reverses manual entries only (S03 rule 9); a Hub entry stays as Hub left it.
  const negated = manualReversalLines(posted, on);
  await checkAgainstChart(tx, negated, 'reversal');
  // The reversal carries its own rounding lines, so balancing adds nothing (ADR 0007).
  const balanced = balanceEntry({
    on,
    ledgers,
    lines: negated,
    rounding: { account: roleTarget('conversion_rounding') },
  });
  if (balanced.length !== negated.length) throw new Error('A reversal needed a rounding line');
  await checkLatestBilling(tx, original.id);
  const exact = await checkExactCancellation(tx, original.id, original.sequence);
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
    // A billing's or a release's cancellation is exact (owner, 2026-11-16): no S04 rule 13
    // difference, so each project's share of a running item stays its lines' sum.
    if (item.state.kind !== 'running' || exact) continue;
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
    // S12: the reversal carries its original's quantities negated and its covered parts back.
    ...(quantities.some((quantity) => quantity !== null) && {
      quantities: quantities.map((quantity) =>
        quantity === null ? null : negatedQuantity(quantity),
      ),
    }),
    advanceLine,
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
/**
 * In a company with a books start, nothing but the opening posts until the opening is posted (S10
 * rule 3): `OPENING_NOT_POSTED`. The guards refuse it again.
 */
async function checkOpeningPosted(
  tx: Transaction,
  booksStart: string | null,
  content: PostingContent,
): Promise<void> {
  if (booksStart === null || content.kind === 'opening' || content.kind === 'opening_reversal') {
    return;
  }
  if (!(await openingIsPosted(tx))) {
    refuse('OPENING_NOT_POSTED', 'The opening balances are not posted yet', { booksStart });
  }
}

/** Whether the company in context has its opening posted (S10 rule 3). */
export async function openingIsPosted(tx: Transaction): Promise<boolean> {
  const [row] = await tx
    .select({ id: openings.id })
    .from(openings)
    .where(eq(openings.state, 'posted'))
    .limit(1);
  return row !== undefined;
}

function checkDates(on: string, content: PostingContent, ledgers: CompanyLedgers): void {
  checkManualEntryDate(on, content.today);
  for (const [, ledger] of keptLedgers(ledgers)) checkCurrencyDate(ledger.currency, on);
  if (content.kind === 'manual') {
    for (const [index, line] of content.lines.entries()) {
      onLine(index + 1, () => checkCurrencyDate(line.currency, on));
    }
  }
  if (content.kind === 'project_document' && content.document.currency !== null) {
    checkCurrencyDate(content.document.currency, on);
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
  documentNumber: DocumentNumber | null = null,
): Promise<Built> {
  switch (content.kind) {
    case 'manual':
      return manualLines(tx, content, on, ledgers, daysOff, lock);
    case 'reversal':
      return reversalLines(tx, content, on, ledgers, lock);
    case 'revaluation':
      return revaluationContentLines(tx, content, on, ledgers, lock);
    case 'opening':
      return openingLines(tx, content, on, ledgers, daysOff, lock);
    case 'opening_reversal':
      return openingReversalLines(tx, content, on, ledgers, lock);
    case 'project_document':
      return projectDocumentLines(tx, content, on, ledgers, daysOff, lock, documentNumber);
  }
}

// Project documents (S12 rules 4–13, 21; ADR 0023).

/**
 * The `contracting@1` accounts a project document posts to besides its cost lines (S12
 * "Accounting treatment"), with the counterparty type each running account is kept by.
 */
const DOCUMENT_ACCOUNTS = {
  suppliers: { code: '211001', item: 'running', counterparty: 'supplier' },
  supplierAdvances: { code: '114002', item: 'running', counterparty: 'supplier' },
  workers: { code: '211007', item: 'running', counterparty: 'worker' },
  wages: { code: '511002', item: null, counterparty: null },
  receivables: { code: '112001', item: 'document', counterparty: 'client' },
  retentionsReceivable: { code: '113002', item: 'document', counterparty: 'client' },
  clientAdvances: { code: '212002', item: 'running', counterparty: 'client' },
  revenue: { code: '411001', item: null, counterparty: null },
  subcontractors: { code: '211002', item: 'running', counterparty: 'supplier' },
  retentionsPayable: { code: '211006', item: 'running', counterparty: 'supplier' },
  subcontracting: { code: '511003', item: null, counterparty: null },
} as const;

type DocumentAccount = (typeof DOCUMENT_ACCOUNTS)[keyof typeof DOCUMENT_ACCOUNTS];

/**
 * The id of a document account (S12): the company's postable account of that code, a running
 * control account of its counterparty type where it keeps one; otherwise `VALIDATION_FAILED`, the
 * chart not being `contracting@1`'s.
 */
async function documentAccount(tx: Transaction, account: DocumentAccount): Promise<string> {
  const [row] = await tx
    .select({
      id: chartAccounts.id,
      kind: chartAccounts.kind,
      itemKind: chartAccounts.itemKind,
      counterpartyType: chartAccounts.counterpartyType,
    })
    .from(chartAccounts)
    .where(eq(chartAccounts.code, account.code));
  const fits =
    row !== undefined &&
    row.kind === 'postable' &&
    (account.item === null
      ? row.itemKind === null
      : row.itemKind === account.item && row.counterpartyType === account.counterparty);
  if (!fits) {
    refuse(
      'VALIDATION_FAILED',
      `A project document needs the account ${account.code} of contracting@1`,
      { account: account.code },
    );
  }
  return row.id;
}

/**
 * The counterparty's running item on an account in a currency as a line moves it (S04 rule 3):
 * found and read with its balance row (`FOR UPDATE` when posting), or made, the made one added to
 * `newItems`; the line keeps `dimensions`, the item its counterparty alone.
 */
async function runningTarget(
  tx: Transaction,
  input: {
    readonly accountId: string;
    readonly counterparty: LineDimensionValue;
    readonly currency: CurrencyCode;
    readonly dimensions: Dimensions;
    readonly on: string;
    readonly keepsParallel: boolean;
    readonly lock: boolean;
  },
  newItems: NewItem[],
): Promise<RunningTarget> {
  const { accountId, counterparty, currency } = input;
  const id = await runningItemOf(tx, accountId, counterparty.id, currency);
  let item: ItemState;
  if (id !== null) {
    const stored = (await itemsOf(tx, [id], input.lock)).get(id);
    if (stored === undefined) throw new Error('A running item read and lost');
    item = stored.state;
  } else {
    const [code] = await tx
      .select({ code: dimensionValues.code })
      .from(dimensionValues)
      .where(eq(dimensionValues.id, counterparty.id));
    const made = uuidv7();
    newItems.push({
      id: made,
      accountId,
      kind: 'running',
      reference: code?.code ?? counterparty.id,
      dimensions: { [counterparty.typeId]: counterparty.id },
      counterpartyValueId: counterparty.id,
      currency,
      dueOn: null,
      documentDate: input.on,
    });
    item = {
      id: made,
      kind: 'running',
      direction: null,
      balance: emptyBalance(currency, input.keepsParallel),
    };
  }
  return { account: accountId, dimensions: input.dimensions, item };
}

/**
 * The project's share of a counterparty's advance (S12 rule 12; owner, 2026-11-16): each of its
 * running items on the advance account, one per currency, read with its balance row (`FOR UPDATE`
 * when posting), as the sum of the item's movements on lines carrying the project, so an advance for
 * another project never measures this one. Advances are non-monetary and never revalued.
 */
async function advanceShares(
  tx: Transaction,
  accountId: string,
  counterpartyId: string,
  contractValueId: string,
  keepsParallel: boolean,
  lock: boolean,
): Promise<ItemState[]> {
  const items = await tx
    .select({ id: openItems.id })
    .from(openItems)
    .where(
      and(
        eq(openItems.kind, 'running'),
        eq(openItems.accountId, accountId),
        eq(openItems.counterpartyValueId, counterpartyId),
      ),
    );
  const stored = await itemsOf(
    tx,
    items.map((item) => item.id),
    lock,
  );
  const shares: ItemState[] = [];
  for (const [id, item] of stored) {
    const result = await tx.execute<{ amount: string; book: string; parallel: string }>(sql`
      select coalesce(sum(m.amount_minor), 0)::text as amount,
        coalesce(sum(m.book_minor), 0)::text as book,
        coalesce(sum(m.parallel_minor), 0)::text as parallel
      from ${openItemMovements} m
      join ${journalLines} l on l.company_id = m.company_id and l.id = m.line_id
      join ${dimensionSetValues} v on v.company_id = l.company_id and v.set_id = l.dimension_set_id
      where m.item_id = ${id} and m.kind <> 'revaluation' and v.value_id = ${contractValueId}`);
    const row = result.rows[0];
    shares.push({
      id,
      kind: 'running',
      direction: null,
      balance: {
        transaction: money(BigInt(row?.amount ?? '0'), item.currency),
        bookMinor: BigInt(row?.book ?? '0'),
        parallelMinor: keepsParallel ? BigInt(row?.parallel ?? '0') : null,
      },
    });
  }
  return shares;
}

/** The project of a document: a `contract` value of kind `project` (S12 rule 1). */
async function projectOf(tx: Transaction, contractValueId: string): Promise<LineDimensionValue> {
  const project = (await dimensionValuesOf(tx, [contractValueId])).get(contractValueId);
  const [row] = await tx
    .select({ kind: dimensionValues.contractKind })
    .from(dimensionValues)
    .where(eq(dimensionValues.id, contractValueId));
  if (project === undefined || project.typeCode !== 'contract' || row?.kind !== 'project') {
    refuse('VALIDATION_FAILED', 'A project document names a project', { contractValueId });
  }
  return project;
}

/**
 * A project document's lines (S12 rules 4–13): the header's project and counterparty checked, the
 * accounts of `contracting@1` found, the running items and the advance's project share read after
 * the ledger head and the period, then `buildProjectDocument()` and `manualEntry()`, each line
 * checked against the chart as a manual line, and `balanceEntry()` on the role accounts. A
 * refusal of one typed line names it in `details.lineNo`.
 */
async function projectDocumentLines(
  tx: Transaction,
  content: Extract<PostingContent, { kind: 'project_document' }>,
  on: string,
  ledgers: CompanyLedgers,
  daysOff: readonly number[],
  lock: boolean,
  documentNumber: DocumentNumber | null,
): Promise<Built> {
  const origin = 'manual';
  const { document } = content;
  const keepsParallel = ledgers.parallel !== null;
  const project = await projectOf(tx, document.contractValueId);
  const projectDimension = { [project.typeId]: project.id };
  const values = await dimensionValuesOf(tx, [
    ...new Set([
      project.id,
      ...(document.counterpartyValueId === null ? [] : [document.counterpartyValueId]),
      ...content.lines.flatMap((line) => line.dimensionValueIds),
    ]),
  ]);
  const newItems: NewItem[] = [];
  const { rates, ids } = await ratesOn(tx, on);
  const context: MeasureContext = {
    ledgers,
    on,
    rates,
    calendar: await publicationCalendar(tx, daysOff),
  };
  let input: ProjectDocumentInput | undefined;
  let extras: DocumentExtras;
  if (document.kind === 'purchase' || document.kind === 'wage_sheet') {
    if (document.currency === null) {
      refuse('VALIDATION_FAILED', 'A purchase and a wage sheet name their currency', {});
    }
    extras = {
      counterpartyValueId: document.counterpartyValueId,
      currency: document.currency,
      projectSequence: null,
      contractValueMinor: null,
      retentionBp: null,
      advanceRecoveryBp: null,
    };
  } else {
    if (documentNumber === null) throw new TypeError('A billing or a release needs its number');
    const prepared = await billingOrRelease(tx, {
      content,
      project,
      values,
      on,
      keepsParallel,
      lock,
      documentNumber,
      newItems,
    });
    input = prepared.input;
    extras = prepared.extras;
  }
  const { currency } = extras;
  if (document.kind === 'purchase') {
    const supplier =
      document.counterpartyValueId === null ? undefined : values.get(document.counterpartyValueId);
    if (supplier === undefined || supplier.typeCode !== 'supplier') {
      refuse('VALIDATION_FAILED', 'A purchase names its supplier', {});
    }
    const suppliersAccount = await documentAccount(tx, DOCUMENT_ACCOUNTS.suppliers);
    const advancesAccount = await documentAccount(tx, DOCUMENT_ACCOUNTS.supplierAdvances);
    const accountIds = [
      ...new Set(
        content.lines.flatMap((line) => (line.accountId === null ? [] : [line.accountId])),
      ),
    ];
    const chart = await chartOf(tx, accountIds);
    const classes = new Map(
      accountIds.length === 0
        ? []
        : (
            await tx
              .select({ id: chartAccounts.id, class: chartAccounts.class })
              .from(chartAccounts)
              .where(inArray(chartAccounts.id, accountIds))
          ).map((row) => [row.id, row.class]),
    );
    const requiring = await requiringMaterial(tx, accountIds);
    const counterpartyDimensions = { [supplier.typeId]: supplier.id, ...projectDimension };
    const lines = content.lines.map((line, index) => {
      const lineNo = index + 1;
      const accountId = line.accountId;
      if (accountId === null) {
        refuse('VALIDATION_FAILED', 'A cost line has its account', { lineNo });
      }
      const named = line.dimensionValueIds.map((id) => values.get(id) as LineDimensionValue);
      if (named.some((value) => value.typeId === project.typeId && value.id !== project.id)) {
        refuse('VALIDATION_FAILED', "A cost line carries the document's project", { lineNo });
      }
      const dimensions = Object.fromEntries([
        ...named.map((value) => [value.typeId, value.id]),
        [project.typeId, project.id],
      ]) as Dimensions;
      onLine(lineNo, () =>
        checkLineAgainstChart({
          account: chart.get(accountId),
          currency,
          dimensions: Object.values(dimensions).map((id) => values.get(id) as LineDimensionValue),
          origin,
        }),
      );
      // S12 rule 7: a cost line is on a postable expense account.
      if (classes.get(accountId) !== 'expense' || chart.get(accountId)?.isControl) {
        refuse('VALIDATION_FAILED', 'A cost line is on an expense account', { lineNo });
      }
      return {
        account: accountId,
        dimensions,
        currency,
        requiresMaterial: requiring.has(accountId),
        amountMinor: line.amountMinor,
        quantity: line.quantity,
        advanceMinor: line.advanceMinor,
      };
    });
    input = {
      kind: 'purchase',
      currency,
      advanceMinor: document.advanceMinor,
      lines,
      supplier: await runningTarget(
        tx,
        {
          accountId: suppliersAccount,
          counterparty: supplier,
          currency,
          dimensions: counterpartyDimensions,
          on,
          keepsParallel,
          lock,
        },
        newItems,
      ),
      advance: {
        account: advancesAccount,
        dimensions: counterpartyDimensions,
        // An advance paid to a supplier is a debit (S12 rule 12).
        side: 1,
        shares:
          document.advanceMinor === null || document.advanceMinor === 0n
            ? []
            : await advanceShares(
                tx,
                advancesAccount,
                supplier.id,
                project.id,
                keepsParallel,
                lock,
              ),
      },
    };
  } else if (document.kind === 'wage_sheet') {
    const { periodFrom, periodTo } = document;
    if (periodFrom === null || periodTo === null) {
      refuse('VALIDATION_FAILED', 'A wage sheet has its period', {});
    }
    const wagesAccount = await documentAccount(tx, DOCUMENT_ACCOUNTS.wages);
    const workersAccount = await documentAccount(tx, DOCUMENT_ACCOUNTS.workers);
    const workers = new Map<string, RunningTarget>();
    const lines = [];
    for (const [index, line] of content.lines.entries()) {
      const lineNo = index + 1;
      const named = line.dimensionValueIds.map((id) => values.get(id) as LineDimensionValue);
      const worker = named.find((value) => value.typeCode === 'worker');
      if (worker === undefined || named.length !== 1) {
        refuse('VALIDATION_FAILED', "A wage sheet's line names its worker", { lineNo });
      }
      if (!workers.has(worker.id)) {
        workers.set(
          worker.id,
          await runningTarget(
            tx,
            {
              accountId: workersAccount,
              counterparty: worker,
              currency,
              dimensions: { [worker.typeId]: worker.id, ...projectDimension },
              on,
              keepsParallel,
              lock,
            },
            newItems,
          ),
        );
      }
      lines.push({
        worker: worker.id,
        dimensions: { ...projectDimension, [worker.typeId]: worker.id } as Dimensions,
        quantity: line.quantity,
        amountMinor: line.amountMinor,
        memo: line.memo,
      });
    }
    input = {
      kind: 'wage_sheet',
      currency,
      on,
      periodFrom,
      periodTo,
      wagesAccount,
      lines,
      workers,
    };
  }
  if (input === undefined) throw new TypeError('A project document of no kind');
  const built = buildProjectDocument(input, context);
  await checkMaterials(tx, built.quantities);
  const roles = await roleAccounts(tx);
  const entry = manualEntry(built.entry, context, {
    gain: { account: roleTarget('fx_realised_gain') },
    loss: { account: roleTarget('fx_realised_loss') },
  });
  const balanced = withRoleAccounts(
    balanceEntry({
      on,
      ledgers,
      lines: entry.lines,
      rounding: { account: roleTarget('conversion_rounding') },
    }),
    roles,
  );
  const typedOf = (index: number) => entry.typed[index] ?? null;
  const billing = isBilling(document.kind);
  // Every line is checked as a manual line: the cost lines with the project, the running lines with
  // their counterparty and the project, a billing's or a release's document items with the item
  // they open or clear, the differences and rounding on the role accounts.
  const chartAccountsUsed = await chartOf(tx, [...new Set(balanced.map((line) => line.account))]);
  const lineValues = await dimensionValuesOf(tx, [
    ...new Set(balanced.flatMap((line) => Object.values(line.dimensions))),
  ]);
  const made = new Set(newItems.map((item) => item.id));
  for (const line of balanced) {
    const account = chartAccountsUsed.get(line.account);
    checkLineAgainstChart({
      account,
      currency: line.transaction.currency,
      dimensions: Object.values(line.dimensions).map(
        (id) => lineValues.get(id) as LineDimensionValue,
      ),
      origin,
      ...(account?.itemKind === 'document' &&
        line.item !== undefined && { item: made.has(line.item.id) ? 'new' : 'existing' }),
    });
  }
  // An item made for a line that does not post (a net or a retention of zero) is not made.
  const posting = newItems.filter((item) => balanced.some((line) => line.item?.id === item.id));
  const advanceLine =
    built.advanceLine === null
      ? -1
      : balanced.findIndex((_, index) => typedOf(index) === built.advanceLine);
  const memoOf = (typed: number): string | null =>
    built.memos[typed] ??
    (typed < content.lines.length ? (content.lines[typed]?.memo ?? null) : null);
  return {
    lines: balanced.map((line, index) => {
      const typed = typedOf(index);
      return { line, memo: typed === null ? null : memoOf(typed), adjusted: false };
    }),
    rateIds: ids,
    newItems: posting,
    voided: [],
    quantities: balanced.map((_, index) => {
      const typed = typedOf(index);
      return typed === null ? null : (built.quantities[typed] ?? null);
    }),
    advanceLine: advanceLine === -1 ? null : advanceLine,
    document: {
      kind: document.kind,
      contractValueId: project.id,
      counterpartyValueId: extras.counterpartyValueId,
      currency,
      side: document.kind === 'retention_release' ? document.side : null,
      periodFrom: document.periodFrom,
      periodTo: document.periodTo,
      totalMinor: built.totalMinor,
      advanceMinor: billing
        ? built.advanceMinor
        : document.kind === 'purchase' && document.advanceMinor !== null
          ? built.advanceMinor
          : null,
      netMinor: built.netMinor,
      supplierReference: document.supplierReference,
      projectSequence: extras.projectSequence,
      cumulativeMinor: billing ? document.cumulativeMinor : null,
      previousMinor: billing ? built.previousMinor : null,
      retentionMinor:
        billing || document.kind === 'retention_release' ? built.retentionMinor : null,
      contractValueMinor: extras.contractValueMinor,
      retentionBp: extras.retentionBp,
      advanceRecoveryBp: extras.advanceRecoveryBp,
    },
  };
}

/** What a project document's row takes besides its build (S12 "Data"). */
interface DocumentExtras {
  readonly counterpartyValueId: string | null;
  readonly currency: CurrencyCode;
  readonly projectSequence: number | null;
  readonly contractValueMinor: bigint | null;
  readonly retentionBp: number | null;
  readonly advanceRecoveryBp: number | null;
}

const isBilling = (kind: ProjectDocumentKind) =>
  kind === 'progress_billing' || kind === 'subcontract_billing';

/**
 * A new document item a billing or a release opens on a document control account (S12 rules 16,
 * 19): named by the document's printed number, free on its account (`OPEN_ITEM_REFERENCE_TAKEN`),
 * opening as a debit, the made one added to `newItems`.
 */
async function newDocumentItem(
  tx: Transaction,
  input: {
    readonly accountId: string;
    readonly reference: string;
    readonly dimensions: Dimensions;
    readonly counterpartyValueId: string;
    readonly currency: CurrencyCode;
    readonly on: string;
    readonly keepsParallel: boolean;
  },
  newItems: NewItem[],
): Promise<RunningTarget> {
  const [taken] = await tx
    .select({ id: openItems.id })
    .from(openItems)
    .where(
      and(
        eq(openItems.kind, 'document'),
        eq(openItems.accountId, input.accountId),
        eq(openItems.reference, input.reference),
      ),
    );
  if (taken !== undefined) {
    refuse('OPEN_ITEM_REFERENCE_TAKEN', 'The reference is used on this account', {
      reference: input.reference,
    });
  }
  const id = uuidv7();
  newItems.push({
    id,
    accountId: input.accountId,
    kind: 'document',
    reference: input.reference,
    dimensions: input.dimensions,
    counterpartyValueId: input.counterpartyValueId,
    currency: input.currency,
    dueOn: null,
    documentDate: input.on,
  });
  return {
    account: input.accountId,
    dimensions: input.dimensions,
    item: {
      id,
      kind: 'document',
      direction: null,
      opensAs: 1,
      balance: emptyBalance(input.currency, input.keepsParallel),
    },
  };
}

/**
 * The latest posted, uncancelled billing of a project (or a supplier's subcontract on it) and the
 * next number within it (S12 rules 14, 16): the numbers run through cancelled billings too. A
 * progress billing's chain is its project's, whatever client the project names now; a
 * subcontractor's is the project's and the supplier's. The ledger head, locked first by every
 * posting, serialises two billings of one project, so the second reads the first's cumulative.
 */
async function billingChain(
  tx: Transaction,
  kind: 'progress_billing' | 'subcontract_billing',
  contractValueId: string,
  supplierValueId: string | null,
): Promise<{ previous: { cumulativeMinor: bigint; on: string } | null; sequence: number }> {
  const party =
    supplierValueId === null ? sql`true` : sql`d.counterparty_value_id = ${supplierValueId}`;
  const result = await tx.execute<{ cumulative: string | null; on: string | null; next: number }>(
    sql`
    select
      (select d.cumulative_minor::text from ${projectDocuments} d
        where d.kind = ${kind} and d.contract_value_id = ${contractValueId}
          and ${party}
          and not exists (
            select 1 from ${journalEntries} r
            where r.company_id = d.company_id and r.reverses_entry_id = d.entry_id)
        order by d.project_sequence desc limit 1) as cumulative,
      (select d.document_date::text from ${projectDocuments} d
        where d.kind = ${kind} and d.contract_value_id = ${contractValueId}
          and ${party}
          and not exists (
            select 1 from ${journalEntries} r
            where r.company_id = d.company_id and r.reverses_entry_id = d.entry_id)
        order by d.project_sequence desc limit 1) as on,
      (select coalesce(max(d.project_sequence), 0) + 1 from ${projectDocuments} d
        where d.kind = ${kind} and d.contract_value_id = ${contractValueId}
          and ${party})::int as next`,
  );
  const row = result.rows[0];
  return {
    previous:
      row?.cumulative == null || row.on == null
        ? null
        : { cumulativeMinor: BigInt(row.cumulative), on: row.on },
    sequence: Number(row?.next ?? 1),
  };
}

/**
 * A billing's or a retention release's input to `buildProjectDocument()` (S12 rules 14–20), read
 * after the ledger head: the project's terms or the supplier's subcontract (`PROJECT_TERMS_MISSING`),
 * which give the currency and the rates; the billing chain; the advance's or the retention's
 * project share; the running items and the new document items, named by the document's number.
 */
async function billingOrRelease(
  tx: Transaction,
  input: {
    readonly content: Extract<PostingContent, { kind: 'project_document' }>;
    readonly project: LineDimensionValue;
    readonly values: ReadonlyMap<string, LineDimensionValue>;
    readonly on: string;
    readonly keepsParallel: boolean;
    readonly lock: boolean;
    readonly documentNumber: DocumentNumber;
    readonly newItems: NewItem[];
  },
): Promise<{ input: ProjectDocumentInput; extras: DocumentExtras }> {
  const { content, project, on, keepsParallel, lock, documentNumber, newItems } = input;
  const { document } = content;
  const printed = `${documentNumber.fiscalYear}/${documentNumber.number}`;
  // A billing's items are named by its printed number, `مستخلص 2026/1` (owner, 2026-11-16), so a
  // manual item's reference never blocks a billing's number.
  const billingItem = documentReference(
    'progress_billing',
    documentNumber.fiscalYear,
    documentNumber.number,
  );
  const projectDimension = { [project.typeId]: project.id };
  const clientSide =
    document.kind === 'progress_billing' ||
    (document.kind === 'retention_release' && document.side === 'client');
  if (clientSide) {
    if (document.counterpartyValueId !== null) {
      refuse('VALIDATION_FAILED', "A client's document names no supplier", {});
    }
    const clientId = project.parentValueId;
    const client =
      clientId === null ? undefined : (await dimensionValuesOf(tx, [clientId])).get(clientId);
    if (client === undefined) refuse('VALIDATION_FAILED', 'A project has its client', {});
    const [terms] = await tx
      .select()
      .from(projectTerms)
      .where(eq(projectTerms.contractValueId, project.id));
    if (terms === undefined) {
      refuse('PROJECT_TERMS_MISSING', 'The project has no terms', { contractValueId: project.id });
    }
    const currency = terms.currency as CurrencyCode;
    checkCurrencyDate(currency, on);
    const dimensions = { [client.typeId]: client.id, ...projectDimension } as Dimensions;
    const receivables = await documentAccount(tx, DOCUMENT_ACCOUNTS.receivables);
    const retentions = await documentAccount(tx, DOCUMENT_ACCOUNTS.retentionsReceivable);
    const extras = (projectSequence: number | null): DocumentExtras => ({
      counterpartyValueId: client.id,
      currency,
      projectSequence,
      contractValueMinor: terms.contractValueMinor,
      retentionBp: terms.retentionBp,
      advanceRecoveryBp: terms.advanceRecoveryBp,
    });
    if (document.kind === 'progress_billing') {
      if (document.cumulativeMinor === null) {
        refuse('VALIDATION_FAILED', 'A billing has its cumulative value', {});
      }
      const advances = await documentAccount(tx, DOCUMENT_ACCOUNTS.clientAdvances);
      const chain = await billingChain(tx, 'progress_billing', project.id, null);
      const target = { counterpartyValueId: client.id, currency, on, keepsParallel, dimensions };
      return {
        input: {
          kind: 'progress_billing',
          currency,
          on,
          cumulativeMinor: document.cumulativeMinor,
          previous: chain.previous,
          retentionBp: terms.retentionBp,
          advanceRecoveryBp: terms.advanceRecoveryBp,
          retentionMinor: document.retentionMinor,
          advanceMinor: document.advanceMinor,
          value: {
            account: await documentAccount(tx, DOCUMENT_ACCOUNTS.revenue),
            dimensions,
          },
          net: await newDocumentItem(
            tx,
            { ...target, accountId: receivables, reference: billingItem },
            newItems,
          ),
          retention: await newDocumentItem(
            tx,
            { ...target, accountId: retentions, reference: billingItem },
            newItems,
          ),
          // An advance received from the client is a credit (S12 rule 12).
          advance: {
            account: advances,
            dimensions,
            side: -1,
            shares: await advanceShares(tx, advances, client.id, project.id, keepsParallel, lock),
          },
        },
        extras: extras(chain.sequence),
      };
    }
    // A client's release (rule 19): each retention item of the project on `113002`.
    const items = await itemsOf(
      tx,
      content.lines.flatMap((line) => (line.openItemId == null ? [] : [line.openItemId])),
      lock,
    );
    const released = content.lines.map((line, index) => {
      const lineNo = index + 1;
      const stored = line.openItemId == null ? undefined : items.get(line.openItemId);
      if (
        stored === undefined ||
        stored.accountId !== retentions ||
        stored.state.kind !== 'document' ||
        stored.dimensions[project.typeId] !== project.id
      ) {
        refuse('VALIDATION_FAILED', "A release names a retention item of the project's", {
          lineNo,
        });
      }
      if (line.amountMinor === null) {
        refuse('VALIDATION_FAILED', 'A release names the amount released', { lineNo });
      }
      return {
        target: { account: stored.accountId, dimensions: stored.dimensions, item: stored.state },
        amountMinor: line.amountMinor,
      };
    });
    return {
      input: {
        kind: 'retention_release',
        side: 'client',
        currency,
        items: released,
        // Named apart from a billing of the same year and number, which names its own item
        // `<fiscal year>/<number>` on `112001` (owner, 2026-11-16).
        receivable: await newDocumentItem(
          tx,
          {
            accountId: receivables,
            reference: `إفراج ${printed}`,
            dimensions,
            counterpartyValueId: client.id,
            currency,
            on,
            keepsParallel,
          },
          newItems,
        ),
      },
      extras: extras(null),
    };
  }
  // The supplier's side: a subcontractor's billing (rule 18) or a supplier's release (rule 20).
  const supplier =
    document.counterpartyValueId === null
      ? undefined
      : input.values.get(document.counterpartyValueId);
  if (supplier === undefined || supplier.typeCode !== 'supplier') {
    refuse(
      'VALIDATION_FAILED',
      'A subcontract billing and a supplier release name the supplier',
      {},
    );
  }
  const [subcontract] = await tx
    .select()
    .from(subcontracts)
    .where(
      and(
        eq(subcontracts.contractValueId, project.id),
        eq(subcontracts.supplierValueId, supplier.id),
        isNull(subcontracts.archivedAt),
      ),
    );
  if (subcontract === undefined) {
    refuse('PROJECT_TERMS_MISSING', 'The supplier has no subcontract on the project', {
      contractValueId: project.id,
      supplierValueId: supplier.id,
    });
  }
  const currency = subcontract.currency as CurrencyCode;
  checkCurrencyDate(currency, on);
  const dimensions = { [supplier.typeId]: supplier.id, ...projectDimension } as Dimensions;
  const running = async (account: DocumentAccount) =>
    runningTarget(
      tx,
      {
        accountId: await documentAccount(tx, account),
        counterparty: supplier,
        currency,
        dimensions,
        on,
        keepsParallel,
        lock,
      },
      newItems,
    );
  const extras = (projectSequence: number | null): DocumentExtras => ({
    counterpartyValueId: supplier.id,
    currency,
    projectSequence,
    contractValueMinor: subcontract.valueMinor,
    retentionBp: subcontract.retentionBp,
    advanceRecoveryBp: subcontract.advanceRecoveryBp,
  });
  if (document.kind === 'subcontract_billing') {
    if (document.cumulativeMinor === null) {
      refuse('VALIDATION_FAILED', 'A billing has its cumulative value', {});
    }
    const advances = await documentAccount(tx, DOCUMENT_ACCOUNTS.supplierAdvances);
    const chain = await billingChain(tx, 'subcontract_billing', project.id, supplier.id);
    return {
      input: {
        kind: 'subcontract_billing',
        currency,
        on,
        cumulativeMinor: document.cumulativeMinor,
        previous: chain.previous,
        retentionBp: subcontract.retentionBp,
        advanceRecoveryBp: subcontract.advanceRecoveryBp,
        retentionMinor: document.retentionMinor,
        advanceMinor: document.advanceMinor,
        value: {
          account: await documentAccount(tx, DOCUMENT_ACCOUNTS.subcontracting),
          dimensions,
        },
        net: await running(DOCUMENT_ACCOUNTS.subcontractors),
        retention: await running(DOCUMENT_ACCOUNTS.retentionsPayable),
        // An advance paid to the subcontractor is a debit (S12 rule 12).
        advance: {
          account: advances,
          dimensions,
          side: 1,
          shares: await advanceShares(tx, advances, supplier.id, project.id, keepsParallel, lock),
        },
      },
      extras: extras(chain.sequence),
    };
  }
  if (document.kind !== 'retention_release' || document.retentionMinor === null) {
    refuse('VALIDATION_FAILED', "A supplier's release names the amount released", {});
  }
  const retentions = await documentAccount(tx, DOCUMENT_ACCOUNTS.retentionsPayable);
  return {
    input: {
      kind: 'retention_release',
      side: 'supplier',
      currency,
      amountMinor: document.retentionMinor,
      // The supplier's retention is a credit, cleared at the project's share's average (rule 20).
      retention: {
        account: retentions,
        dimensions,
        side: -1,
        shares: await advanceShares(tx, retentions, supplier.id, project.id, keepsParallel, lock),
      },
      payable: await running(DOCUMENT_ACCOUNTS.subcontractors),
    },
    extras: extras(null),
  };
}

/**
 * The opening entry's lines (S10 rules 17–19, 23): each spec checked against the chart, a stated
 * line as given, a measured one measured at the rates of the eve, opening its item: a document item
 * under its reference, free on its account among the items standing (another opening's, reversed,
 * leaves it free), with its own date; on a running account the client's item, found at zero or
 * made. Then the balancing line on the retained-earnings role's account, the remainder of each
 * ledger, and `balanceEntry()`, which adds nothing. Due dates are the records', often past: they
 * are not checked against the entry date (S04 rule 6 is for new documents).
 */
async function openingLines(
  tx: Transaction,
  content: Extract<PostingContent, { kind: 'opening' }>,
  on: string,
  ledgers: CompanyLedgers,
  daysOff: readonly number[],
  lock: boolean,
): Promise<Built> {
  const keepsParallel = ledgers.parallel !== null;
  for (const [index, spec] of content.lines.entries()) {
    const lineNo = index + 1;
    if (spec.amountMinor === 0n && spec.stated === undefined) {
      refuse('VALIDATION_FAILED', 'A measured line of zero amount', { lineNo });
    }
    if (spec.stated !== undefined && (spec.stated.parallelMinor === null) === keepsParallel) {
      refuse('VALIDATION_FAILED', 'A stated line without the parallel amount', { lineNo });
    }
    if (spec.stated !== undefined && spec.newItem !== undefined) {
      refuse('VALIDATION_FAILED', 'A stated line opens no item', { lineNo });
    }
  }
  const values = await dimensionValuesOf(tx, [
    ...new Set(content.lines.flatMap((spec) => spec.dimensionValueIds)),
  ]);
  const chart = await chartOf(tx, [...new Set(content.lines.map((spec) => spec.accountId))]);
  const { rates, ids } = await ratesOn(tx, content.measuredOn);
  const context: MeasureContext = {
    ledgers,
    on: content.measuredOn,
    rates,
    calendar: await publicationCalendar(tx, daysOff),
  };
  const newItems: NewItem[] = [];
  const lines: Line[] = [];
  for (const [index, spec] of content.lines.entries()) {
    const lineNo = index + 1;
    const account = chart.get(spec.accountId);
    const named = spec.dimensionValueIds.map((id) => values.get(id) as LineDimensionValue);
    const dimensions = Object.fromEntries(
      named.map((value) => [value.typeId, value.id]),
    ) as Dimensions;
    const origin = 'manual';
    const amount = money(spec.amountMinor, spec.currency);
    onLine(lineNo, () =>
      checkLineAgainstChart({
        account,
        currency: spec.currency,
        dimensions: named,
        origin,
        ...(spec.newItem !== undefined && { item: 'new' as const }),
      }),
    );
    const stated =
      spec.stated === undefined
        ? null
        : ({
            kind: 'stated',
            account: spec.accountId,
            dimensions,
            transaction: amount,
            bookMinor: spec.stated.bookMinor,
            parallelMinor: spec.stated.parallelMinor,
          } satisfies Line);
    // A stated line on a non-monetary running account opens its counterparty's item below at the
    // records' amounts (owner, 2026-11-15; IAS 21.23(b), IFRIC 22); any other stated line has none.
    if (stated !== null && account?.itemKind !== 'running') {
      lines.push(stated);
      continue;
    }
    let item: ItemState | null = null;
    if (spec.newItem !== undefined) {
      const { reference } = spec.newItem;
      if (await referenceTaken(tx, spec.accountId, reference)) {
        refuse('OPEN_ITEM_REFERENCE_TAKEN', 'The reference is used on this account', {
          reference,
          lineNo,
        });
      }
      if (
        newItems.some(
          (other) => other.accountId === spec.accountId && other.reference === reference,
        )
      ) {
        refuse('OPEN_ITEM_REFERENCE_TAKEN', 'The reference is used twice in the opening', {
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
        counterpartyValueId: counterpartyValueOf(account, named),
        currency: spec.currency,
        dueOn: spec.newItem.dueOn,
        documentDate: spec.newItem.documentDate,
      });
      item = {
        id,
        kind: 'document',
        direction: null,
        opensAs: normal?.balance === 'credit' ? -1 : 1,
        balance: emptyBalance(spec.currency, keepsParallel),
      };
    } else if (account?.itemKind === 'running') {
      // The item is the counterparty's alone; the line keeps every dimension it names (S11 rule 3).
      const counterparty = onLine(lineNo, () => counterpartyOf(account, named));
      const itemDimensions = { [counterparty.typeId]: counterparty.id };
      const existing = await runningItemOf(tx, spec.accountId, counterparty.id, spec.currency);
      if (existing !== null) {
        const stored = (await itemsOf(tx, [existing], lock)).get(existing);
        if (stored === undefined) throw new Error('A running item read and lost');
        if (stored.state.balance.transaction.amountMinor !== 0n) {
          refuse('VALIDATION_FAILED', "The counterparty's running item is not at zero", {
            lineNo,
          });
        }
        item = stored.state;
      } else {
        const [code] = await tx
          .select({ code: dimensionValues.code })
          .from(dimensionValues)
          .where(eq(dimensionValues.id, counterparty.id));
        const id = uuidv7();
        newItems.push({
          id,
          accountId: spec.accountId,
          kind: 'running',
          reference: code?.code ?? counterparty.id,
          dimensions: itemDimensions,
          counterpartyValueId: counterparty.id,
          currency: spec.currency,
          dueOn: null,
          documentDate: on,
        });
        item = {
          id,
          kind: 'running',
          direction: null,
          balance: emptyBalance(spec.currency, keepsParallel),
        };
      }
    }
    const target = { account: spec.accountId, dimensions };
    if (item === null) {
      lines.push(onLine(lineNo, () => measuredLine({ ...target, amount }, context)));
      continue;
    }
    if (stated !== null) {
      // The item is new or at zero, so the stated line adds its amounts whole.
      lines.push({ ...stated, item: { id: item.id, movement: 'add' } });
      continue;
    }
    const moved = onLine(lineNo, () => moveItem(item as ItemState, target, amount, context));
    if (moved.lines.length !== 1) throw new Error('An opening item moved by more than one line');
    lines.push(...moved.lines);
  }
  const balancing = balancingLine(lines, ledgers, roleTarget('retained_earnings'));
  const all = balancing === null ? lines : [...lines, balancing];
  const balanced = withRoleAccounts(
    balanceEntry({
      on,
      ledgers,
      lines: all,
      rounding: { account: roleTarget('conversion_rounding') },
    }),
    await roleAccounts(tx),
  );
  if (balanced.length !== all.length) throw new Error('The opening needed a rounding line');
  if (balancing !== null) {
    await checkAgainstChart(tx, balanced.slice(-1), 'manual');
  }
  return {
    lines: balanced.map((line, index) => ({
      line,
      memo: content.lines[index]?.memo ?? null,
      adjusted: false,
    })),
    rateIds: ids,
    newItems,
    voided: [],
  };
}

/**
 * Whether a document item on the account stands under `reference`: any item but one an opening
 * opened whose opening entry was reversed (S10 rule 25), so the new opening opens it again.
 */
async function referenceTaken(
  tx: Transaction,
  accountId: string,
  reference: string,
): Promise<boolean> {
  const result = await tx.execute<{ taken: boolean }>(sql`
    select exists (
      select 1 from ${openItems} i
      where i.kind = 'document' and i.account_id = ${accountId} and i.reference = ${reference}
        and not (i.source = 'opening' and exists (
          select 1 from ${journalEntries} r
          where r.company_id = i.company_id and r.reverses_entry_id = i.opened_by_entry_id
        ))
    ) as taken`);
  return result.rows[0]?.taken === true;
}

/**
 * The opening's whole reversal (S10 rule 25): the opening entry, of source `opening`, not reversed,
 * negated line by line at its amounts (`reverseLines()`: no rate read), each line moving its item
 * back; every account checked again for its state only. The opening service has checked it is the
 * company's only entry, which the guards hold again.
 */
async function openingReversalLines(
  tx: Transaction,
  content: Extract<PostingContent, { kind: 'opening_reversal' }>,
  on: string,
  ledgers: CompanyLedgers,
  lock: boolean,
): Promise<Built> {
  const { original, stored, lines, movements } = await storedEntry(tx, content.entryId);
  if (original.source !== 'opening' || original.reversesEntryId !== null) {
    refuse('ENTRY_NOT_REVERSIBLE', 'Only an opening entry is reversed as the opening', {
      entryId: original.id,
    });
  }
  if (original.entryDate !== on) {
    refuse('VALIDATION_FAILED', 'The opening is reversed on its own date', {
      entryId: original.id,
    });
  }
  const negated = reverseLines(lines);
  await checkAgainstChart(tx, negated, 'reversal');
  const balanced = balanceEntry({
    on,
    ledgers,
    lines: negated,
    rounding: { account: roleTarget('conversion_rounding') },
  });
  if (balanced.length !== negated.length) throw new Error('A reversal needed a rounding line');
  await itemsOf(
    tx,
    movements.map((movement) => movement.itemId),
    lock,
  );
  return {
    lines: negated.map((line, index) => ({
      line,
      memo: stored[index]?.memo ?? null,
      adjusted: false,
    })),
    rateIds: new Map(),
    newItems: [],
    voided: [],
  };
}

/**
 * The lines of a ledger's revaluation (S07 rule 13): two difference lines per balance with a
 * difference, built by `revaluationLines()`, on the unrealised gain and loss accounts of the
 * company's roles (`ACCOUNT_ROLE_MISSING` without them). A balance's account is checked as a
 * revaluation's (a blocked account and an archived value accepted, owner 2026-11-11), the gain and
 * loss accounts as any line's. Each item a line revalues has its balance row read `FOR UPDATE`
 * when posting (the lock order: the head, the period, then the items).
 */
async function revaluationContentLines(
  tx: Transaction,
  content: Extract<PostingContent, { kind: 'revaluation' }>,
  on: string,
  ledgers: CompanyLedgers,
  lock: boolean,
): Promise<Built> {
  const built = revaluationLines(ledgers, content.ledger, content.balances, {
    gain: { account: roleTarget('fx_unrealised_gain') },
    loss: { account: roleTarget('fx_unrealised_loss') },
  });
  const lines = withRoleAccounts(built, await roleAccounts(tx));
  // Each balance's line, then its gain or loss line (`revaluationLines()`).
  await checkAgainstChart(
    tx,
    lines.filter((_, index) => index % 2 === 0),
    'revaluation',
  );
  await checkAgainstChart(
    tx,
    lines.filter((_, index) => index % 2 === 1),
    'manual',
  );
  await itemsOf(
    tx,
    content.balances.flatMap((balance) => (balance.item === undefined ? [] : [balance.item])),
    lock,
  );
  const balanced = balanceEntry({
    on,
    ledgers,
    lines,
    rounding: { account: roleTarget('conversion_rounding') },
  });
  if (balanced.length !== lines.length) throw new Error('A revaluation needed a rounding line');
  return {
    lines: lines.map((line) => ({ line, memo: null, adjusted: false })),
    rateIds: new Map(),
    newItems: [],
    voided: [],
  };
}

/**
 * The reversal of a revaluation entry (S07 rule 14): its lines negated exactly on the next month's
 * first day, each keeping its item, so its movements are `revaluation` too; the accounts checked as
 * a revaluation's. No S04 rule 13 difference follows: a revaluation is not a movement of the items.
 */
async function revaluationReversalBuilt(
  tx: Transaction,
  entryId: string,
  on: string,
  ledgers: CompanyLedgers,
): Promise<Built> {
  const { original, lines } = await storedEntry(tx, entryId);
  const [reversal] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.reversesEntryId, original.id));
  const negated = revaluationReversalLines(
    {
      source: original.source as EntrySource,
      date: original.entryDate,
      isReversal: original.reversesEntryId !== null,
      reversed: reversal !== undefined,
      lines,
    },
    on,
  );
  await checkAgainstChart(tx, negated, 'revaluation');
  const balanced = balanceEntry({
    on,
    ledgers,
    lines: negated,
    rounding: { account: roleTarget('conversion_rounding') },
  });
  if (balanced.length !== negated.length) throw new Error('A reversal needed a rounding line');
  return {
    lines: negated.map((line) => ({ line, memo: null, adjusted: false })),
    rateIds: new Map(),
    newItems: [],
    voided: [],
  };
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
  /** The line's material and quantity (S12 rule 4); null on a line with none. */
  readonly quantity: LineQuantity | null;
  /** The part an applied advance covers, at its carried amounts (S12 rule 12); null otherwise. */
  readonly covered: {
    readonly amountMinor: bigint;
    readonly bookMinor: bigint;
    readonly parallelMinor: bigint | null;
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
  return (await previewBuilt(tx, request)).lines;
}

async function previewBuilt(
  tx: Transaction,
  request: Pick<PostingRequest, 'entryDate' | 'content'>,
): Promise<{ lines: PreviewLine[]; built: Built }> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const ledgers = ledgersOf(settings);
  const on = request.entryDate;
  const { content } = request;
  checkDates(on, content, ledgers);
  await checkOpeningPosted(tx, settings.booksStart, content);
  const period = periodOf(on);
  if (isClosedPeriod(await readClosedPeriods(tx), period)) {
    refuse('PERIOD_CLOSED', `The period ${period} is closed`, { period });
  }
  const documentNumber =
    content.kind === 'project_document'
      ? await nextDocumentNumber(
          tx,
          content.document.kind,
          fiscalYearOf(on, settings.fiscalYearStartMonth),
        )
      : null;
  const built = await buildLines(
    tx,
    content,
    on,
    ledgers,
    settings.bulletinDaysOff,
    false,
    documentNumber,
  );
  await checkBoxes(tx, built.lines, on, false);
  const made = new Map(built.newItems.map((item) => [item.id, item]));
  const lines = built.lines.map(
    ({ line, memo, adjusted }, index): PreviewLine => ({
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
      conversions: conversionsOf(
        line,
        built.rateIds,
        content.kind === 'manual' ||
          content.kind === 'opening' ||
          content.kind === 'project_document',
      ),
      item:
        line.item === undefined
          ? null
          : {
              ...line.item,
              adjusted,
              isNew: made.has(line.item.id),
              reference: made.get(line.item.id)?.reference ?? null,
            },
      quantity: built.quantities?.[index] ?? null,
      covered:
        line.kind === 'measured' && line.covered !== undefined
          ? {
              amountMinor: line.covered.transaction.amountMinor,
              bookMinor: line.covered.bookMinor,
              parallelMinor: line.covered.parallelMinor,
            }
          : null,
    }),
  );
  return { lines, built };
}

/** The warnings a project document's preview shows and its posting accepts (S12 rules 8, 14). */
export type ProjectDocumentWarning =
  | 'duplicate_supplier_reference'
  | 'cumulative_above_contract_value';

/** A project document's preview (S12 "API"): its lines, figures and warnings. */
export interface ProjectDocumentPreviewResult {
  readonly lines: PreviewLine[];
  readonly kind: ProjectDocumentKind;
  readonly currency: CurrencyCode;
  readonly totalMinor: bigint;
  readonly advanceMinor: bigint | null;
  /** The counterparty's credit or charge: the total less the deductions. */
  readonly netMinor: bigint;
  /** A billing's previous cumulative and retention, a release's amount; null otherwise. */
  readonly previousMinor: bigint | null;
  readonly retentionMinor: bigint | null;
  readonly warnings: ProjectDocumentWarning[];
}

/**
 * What a project document draft would post now (S12 "API"), with no write and no lock: its lines as
 * `post()` would build them, its figures, and the warnings: a purchase whose supplier's reference
 * an uncancelled purchase of the same supplier already carries (rule 8).
 */
export async function previewProjectDocument(
  tx: Transaction,
  request: Pick<PostingRequest, 'entryDate'> & {
    readonly content: Extract<PostingContent, { kind: 'project_document' }>;
  },
): Promise<ProjectDocumentPreviewResult> {
  const { lines, built } = await previewBuilt(tx, request);
  const row = built.document;
  if (row === undefined) throw new Error('A project document built without its row');
  const warnings: ProjectDocumentWarning[] = [];
  if (
    row.kind === 'purchase' &&
    row.supplierReference !== null &&
    row.counterpartyValueId !== null
  ) {
    const result = await tx.execute<{ taken: boolean }>(sql`
      select exists (
        select 1 from ${projectDocuments} d
        where d.kind = 'purchase' and d.counterparty_value_id = ${row.counterpartyValueId}
          and d.supplier_reference = ${row.supplierReference}
          and not exists (
            select 1 from ${journalEntries} r
            where r.company_id = d.company_id and r.reverses_entry_id = d.entry_id
          )
      ) as taken`);
    if (result.rows[0]?.taken === true) warnings.push('duplicate_supplier_reference');
  }
  // S12 rule 14: a cumulative above the contract's (or subcontract's) value is a variation.
  if (
    row.cumulativeMinor !== null &&
    row.contractValueMinor !== null &&
    row.cumulativeMinor > row.contractValueMinor
  ) {
    warnings.push('cumulative_above_contract_value');
  }
  return {
    lines,
    kind: row.kind,
    currency: row.currency,
    totalMinor: row.totalMinor,
    advanceMinor: row.advanceMinor,
    netMinor: row.netMinor,
    previousMinor: row.previousMinor,
    retentionMinor: row.retentionMinor,
    warnings,
  };
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
  /** The entry's source: `manual`, `revaluation` or `opening`. */
  readonly source: EntrySource;
  /** The voucher it posts (S11 rule 9), named in its audit row. */
  readonly voucher?: { readonly kind: VoucherKind; readonly number: number };
  /** The project document it posts (S12 rule 21), named in its audit row. */
  readonly projectDocument?: { readonly kind: ProjectDocumentKind; readonly number: number };
}

/**
 * A line's quantity and covered part as the chain hashes and the posting stores them (S12): each
 * only when the line has one; a covered part names its clearing line by number.
 */
function quantityAndCoveredOf(
  built: Built,
  line: Line,
  index: number,
): { quantity?: LineQuantity; covered?: ChainCovered } {
  const quantity = built.quantities?.[index] ?? null;
  const covered = line.kind === 'measured' ? line.covered : undefined;
  if (covered !== undefined && (built.advanceLine === undefined || built.advanceLine === null)) {
    throw new Error('A covered line without its advance line');
  }
  return {
    ...(quantity !== null && { quantity }),
    ...(covered !== undefined && {
      covered: {
        advanceLineNo: (built.advanceLine as number) + 1,
        amountMinor: covered.transaction.amountMinor,
        bookMinor: covered.bookMinor,
        parallelMinor: covered.parallelMinor,
      },
    }),
  };
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
    // So do its quantity and covered part (S12), so earlier entries hash the same.
    ...quantityAndCoveredOf(built, line, index),
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
    source: entry.source,
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
        source: entry.source === 'opening' ? ('opening' as const) : ('manual' as const),
        hubDocument: null,
        dimensionSetId: sets.get(dimensionKey(item.dimensions)) as string,
        counterpartyValueId: item.counterpartyValueId,
        currency: item.currency,
        documentDate: item.documentDate,
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
              effectiveOn: item.documentDate,
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
  // S12: the lines' quantities and the advance's covered parts, after the lines and movements and
  // before the head moves past the entry, which their guards read as the entry being posted.
  const quantities = lines.flatMap((line) =>
    line.quantity === undefined
      ? []
      : [
          {
            companyId,
            entryId,
            lineId: line.id,
            materialId: line.quantity.materialId,
            unit: line.quantity.unit,
            quantity: line.quantity.quantity,
            unitPrice: line.quantity.unitPrice,
          },
        ],
  );
  if (quantities.length > 0) await tx.insert(lineQuantities).values(quantities);
  const applications = lines.flatMap((line) => {
    if (line.covered === undefined) return [];
    const advance = lines[line.covered.advanceLineNo - 1];
    if (advance === undefined) throw new Error('A covered part without its advance line');
    return [
      {
        companyId,
        entryId,
        advanceLineId: advance.id,
        lineId: line.id,
        amountMinor: line.covered.amountMinor,
        bookMinor: line.covered.bookMinor,
        parallelMinor: line.covered.parallelMinor,
      },
    ];
  });
  if (applications.length > 0) await tx.insert(advanceApplications).values(applications);
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
      ...(entry.voucher !== undefined && {
        voucher: { kind: entry.voucher.kind, fiscalYear, number: entry.voucher.number },
      }),
      ...(entry.projectDocument !== undefined && {
        projectDocument: {
          kind: entry.projectDocument.kind,
          fiscalYear,
          number: entry.projectDocument.number,
        },
      }),
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
 * The period of an entry dated `on`, made open when missing and read `FOR SHARE`, after the head
 * (ADR 0008's lock order): its id, or `PERIOD_CLOSED` for a closed month and, while a month is
 * closed, for a month before the company's first period (S07 rule 4). A reopened month posts as an
 * open one (rule 1).
 */
async function openPeriod(
  tx: Transaction,
  companyId: string,
  on: string,
  fiscalYear: number,
): Promise<string> {
  const period = periodOf(on);
  if (isClosedPeriod(await readClosedPeriods(tx), period)) {
    refuse('PERIOD_CLOSED', `The period ${period} is closed`, { period });
  }
  await tx
    .insert(periods)
    .values({ companyId, period, fiscalYear, state: 'open' })
    .onConflictDoNothing({ target: [periods.companyId, periods.period] });
  const [periodRow] = await tx
    .select({ id: periods.id, state: periods.state })
    .from(periods)
    .where(eq(periods.period, period))
    .for('share');
  if (periodRow === undefined || periodRow.state === 'closed') {
    refuse('PERIOD_CLOSED', `The period ${period} is closed`, { period });
  }
  return periodRow.id;
}

/**
 * What follows a revaluation entry in its posting (S07 rules 13, 14): its exact reversal on the
 * next month's first day, under its own request `<key>:reversal` with its own number (in the next
 * fiscal year after December, ADR 0012) and audit row, and the revaluation's row, `adjusting` when
 * one of the same period and ledger stands. A revaluation is posted by a person.
 */
async function writeRevaluationReversal(
  tx: Transaction,
  companyId: string,
  head: Head,
  request: PostingRequest,
  posting: {
    readonly entryId: string;
    readonly periodId: string;
    readonly content: Extract<PostingContent, { kind: 'revaluation' }>;
    readonly ledgers: CompanyLedgers;
    readonly settings: { readonly id: string; readonly fiscalYearStartMonth: number };
  },
): Promise<void> {
  const { actor } = request;
  if (actor.kind !== 'person') throw new TypeError('A revaluation is posted by a person');
  const { content, ledgers, settings } = posting;
  const on = firstDayOfNextMonth(request.entryDate);
  const fiscalYear = fiscalYearOf(on, settings.fiscalYearStartMonth);
  await openPeriod(tx, companyId, on, fiscalYear);
  const built = await revaluationReversalBuilt(tx, posting.entryId, on, ledgers);
  const [reversalRequest] = await tx
    .insert(postingRequests)
    .values({
      companyId,
      client: request.client,
      idempotencyKey: `${request.idempotencyKey}:reversal`,
      payloadHash: sha256(
        canonicalJson({ client: request.client, reverses: posting.entryId, entryDate: on }),
      ),
    })
    .returning({ id: postingRequests.id });
  if (!reversalRequest) throw new Error('No posting request for the reversal');
  const reversal = await writeEntry(
    tx,
    companyId,
    head,
    { on, fiscalYear, settingsId: settings.id },
    actor,
    {
      requestId: reversalRequest.id,
      description: `عكس ${request.description}`,
      reference: request.reference,
      reversesEntryId: posting.entryId,
      draftId: null,
      preparedByUserId: request.preparedByUserId,
      approvedByUserId: null,
      built,
      follows: null,
      source: 'revaluation',
    },
  );
  const [standing] = await tx
    .select({ id: revaluations.id })
    .from(revaluations)
    .where(
      and(eq(revaluations.periodId, posting.periodId), eq(revaluations.ledger, content.ledger)),
    )
    .limit(1);
  await tx.insert(revaluations).values({
    companyId,
    periodId: posting.periodId,
    ledger: content.ledger,
    entryId: posting.entryId,
    reversalEntryId: reversal.id,
    adjusting: standing !== undefined,
    fingerprint: content.fingerprint,
    rates: content.rates,
    userId: actor.userId,
  });
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
  // Before anything is written: nothing but the opening posts before it (S10 rule 3).
  const [start] = await tx.select({ booksStart: companySettings.booksStart }).from(companySettings);
  await checkOpeningPosted(tx, start?.booksStart ?? null, request.content);
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
  const periodId = await openPeriod(tx, companyId, on, fiscalYear);

  // S12 rule 21: a project document's number, taken before its lines so that a billing's and a
  // release's new items carry it, and its entry's reference; a refusal rolls it back.
  const documentNumber =
    content.kind === 'project_document'
      ? await takeDocumentNumber(tx, companyId, content.document.kind, fiscalYear)
      : null;
  const built = await buildLines(
    tx,
    content,
    on,
    ledgers,
    settings.bulletinDaysOff,
    true,
    documentNumber === null ? null : { fiscalYear, number: documentNumber },
  );
  // S11 rule 8: every entry, of any source, leaves each box at or above zero at every date.
  await checkBoxes(tx, built.lines, on, true);
  const reversesEntryId =
    content.kind === 'reversal' || content.kind === 'opening_reversal' ? content.entryId : null;
  const source: EntrySource =
    content.kind === 'revaluation'
      ? 'revaluation'
      : content.kind === 'opening' || content.kind === 'opening_reversal'
        ? 'opening'
        : 'manual';
  const head: Head = { id: headRow.id, entryCount: headRow.entryCount, lastHash: headRow.lastHash };
  const at = { on, fiscalYear, settingsId: settings.id };
  // S11 rule 9: a voucher's number, taken here so that its entry's reference can carry it.
  const voucher =
    request.voucher === undefined
      ? null
      : {
          spec: request.voucher,
          number: await takeVoucherNumber(tx, companyId, request.voucher.kind, fiscalYear),
        };
  const document =
    built.document === undefined || documentNumber === null
      ? null
      : { row: built.document, number: documentNumber };
  const posted = await writeEntry(tx, companyId, head, at, request.actor, {
    requestId: created.id,
    description: request.description,
    reference:
      request.reference ??
      (voucher === null ? null : voucherReference(voucher.spec.kind, fiscalYear, voucher.number)) ??
      (document === null
        ? null
        : documentReference(document.row.kind, fiscalYear, document.number)),
    reversesEntryId,
    draftId: request.draftId,
    preparedByUserId: request.preparedByUserId,
    approvedByUserId: request.approvedByUserId,
    built,
    follows: null,
    source,
    ...(voucher !== null && { voucher: { kind: voucher.spec.kind, number: voucher.number } }),
    ...(document !== null && {
      projectDocument: { kind: document.row.kind, number: document.number },
    }),
  });
  if (document !== null) {
    if (request.draftId === null) throw new TypeError('A project document posts from its draft');
    await tx.insert(projectDocuments).values({
      companyId,
      kind: document.row.kind,
      fiscalYear,
      number: document.number,
      projectSequence: document.row.projectSequence,
      documentDate: on,
      entryId: posted.id,
      draftId: request.draftId,
      contractValueId: document.row.contractValueId,
      counterpartyValueId: document.row.counterpartyValueId,
      side: document.row.side,
      currency: document.row.currency,
      periodFrom: document.row.periodFrom,
      periodTo: document.row.periodTo,
      totalMinor: document.row.totalMinor,
      cumulativeMinor: document.row.cumulativeMinor,
      previousMinor: document.row.previousMinor,
      retentionMinor: document.row.retentionMinor,
      advanceMinor: document.row.advanceMinor,
      supplierReference: document.row.supplierReference,
      // A billing keeps the terms it was posted under (0075).
      ...(isBilling(document.row.kind)
        ? {
            contractValueMinor: document.row.contractValueMinor,
            retentionBp: document.row.retentionBp,
            advanceRecoveryBp: document.row.advanceRecoveryBp,
          }
        : {}),
    });
  }
  if (voucher !== null) {
    if (request.draftId === null) throw new TypeError('A voucher posts from its draft');
    await writeVoucher(tx, companyId, {
      spec: voucher.spec,
      fiscalYear,
      number: voucher.number,
      on,
      entryId: posted.id,
      draftId: request.draftId,
    });
  }
  if (content.kind === 'revaluation') {
    await writeRevaluationReversal(tx, companyId, head, request, {
      entryId: posted.id,
      periodId,
      content,
      ledgers,
      settings,
    });
    return posted;
  }
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
      source,
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

/**
 * A period's close or reopen as the period service decided it (S07 rules 2, 3, 9), written by the
 * ledger's one writer (ADR 0005 invariant 11), which writes every period row: an empty month
 * closed gets its row first, made open in its fiscal year (rule 2); then the `period_events` row
 * with the ledger head's sequence and, on a close, the checklist; then the state. The ledger head
 * is locked first (ADR 0008's lock order; the service has locked it already), and the guards
 * check the transition again. Returns the period's id.
 */
export async function writePeriodTransition(
  tx: Transaction,
  input: {
    readonly companyId: string;
    readonly period: string;
    readonly kind: 'closed' | 'reopened';
    readonly reason: string;
    readonly userId: string;
    readonly checklist: readonly unknown[] | null;
  },
): Promise<string> {
  const { companyId, period, kind } = input;
  const [head] = await tx
    .select({ entryCount: ledgerHeads.entryCount })
    .from(ledgerHeads)
    .for('update');
  if (!head) throw new Error('A company without its ledger head');
  let [row] = await tx.select().from(periods).where(eq(periods.period, period)).for('update');
  if (row === undefined && kind === 'closed') {
    const [settings] = await tx
      .select({ startMonth: companySettings.fiscalYearStartMonth })
      .from(companySettings);
    if (!settings) throw new Error('A company without its settings');
    await tx.insert(periods).values({
      companyId,
      period,
      fiscalYear: fiscalYearOf(`${period}-01`, settings.startMonth),
      state: 'open',
    });
    [row] = await tx.select().from(periods).where(eq(periods.period, period)).for('update');
  }
  if (row === undefined) throw new Error(`No period ${period} to ${kind}`);
  await tx.insert(periodEvents).values({
    companyId,
    periodId: row.id,
    kind,
    reason: input.reason,
    userId: input.userId,
    checklist: input.checklist,
    headSequence: BigInt(head.entryCount),
  });
  await tx.update(periods).set({ state: kind }).where(eq(periods.id, row.id));
  return row.id;
}

// Project documents' numbers (S12 rule 21).

/** How a document's kind reads in its entry's reference, before its number (S12 "Arabic strings"). */
const DOCUMENT_LABELS: { readonly [Kind in ProjectDocumentKind]: string } = {
  purchase: 'فاتورة مشتريات',
  wage_sheet: 'كشف أجور',
  progress_billing: 'مستخلص',
  subcontract_billing: 'مستخلص مقاول باطن',
  retention_release: 'إفراج عن محتجزات',
};

/** The reference a document's entry takes when the accountant left it empty: `كشف أجور 2026/3`. */
function documentReference(kind: ProjectDocumentKind, fiscalYear: number, number: number): string {
  return `${DOCUMENT_LABELS[kind]} ${fiscalYear}/${number}`;
}

/** The number a document of a kind would take now in a fiscal year, for a preview: no lock. */
async function nextDocumentNumber(
  tx: Transaction,
  kind: ProjectDocumentKind,
  fiscalYear: number,
): Promise<DocumentNumber> {
  const [row] = await tx
    .select({ lastNumber: projectDocumentSequences.lastNumber })
    .from(projectDocumentSequences)
    .where(
      and(
        eq(projectDocumentSequences.kind, kind),
        eq(projectDocumentSequences.fiscalYear, fiscalYear),
      ),
    );
  return { fiscalYear, number: (row?.lastNumber ?? 0) + 1 };
}

/**
 * The next number of a document kind in a fiscal year (S12 rule 21), under the sequence row's lock,
 * after the ledger head: gapless, since a refusal rolls the transaction back.
 */
async function takeDocumentNumber(
  tx: Transaction,
  companyId: string,
  kind: ProjectDocumentKind,
  fiscalYear: number,
): Promise<number> {
  const [sequence] = await tx
    .insert(projectDocumentSequences)
    .values({ companyId, kind, fiscalYear, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [
        projectDocumentSequences.companyId,
        projectDocumentSequences.kind,
        projectDocumentSequences.fiscalYear,
      ],
      set: { lastNumber: sql`${projectDocumentSequences.lastNumber} + 1`, updatedAt: sql`now()` },
    })
    .returning({ lastNumber: projectDocumentSequences.lastNumber });
  if (!sequence) throw new Error('No project document number');
  return sequence.lastNumber;
}

// Cash vouchers (S11 rules 8–14).

/** How a voucher's kind reads in its entry's reference, before its number (S11 "Arabic strings"). */
const VOUCHER_LABELS: { readonly [Kind in VoucherKind]: string } = {
  receipt: 'سند قبض',
  payment: 'سند صرف',
  transfer: 'سند تحويل',
  count: 'محضر جرد',
};

/** The reference a voucher's entry takes when the accountant left it empty: `سند قبض 2026/15`. */
function voucherReference(kind: VoucherKind, fiscalYear: number, number: number): string {
  return `${VOUCHER_LABELS[kind]} ${fiscalYear}/${number}`;
}

/**
 * The next number of a voucher kind in a fiscal year (S11 rule 9), under the sequence row's lock:
 * gapless, since a refusal rolls the transaction back and the guards check every number is taken.
 */
async function takeVoucherNumber(
  tx: Transaction,
  companyId: string,
  kind: VoucherKind,
  fiscalYear: number,
): Promise<number> {
  const [sequence] = await tx
    .insert(voucherSequences)
    .values({ companyId, kind, fiscalYear, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [voucherSequences.companyId, voucherSequences.kind, voucherSequences.fiscalYear],
      set: { lastNumber: sql`${voucherSequences.lastNumber} + 1`, updatedAt: sql`now()` },
    })
    .returning({ lastNumber: voucherSequences.lastNumber });
  if (!sequence) throw new Error('No voucher number');
  return sequence.lastNumber;
}

/** Writes a posted voucher with its number, entry (none for a count that matched) and header. */
async function writeVoucher(
  tx: Transaction,
  companyId: string,
  voucher: {
    readonly spec: VoucherSpec;
    readonly fiscalYear: number;
    readonly number: number;
    readonly on: string;
    readonly entryId: string | null;
    readonly draftId: string;
  },
): Promise<string> {
  const { spec } = voucher;
  const id = uuidv7();
  await tx.insert(cashVouchers).values({
    id,
    companyId,
    kind: spec.kind,
    fiscalYear: voucher.fiscalYear,
    number: voucher.number,
    voucherDate: voucher.on,
    entryId: voucher.entryId,
    draftId: voucher.draftId,
    cashAccountId: spec.cashAccountId,
    counterCashAccountId: spec.counterCashAccountId,
    partyName: spec.partyName,
    countedMinor: spec.kind === 'count' ? spec.countedMinor : null,
    expectedMinor: spec.kind === 'count' ? spec.expectedMinor : null,
  });
  return id;
}

/**
 * A box's balance in its currency at the end of the day before `on`, from the period balances of
 * the months before `on`'s and the lines of its month before `on`, and its net movement on each
 * date from `on` on (S11 rule 8; "Volume and performance").
 */
async function boxMovements(
  tx: Transaction,
  box: string,
  on: string,
): Promise<{ opening: bigint; later: { date: string; amountMinor: bigint }[] }> {
  const month = periodOf(on);
  const monthStart = `${month}-01`;
  const opening = await tx.execute<{ amount: string | null }>(sql`
    select (
      coalesce((
        select sum(b.debit_minor - b.credit_minor)
        from public.period_balances b
        join public.periods p on p.company_id = b.company_id and p.id = b.period_id
        where b.account_id = ${box} and p.period < ${month}
      ), 0)
      + coalesce((
        select sum(l.amount_minor)
        from public.journal_lines l
        join public.journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
        where l.account_id = ${box} and e.entry_date >= ${monthStart}::date
          and e.entry_date < ${on}::date
      ), 0)
    )::text as amount`);
  const later = await tx.execute<{ date: string; amount: string }>(sql`
    select e.entry_date::text as date, sum(l.amount_minor)::text as amount
    from public.journal_lines l
    join public.journal_entries e on e.company_id = l.company_id and e.id = l.entry_id
    where l.account_id = ${box} and e.entry_date >= ${on}::date
    group by e.entry_date
    order by e.entry_date`);
  return {
    opening: BigInt(opening.rows[0]?.amount ?? '0'),
    later: later.rows.map((row) => ({ date: row.date, amountMinor: BigInt(row.amount) })),
  };
}

/**
 * A box's expected balance for a count (S11 rule 13): its balance in its currency at the end of
 * `on`, from what is posted.
 */
async function boxBalanceAt(tx: Transaction, box: string, on: string): Promise<bigint> {
  const { opening, later } = await boxMovements(tx, box, on);
  return balanceAtEnd({ opening, later, on });
}

/**
 * S11 rule 8: refuses lines after which a box would be below zero in its currency at the end of
 * their date or of any later date (`CASH_BOX_NEGATIVE`, naming the box, the first such date and
 * the shortfall). Each box the lines take cash out of is locked `FOR NO KEY UPDATE` in id order when
 * `lock` (after the ledger head, ADR 0008's order), so two payments from one box serialise and the
 * second reads the first's line; a draft or a line that names the box (a key share) never blocks it.
 * Bank accounts are not checked (an overdraft is a borrowing, Q17).
 */
async function checkBoxes(
  tx: Transaction,
  lines: readonly BuiltLine[],
  on: string,
  lock: boolean,
): Promise<void> {
  const changes = netChanges(lines.map(({ line }) => line));
  const outgoing = [...changes].filter(([, change]) => change < 0n).map(([account]) => account);
  if (outgoing.length === 0) return;
  const query = tx
    .select({ id: chartAccounts.id, code: chartAccounts.code, currency: chartAccounts.currency })
    .from(chartAccounts)
    .where(and(inArray(chartAccounts.id, outgoing), eq(chartAccounts.cashKind, 'box')))
    .orderBy(asc(chartAccounts.id));
  const boxes = lock ? await query.for('no key update') : await query;
  for (const box of boxes) {
    const { opening, later } = await boxMovements(tx, box.id, on);
    const shortfall = boxShortfall({ opening, later, on, change: changes.get(box.id) ?? 0n });
    if (shortfall !== null) {
      refuse(
        'CASH_BOX_NEGATIVE',
        `The box ${box.code} would be ${shortfall.shortfallMinor} below zero on ${shortfall.date}`,
        {
          accountId: box.id,
          account: box.code,
          currency: box.currency,
          date: shortfall.date,
          shortfallMinor: shortfall.shortfallMinor.toString(),
        },
      );
    }
  }
}

/** The order in which a currency is a pair's base when the company holds no orientation for it. */
const BASE_ORDER: readonly CurrencyCode[] = ['USD', 'EUR', 'TRY', 'SYP'];

/** The company's orientation of a pair (S02 `RATE_ORIENTATION`), or the base order's. */
/** A pair of currencies in the company's orientation (`RATE_ORIENTATION`), else `BASE_ORDER`'s. */
export async function pairOrientation(
  tx: Transaction,
  a: CurrencyCode,
  b: CurrencyCode,
): Promise<{ base: CurrencyCode; quote: CurrencyCode }> {
  const [held] = await tx
    .select({ base: ratePairs.base, quote: ratePairs.quote })
    .from(ratePairs)
    .where(
      or(
        and(eq(ratePairs.base, a), eq(ratePairs.quote, b)),
        and(eq(ratePairs.base, b), eq(ratePairs.quote, a)),
      ),
    );
  if (held) return { base: held.base as CurrencyCode, quote: held.quote as CurrencyCode };
  return BASE_ORDER.indexOf(a) <= BASE_ORDER.indexOf(b)
    ? { base: a, quote: b }
    : { base: b, quote: a };
}

/**
 * The accounts a count posts its difference to (S11 rule 13, `contracting@1`): cash shortages
 * `532007` on `is.other_expenses` and cash overages `422002` on `is.other_income` (IAS 1.97–98). An
 * account of either code that is not that account (another chart's `532007`, a postable account on
 * another statement line) is refused, never posted to.
 */
const COUNT_ACCOUNTS = {
  shortage: { code: '532007', statementLine: 'is.other_expenses' },
  overage: { code: '422002', statementLine: 'is.other_income' },
} as const;

/** A voucher draft as it posts (S11 rules 9–13): its header, typed lines, dealt rates and clock. */
export interface VoucherRequest extends Omit<PostingRequest, 'content' | 'voucher'> {
  readonly voucher: VoucherSpec;
  /** The typed lines; none on a count, whose lines come from its difference. */
  readonly lines: readonly ManualLineSpec[];
  readonly dealtRates: readonly DealtRateSpec[];
  readonly today: string;
}

/** A derived dealt rate as a transfer offers it (S11 rule 12). */
export interface DerivedRate {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: string;
}

/** What a voucher posts, prepared: its lines and dealt rates, a transfer's rate, a count's figures. */
interface PreparedVoucher {
  /** The cash account's currency. */
  readonly cashCurrency: CurrencyCode;
  readonly lines: readonly ManualLineSpec[];
  readonly dealtRates: readonly DealtRateSpec[];
  readonly derivedRate: DerivedRate | null;
  readonly expectedMinor: bigint | null;
  readonly differenceMinor: bigint | null;
}

/**
 * A voucher's lines checked and completed (S11 rules 10–13): the shape of its lines against its
 * header (`checkVoucherShape()`, `CASH_ACCOUNT_INVALID`); for a currency exchange the rate derived
 * from its amounts, offered as the pair's dealt rate when the accountant typed none for the pair
 * and a ledger takes it, never refused for it (rule 12); for a count, the box's expected balance at
 * the end of its date, read under the box's lock when `lock`, compared with the preview's
 * (`CASH_COUNT_STALE`, with the new expected amount), and its difference lines.
 */
export async function checkVoucher(
  tx: Transaction,
  request: Pick<VoucherRequest, 'voucher' | 'lines'>,
) {
  const { voucher } = request;
  const ids = [
    voucher.cashAccountId,
    ...(voucher.counterCashAccountId === null ? [] : [voucher.counterCashAccountId]),
    ...request.lines.map((line) => line.accountId),
  ];
  const rows = await tx
    .select({
      id: chartAccounts.id,
      code: chartAccounts.code,
      cashKind: chartAccounts.cashKind,
      currency: chartAccounts.currency,
      blockedAt: chartAccounts.blockedAt,
      archivedAt: chartAccounts.archivedAt,
    })
    .from(chartAccounts)
    .where(inArray(chartAccounts.id, [...new Set(ids)]));
  const accounts = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        cashKind: row.cashKind,
        currency: row.currency as CurrencyCode | null,
        accountClass: Number(row.code[0]),
      },
    ]),
  );
  const cashAccount = accounts.get(voucher.cashAccountId);
  if (cashAccount === undefined) {
    refuse('CASH_ACCOUNT_INVALID', "The voucher's account is not a cash account", {
      field: 'cashAccountId',
    });
  }
  const counterCashAccount =
    voucher.counterCashAccountId === null ? null : accounts.get(voucher.counterCashAccountId);
  if (counterCashAccount === undefined) {
    refuse('CASH_ACCOUNT_INVALID', "The transfer's destination is not a cash account", {
      field: 'counterCashAccountId',
    });
  }
  // Edge cases 16–17: an archived or blocked cash account takes no new voucher, a count that
  // matches (which posts no line the chart would check) included.
  for (const id of [voucher.cashAccountId, voucher.counterCashAccountId]) {
    const row = rows.find((candidate) => candidate.id === id);
    if (row?.archivedAt != null) {
      refuse('ACCOUNT_ARCHIVED', `The cash account ${row.code} is archived`, { account: row.code });
    }
    if (row?.blockedAt != null) {
      refuse('ACCOUNT_BLOCKED', `The cash account ${row.code} is blocked`, { account: row.code });
    }
  }
  const transfer = checkVoucherShape({
    kind: voucher.kind,
    cashAccount,
    counterCashAccount,
    lines: request.lines.map((line) => ({
      account: line.accountId,
      currency: line.currency,
      amountMinor: line.amountMinor,
    })),
    accounts,
  });
  return { cashAccount, transfer };
}

async function prepareVoucher(
  tx: Transaction,
  request: Pick<VoucherRequest, 'voucher' | 'lines' | 'dealtRates' | 'entryDate'>,
  ledgers: CompanyLedgers,
  lock: boolean,
): Promise<PreparedVoucher> {
  const { voucher } = request;
  const { cashAccount, transfer } = await checkVoucher(tx, request);
  if (transfer !== null) {
    const pair = await pairOrientation(tx, transfer.givenCurrency, transfer.receivedCurrency);
    const derivedRate = derivedDealtRate(transfer, pair);
    const typed = request.dealtRates.some(
      (rate) =>
        (rate.base === pair.base && rate.quote === pair.quote) ||
        (rate.base === pair.quote && rate.quote === pair.base),
    );
    const currencies = new Set(request.lines.map((line) => line.currency));
    const offered =
      derivedRate !== null && !typed && dealtRateAccepted(derivedRate, currencies, ledgers);
    return {
      cashCurrency: cashAccount.currency as CurrencyCode,
      lines: request.lines,
      dealtRates:
        offered && derivedRate !== null ? [...request.dealtRates, derivedRate] : request.dealtRates,
      derivedRate,
      expectedMinor: null,
      differenceMinor: null,
    };
  }
  if (voucher.kind !== 'count') {
    return {
      cashCurrency: cashAccount.currency as CurrencyCode,
      lines: request.lines,
      dealtRates: request.dealtRates,
      derivedRate: null,
      expectedMinor: null,
      differenceMinor: null,
    };
  }
  const countedMinor = voucher.countedMinor;
  if (countedMinor === null) {
    refuse('VALIDATION_FAILED', 'A count states the cash counted', { field: 'countedMinor' });
  }
  if (lock) {
    await tx
      .select({ id: chartAccounts.id })
      .from(chartAccounts)
      .where(eq(chartAccounts.id, voucher.cashAccountId))
      .for('no key update');
  }
  const expectedMinor = await boxBalanceAt(tx, voucher.cashAccountId, request.entryDate);
  if (voucher.expectedMinor !== null && voucher.expectedMinor !== expectedMinor) {
    refuse('CASH_COUNT_STALE', 'The box has changed since the count was previewed', {
      expectedMinor: expectedMinor.toString(),
    });
  }
  const targets = await tx
    .select({
      id: chartAccounts.id,
      code: chartAccounts.code,
      kind: chartAccounts.kind,
      statementLine: chartAccounts.statementLine,
    })
    .from(chartAccounts)
    .where(
      inArray(chartAccounts.code, [COUNT_ACCOUNTS.shortage.code, COUNT_ACCOUNTS.overage.code]),
    );
  const accountOf = (target: { readonly code: string; readonly statementLine: string }) => {
    const found = targets.find((row) => row.code === target.code);
    if (
      found === undefined ||
      found.kind !== 'postable' ||
      found.statementLine !== target.statementLine
    ) {
      refuse(
        'CASH_ACCOUNT_INVALID',
        `A count posts its difference to ${target.code} on ${target.statementLine}`,
        { account: target.code, statementLine: target.statementLine },
      );
    }
    return found.id;
  };
  const lines =
    countedMinor === expectedMinor
      ? []
      : countLines({
          box: voucher.cashAccountId,
          currency: cashAccount.currency as CurrencyCode,
          countedMinor,
          expectedMinor,
          shortageAccount: countedMinor < expectedMinor ? accountOf(COUNT_ACCOUNTS.shortage) : '',
          overageAccount: countedMinor > expectedMinor ? accountOf(COUNT_ACCOUNTS.overage) : '',
        }).map(
          (line): ManualLineSpec => ({
            accountId: line.account,
            dimensionValueIds: [],
            currency: line.currency,
            amountMinor: line.amountMinor,
            memo: null,
          }),
        );
  return {
    cashCurrency: cashAccount.currency as CurrencyCode,
    lines,
    dealtRates: [],
    derivedRate: null,
    expectedMinor,
    differenceMinor: countDifference(countedMinor, expectedMinor),
  };
}

/** A posted voucher: its number and its entry, none for a count that matched (S11 rule 13). */
export interface PostedVoucherRef {
  readonly id: string;
  readonly kind: VoucherKind;
  readonly fiscalYear: number;
  readonly number: number;
  readonly entry: PostedEntryRef | null;
  /** The draft had posted its voucher before and nothing posted now. */
  readonly replayed: boolean;
}

/**
 * Posts a voucher draft (S11 rules 8–14), inside `withCompany`, idempotent by the draft (one
 * voucher per draft): the ledger head locked first, then the voucher prepared (`prepareVoucher()`,
 * a count's box locked and its expected balance compared), then posted by `post()` with its voucher
 * header, which takes the number, writes the entry with its reference and the voucher, and checks
 * every box (rule 8). A count that matches posts no entry: its period made open, its date checked
 * as a manual entry's, its number taken and its voucher written with the audit row
 * `cash_count.recorded`. Any refusal throws and the caller's transaction rolls back, so no number
 * is used up.
 */
export async function postVoucher(
  tx: Transaction,
  request: VoucherRequest,
): Promise<PostedVoucherRef> {
  const companyId = await contextCompany(tx);
  const draftId = request.draftId;
  if (draftId === null) throw new TypeError('A voucher posts from its draft');
  // The voucher a draft posted is read after the ledger head is locked, so a second post of the
  // draft at once waits for the first and answers its voucher (one voucher per draft).
  const [head] = await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
  const existing = await voucherOfDraft(tx, draftId);
  if (existing !== null) return { ...existing, replayed: true };
  const [settings] = await tx.select().from(companySettings).for('update');
  if (!head || !settings) throw new Error('A company without its ledger head or settings');
  const prepared = await prepareVoucher(tx, request, ledgersOf(settings), true);
  const spec: VoucherSpec = { ...request.voucher, expectedMinor: prepared.expectedMinor };
  if (request.voucher.kind === 'count' && prepared.lines.length === 0) {
    const on = request.entryDate;
    await checkOpeningPosted(tx, settings.booksStart, {
      kind: 'manual',
      today: request.today,
      lines: [],
      dealtRates: [],
    });
    checkManualEntryDate(on, request.today);
    checkCurrencyDate(prepared.cashCurrency, on);
    const fiscalYear = fiscalYearOf(on, settings.fiscalYearStartMonth);
    await openPeriod(tx, companyId, on, fiscalYear);
    const number = await takeVoucherNumber(tx, companyId, 'count', fiscalYear);
    const id = await writeVoucher(tx, companyId, {
      spec,
      fiscalYear,
      number,
      on,
      entryId: null,
      draftId,
    });
    await writeCompanyAudit(tx, companyId, request.actor, {
      action: 'cash_count.recorded',
      entityType: 'cash_voucher',
      entityId: id,
      after: {
        kind: 'count',
        fiscalYear,
        number,
        voucherDate: on,
        cashAccountId: spec.cashAccountId,
        countedMinor: spec.countedMinor?.toString() ?? null,
        expectedMinor: spec.expectedMinor?.toString() ?? null,
        description: request.description,
      },
    });
    return { id, kind: 'count', fiscalYear, number, entry: null, replayed: false };
  }
  const entry = await post(tx, {
    client: request.client,
    idempotencyKey: request.idempotencyKey,
    entryDate: request.entryDate,
    description: request.description,
    reference: request.reference,
    draftId,
    preparedByUserId: request.preparedByUserId,
    approvedByUserId: request.approvedByUserId,
    actor: request.actor,
    content: {
      kind: 'manual',
      today: request.today,
      dealtRates: prepared.dealtRates,
      lines: prepared.lines,
    },
    voucher: spec,
  });
  const posted = await voucherOfDraft(tx, draftId);
  if (posted === null) throw new Error('A voucher posted without its row');
  return { ...posted, entry, replayed: entry.replayed };
}

/** The voucher a draft posted, with its entry, or null. */
async function voucherOfDraft(
  tx: Transaction,
  draftId: string,
): Promise<Omit<PostedVoucherRef, 'replayed'> | null> {
  const [row] = await tx
    .select({ voucher: cashVouchers, entry: journalEntries })
    .from(cashVouchers)
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.companyId, cashVouchers.companyId),
        eq(journalEntries.id, cashVouchers.entryId),
      ),
    )
    .where(eq(cashVouchers.draftId, draftId));
  if (row === undefined) return null;
  const { voucher, entry } = row;
  return {
    id: voucher.id,
    kind: voucher.kind,
    fiscalYear: voucher.fiscalYear,
    number: voucher.number,
    entry:
      entry === null
        ? null
        : {
            id: entry.id,
            fiscalYear: entry.fiscalYear,
            number: entry.number,
            sequence: entry.sequence,
            hash: entry.hash,
            replayed: true,
          },
  };
}

/** A voucher's preview (S11 "API"): its lines, a transfer's derived rate and a count's figures. */
export interface VoucherPreviewResult {
  readonly lines: PreviewLine[];
  readonly derivedRate: DerivedRate | null;
  readonly expectedMinor: bigint | null;
  readonly differenceMinor: bigint | null;
}

/**
 * What a voucher draft would post now (S11 "API"), with no write and no lock: the lines as
 * `previewPosting()` builds them (none for a count that matches), a transfer's derived rate and a
 * count's expected balance and difference. It refuses as `postVoucher()` would, but for a count's
 * stale expected amount, which the preview gives.
 */
export async function previewVoucher(
  tx: Transaction,
  request: Pick<VoucherRequest, 'voucher' | 'lines' | 'dealtRates' | 'entryDate' | 'today'>,
): Promise<VoucherPreviewResult> {
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  const prepared = await prepareVoucher(
    tx,
    { ...request, voucher: { ...request.voucher, expectedMinor: null } },
    ledgersOf(settings),
    false,
  );
  const lines =
    prepared.lines.length === 0
      ? []
      : await previewPosting(tx, {
          entryDate: request.entryDate,
          content: {
            kind: 'manual',
            today: request.today,
            dealtRates: prepared.dealtRates,
            lines: prepared.lines,
          },
        });
  return {
    lines,
    derivedRate: prepared.derivedRate,
    expectedMinor: prepared.expectedMinor,
    differenceMinor: prepared.differenceMinor,
  };
}
