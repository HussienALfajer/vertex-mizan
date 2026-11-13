import {
  type CompanyLedgers,
  type CurrencyCode,
  DomainError,
  type ExchangeRate,
  type HubContractRef,
  type HubDocumentId,
  type HubServiceRef,
  type HubValueRef,
  hubMinor,
  type InvoiceLine,
  isContractAsset,
  type Ledger,
  type Money,
  money,
  type OpeningInvoice,
  type OpeningSnapshot,
  type RateType,
} from '@vertex-mizan/contracts';
import { hubDealtRates, recognitionPatternOf } from './hub.js';
import {
  type CarriedAmounts,
  type Conversion,
  keptLedgers,
  type Line,
  ledgerAmount,
  negate,
} from './lines.js';
import { type MeasureContext, measure } from './measure.js';
import { dayAfter } from './periods.js';
import type { PublicationCalendar } from './rates.js';
import {
  creditParts,
  type OverTimeMonth,
  overTimeMonths,
  releaseParts,
  remainingReleaseParts,
} from './recognition.js';

/**
 * The opening balances (S10 rules 11–19, 23; ADR 0019; `docs/scenarios/opening/opening-entry.md`,
 * owner 2026-11-12): Hub's part of the opening entry from its snapshot as of the eve, the
 * accountant's lines from the old records, and the balancing figure on retained earnings, each
 * ledger on its own. Pure: `packages/db` reads the snapshot, the rates, the accounts and the draft,
 * calls these functions, maps Hub's references to dimension values and posts through `post()`.
 */

/**
 * Hub's numbers in their natural order (`INV-2026-8` before `INV-2026-10`): digit runs compared as
 * numbers, everything else as text, then the whole text as a tie-break.
 */
export function compareNumbers(a: string, b: string): number {
  const chunks = (text: string) => text.match(/\d+|\D+/g) ?? [];
  const left = chunks(a);
  const right = chunks(b);
  for (let k = 0; k < Math.min(left.length, right.length); k++) {
    const x = left[k] as string;
    const y = right[k] as string;
    if (x === y) continue;
    const numeric = /^\d/.test(x) && /^\d/.test(y);
    if (numeric) {
      const difference = BigInt(x) - BigInt(y);
      if (difference !== 0n) return difference < 0n ? -1 : 1;
      continue;
    }
    return x < y ? -1 : 1;
  }
  if (left.length !== right.length) return left.length - right.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** What the opening reads to measure: the ledgers, the eve, the rate table and the calendar. */
export interface OpeningRateContext {
  readonly ledgers: CompanyLedgers;
  /** The eve of the books start (`as_of`): the date of every monetary measurement (rule 17). */
  readonly asOf: string;
  readonly rates: readonly ExchangeRate[];
  readonly calendar: PublicationCalendar;
}

/** A rate a measurement needed and the table lacks (check `rates`, S10 rule 21). */
export interface MissingRate {
  readonly ledger: Ledger;
  readonly rateType: RateType;
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly on: string;
}

/** A line S06 would hold (check `schedules`, S10 rule 13): Hub's invoice number, the line, why. */
export interface ScheduleFailure {
  readonly invoice: string;
  /** The line's place on its invoice, from 1; 0 for a credit of another invoice. */
  readonly position: number;
  readonly detail: string;
}

/**
 * A new measurement in each ledger at the context's date, or the rate it misses: a measurement
 * that cannot be made is a failing check, not a refusal, so the preview lists every missing rate.
 */
function tryMeasure(
  amount: Money,
  context: MeasureContext,
  missing: MissingRate[],
): ReturnType<typeof measure> | null {
  try {
    return measure(amount, context);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'RATE_MISSING') {
      const details = error.details as unknown as MissingRate;
      const seen = missing.some(
        (rate) =>
          rate.ledger === details.ledger &&
          rate.from === details.from &&
          rate.to === details.to &&
          rate.on === details.on,
      );
      if (!seen) {
        missing.push({
          ledger: details.ledger,
          rateType: details.rateType,
          from: details.from,
          to: details.to,
          on: details.on,
        });
      }
      return null;
    }
    throw error;
  }
}

function zeroOf(currency: CurrencyCode, ledgers: CompanyLedgers): CarriedAmounts {
  return {
    transaction: money(0n, currency),
    bookMinor: 0n,
    parallelMinor: ledgers.parallel === null ? null : 0n,
  };
}

function addCarried(a: CarriedAmounts, b: CarriedAmounts): CarriedAmounts {
  if (a.transaction.currency !== b.transaction.currency) {
    throw new TypeError('Amounts in two currencies');
  }
  return {
    transaction: money(
      a.transaction.amountMinor + b.transaction.amountMinor,
      a.transaction.currency,
    ),
    bookMinor: a.bookMinor + b.bookMinor,
    parallelMinor:
      a.parallelMinor === null || b.parallelMinor === null
        ? null
        : a.parallelMinor + b.parallelMinor,
  };
}

/** Hub's rate of an invoice as a dealt rate of its issue date, where a ledger reads it. */
function hubIssueRates(
  ledgers: CompanyLedgers,
  currency: CurrencyCode,
  sypPerUsd: string,
  issuedOn: string,
): ExchangeRate[] {
  return hubDealtRates(ledgers, [currency], sypPerUsd).map((rate) => ({
    effectiveOn: issuedOn,
    base: rate.base,
    quote: rate.quote,
    rate: rate.rate,
    type: 'market',
    source: 'hub',
  }));
}

/**
 * An invoice line's schedule as the opening opens it (S10 rule 13): what S06's rules would leave of
 * it at the end of the eve had its invoice posted on its date at its rates, each credit on its date
 * and each milestone done on its date.
 */
export interface OpeningSchedule {
  readonly invoice: HubDocumentId;
  readonly issuedOn: string;
  readonly client: HubValueRef;
  readonly contract: HubContractRef | undefined;
  readonly line: InvoiceLine;
  readonly service: HubServiceRef;
  /** The line's place on its invoice, from 1. */
  readonly position: number;
  readonly pattern: 'over_time' | 'point_in_time';
  readonly serviceFrom: string | null;
  readonly serviceTo: string | null;
  readonly milestoneId: string | null;
  /** `<retainer external id>:<cycle_start>` for a retainer cycle's charge, else null. */
  readonly cycleKey: string | null;
  /** The months of the service period over time (`overTimeMonths()`); none at a point in time. */
  readonly months: readonly OverTimeMonth[];
  /** What the line deferred at its rates of issue, positive: the `deferred` movement. */
  readonly deferred: CarriedAmounts;
  /** How the deferral was measured, per ledger. */
  readonly conversions: { readonly book: Conversion | null; readonly parallel: Conversion | null };
  /**
   * What S06 took off it through the eve, zero or negative: its releases and its credits' liability
   * parts. The `before_opening` movement; the opening's contract liability line is the negation of
   * `deferred` plus it.
   */
  readonly beforeOpening: CarriedAmounts;
  /** The credits' parts of its transaction amount through the eve (S06 rule 6), positive. */
  readonly creditMinor: bigint;
  /**
   * Each month released through the eve with its release, negative (S06 rule 4): a `before_opening`
   * movement of its month, as a `released` one would be.
   */
  readonly releases: readonly { readonly month: string; readonly amounts: CarriedAmounts }[];
  /**
   * What the credits took off its liability through the eve, zero or negative: a `before_opening`
   * movement with no month and the credits' part, as a `credited` one would be; null with no credit.
   */
  readonly creditLiability: CarriedAmounts | null;
  /** What it still defers at the eve, positive in its transaction amount. */
  readonly remaining: CarriedAmounts;
  /** The months released through the eve, in order. */
  readonly releasedMonths: readonly string[];
}

/** One over-time line in the simulation of S06 through the eve. */
interface Simulated {
  readonly base: Omit<
    OpeningSchedule,
    | 'beforeOpening'
    | 'creditMinor'
    | 'remaining'
    | 'releasedMonths'
    | 'releases'
    | 'creditLiability'
  >;
  netMinor: bigint;
  creditMinor: bigint;
  remaining: CarriedAmounts;
  released: string[];
  releases: { month: string; amounts: CarriedAmounts }[];
  creditLiability: CarriedAmounts | null;
  /** Whether a credit took a part of it: its months are then cut from what remains (S06 rule 6). */
  credited: boolean;
}

/** The schedules of a snapshot, the lines S06 would hold, and the rates their deferrals miss. */
export interface OpeningSchedules {
  readonly schedules: readonly OpeningSchedule[];
  readonly failures: readonly ScheduleFailure[];
  readonly missingRates: readonly MissingRate[];
}

/**
 * The schedules the opening opens (S10 rule 13), in the order of their lines on the opening entry:
 * by Hub's invoice number and the line's place. Each invoice's deferrals are measured at its rates
 * of issue (rule 17: the bulletin of `issued_on` in the book ledger, Hub's `syp_per_usd` where a
 * ledger accepts it); then, in date order, each month that ended on or before the eve is released
 * by S06's parts (`releaseParts()`, or after a credit `remainingReleaseParts()` of what remains),
 * every month that ended before a credit's date first, and each credit (of an invoice in
 * `invoices`, or of `credits`) is shared over its cycle's schedules standing on its date by
 * `creditParts()`. A deposit or milestone line whose milestone is not done by the eve stays whole.
 * Only a line with something left at the eve is opened; a line S06 would hold is a failure.
 */
export function openingSchedules(
  snapshot: OpeningSnapshot,
  context: OpeningRateContext,
): OpeningSchedules {
  const { ledgers, asOf } = context;
  const failures: ScheduleFailure[] = [];
  const missingRates: MissingRate[] = [];
  const milestones = new Map(snapshot.milestones.map((m) => [m.milestone.id, m]));
  const simulated: Simulated[] = [];
  const pointInTime: OpeningSchedule[] = [];
  const credits: {
    invoice: string;
    position: number;
    issuedOn: string;
    currency: CurrencyCode;
    cycleKey: string;
    creditMinor: bigint;
    order: number;
  }[] = [];
  // S06 opens schedules in the order its invoices post: Hub's, by issue date, then as listed.
  const invoices = [...snapshot.invoices].sort((a, b) =>
    a.issued_on < b.issued_on ? -1 : a.issued_on > b.issued_on ? 1 : 0,
  );

  const measureDeferral = (invoice: OpeningInvoice, amountMinor: bigint) =>
    tryMeasure(
      money(amountMinor, invoice.currency),
      {
        ledgers,
        on: invoice.issued_on,
        rates: context.rates,
        calendar: context.calendar,
        dealtRates: hubIssueRates(
          ledgers,
          invoice.currency,
          invoice.syp_per_usd,
          invoice.issued_on,
        ),
      },
      missingRates,
    );

  for (const invoice of invoices) {
    const { client, contract } = invoice;
    for (const [index, line] of invoice.lines.entries()) {
      const position = index + 1;
      const pattern = recognitionPatternOf(line, contract);
      const fail = (detail: string) =>
        failures.push({ invoice: invoice.invoice.number, position, detail });
      if (pattern.kind === 'at_issue') continue;
      if (pattern.kind === 'unclear') {
        fail(`recognition_pattern_unclear:${position}`);
        continue;
      }
      if (pattern.kind === 'credit') {
        if (contract === undefined) continue;
        credits.push({
          invoice: invoice.invoice.number,
          position,
          issuedOn: invoice.issued_on,
          currency: invoice.currency,
          cycleKey: `${contract.external_id}:${pattern.cycleStart}`,
          creditMinor: -hubMinor(line.amount),
          order: credits.length,
        });
        continue;
      }
      const common = {
        invoice: invoice.invoice,
        issuedOn: invoice.issued_on,
        client,
        contract,
        line,
        service: line.service,
        position,
      };
      if (pattern.kind === 'point_in_time') {
        const milestone = milestones.get(pattern.milestoneId);
        const doneOn = milestone?.done_on;
        // Done by the eve: S06 released the line's deferral at the done, or the line cleared the
        // done's contract asset at its issue, either only at the milestone's amount in its currency;
        // another amount is held `milestone_amount_differs` (S06 rules 11–12), so the check fails.
        if (
          milestone !== undefined &&
          doneOn !== undefined &&
          (BigInt(milestone.amount) !== hubMinor(line.amount) ||
            milestone.currency !== invoice.currency)
        ) {
          fail('milestone_amount_differs');
          continue;
        }
        // Done by the eve: recognised before the books start, nothing deferred.
        if (doneOn !== undefined) continue;
        const measured = measureDeferral(invoice, hubMinor(line.amount));
        if (measured === null) continue;
        const deferred: CarriedAmounts = {
          transaction: money(hubMinor(line.amount), invoice.currency),
          bookMinor: measured.bookMinor,
          parallelMinor: measured.parallelMinor,
        };
        pointInTime.push({
          ...common,
          pattern: 'point_in_time',
          serviceFrom: null,
          serviceTo: null,
          milestoneId: pattern.milestoneId,
          cycleKey: null,
          months: [],
          deferred,
          conversions: measured.conversions,
          beforeOpening: zeroOf(invoice.currency, ledgers),
          creditMinor: 0n,
          releases: [],
          creditLiability: null,
          remaining: deferred,
          releasedMonths: [],
        });
        continue;
      }
      const months = overTimeMonths(
        hubMinor(line.amount),
        pattern.from,
        pattern.to,
        invoice.issued_on,
      );
      const deferredMinor = months
        .filter((month) => !month.elapsed)
        .reduce((total, month) => total + month.transactionMinor, 0n);
      const cycleKey =
        line.source === 'retainer_charge' && contract !== undefined
          ? `${contract.external_id}:${pattern.from}`
          : null;
      // Wholly elapsed at issue: recognised as a contract asset then, nothing deferred.
      if (deferredMinor === 0n) continue;
      const measured = measureDeferral(invoice, deferredMinor);
      if (measured === null) continue;
      const deferred: CarriedAmounts = {
        transaction: money(deferredMinor, invoice.currency),
        bookMinor: measured.bookMinor,
        parallelMinor: measured.parallelMinor,
      };
      simulated.push({
        base: {
          ...common,
          pattern: 'over_time',
          serviceFrom: pattern.from,
          serviceTo: pattern.to,
          milestoneId: null,
          cycleKey,
          months,
          deferred,
          conversions: measured.conversions,
        },
        netMinor: hubMinor(line.amount),
        creditMinor: 0n,
        remaining: deferred,
        released: [],
        releases: [],
        creditLiability: null,
        credited: false,
      });
    }
  }
  for (const credit of snapshot.credits) {
    credits.push({
      invoice: credit.invoice.number,
      position: 0,
      issuedOn: credit.issued_on,
      currency: credit.currency,
      cycleKey: `${credit.contract.external_id}:${credit.line.cycle_start}`,
      creditMinor: -hubMinor(credit.line.amount),
      order: credits.length,
    });
  }

  // A month's release as S06 cuts it (`overTimeStates()` of `packages/db`): from the deferral by
  // `releaseParts()` while never credited, then from what remains over the months not released by
  // `remainingReleaseParts()`, each time a month is released.
  const releaseOf = (schedule: Simulated, month: string): CarriedAmounts => {
    const open = schedule.base.months.filter((m) => !m.elapsed);
    if (!schedule.credited) {
      const parts = releaseParts(schedule.base.deferred, schedule.base.months, ledgers);
      const part = parts[open.findIndex((m) => m.month === month)];
      if (part === undefined) throw new TypeError('A month without its release');
      return part;
    }
    const left = open.filter((m) => !schedule.released.includes(m.month));
    const parts = remainingReleaseParts(schedule.remaining, left, ledgers);
    const part = parts[left.findIndex((m) => m.month === month)];
    if (part === undefined) throw new TypeError('A month without its release');
    return part;
  };

  // S06 through the eve, in date order: a month is released once it ended, before any credit
  // dated after its last day; a credit is shared over its cycle's schedules standing on its date.
  type Step =
    | { kind: 'release'; on: string; schedule: Simulated; month: string }
    | { kind: 'credit'; on: string; credit: (typeof credits)[number] };
  const steps: Step[] = [];
  for (const schedule of simulated) {
    for (const month of schedule.base.months) {
      if (month.elapsed || month.lastDay > asOf) continue;
      steps.push({ kind: 'release', on: dayAfter(month.lastDay), schedule, month: month.month });
    }
  }
  for (const credit of credits) steps.push({ kind: 'credit', on: credit.issuedOn, credit });
  steps.sort((a, b) => {
    if (a.on !== b.on) return a.on < b.on ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'release' ? -1 : 1;
    return a.kind === 'credit' && b.kind === 'credit' ? a.credit.order - b.credit.order : 0;
  });
  for (const step of steps) {
    if (step.kind === 'release') {
      const { schedule, month } = step;
      const part = releaseOf(schedule, month);
      schedule.remaining = addCarried(schedule.remaining, negate(part));
      schedule.released.push(month);
      schedule.releases.push({ month, amounts: negate(part) });
      continue;
    }
    const { credit } = step;
    const standing = simulated.filter(
      (schedule) =>
        schedule.base.cycleKey === credit.cycleKey &&
        schedule.base.issuedOn <= credit.issuedOn &&
        schedule.remaining.transaction.currency === credit.currency,
    );
    const fail = (detail: string) =>
      failures.push({ invoice: credit.invoice, position: credit.position, detail });
    if (standing.length === 0) {
      fail('credit_cycle');
      continue;
    }
    const net = standing.reduce((total, schedule) => total + schedule.netMinor, 0n);
    if (credit.creditMinor > net) {
      fail('credit_exceeds_cycle');
      continue;
    }
    const parts = creditParts(
      credit.creditMinor,
      standing.map((schedule) => ({ netMinor: schedule.netMinor, remaining: schedule.remaining })),
    );
    for (const [k, schedule] of standing.entries()) {
      const part = parts[k];
      if (part === undefined) throw new TypeError('A schedule without its part');
      const partMinor = part.revenueMinor + (part.liability?.transaction.amountMinor ?? 0n);
      if (partMinor === 0n) continue;
      schedule.netMinor -= partMinor;
      schedule.creditMinor += partMinor;
      schedule.credited = true;
      const liability =
        part.liability === null ? zeroOf(credit.currency, ledgers) : negate(part.liability);
      schedule.remaining = addCarried(schedule.remaining, liability);
      schedule.creditLiability =
        schedule.creditLiability === null
          ? liability
          : addCarried(schedule.creditLiability, liability);
    }
  }

  const overTime: OpeningSchedule[] = simulated
    .filter((schedule) => schedule.remaining.transaction.amountMinor !== 0n)
    .map((schedule) => ({
      ...schedule.base,
      beforeOpening: addCarried(schedule.remaining, negate(schedule.base.deferred)),
      creditMinor: schedule.creditMinor,
      releases: schedule.releases,
      creditLiability: schedule.creditLiability,
      remaining: schedule.remaining,
      releasedMonths: schedule.released,
    }));
  const schedules = [...overTime, ...pointInTime].sort(
    (a, b) => compareNumbers(a.invoice.number, b.invoice.number) || a.position - b.position,
  );
  return { schedules, failures, missingRates };
}

/** The slots of Hub's part (S10 rule 11), as the opening entry orders them (rule 23). */
export const OPENING_HUB_SLOTS = ['receivable', 'contract_asset', 'ad_funds'] as const;

export type OpeningHubSlot = (typeof OPENING_HUB_SLOTS)[number];

/**
 * An item of Hub's part (S10 rule 11): a receivable per invoice with an outstanding amount, a
 * contract asset per milestone done and not invoiced, an ad funds running item per client wallet;
 * monetary, measured at each ledger's policy rate in force on the eve (rule 17). `amount` is the
 * line's transaction amount, debit positive (ad funds held are a credit).
 */
export interface OpeningHubItem {
  readonly slot: OpeningHubSlot;
  /** Hub's invoice number, milestone number, or the client's code (an ad funds item). */
  readonly reference: string;
  /** The Hub document of a receivable (the invoice) or a contract asset (the milestone). */
  readonly document: { readonly type: 'invoice' | 'milestone'; readonly id: HubDocumentId } | null;
  readonly client: HubValueRef;
  readonly contract: HubContractRef | undefined;
  readonly dueOn: string | null;
  /** Its document's own date (an invoice's issue, a milestone's done), or the eve. */
  readonly documentDate: string;
  readonly amount: Money;
  readonly bookMinor: bigint;
  readonly parallelMinor: bigint | null;
  readonly conversions: { readonly book: Conversion | null; readonly parallel: Conversion | null };
}

/** An ad funds item's reference: the client's code in Hub, else its Hub id. */
export function clientReference(client: HubValueRef): string {
  return client.code ?? client.external_id;
}

/**
 * Hub's items (S10 rule 11) in the opening entry's order (rule 23): by slot, then by Hub's number;
 * and the rates their measurements miss.
 */
export function openingHubItems(
  snapshot: OpeningSnapshot,
  context: OpeningRateContext,
): { readonly items: readonly OpeningHubItem[]; readonly missingRates: readonly MissingRate[] } {
  const missingRates: MissingRate[] = [];
  const measureContext: MeasureContext = {
    ledgers: context.ledgers,
    on: context.asOf,
    rates: context.rates,
    calendar: context.calendar,
  };
  const items: OpeningHubItem[] = [];
  const add = (item: Omit<OpeningHubItem, 'bookMinor' | 'parallelMinor' | 'conversions'>) => {
    const measured = tryMeasure(item.amount, measureContext, missingRates);
    items.push({
      ...item,
      bookMinor: measured?.bookMinor ?? 0n,
      parallelMinor: context.ledgers.parallel === null ? null : (measured?.parallelMinor ?? 0n),
      conversions: measured?.conversions ?? { book: null, parallel: null },
    });
  };
  for (const invoice of snapshot.invoices) {
    if (invoice.outstanding === 0) continue;
    add({
      slot: 'receivable',
      reference: invoice.invoice.number,
      document: { type: 'invoice', id: invoice.invoice },
      client: invoice.client,
      contract: invoice.contract,
      dueOn: invoice.due_on,
      documentDate: invoice.issued_on,
      amount: money(hubMinor(invoice.outstanding), invoice.currency),
    });
  }
  // A milestone a line of the snapshot's invoices names is billed (S06 rule 12): no contract asset.
  const billed = new Set(
    snapshot.invoices.flatMap((invoice) =>
      invoice.lines.flatMap((line) => (line.milestone_id === undefined ? [] : [line.milestone_id])),
    ),
  );
  for (const milestone of snapshot.milestones) {
    if (!isContractAsset(milestone) || billed.has(milestone.milestone.id)) continue;
    add({
      slot: 'contract_asset',
      reference: milestone.milestone.number,
      document: { type: 'milestone', id: milestone.milestone },
      client: milestone.client,
      contract: milestone.project,
      dueOn: null,
      documentDate: milestone.done_on ?? context.asOf,
      amount: money(hubMinor(milestone.amount), milestone.currency),
    });
  }
  for (const wallet of snapshot.wallets) {
    add({
      slot: 'ad_funds',
      reference: clientReference(wallet.client),
      document: null,
      client: wallet.client,
      contract: undefined,
      dueOn: null,
      documentDate: context.asOf,
      // Funds held are a credit; a wallet spent beyond its deposits a debit (ADR 0007).
      amount: money(-hubMinor(wallet.balance), 'USD'),
    });
  }
  const rank = (slot: OpeningHubSlot) => OPENING_HUB_SLOTS.indexOf(slot);
  items.sort((a, b) =>
    a.slot !== b.slot ? rank(a.slot) - rank(b.slot) : compareNumbers(a.reference, b.reference),
  );
  return { items, missingRates };
}

/**
 * A line of the accountant as the opening measures it (S10 rules 14, 17): `monetary` when its
 * account is monetary (a control account's item included). A stated line gives `bookMinor` and
 * `parallelMinor`, each null in its ledger's own currency, where the amount is itself.
 */
export interface OpeningRecordLine {
  readonly account: string;
  readonly monetary: boolean;
  readonly amount: Money;
  readonly bookMinor: bigint | null;
  readonly parallelMinor: bigint | null;
}

/** An accountant's line measured (rule 17), or why it cannot be: a stated amount missing. */
export type MeasuredRecordLine =
  | { readonly kind: 'line'; readonly line: Line }
  | { readonly kind: 'incomplete'; readonly ledger: Ledger }
  | { readonly kind: 'rate_missing' };

/**
 * The accountant's line (rule 17): monetary, a new measurement at each ledger's policy rate of the
 * eve; otherwise `stated`, its book and parallel amounts from the records, the amount itself in a
 * ledger of its own currency, where a typed amount must be the amount.
 */
export function openingRecordLine(
  input: OpeningRecordLine,
  context: OpeningRateContext,
  missingRates: MissingRate[],
): MeasuredRecordLine {
  const { ledgers } = context;
  if (input.monetary) {
    const measured = tryMeasure(
      input.amount,
      { ledgers, on: context.asOf, rates: context.rates, calendar: context.calendar },
      missingRates,
    );
    if (measured === null) return { kind: 'rate_missing' };
    return {
      kind: 'line',
      line: {
        kind: 'measured',
        account: input.account,
        dimensions: {},
        transaction: input.amount,
        bookMinor: measured.bookMinor,
        parallelMinor: measured.parallelMinor,
        conversions: measured.conversions,
      },
    };
  }
  const amounts = new Map<Ledger, bigint | null>();
  for (const [ledger, settings] of keptLedgers(ledgers)) {
    const typed = ledger === 'book' ? input.bookMinor : input.parallelMinor;
    if (settings.currency === input.amount.currency) {
      if (typed !== null && typed !== input.amount.amountMinor) {
        return { kind: 'incomplete', ledger };
      }
      amounts.set(ledger, input.amount.amountMinor);
      continue;
    }
    if (typed === null) return { kind: 'incomplete', ledger };
    amounts.set(ledger, typed);
  }
  return {
    kind: 'line',
    line: {
      kind: 'stated',
      account: input.account,
      dimensions: {},
      transaction: input.amount,
      bookMinor: amounts.get('book') ?? 0n,
      parallelMinor: ledgers.parallel === null ? null : (amounts.get('parallel') ?? 0n),
    },
  };
}

/** A schedule's line on the opening entry: the contract liability it still carries, stated. */
export function openingScheduleLine(schedule: OpeningSchedule, account: string): Line {
  const carried = negate(schedule.remaining);
  return {
    kind: 'stated',
    account,
    dimensions: {},
    transaction: carried.transaction,
    bookMinor: carried.bookMinor,
    parallelMinor: carried.parallelMinor,
  };
}

/** A Hub item's line on the opening entry: a new measurement at the eve. */
export function openingItemLine(item: OpeningHubItem, account: string): Line {
  return {
    kind: 'measured',
    account,
    dimensions: {},
    transaction: item.amount,
    bookMinor: item.bookMinor,
    parallelMinor: item.parallelMinor,
    conversions: item.conversions,
  };
}

/**
 * The balancing figure (S10 rules 18–19): one stated line on the retained-earnings account in the
 * book currency, its book amount minus the other lines' book amounts and its parallel amount minus
 * their parallel amounts, so each ledger balances on its own; null when it is zero in both. Its
 * transaction amount is its book amount (the book currency's own).
 */
export function balancingLine(
  lines: readonly Line[],
  ledgers: CompanyLedgers,
  account: string,
): Line | null {
  let book = 0n;
  let parallel: bigint | null = ledgers.parallel === null ? null : 0n;
  for (const line of lines) {
    book -= line.bookMinor;
    if (parallel !== null) {
      const amount = ledgerAmount(line, 'parallel');
      if (amount === null) throw new TypeError('A line without the parallel amount');
      parallel -= amount;
    }
  }
  if (book === 0n && (parallel === null || parallel === 0n)) return null;
  return {
    kind: 'stated',
    account,
    dimensions: {},
    transaction: money(book, ledgers.book.currency),
    bookMinor: book,
    parallelMinor: parallel,
  };
}

/** A balance per slot, client and currency, signed as the account's natural balance (rule 15). */
export interface SlotFigure {
  readonly slot: 'receivable' | 'ad_funds';
  readonly client: string;
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
}

/** A client and currency whose records and Hub's items disagree (check `records_agree`). */
export interface FigureDifference {
  readonly slot: 'receivable' | 'ad_funds';
  readonly client: string;
  readonly currency: CurrencyCode;
  /** Hub's items in the transaction currency; zero with none. */
  readonly hubMinor: bigint;
  /** The records' figure; null when not entered. */
  readonly recordsMinor: bigint | null;
  /** The records' figure less Hub's; null when not entered (S10 "Screens" step 3). */
  readonly differenceMinor: bigint | null;
}

/**
 * The records against Hub (S10 rules 15, 21, "Screens" step 3): per slot, client and currency,
 * Hub's items summed as the account's natural balance (a receivable's debit, client funds'
 * credit) beside the records' figure (null when not entered), every pair either side holds. In
 * order of slot, client and currency.
 */
export function recordsAgreement(
  hub: readonly SlotFigure[],
  records: readonly SlotFigure[],
): FigureDifference[] {
  const key = (figure: SlotFigure) =>
    `${figure.slot}\u0000${figure.client}\u0000${figure.currency}`;
  const sums = new Map<string, { figure: SlotFigure; hub: bigint; records: bigint | null }>();
  for (const figure of hub) {
    const entry = sums.get(key(figure)) ?? { figure, hub: 0n, records: null };
    entry.hub += figure.amountMinor;
    sums.set(key(figure), entry);
  }
  for (const figure of records) {
    const entry = sums.get(key(figure)) ?? { figure, hub: 0n, records: null };
    entry.records = (entry.records ?? 0n) + figure.amountMinor;
    sums.set(key(figure), entry);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, { figure, hub: hubTotal, records: recordsTotal }]) => ({
      slot: figure.slot,
      client: figure.client,
      currency: figure.currency,
      hubMinor: hubTotal,
      recordsMinor: recordsTotal,
      differenceMinor: recordsTotal === null ? null : recordsTotal - hubTotal,
    }));
}

/**
 * The pairs of `recordsAgreement()` that are not equal, a figure not entered included, with no
 * tolerance (owner, 2026-11-12): what fails check `records_agree`.
 */
export function recordsDifferences(
  hub: readonly SlotFigure[],
  records: readonly SlotFigure[],
): FigureDifference[] {
  return recordsAgreement(hub, records).filter((pair) => pair.recordsMinor !== pair.hubMinor);
}

/** Hub's item as a figure of its slot (rule 15): the ad funds' credit as a positive balance. */
export function hubItemFigure(item: OpeningHubItem): SlotFigure | null {
  if (item.slot === 'contract_asset') return null;
  const amount = item.amount.amountMinor;
  return {
    slot: item.slot,
    client: item.client.external_id,
    currency: item.amount.currency,
    amountMinor: item.slot === 'ad_funds' ? -amount : amount,
  };
}

/**
 * What the preview's fingerprint hashes (S10 rules 20, 23): the snapshot, the draft's version and
 * the rate rows the lines were measured with, so a snapshot received, a save or a rate recorded
 * changes it.
 */
export function openingFingerprintValue(input: {
  readonly snapshotId: string | null;
  readonly version: number;
  readonly rateIds: readonly string[];
}): { snapshotId: string | null; version: string; rateIds: string[] } {
  return {
    snapshotId: input.snapshotId,
    version: String(input.version),
    rateIds: [...new Set(input.rateIds)].sort(),
  };
}

/** The debits of an entry's lines in each ledger (S10 "Audit": the opening's totals per ledger). */
export function debitTotals(
  lines: readonly { readonly bookMinor: bigint; readonly parallelMinor: bigint | null }[],
): { bookMinor: bigint; parallelMinor: bigint | null } {
  let book = 0n;
  let parallel: bigint | null = null;
  for (const line of lines) {
    if (line.bookMinor > 0n) book += line.bookMinor;
    if (line.parallelMinor !== null) {
      parallel = (parallel ?? 0n) + (line.parallelMinor > 0n ? line.parallelMinor : 0n);
    }
  }
  return { bookMinor: book, parallelMinor: parallel };
}
