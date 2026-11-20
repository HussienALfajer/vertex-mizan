import {
  type CashKind,
  type CurrencyCode,
  currencies,
  DomainError,
  divideHalfAwayFromZero,
  type VoucherKind,
} from '@vertex-mizan/contracts';

// Cash vouchers and boxes (S11 rules 8 and 10–13): the shape of a voucher's lines, the dealt rate a
// transfer between two currencies derives from its amounts, a count's difference lines and the box
// check's arithmetic. Which accounts a count posts to is the posting function's to read; every line
// is then measured by `manualEntry()` as any manual line (rule 15).

/** An account a voucher names or posts to, as the posting function read it from the chart. */
export interface VoucherAccount {
  readonly id: string;
  /** `box` or `bank` on a cash account (S11 rule 7); null on any other account. */
  readonly cashKind: CashKind | null;
  /** The account's currency restriction; a cash account always has one. */
  readonly currency: CurrencyCode | null;
  /** Its class, the first digit of its code: 5 is an expense (S02). */
  readonly accountClass: number;
}

/** A voucher line as typed: an account, a currency and a signed amount (debit positive). */
export interface VoucherLine {
  readonly account: string;
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
}

/** A voucher's header and lines, with every account its lines name. */
export interface VoucherInput {
  readonly kind: VoucherKind;
  readonly cashAccount: VoucherAccount;
  /** A transfer's destination; null on every other kind. */
  readonly counterCashAccount: VoucherAccount | null;
  readonly lines: readonly VoucherLine[];
  /** The accounts of the lines by id (an unknown one is the chart check's to refuse). */
  readonly accounts: ReadonlyMap<string, VoucherAccount>;
}

/** A transfer's three amounts (rule 12): what leaves the source, what reaches the destination, the fee. */
export interface TransferAmounts {
  /** The source's credit, a positive amount in the source's currency. */
  readonly given: bigint;
  readonly givenCurrency: CurrencyCode;
  /** The destination's debit, in the destination's currency. */
  readonly received: bigint;
  readonly receivedCurrency: CurrencyCode;
  /** The fee line's debit in the source's currency, 0 without one. */
  readonly fee: bigint;
}

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError('CASH_ACCOUNT_INVALID', message, details);
}

/** The 1-based numbers of the lines on an account. */
function linesOn(lines: readonly VoucherLine[], account: string): number[] {
  return lines.flatMap((line, index) => (line.account === account ? [index + 1] : []));
}

/**
 * Refuses a voucher whose header or lines break S11 rules 10–13 (`CASH_ACCOUNT_INVALID`, naming the
 * rule and, when one line is at fault, `lineNo`):
 * - its cash account is a cash account (a box for a count);
 * - a receipt has exactly one line on its cash account, a debit, and one counter line or more;
 *   a payment exactly one credit there and one counter line or more;
 * - a transfer has one credit on its source, one debit on its destination (another cash account),
 *   and at most one more line, a debit on an expense account in the source's currency (the fee);
 *   in one currency the source's credit is the destination's debit plus the fee;
 * - a count has no lines: the posting function builds them from the difference.
 * Returns a transfer's amounts, null for the other kinds. A line's currency against its account's
 * restriction is the chart check's (S02 rule 8).
 */
export function checkVoucherShape(voucher: VoucherInput): TransferAmounts | null {
  const { kind, cashAccount, counterCashAccount, lines } = voucher;
  if (cashAccount.cashKind === null) {
    invalid("The voucher's account is not a cash account", { field: 'cashAccountId' });
  }
  if (kind !== 'transfer' && counterCashAccount !== null) {
    invalid('Only a transfer names a destination', { field: 'counterCashAccountId' });
  }
  if (kind === 'count') {
    if (cashAccount.cashKind !== 'box') {
      invalid('A cash count is of a box', { field: 'cashAccountId' });
    }
    if (lines.length > 0) invalid('A count has no lines: they come from its difference');
    return null;
  }
  if (kind === 'receipt' || kind === 'payment') {
    const sign = kind === 'receipt' ? 1n : -1n;
    const onCash = linesOn(lines, cashAccount.id);
    if (onCash.length !== 1) {
      invalid(`A ${kind} has exactly one line on its cash account`, {
        rule: kind === 'receipt' ? 10 : 11,
        lines: onCash.length,
      });
    }
    const [lineNo] = onCash as [number];
    const line = lines[lineNo - 1] as VoucherLine;
    if (line.amountMinor * sign <= 0n) {
      invalid(
        kind === 'receipt'
          ? "A receipt's cash line is a debit"
          : "A payment's cash line is a credit",
        { rule: kind === 'receipt' ? 10 : 11, lineNo },
      );
    }
    if (lines.length < 2) {
      invalid(`A ${kind} has a counter line`, { rule: kind === 'receipt' ? 10 : 11 });
    }
    return null;
  }
  // A transfer (rule 12).
  if (counterCashAccount === null) {
    invalid('A transfer names its destination', { field: 'counterCashAccountId' });
  }
  if (counterCashAccount.cashKind === null) {
    invalid("The transfer's destination is not a cash account", {
      field: 'counterCashAccountId',
    });
  }
  if (counterCashAccount.id === cashAccount.id) {
    invalid('A transfer moves cash between two cash accounts', { field: 'counterCashAccountId' });
  }
  const source = linesOn(lines, cashAccount.id);
  const destination = linesOn(lines, counterCashAccount.id);
  if (source.length !== 1 || destination.length !== 1) {
    invalid('A transfer has one line on its source and one on its destination', { rule: 12 });
  }
  const sourceLine = lines[(source[0] as number) - 1] as VoucherLine;
  const destinationLine = lines[(destination[0] as number) - 1] as VoucherLine;
  if (sourceLine.amountMinor >= 0n) {
    invalid("A transfer's source line is a credit", { rule: 12, lineNo: source[0] });
  }
  if (destinationLine.amountMinor <= 0n) {
    invalid("A transfer's destination line is a debit", { rule: 12, lineNo: destination[0] });
  }
  const others = lines.flatMap((line, index) =>
    index + 1 === source[0] || index + 1 === destination[0] ? [] : [{ line, lineNo: index + 1 }],
  );
  if (others.length > 1) invalid('A transfer has at most one fee line', { rule: 12 });
  const [fee] = others;
  if (fee !== undefined) {
    const account = voucher.accounts.get(fee.line.account);
    if (
      fee.line.amountMinor <= 0n ||
      fee.line.currency !== sourceLine.currency ||
      (account !== undefined && account.accountClass !== 5)
    ) {
      invalid("A transfer's fee is a debit on an expense account in the source's currency", {
        rule: 12,
        lineNo: fee.lineNo,
      });
    }
  }
  const amounts: TransferAmounts = {
    given: -sourceLine.amountMinor,
    givenCurrency: sourceLine.currency,
    received: destinationLine.amountMinor,
    receivedCurrency: destinationLine.currency,
    fee: fee?.line.amountMinor ?? 0n,
  };
  if (amounts.given <= amounts.fee) {
    invalid("A transfer's fee is less than what leaves the source", { rule: 12 });
  }
  if (
    amounts.givenCurrency === amounts.receivedCurrency &&
    amounts.given !== amounts.received + amounts.fee
  ) {
    invalid("In one currency the source's credit is the destination's debit plus the fee", {
      rule: 12,
    });
  }
  return amounts;
}

/** The decimal places of every rate a voucher derives (S11 rule 12). */
export const DERIVED_RATE_DECIMALS = 10;

/**
 * The dealt rate of a currency exchange (S11 rule 12): what reached the destination over what left
 * the source net of the fee, quoted as `base`/`quote` (the company's orientation of the pair), each
 * amount in major units, rounded once half away from zero to 10 decimals. Null for a transfer in
 * one currency. A rate that rounds to zero cannot be stored (`INVALID_RATE`).
 */
export function derivedDealtRate(
  amounts: TransferAmounts,
  pair: { readonly base: CurrencyCode; readonly quote: CurrencyCode },
): { base: CurrencyCode; quote: CurrencyCode; rate: string } | null {
  const { givenCurrency, receivedCurrency } = amounts;
  if (givenCurrency === receivedCurrency) return null;
  const sides = new Set([pair.base, pair.quote]);
  if (pair.base === pair.quote || !sides.has(givenCurrency) || !sides.has(receivedCurrency)) {
    throw new RangeError(`${pair.base}/${pair.quote} is not the pair of the exchange`);
  }
  const net = amounts.given - amounts.fee;
  const [baseMinor, quoteMinor] =
    pair.base === givenCurrency ? [net, amounts.received] : [amounts.received, net];
  const baseExponent = BigInt(currencies[pair.base].exponent);
  const quoteExponent = BigInt(currencies[pair.quote].exponent);
  // quote ÷ base in major units: quoteMinor / 10^qe ÷ (baseMinor / 10^be), scaled by 10^10.
  const scaled = divideHalfAwayFromZero(
    quoteMinor * 10n ** (baseExponent + BigInt(DERIVED_RATE_DECIMALS)),
    baseMinor * 10n ** quoteExponent,
  );
  if (scaled <= 0n) {
    throw new DomainError('INVALID_RATE', 'The exchange gives a rate of zero', {
      base: pair.base,
      quote: pair.quote,
    });
  }
  const digits = scaled.toString().padStart(DERIVED_RATE_DECIMALS + 1, '0');
  const rate = `${digits.slice(0, -DERIVED_RATE_DECIMALS)}.${digits.slice(-DERIVED_RATE_DECIMALS)}`;
  return { base: pair.base, quote: pair.quote, rate };
}

/**
 * A count's lines (S11 rule 13) for a box counted at `counted` against its expected balance: a
 * shortage Dr the shortage account / Cr the box, an overage Dr the box / Cr the overage account,
 * both in the box's currency for the difference; none when they match. Both lines are new
 * measurements at the count's date (`manualEntry()`).
 */
export function countLines(count: {
  readonly box: string;
  readonly currency: CurrencyCode;
  readonly countedMinor: bigint;
  readonly expectedMinor: bigint;
  readonly shortageAccount: string;
  readonly overageAccount: string;
}): VoucherLine[] {
  if (count.countedMinor < 0n || count.expectedMinor < 0n) {
    throw new RangeError('A count is of a box at or above zero, and the cash counted is too');
  }
  const difference = count.countedMinor - count.expectedMinor;
  if (difference === 0n) return [];
  const { box, currency } = count;
  return difference < 0n
    ? [
        { account: count.shortageAccount, currency, amountMinor: -difference },
        { account: box, currency, amountMinor: difference },
      ]
    : [
        { account: box, currency, amountMinor: difference },
        { account: count.overageAccount, currency, amountMinor: -difference },
      ];
}

/** A box's net movement on one date, in its currency (the sum of its lines dated then). */
export interface BoxMovement {
  readonly date: string;
  readonly amountMinor: bigint;
}

/** A box's balance at the end of `on` (S11 rule 13): `opening` plus its movements dated `on`. */
export function balanceAtEnd(box: {
  readonly opening: bigint;
  readonly later: readonly BoxMovement[];
  readonly on: string;
}): bigint {
  let balance = box.opening;
  for (const movement of box.later) if (movement.date === box.on) balance += movement.amountMinor;
  return balance;
}

/** A count's difference (S11 rule 13): counted less expected, a shortage below zero. */
export function countDifference(countedMinor: bigint, expectedMinor: bigint): bigint {
  return countedMinor - expectedMinor;
}
