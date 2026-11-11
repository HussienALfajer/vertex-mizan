import {
  type CompanyLedgers,
  type CrossRate,
  type CurrencyCode,
  convert,
  DomainError,
  type ExchangeRate,
  type Ledger,
  money,
} from '@vertex-mizan/contracts';
import { differenceLine, type LineTarget } from './balance.js';
import { reverseLines } from './carried.js';
import type { CanonicalValue } from './integrity.js';
import { type Dimensions, type Line, ledgerCurrency } from './lines.js';
import type { PostedEntry } from './manual.js';
import { lastDayOfMonth } from './periods.js';

// The month-end revaluation of one ledger (S07 rules 10–15, ADR 0007, ADR 0016; scenario
// `currency/month-end-revaluation`): each monetary balance in a currency other than the ledger's
// is brought to its transaction balance at the closing rate. The posting function reads the
// balances and the rates; these functions decide every amount.

/**
 * One balance to revalue in a ledger, as the posting function reads it at the month's end: an open
 * item of a monetary control account (`item`), or a monetary account's balance per dimension set
 * and currency. `carryingMinor` is its amount in the ledger without the lines of revaluation
 * entries and their reversals (ADR 0007: a carrying amount never includes a revaluation);
 * `revaluedMinor`, what revaluation entries dated on the month's last day already posted on it.
 */
export interface RevaluationBalance {
  readonly account: string;
  readonly dimensions: Dimensions;
  /** The open item it is, on a control account. */
  readonly item?: string;
  readonly currency: CurrencyCode;
  /** The open transaction balance, in `currency`. */
  readonly transactionMinor: bigint;
  readonly carryingMinor: bigint;
  readonly revaluedMinor: bigint;
}

/** A balance with its target at the closing rate and the difference still to post. */
export interface RevaluedBalance extends RevaluationBalance {
  readonly targetMinor: bigint;
  /** `target − carrying − revalued` (rule 12): zero when the ledger's revaluation is current. */
  readonly differenceMinor: bigint;
}

/**
 * A balance revalued at `rate`, the closing rate of its currency in `ledger` (rule 12): the target
 * is its transaction balance converted once, rounded half away from zero through `convert()`, so a
 * zero transaction balance with an amount left in the ledger is brought to zero (rule 10).
 */
export function revalueBalance(
  balance: RevaluationBalance,
  ledgers: CompanyLedgers,
  ledger: Ledger,
  rate: ExchangeRate | CrossRate,
): RevaluedBalance {
  const to = ledgerCurrency(ledgers, ledger);
  if (balance.currency === to) {
    throw new TypeError('A balance in the ledger currency is not revalued in it');
  }
  const targetMinor = convert(
    money(balance.transactionMinor, balance.currency),
    to,
    rate,
  ).amountMinor;
  return {
    ...balance,
    targetMinor,
    differenceMinor: targetMinor - balance.carryingMinor - balance.revaluedMinor,
  };
}

/** The unrealised exchange gain and loss accounts (roles `fx_unrealised_gain`, `fx_unrealised_loss`). */
export interface UnrealisedTargets {
  readonly gain: LineTarget;
  readonly loss: LineTarget;
}

/**
 * The lines of a ledger's revaluation entry (rule 13; owner, 2026-11-11): for each balance with a
 * difference *d*, two difference lines in `ledger` only, the other ledger zero: one on the balance,
 * in its currency with a transaction amount of zero, its dimensions and its open item (a
 * `revaluation` movement); one of −*d* in the ledger's currency on the unrealised gain account when
 * it is a credit, or on the loss account when it is a debit, without dimensions. Gains and losses
 * are never netted (IAS 1.32), and the lines balance exactly, so the entry needs no rounding line.
 * No line for a balance whose difference is zero; none at all when the revaluation is current.
 */
export function revaluationLines(
  ledgers: CompanyLedgers,
  ledger: Ledger,
  balances: readonly RevaluedBalance[],
  targets: UnrealisedTargets,
): Line[] {
  return balances.flatMap((balance) => {
    const d = balance.differenceMinor;
    if (d === 0n) return [];
    const onBalance = differenceLine(ledgers, ledger, d, {
      kind: 'item',
      currency: balance.currency,
      account: balance.account,
      dimensions: balance.dimensions,
    });
    const result = d > 0n ? targets.gain : targets.loss;
    return [
      balance.item === undefined
        ? onBalance
        : { ...onBalance, item: { id: balance.item, movement: 'revaluation' as const } },
      differenceLine(ledgers, ledger, -d, { ...result, kind: 'gain-loss' }),
    ];
  });
}

/** The first day of the month after the month of `on`. */
export function firstDayOfNextMonth(on: string): string {
  const year = Number(on.slice(0, 4));
  const month = Number(on.slice(5, 7));
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return `${next}-01`;
}

/**
 * The reversal of a revaluation entry, dated `on` (rule 14; scope §4): its lines negated exactly
 * (`reverseLines()`, each keeping its item, so its movements are `revaluation` too), posted by the
 * revaluation itself on the first day of the next month. Only a revaluation entry that is not a
 * reversal is reversed this way (`ENTRY_NOT_REVERSIBLE`), once (`ENTRY_ALREADY_REVERSED`); a
 * revaluation is never reversed by hand (`manualReversalLines()`).
 */
export function revaluationReversalLines(original: PostedEntry, on: string): Line[] {
  if (original.source !== 'revaluation' || original.isReversal) {
    throw new DomainError('ENTRY_NOT_REVERSIBLE', 'Only a revaluation reverses this way', {
      source: original.source,
    });
  }
  if (original.reversed) {
    throw new DomainError('ENTRY_ALREADY_REVERSED', 'The entry has a reversal already');
  }
  if (
    original.date !== lastDayOfMonth(original.date) ||
    on !== firstDayOfNextMonth(original.date)
  ) {
    throw new RangeError('A revaluation is dated on a last day and reversed on the next day');
  }
  return reverseLines(original.lines);
}

/** The rate rows a closing rate used: its row, or both quotes of a cross, as their ids. */
export interface ClosingRateRows {
  readonly currency: CurrencyCode;
  readonly rowIds: readonly string[];
}

/**
 * What the preview's fingerprint hashes (rule 17): the month, the ledger, the rate rows of each
 * closing rate, and each balance with its amounts, in a fixed order. Any change to a balance, to a
 * difference or to a rate row in force changes it, so a posting is exact to the preview it repeats.
 */
export function revaluationFingerprintValue(input: {
  readonly period: string;
  readonly ledger: Ledger;
  readonly rates: readonly ClosingRateRows[];
  readonly balances: readonly (RevaluationBalance & {
    readonly targetMinor: bigint | null;
    readonly differenceMinor: bigint | null;
  })[];
}): CanonicalValue {
  return {
    period: input.period,
    ledger: input.ledger,
    rates: input.rates.map((rate) => ({ currency: rate.currency, rows: [...rate.rowIds] })),
    balances: input.balances.map((balance) => ({
      account: balance.account,
      dimensions: Object.entries(balance.dimensions)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([type, value]) => `${type}:${value}`),
      item: balance.item ?? null,
      currency: balance.currency,
      transaction: balance.transactionMinor,
      carrying: balance.carryingMinor,
      revalued: balance.revaluedMinor,
      target: balance.targetMinor,
      difference: balance.differenceMinor,
    })),
  };
}
