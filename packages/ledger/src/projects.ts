import {
  type CurrencyCode,
  DAYS_UNIT,
  DomainError,
  isZeroQuantity,
  lineAmount,
  type Money,
  money,
  quantityPlacesUsed,
} from '@vertex-mizan/contracts';
import { allocate, allocateCarried } from './allocation.js';
import { type ItemState, moveItem } from './items.js';
import { type CarriedAmounts, type Dimensions, negate } from './lines.js';
import type { ManualEntry, ManualLine } from './manual.js';
import type { MeasureContext } from './measure.js';
import { periodOf } from './periods.js';

/**
 * Project documents (S12, ADR 0023): the entry a document derives from what the accountant typed.
 * `buildProjectDocument()` is called at preview and at posting with the balances the posting
 * function read; it decides nothing about the accounts, which the caller names (`contracting@1`'s
 * codes), and returns a `ManualEntry` for `manualEntry()`, each manual line with its quantity, and
 * the clearing line of an applied advance with the lines it covers.
 */

/** A line's quantity (S12 rules 4–6): as `line_quantities` stores it. */
export interface LineQuantity {
  readonly materialId: string | null;
  readonly unit: string;
  /** Three decimals (`quantitySchema`). */
  readonly quantity: string;
  /** Four decimals; null exactly on a price adjustment (a quantity of 0). */
  readonly unitPrice: string | null;
}

/** A line as typed, on any manual draft: what `resolveLineAmount()` reads. */
export interface TypedQuantityLine {
  /** Its account requires a material (S12 rule 4). */
  readonly requiresMaterial: boolean;
  readonly currency: CurrencyCode;
  /** The amount as typed: a price adjustment's, a lump sum's, a line with no quantity's. */
  readonly amountMinor: bigint | null;
  readonly quantity: LineQuantity | null;
}

function invalid(message: string, lineNo: number, details: Record<string, unknown> = {}): never {
  throw new DomainError('VALIDATION_FAILED', message, { ...details, lineNo });
}

/**
 * A line's amount and quantity (S12 rules 4–6), on any manual line, document or voucher:
 * - on an account that requires a material, a material and a quantity (`MATERIAL_REQUIRED`);
 * - a quantity other than 0 has a unit price, and the amount is their product rounded half away
 *   from zero (`lineAmount()`), never typed: a typed amount must be that product;
 * - a quantity of 0 is a price adjustment: a material, no unit price, and a typed amount;
 * - a line of zero is refused (S03 edge case 3, S12 edge case 2).
 * Refusals name the line (`details.lineNo`, 1-based). Whether the material is archived or its
 * unit the line's is the posting function's, which reads the catalogue.
 */
export function resolveLineAmount(
  line: TypedQuantityLine,
  lineNo: number,
): { readonly amount: Money; readonly quantity: LineQuantity | null } {
  const { quantity } = line;
  if (line.requiresMaterial && (quantity === null || quantity.materialId === null)) {
    throw new DomainError(
      'MATERIAL_REQUIRED',
      'A line on this account names a material and a quantity',
      {
        lineNo,
      },
    );
  }
  let amountMinor: bigint;
  if (quantity === null) {
    if (line.amountMinor === null) invalid('A line with no amount', lineNo);
    amountMinor = line.amountMinor;
  } else if (isZeroQuantity(quantity.quantity)) {
    if (quantity.materialId === null)
      invalid('A quantity of 0 adjusts a material’s price only', lineNo);
    if (quantity.unitPrice !== null) invalid('A price adjustment has no unit price', lineNo);
    if (line.amountMinor === null) invalid('A price adjustment’s amount is typed', lineNo);
    amountMinor = line.amountMinor;
  } else {
    if (quantity.unitPrice === null) invalid('A quantity has its unit price', lineNo);
    amountMinor = lineAmount(quantity.quantity, quantity.unitPrice, line.currency).amountMinor;
    if (line.amountMinor !== null && line.amountMinor !== amountMinor) {
      invalid('A line’s amount is its quantity times its unit price', lineNo, {
        amountMinor: amountMinor.toString(),
      });
    }
  }
  if (amountMinor === 0n) invalid('A line of zero amount', lineNo);
  return { amount: money(amountMinor, line.currency), quantity };
}

/** Where a running item's line goes: its account, dimensions and the item as the caller read it. */
export interface RunningTarget {
  readonly account: string;
  readonly dimensions: Dimensions;
  readonly item: ItemState;
}

/** A cost line of a purchase as typed (S12 rule 7). */
export interface PurchaseLine extends TypedQuantityLine {
  readonly account: string;
  /** The project's contract dimension included (the document sets it). */
  readonly dimensions: Dimensions;
  /** The covered part the accountant typed (S12 rule 12); null to allocate the advance. */
  readonly advanceMinor: bigint | null;
}

/**
 * The advance a document may apply (S12 rule 12): the counterparty's running item on the advance
 * account, as the project's share (its lines with this contract), one per currency the share is
 * held in. The posting function reads each share's movements; the item's id is the item's own.
 */
export interface AdvanceShares {
  readonly account: string;
  readonly dimensions: Dimensions;
  /**
   * The side an advance is held on: 1 for an advance paid (`114002`, a debit), −1 for one received
   * (`212002`, a credit). A share on the other side holds no advance.
   */
  readonly side: 1 | -1;
  readonly shares: readonly ItemState[];
}

/** A project purchase invoice as typed (S12 rules 7–8, 12). */
export interface PurchaseDocument {
  readonly kind: 'purchase';
  readonly currency: CurrencyCode;
  readonly lines: readonly PurchaseLine[];
  /** The supplier's running item on `211001`, with the project on the line. */
  readonly supplier: RunningTarget;
  /** The advance applied, in the document's currency; null or 0 for none. */
  readonly advanceMinor: bigint | null;
  /** The supplier's advance on `114002`, the project's share. */
  readonly advance: AdvanceShares;
}

/** A wage sheet's line as typed (S12 rule 10): days at a daily rate, or a lump sum. */
export interface WageLine {
  /** The worker's value, a key of `WageSheetDocument.workers`. */
  readonly worker: string;
  readonly dimensions: Dimensions;
  /** Days (`unit` "يوم", no material) with their daily rate; null for a lump sum. */
  readonly quantity: LineQuantity | null;
  /** A lump sum's amount as typed. */
  readonly amountMinor: bigint | null;
  /** A lump sum's description (مقطوعية). */
  readonly memo: string | null;
}

/** A wage sheet as typed (S12 rule 10). */
export interface WageSheetDocument {
  readonly kind: 'wage_sheet';
  readonly currency: CurrencyCode;
  readonly on: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  /** The wages account (`511002`). */
  readonly wagesAccount: string;
  readonly lines: readonly WageLine[];
  /** Each worker's running item on `211007`, with the project on the line, by worker. */
  readonly workers: ReadonlyMap<string, RunningTarget>;
}

export type ProjectDocumentInput = PurchaseDocument | WageSheetDocument;

/** A document's entry before `manualEntry()`, with what the posting function stores beside it. */
export interface BuiltDocument {
  readonly entry: ManualEntry;
  /** Each manual line's quantity, null on a line with none. */
  readonly quantities: readonly (LineQuantity | null)[];
  /** Each manual line's memo, null on a line with none (a lump sum's description). */
  readonly memos: readonly (string | null)[];
  /** The index of the manual line that clears an applied advance; null with none. */
  readonly advanceLine: number | null;
  /** The document's figures: the sum of its lines, the advance applied and what is left. */
  readonly totalMinor: bigint;
  readonly advanceMinor: bigint;
  readonly netMinor: bigint;
}

function lineOf(target: RunningTarget, amount: Money): ManualLine {
  return { account: target.account, dimensions: target.dimensions, amount, item: target.item };
}

/**
 * The project's share of the counterparty's advance in the document's currency, refusing an advance
 * held only in another currency (`ADVANCE_CURRENCY_MISMATCH`, S12 answer 6 and edge case 4) and more
 * than the share (`RELEASE_EXCEEDS_BALANCE`, rule 12): none, or too little, in the document's
 * currency is the latter. An application never crosses the share's zero (rule 13).
 */
function advanceShare(
  advance: AdvanceShares,
  currency: CurrencyCode,
  amountMinor: bigint,
): ItemState {
  // Only a balance on the advance's own side is advance held: a share on the other side (an
  // advance account credited for this project by hand) holds none, so nothing is cleared from it
  // and nothing is measured anew on it (IAS 21.23(b), IFRIC 22.8).
  const heldIn = (item: ItemState) => {
    const signed = BigInt(advance.side) * item.balance.transaction.amountMinor;
    return signed > 0n ? signed : 0n;
  };
  const share = advance.shares.find((item) => item.balance.transaction.currency === currency);
  const held = share === undefined ? 0n : heldIn(share);
  const elsewhere = advance.shares.some(
    (item) => item.balance.transaction.currency !== currency && heldIn(item) > 0n,
  );
  if (held === 0n && elsewhere) {
    throw new DomainError(
      'ADVANCE_CURRENCY_MISMATCH',
      `The advance for this project is held in another currency than ${currency}`,
      { currency },
    );
  }
  if (share === undefined || amountMinor > held) {
    throw new DomainError(
      'RELEASE_EXCEEDS_BALANCE',
      `An advance of ${amountMinor} beyond the ${held} carried for this project`,
      { availableMinor: held.toString() },
    );
  }
  return share;
}

/**
 * The covered parts of the lines an advance pays for (S12 rule 12; ADR 0007): each line's covered
 * amount as typed, or the advance allocated across the lines with a positive amount in proportion
 * to it, with cumulative rounding; then the clearing line's carried amounts allocated across the
 * covered lines in proportion to their covered amounts, each ledger separately, so they sum exactly
 * to the clearing line. A covered amount is never above its line's, nor on a credit line.
 */
function coveredParts(
  amounts: readonly bigint[],
  typed: readonly (bigint | null)[],
  advanceMinor: bigint,
  carried: CarriedAmounts,
): (CarriedAmounts | undefined)[] {
  let covering: bigint[];
  if (typed.some((part) => part !== null)) {
    covering = typed.map((part) => part ?? 0n);
    let sum = 0n;
    for (const part of covering) sum += part;
    if (sum !== advanceMinor) {
      invalid('The covered parts sum to the advance applied', 1, {
        advanceMinor: advanceMinor.toString(),
      });
    }
  } else {
    covering = allocate(
      advanceMinor,
      amounts.map((amount) => (amount > 0n ? amount : 0n)),
    );
  }
  for (const [index, part] of covering.entries()) {
    const amount = amounts[index] ?? 0n;
    if (part < 0n || (part > 0n && (amount < 0n || part > amount))) {
      invalid('A covered part within its line’s amount', index + 1);
    }
  }
  const coveredIndexes = covering.flatMap((part, index) => (part > 0n ? [index] : []));
  const parts = allocateCarried(
    carried,
    coveredIndexes.map((index) => covering[index] ?? 0n),
  );
  const byLine: (CarriedAmounts | undefined)[] = amounts.map(() => undefined);
  for (const [k, index] of coveredIndexes.entries()) byLine[index] = parts[k];
  return byLine;
}

function purchase(document: PurchaseDocument, context: MeasureContext): BuiltDocument {
  if (document.lines.length === 0) invalid('A purchase has a line', 1);
  const resolved = document.lines.map((line, index) => {
    if (line.currency !== document.currency) {
      invalid('Every line is in the document’s currency', index + 1);
    }
    return resolveLineAmount(line, index + 1);
  });
  const amounts = resolved.map((line) => line.amount.amountMinor);
  let totalMinor = 0n;
  for (const amount of amounts) totalMinor += amount;
  const advanceMinor = document.advanceMinor ?? 0n;
  const netMinor = totalMinor - advanceMinor;
  if (netMinor < 0n) invalid('A purchase’s total is at least the advance it applies', 1);
  const lines: ManualLine[] = [];
  const quantities: (LineQuantity | null)[] = [];
  let advanceLine: number | null = null;
  let covered: (CarriedAmounts | undefined)[] = amounts.map(() => undefined);
  const clearing: ManualLine[] = [];
  if (advanceMinor > 0n) {
    const share = advanceShare(document.advance, document.currency, advanceMinor);
    const credit = money(-advanceMinor, document.currency);
    const target = { account: document.advance.account, dimensions: document.advance.dimensions };
    // The clearing line, as `manualEntry()` will build it again from the same share.
    const moved = moveItem(share, target, credit, context);
    const [line] = moved.lines;
    if (moved.lines.length !== 1 || line === undefined || line.item?.movement !== 'clear') {
      throw new TypeError('An advance applied within its share clears it in one line');
    }
    covered = coveredParts(
      amounts,
      document.lines.map((typed) => typed.advanceMinor),
      advanceMinor,
      negate(line),
    );
    clearing.push({ ...target, amount: credit, item: share });
  } else if (
    document.lines.some((line) => line.advanceMinor !== null && line.advanceMinor !== 0n)
  ) {
    invalid('A covered part needs the advance applied', 1);
  }
  for (const [index, line] of document.lines.entries()) {
    const part = covered[index];
    lines.push({
      account: line.account,
      dimensions: line.dimensions,
      amount: resolved[index]?.amount ?? money(0n, document.currency),
      ...(part !== undefined && { covered: part }),
    });
    quantities.push(resolved[index]?.quantity ?? null);
  }
  if (clearing.length > 0) {
    advanceLine = lines.length;
    lines.push(...clearing);
    quantities.push(null);
  }
  if (netMinor !== 0n) {
    lines.push(lineOf(document.supplier, money(-netMinor, document.currency)));
    quantities.push(null);
  }
  return {
    entry: { lines, dealtRates: [] },
    quantities,
    memos: lines.map(() => null),
    advanceLine,
    totalMinor,
    advanceMinor,
    netMinor,
  };
}

function wageSheet(document: WageSheetDocument): BuiltDocument {
  const { periodFrom, periodTo } = document;
  if (periodOf(periodFrom) !== periodOf(periodTo) || periodFrom > periodTo) {
    invalid('A wage sheet’s period lies in one calendar month', 1, { periodFrom, periodTo });
  }
  if (document.on !== periodTo) {
    invalid('A wage sheet is dated its period’s last day', 1, { periodTo });
  }
  if (document.lines.length === 0) invalid('A wage sheet has a line', 1);
  const lines: ManualLine[] = [];
  const quantities: (LineQuantity | null)[] = [];
  const memos: (string | null)[] = [];
  const owed = new Map<string, bigint>();
  let totalMinor = 0n;
  for (const [index, line] of document.lines.entries()) {
    const lineNo = index + 1;
    if (!document.workers.has(line.worker))
      throw new TypeError(`No running item for ${line.worker}`);
    if (line.quantity !== null) {
      const days = line.quantity;
      if (days.materialId !== null || days.unit !== DAYS_UNIT) {
        invalid('A wage sheet’s quantity is days', lineNo);
      }
      if (days.quantity.startsWith('-') || quantityPlacesUsed(days.quantity) > 1) {
        invalid('Days are above zero with at most one decimal place', lineNo);
      }
    } else if (line.memo === null || line.memo.trim() === '') {
      invalid('A lump sum has its description', lineNo);
    }
    const { amount, quantity } = resolveLineAmount(
      {
        requiresMaterial: false,
        currency: document.currency,
        amountMinor: line.amountMinor,
        quantity: line.quantity,
      },
      lineNo,
    );
    if (amount.amountMinor < 0n) invalid('A wage is above zero', lineNo);
    lines.push({ account: document.wagesAccount, dimensions: line.dimensions, amount });
    quantities.push(quantity);
    memos.push(line.quantity === null ? line.memo : null);
    owed.set(line.worker, (owed.get(line.worker) ?? 0n) + amount.amountMinor);
    totalMinor += amount.amountMinor;
  }
  for (const [worker, amountMinor] of owed) {
    const target = document.workers.get(worker);
    if (target === undefined) throw new TypeError(`No running item for ${worker}`);
    lines.push(lineOf(target, money(-amountMinor, document.currency)));
    quantities.push(null);
    memos.push(null);
  }
  return {
    entry: { lines, dealtRates: [] },
    quantities,
    memos,
    advanceLine: null,
    totalMinor,
    advanceMinor: 0n,
    netMinor: totalMinor,
  };
}

/**
 * The entry a project document derives (S12 rules 4–13, 21; ADR 0023), before `manualEntry()`:
 * - a purchase (rules 7–8): each cost line, its amount from its quantity where it has one (rule 6),
 *   a new measurement except the part an applied advance covers (rule 12), which takes the
 *   advance's carried amounts; the advance cleared on its project's share; one credit on the
 *   supplier's running item for the total less the advance;
 * - a wage sheet (rule 10): its period within one calendar month and dated its last day, each line
 *   on the wages account with the project and the worker, days (at most one decimal, unit "يوم")
 *   times the daily rate or a lump sum with its description; one credit per worker on the worker's
 *   running item for the sum of the worker's lines.
 * Refusals name the line in `details.lineNo`. The billings and releases come with S12's next part.
 */
export function buildProjectDocument(
  document: ProjectDocumentInput,
  context: MeasureContext,
): BuiltDocument {
  switch (document.kind) {
    case 'purchase':
      return purchase(document, context);
    case 'wage_sheet':
      return wageSheet(document);
  }
}
