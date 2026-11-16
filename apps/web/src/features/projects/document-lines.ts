import {
  type CurrencyCode,
  DAYS_UNIT,
  type Draft,
  type DraftInput,
  isZeroQuantity,
  lineAmount,
  type ProjectDocumentKind,
  quantityPlacesUsed,
  quantitySchema,
  type RetentionSide,
  unitPriceSchema,
} from '@vertex-mizan/contracts';

/*
 * A project document draft's working copy (S12 "Drafts"): the header as typed and the lines its
 * kind takes, with stable keys, and their conversion to and from the API's draft. A purchase's
 * lines are cost lines; a wage sheet's, one per worker line; a billing has none; a client's release
 * names its retention items. Quantities and unit prices stay decimal text; amounts stay bigint
 * minor units, and a line's amount from its quantity is the money module's `lineAmount()`.
 */

/** A purchase's cost line as typed (S12 rule 7). */
export interface PurchaseLine {
  readonly key: string;
  readonly accountId: string | null;
  readonly materialId: string | null;
  /** The material's unit, kept with the line as the draft stores it. */
  readonly unit: string | null;
  readonly quantity: string;
  readonly unitPrice: string;
  /** Typed only where no quantity gives it: an account without a material, or a quantity of 0. */
  readonly amountMinor: bigint | null;
  /** The part an applied advance covers, as typed (rule 12); null shares it by amount. */
  readonly advanceMinor: bigint | null;
  readonly memo: string;
}

/** A wage sheet's line as typed (S12 rule 10): days at a daily rate, or a lump sum. */
export interface WageLine {
  readonly key: string;
  readonly workerId: string | null;
  readonly mode: 'days' | 'lump';
  readonly days: string;
  readonly dailyRate: string;
  readonly amountMinor: bigint | null;
  readonly description: string;
}

/** A document's header as typed. */
export interface DocumentHeader {
  readonly kind: ProjectDocumentKind;
  readonly projectId: string | null;
  readonly counterpartyId: string | null;
  readonly currency: CurrencyCode | null;
  readonly side: RetentionSide | null;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly cumulativeMinor: bigint | null;
  readonly retentionMinor: bigint | null;
  readonly advanceMinor: bigint | null;
  readonly supplierReference: string;
}

export interface EditDocument {
  readonly entryDate: string;
  readonly description: string;
  readonly header: DocumentHeader;
  readonly purchaseLines: readonly PurchaseLine[];
  readonly wageLines: readonly WageLine[];
  /** A client's release: the amount released of each retention item, by its id. */
  readonly releases: Readonly<Record<string, bigint | null>>;
}

let lastKey = 0;
const nextKey = () => {
  lastKey += 1;
  return `document-line-${lastKey}`;
};

export function emptyPurchaseLine(): PurchaseLine {
  return {
    key: nextKey(),
    accountId: null,
    materialId: null,
    unit: null,
    quantity: '',
    unitPrice: '',
    amountMinor: null,
    advanceMinor: null,
    memo: '',
  };
}

export function emptyWageLine(): WageLine {
  return {
    key: nextKey(),
    workerId: null,
    mode: 'days',
    days: '',
    dailyRate: '',
    amountMinor: null,
    description: '',
  };
}

/** A new document of a kind, dated today, on a project when one is given. */
export function newDocument(
  kind: ProjectDocumentKind,
  today: string,
  projectId: string | null,
): EditDocument {
  return {
    entryDate: today,
    description: '',
    header: {
      kind,
      projectId,
      counterpartyId: null,
      currency: null,
      side: kind === 'retention_release' ? 'client' : null,
      periodFrom: kind === 'wage_sheet' ? `${today.slice(0, 7)}-01` : '',
      periodTo: kind === 'wage_sheet' ? today : '',
      cumulativeMinor: null,
      retentionMinor: null,
      advanceMinor: null,
      supplierReference: '',
    },
    purchaseLines: kind === 'purchase' ? [emptyPurchaseLine()] : [],
    wageLines: kind === 'wage_sheet' ? [emptyWageLine()] : [],
    releases: {},
  };
}

const bigintOf = (text: string | null) => (text === null ? null : BigInt(text));

/** The working copy of a stored project document draft. */
export function editDocumentOf(draft: Draft): EditDocument | null {
  const header = draft.projectDocument;
  if (header === null) return null;
  return {
    entryDate: draft.entryDate,
    description: draft.description ?? '',
    header: {
      kind: header.kind,
      projectId: header.contractValueId,
      counterpartyId: header.counterpartyValueId,
      currency: header.currency,
      side: header.side,
      periodFrom: header.periodFrom ?? '',
      periodTo: header.periodTo ?? '',
      cumulativeMinor: bigintOf(header.cumulativeMinor),
      retentionMinor: bigintOf(header.retentionMinor),
      advanceMinor: bigintOf(header.advanceMinor),
      supplierReference: header.supplierReference ?? '',
    },
    purchaseLines:
      header.kind === 'purchase'
        ? draft.lines.map((line) => ({
            key: nextKey(),
            accountId: line.accountId,
            materialId: line.materialId,
            unit: line.unit,
            quantity: line.quantity ?? '',
            unitPrice: line.unitPrice ?? '',
            amountMinor:
              line.quantity !== null && !isZeroQuantity(line.quantity)
                ? null
                : bigintOf(line.amountMinor),
            advanceMinor: bigintOf(line.advanceMinor),
            memo: line.memo ?? '',
          }))
        : [],
    wageLines:
      header.kind === 'wage_sheet'
        ? draft.lines.map((line) => ({
            key: nextKey(),
            workerId: line.dimensionValueIds[0] ?? null,
            mode: line.quantity === null ? 'lump' : 'days',
            days: line.quantity ?? '',
            dailyRate: line.unitPrice ?? '',
            amountMinor: line.quantity === null ? bigintOf(line.amountMinor) : null,
            description: line.memo ?? '',
          }))
        : [],
    releases: Object.fromEntries(
      (header.retentionItems ?? []).map((item) => [item.itemId, BigInt(item.amountMinor)]),
    ),
  };
}

/** A quantity as typed, written with 3 places, or null when it is not one. */
export function quantityOf(text: string): string | null {
  const parsed = quantitySchema.safeParse(text);
  return parsed.success ? parsed.data : null;
}

/** A unit price as typed, written with 4 places, or null when it is not one. */
export function unitPriceOf(text: string): string | null {
  const parsed = unitPriceSchema.safeParse(text);
  return parsed.success ? parsed.data : null;
}

/** Days as typed (rule 10): a quantity with at most one decimal place used. */
export function daysOf(text: string): string | null {
  const quantity = quantityOf(text);
  return quantity !== null && quantityPlacesUsed(quantity) <= 1 ? quantity : null;
}

/**
 * A purchase line's amount (rule 6): the rounded product of its quantity and unit price when it
 * has a quantity other than zero, else the amount typed; null while something is missing.
 */
export function purchaseLineAmount(
  line: PurchaseLine,
  currency: CurrencyCode | null,
): bigint | null {
  const quantity = quantityOf(line.quantity);
  if (quantity !== null && !isZeroQuantity(quantity)) {
    const price = unitPriceOf(line.unitPrice);
    if (price === null || currency === null) return null;
    return lineAmount(quantity, price, currency).amountMinor;
  }
  return line.amountMinor;
}

/** A wage line's amount: days × daily rate, or the lump sum typed; null while missing. */
export function wageLineAmount(line: WageLine, currency: CurrencyCode | null): bigint | null {
  if (line.mode === 'lump') return line.amountMinor;
  const days = daysOf(line.days);
  const rate = unitPriceOf(line.dailyRate);
  if (days === null || rate === null || currency === null) return null;
  return lineAmount(days, rate, currency).amountMinor;
}

const text = (value: string) => (value.trim() === '' ? null : value.trim());
const minor = (value: bigint | null) => (value === null ? null : value.toString());

/** Whether a purchase line has nothing typed: it is left out when the draft is saved. */
export function isBlankPurchaseLine(line: PurchaseLine): boolean {
  return (
    line.accountId === null &&
    line.materialId === null &&
    line.quantity.trim() === '' &&
    line.unitPrice.trim() === '' &&
    line.amountMinor === null &&
    line.memo.trim() === ''
  );
}

export function isBlankWageLine(line: WageLine): boolean {
  return (
    line.workerId === null &&
    line.days.trim() === '' &&
    line.dailyRate.trim() === '' &&
    line.amountMinor === null &&
    line.description.trim() === ''
  );
}

/**
 * The draft as `POST /api/drafts` and `PUT` take it (S12 "API"): the header the kind takes, the
 * lines of a purchase or a wage sheet, a client's release's items. The API computes a line's
 * amount from its quantity on save and checks the rest at the preview and the posting.
 */
export function documentInputOf(edit: EditDocument): DraftInput {
  const { header } = edit;
  const { kind } = header;
  const purchase = kind === 'purchase';
  const wages = kind === 'wage_sheet';
  const billing = kind === 'progress_billing' || kind === 'subcontract_billing';
  const release = kind === 'retention_release';
  const supplierRelease = release && header.side === 'supplier';
  const clientRelease = release && header.side === 'client';
  const takesSupplier = purchase || kind === 'subcontract_billing' || supplierRelease;
  return {
    entryDate: wages && header.periodTo !== '' ? header.periodTo : edit.entryDate,
    description: text(edit.description),
    reference: null,
    dealtRates: [],
    lines: purchase
      ? edit.purchaseLines
          .filter((line) => !isBlankPurchaseLine(line))
          .map((line) => {
            const quantity = quantityOf(line.quantity);
            const counted = quantity !== null && !isZeroQuantity(quantity);
            return {
              accountId: line.accountId,
              dimensionValueIds: [],
              currency: header.currency,
              amountMinor: counted ? null : minor(line.amountMinor),
              memo: text(line.memo),
              openItemId: null,
              newItem: null,
              materialId: quantity === null ? null : line.materialId,
              unit: quantity === null || line.materialId === null ? null : line.unit,
              quantity,
              unitPrice: counted ? unitPriceOf(line.unitPrice) : null,
              advanceMinor: minor(line.advanceMinor),
            };
          })
      : wages
        ? edit.wageLines
            .filter((line) => !isBlankWageLine(line))
            .map((line) => {
              const days = line.mode === 'days' ? daysOf(line.days) : null;
              return {
                accountId: null,
                dimensionValueIds: line.workerId === null ? [] : [line.workerId],
                currency: header.currency,
                amountMinor: line.mode === 'lump' ? minor(line.amountMinor) : null,
                memo: text(line.description),
                openItemId: null,
                newItem: null,
                materialId: null,
                unit: days === null ? null : DAYS_UNIT,
                quantity: days,
                unitPrice: days === null ? null : unitPriceOf(line.dailyRate),
                advanceMinor: null,
              };
            })
        : [],
    projectDocument:
      header.projectId === null
        ? null
        : {
            kind,
            contractValueId: header.projectId,
            counterpartyValueId: takesSupplier ? header.counterpartyId : null,
            currency: purchase || wages ? header.currency : null,
            side: release ? header.side : null,
            periodFrom: wages ? text(header.periodFrom) : null,
            periodTo: wages ? text(header.periodTo) : null,
            cumulativeMinor: billing ? minor(header.cumulativeMinor) : null,
            retentionMinor: billing || supplierRelease ? minor(header.retentionMinor) : null,
            advanceMinor: purchase || billing ? minor(header.advanceMinor) : null,
            supplierReference: purchase ? text(header.supplierReference) : null,
            retentionItems: clientRelease
              ? Object.entries(edit.releases).flatMap(([itemId, amount]) =>
                  amount === null || amount === 0n
                    ? []
                    : [{ itemId, amountMinor: amount.toString() }],
                )
              : null,
          },
  };
}
