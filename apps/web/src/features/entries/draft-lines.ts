import type {
  Account,
  CompanyLedgers,
  CurrencyCode,
  DimensionType,
  DimensionValue,
  Draft,
  DraftInput,
  RatePair,
} from '@vertex-mizan/contracts';

/*
 * The entry screen's working copy of a draft (S03 rules 4–5, 13): lines as typed, with a stable
 * key each so the grid's editor follows its line, and their conversion to and from the API's
 * draft. Amounts stay bigint minor units; only the money module adds them.
 */

/** A line as typed: anything may still be missing. */
export interface EditLine {
  readonly key: string;
  readonly accountId: string | null;
  readonly dimensionValueIds: readonly string[];
  readonly currency: CurrencyCode | null;
  /** Signed: positive a debit, negative a credit. */
  readonly amountMinor: bigint | null;
  readonly memo: string;
}

/** A dealt rate as typed, for a pair the entry has (rule 13): `null` when none is given. */
export interface EditDealtRate {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: string | null;
}

export interface EditDraft {
  readonly entryDate: string;
  readonly description: string;
  readonly reference: string;
  readonly dealtRates: readonly EditDealtRate[];
  readonly lines: readonly EditLine[];
}

let lastKey = 0;

/** A key no other line of this page has. */
export function newLineKey(): string {
  lastKey += 1;
  return `line-${lastKey}`;
}

export function emptyLine(): EditLine {
  return {
    key: newLineKey(),
    accountId: null,
    dimensionValueIds: [],
    currency: null,
    amountMinor: null,
    memo: '',
  };
}

/** A new entry: today, two empty lines. */
export function newDraft(today: string): EditDraft {
  return {
    entryDate: today,
    description: '',
    reference: '',
    dealtRates: [],
    lines: [emptyLine(), emptyLine()],
  };
}

/** The working copy of a stored draft. */
export function editDraftOf(draft: Draft): EditDraft {
  return {
    entryDate: draft.entryDate,
    description: draft.description ?? '',
    reference: draft.reference ?? '',
    dealtRates: draft.dealtRates,
    lines:
      draft.lines.length === 0 && draft.reversesEntryId === null
        ? [emptyLine(), emptyLine()]
        : draft.lines.map((line) => ({
            key: newLineKey(),
            accountId: line.accountId,
            dimensionValueIds: line.dimensionValueIds,
            currency: line.currency,
            amountMinor: line.amountMinor === null ? null : BigInt(line.amountMinor),
            memo: line.memo ?? '',
          })),
  };
}

/** Whether a line has nothing typed in it: it is left out when the draft is saved. */
export function isBlankLine(line: EditLine): boolean {
  return (
    line.accountId === null &&
    line.dimensionValueIds.length === 0 &&
    line.currency === null &&
    line.amountMinor === null &&
    line.memo.trim() === ''
  );
}

/** Whether a line has its account, currency and a non-zero amount (rule 5). */
export function isCompleteLine(line: EditLine): boolean {
  return (
    line.accountId !== null &&
    line.currency !== null &&
    line.amountMinor !== null &&
    line.amountMinor !== 0n
  );
}

/**
 * The draft as `POST /api/drafts` and `PUT` take it: blank lines dropped, empty text as null, a
 * zero amount as none (the API refuses a zero line). Its dealt rates are those given among
 * `offered`, the pairs the entry has now (`dealtRatePairs`): a rate kept for a pair the entry no
 * longer has is never sent, since the posting refuses it. A reversal's draft sends no lines and
 * no rates: its lines are its original's.
 */
export function draftInputOf(
  edit: EditDraft,
  reversal: boolean,
  offered: readonly EditDealtRate[],
): DraftInput {
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    entryDate: edit.entryDate,
    description: text(edit.description),
    reference: text(edit.reference),
    dealtRates: reversal
      ? []
      : offered.flatMap((rate) =>
          rate.rate === null ? [] : [{ base: rate.base, quote: rate.quote, rate: rate.rate }],
        ),
    lines: reversal
      ? []
      : edit.lines
          .filter((line) => !isBlankLine(line))
          .map((line) => ({
            accountId: line.accountId,
            dimensionValueIds: [...line.dimensionValueIds],
            currency: line.currency,
            amountMinor:
              line.amountMinor === null || line.amountMinor === 0n
                ? null
                : line.amountMinor.toString(),
            memo: text(line.memo),
          })),
  };
}

/**
 * The pairs a dealt rate can be given for (rule 13): a line currency and the currency of a ledger
 * whose policy accepts a transaction's rate, in the company's orientation of the pair when it has
 * one (`RATE_ORIENTATION`), with the rate already typed for it in that orientation. A rate kept in
 * the other orientation (typed before the company's pair existed) is left out, never shown or
 * sent inverted or under the other quote (ADR 0007: rates are never inverted); the field is empty
 * and the accountant types it again as quoted.
 */
export function dealtRatePairs(
  edit: EditDraft,
  ledgers: CompanyLedgers,
  pairs: readonly RatePair[],
): EditDealtRate[] {
  const accepting = [ledgers.book, ledgers.parallel].filter(
    (ledger) => ledger?.ratePolicy.acceptsTransactionRate,
  );
  const found: EditDealtRate[] = [];
  for (const ledger of accepting) {
    if (!ledger) continue;
    for (const currency of new Set(edit.lines.map((line) => line.currency))) {
      if (currency === null || currency === ledger.currency) continue;
      const held = pairs.find(
        (pair) =>
          (pair.base === currency && pair.quote === ledger.currency) ||
          (pair.base === ledger.currency && pair.quote === currency),
      );
      const base = held?.base ?? currency;
      const quote = held?.quote ?? ledger.currency;
      if (found.some((rate) => rate.base === base && rate.quote === quote)) continue;
      const typed = edit.dealtRates.find((rate) => rate.base === base && rate.quote === quote);
      found.push({ base, quote, rate: typed?.rate ?? null });
    }
  }
  return found;
}

/**
 * The dimension types the grid shows a column for: those the lines' accounts require and those a
 * line already carries a value of, in the company's order.
 */
export function dimensionColumns(
  lines: readonly EditLine[],
  accounts: ReadonlyMap<string, Account>,
  types: readonly DimensionType[],
  values: ReadonlyMap<string, DimensionValue>,
): DimensionType[] {
  const wanted = new Set<string>();
  for (const line of lines) {
    const account = line.accountId ? accounts.get(line.accountId) : undefined;
    for (const typeId of account?.requiredDimensionTypeIds ?? []) wanted.add(typeId);
    for (const id of line.dimensionValueIds) {
      const value = values.get(id);
      if (value) wanted.add(value.typeId);
    }
  }
  return types.filter((type) => wanted.has(type.id)).sort((a, b) => a.position - b.position);
}

/** The line's value of one dimension type, if it carries one. */
export function lineValueOf(
  line: EditLine,
  typeId: string,
  values: ReadonlyMap<string, DimensionValue>,
): DimensionValue | undefined {
  for (const id of line.dimensionValueIds) {
    const value = values.get(id);
    if (value?.typeId === typeId) return value;
  }
  return undefined;
}

/** The line with its value of one dimension type replaced, or removed (`null`). */
export function withDimensionValue(
  line: EditLine,
  typeId: string,
  valueId: string | null,
  values: ReadonlyMap<string, DimensionValue>,
): EditLine {
  const others = line.dimensionValueIds.filter((id) => values.get(id)?.typeId !== typeId);
  return { ...line, dimensionValueIds: valueId === null ? others : [...others, valueId] };
}

/** A dimension value found by what was typed: its code (any case), or its exact name. */
export function findDimensionValue(
  values: readonly DimensionValue[],
  text: string,
): DimensionValue | undefined {
  const typed = text.trim();
  const lower = typed.toLowerCase();
  return values.find(
    (value) =>
      value.archivedAt === null &&
      ((value.code !== null && value.code.toLowerCase() === lower) || value.name === typed),
  );
}
