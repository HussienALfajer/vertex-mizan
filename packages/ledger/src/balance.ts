import {
  type CompanyLedgers,
  type CurrencyCode,
  checkCurrencyDate,
  convert,
  DomainError,
  type ExactTerm,
  type Ledger,
  type Money,
  money,
  sumsToZeroExactly,
} from '@vertex-mizan/contracts';
import { type Dimensions, keptLedgers, type Line, ledgerAmount, ledgerCurrency } from './lines.js';

/** Where a line goes: an account and its dimensions. */
export interface LineTarget {
  readonly account: string;
  readonly dimensions?: Dimensions;
}

/**
 * Where an exchange difference goes (ADR 0007): the exchange gain or loss account, where the
 * line's transaction currency is the ledger's currency; or a monetary account or open item, where
 * the line keeps the item's currency with a transaction amount of zero, so the item's transaction
 * balance and the account's currency restriction hold.
 */
export type DifferenceTarget =
  | (LineTarget & { readonly kind: 'gain-loss' })
  | (LineTarget & { readonly kind: 'item'; readonly currency: CurrencyCode });

function amountIn(line: Line, ledger: Ledger): bigint {
  const amount = ledgerAmount(line, ledger);
  if (amount === null) throw new TypeError(`A line with no ${ledger} amount`);
  return amount;
}

/** The sum of the lines' amounts in one ledger: zero when they balance in it. */
export function ledgerTotal(lines: readonly Line[], ledger: Ledger): bigint {
  let total = 0n;
  for (const line of lines) total += amountIn(line, ledger);
  return total;
}

function oneLedgerLine(
  kind: 'difference' | 'rounding',
  ledgers: CompanyLedgers,
  ledger: Ledger,
  amountMinor: bigint,
  transaction: Money | null,
  target: LineTarget,
): Line {
  const amount = money(amountMinor, ledgerCurrency(ledgers, ledger));
  return {
    kind,
    ledger,
    account: target.account,
    dimensions: target.dimensions ?? {},
    transaction: transaction ?? amount,
    bookMinor: ledger === 'book' ? amountMinor : 0n,
    parallelMinor: ledgers.parallel === null ? null : ledger === 'parallel' ? amountMinor : 0n,
  };
}

/** An exchange-difference line, realised or unrealised, with `amountMinor` in `ledger` only. */
export function differenceLine(
  ledgers: CompanyLedgers,
  ledger: Ledger,
  amountMinor: bigint,
  target: DifferenceTarget,
): Line {
  if (target.kind === 'item' && target.currency === ledgerCurrency(ledgers, ledger)) {
    throw new TypeError('An item in the ledger currency has no exchange difference in it');
  }
  const transaction = target.kind === 'item' ? money(0n, target.currency) : null;
  return oneLedgerLine('difference', ledgers, ledger, amountMinor, transaction, target);
}

/**
 * The lines an exchange difference cannot explain: all but difference and rounding lines. When
 * they are all in one transaction currency they balance in it; when they are also all new
 * measurements, any residual in a ledger is conversion rounding (ADR 0007). An overpayment, a
 * short payment or a mistake in a posting rule is never a gain or loss.
 */
function checkOneCurrency(lines: readonly Line[]): void {
  const base = lines.filter((line) => line.kind !== 'difference' && line.kind !== 'rounding');
  const currency = base[0]?.transaction.currency;
  if (currency === undefined || base.some((line) => line.transaction.currency !== currency)) {
    return;
  }
  let total = 0n;
  for (const line of base) total += line.transaction.amountMinor;
  if (total !== 0n) {
    throw new DomainError('ENTRY_UNBALANCED', `The entry's ${currency} lines do not balance`, {
      currency,
      residualMinor: (-total).toString(),
    });
  }
  const measuredOnly = base.every((line) => line.kind === 'measured');
  if (measuredOnly && lines.some((line) => line.kind === 'difference')) {
    throw new DomainError(
      'ENTRY_UNBALANCED',
      `New measurements in ${currency} alone leave no exchange difference`,
      { currency },
    );
  }
}

/**
 * The realised exchange-difference lines that balance `lines` (IAS 21.28): one on `target`, the
 * exchange gain or loss account, for the residual of each ledger they leave out of balance. For
 * posting rules that settle or clear a carried balance, or whose lines are in more than one
 * transaction currency; the residual includes the conversion rounding of their new measurements.
 * Lines in one transaction currency that do not balance in it are refused (`ENTRY_UNBALANCED`).
 */
export function exchangeDifferenceLines(
  ledgers: CompanyLedgers,
  lines: readonly Line[],
  target: LineTarget,
): Line[] {
  checkOneCurrency(lines);
  const differences: Line[] = [];
  for (const [ledger] of keptLedgers(ledgers)) {
    const residual = -ledgerTotal(lines, ledger);
    if (residual !== 0n) {
      differences.push(differenceLine(ledgers, ledger, residual, { ...target, kind: 'gain-loss' }));
    }
  }
  return differences;
}

function checkShape(line: Line, ledgers: CompanyLedgers): void {
  const keepsParallel = ledgers.parallel !== null;
  if ((line.parallelMinor !== null) !== keepsParallel) {
    throw new TypeError('A line whose parallel amount does not match the company ledgers');
  }
  if (line.kind === 'measured' && !keepsParallel && line.conversions.parallel !== null) {
    throw new TypeError('A parallel conversion in a company that keeps no parallel ledger');
  }
  if ((line.kind === 'difference' || line.kind === 'rounding') && line.ledger === 'parallel') {
    if (!keepsParallel) throw new TypeError('A parallel line in a company that keeps none');
  }
}

/**
 * Checks a line's amount in one ledger against its kind, and returns its term in the exact
 * balance: the transaction amount with the rate it was converted at, or the amount as is.
 * Rounding lines have no term: the rounding they absorb is judged without them.
 */
function termIn(line: Line, ledger: Ledger, currency: CurrencyCode): ExactTerm | null {
  const amount = amountIn(line, ledger);
  const asIs = { amount: money(amount, currency) }; // refuses an amount outside the stored range
  const { transaction } = line;
  const own = transaction.currency === currency;
  if (line.kind === 'difference' || line.kind === 'rounding') {
    // In one ledger only: in its ledger currency for the amount, or, for a difference on an item
    // in another currency, with no transaction amount.
    const fits =
      line.ledger !== ledger
        ? amount === 0n
        : own
          ? transaction.amountMinor === amount
          : line.kind === 'difference' && transaction.amountMinor === 0n;
    if (!fits) throw new TypeError(`A ${line.kind} line that does not fit ADR 0007`);
    return line.kind === 'rounding' ? null : asIs;
  }
  const conversion = line.kind === 'measured' ? line.conversions[ledger] : null;
  if (own) {
    // An amount in its own currency is never converted.
    if (conversion !== null || transaction.amountMinor !== amount) {
      throw new TypeError('A line in the ledger currency whose amount is not its own');
    }
    return asIs;
  }
  if (line.kind === 'carried') return asIs;
  if (conversion === null) throw new TypeError('A measured line with no conversion');
  if (convert(transaction, currency, conversion.rate).amountMinor !== amount) {
    throw new TypeError('A measured line whose amount is not the conversion it records');
  }
  return { amount: transaction, rate: conversion.rate };
}

/** An entry as a posting rule built it, before its rounding lines. */
export interface EntryDraft {
  /** The entry date. */
  readonly on: string;
  readonly ledgers: CompanyLedgers;
  readonly lines: readonly Line[];
  /** The company's conversion-rounding account. */
  readonly rounding: LineTarget;
}

/**
 * The lines of an entry ready to post (ADR 0007): `lines`, and for each ledger that conversion
 * rounding alone leaves out of balance, a line on the rounding account for the difference, in that
 * ledger only. Rounding alone means that, leaving rounding lines out, the exact, unrounded values
 * of the converted lines and the other lines' amounts sum to zero; the rounding of a ledger, added
 * here or passed in (a reversal's, which must then balance the ledger by itself), is therefore at
 * most half a minor unit per converted line.
 *
 * Refuses an entry with fewer than two lines (`ENTRY_TOO_FEW_LINES`), an SYP amount dated before
 * the new pound (`SYP_BEFORE_REDENOMINATION`), and any other imbalance (`ENTRY_UNBALANCED`): lines
 * in one transaction currency that do not balance in it, a difference line among new measurements
 * in one currency, or a residual that is not rounding (the posting rule posts an exchange residual
 * as difference lines first). A line whose amounts contradict its kind is a programming error
 * (`TypeError`).
 */
export function balanceEntry(draft: EntryDraft): Line[] {
  const { on, ledgers, lines } = draft;
  if (lines.length < 2) {
    throw new DomainError('ENTRY_TOO_FEW_LINES', `An entry with ${lines.length} line(s)`);
  }
  for (const [, settings] of keptLedgers(ledgers)) checkCurrencyDate(settings.currency, on);
  for (const line of lines) {
    checkCurrencyDate(line.transaction.currency, on);
    checkShape(line, ledgers);
  }
  // Every line is checked in every ledger before any balance is judged.
  const checked = keptLedgers(ledgers).map(([ledger, settings]) => {
    const terms: ExactTerm[] = [];
    for (const line of lines) {
      const term = termIn(line, ledger, settings.currency);
      if (term !== null) terms.push(term);
    }
    return { ledger, currency: settings.currency, terms };
  });
  checkOneCurrency(lines);
  const balanced = [...lines];
  for (const { ledger, currency, terms } of checked) {
    const residual = -ledgerTotal(lines, ledger);
    // Rounding lines passed in (a reversal's) must be all the rounding their ledger needs.
    const rounded = lines.some((line) => line.kind === 'rounding' && line.ledger === ledger);
    if (residual === 0n && !rounded) continue;
    if ((rounded && residual !== 0n) || !sumsToZeroExactly(currency, terms)) {
      throw new DomainError(
        'ENTRY_UNBALANCED',
        `The entry is out of balance in the ${ledger} ledger beyond conversion rounding`,
        { ledger, residualMinor: residual.toString() },
      );
    }
    if (residual !== 0n) {
      balanced.push(oneLedgerLine('rounding', ledgers, ledger, residual, null, draft.rounding));
    }
  }
  return balanced;
}
