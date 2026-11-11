import {
  type CompanyLedgers,
  type CurrencyCode,
  convert,
  DomainError,
  documentOf,
  type EventDocument,
  type EventEnvelope,
  type EventOf,
  type ExchangeRate,
  type HoldReason,
  type HubContractRef,
  type HubCurrency,
  type HubValueRef,
  hubMinor,
  type Money,
  money,
  type PostingSlot,
  paymentMethodSlot,
} from '@vertex-mizan/contracts';
import { reverseLines } from './carried.js';
import {
  type CarriedAmounts,
  carriedLine,
  type Dimensions,
  keptLedgers,
  type Line,
  negate,
} from './lines.js';
import { periodOf } from './periods.js';
import { type OverTimeMonth, overTimeMonths } from './recognition.js';

// The posting rules of Hub's events (S05 rules 8–17, "Accounting treatment"; ADR 0006, 0013, 0014),
// each from its approved scenario: `revenue/revenue-at-issue`, `receivables/hub-payment`,
// `inbox/holds-and-actions`, `ad-funds/running-balance` and `expenses/project-expense`. Pure functions from the event, the mapped accounts and what the
// posting function read of the books to a plan: a hold with its reason and detail, a record that
// changes data only, or the entries to post as line specifications. `post()` in `packages/db`
// measures and writes them with this package's mechanics (`manualEntry()`, `reverseLines()`,
// `balanceEntry()`), so no rule decides an amount a measurement or a carried balance decides.

/** An account a slot maps to, with its state (S05 rule 8: a blocked one holds `NO_MAPPING`). */
export interface MappedAccount {
  readonly id: string;
  readonly code: string;
  readonly blocked: boolean;
  readonly archived: boolean;
}

/** What every rule reads of the company: its ledgers, its mapping and its tolerance (rule 9). */
export interface HubRuleContext {
  readonly ledgers: CompanyLedgers;
  /** The account of a slot; a payment method's slot by currency, the others with null. */
  readonly mapping: (slot: PostingSlot, currency: HubCurrency | null) => MappedAccount | null;
  /** The payments' tolerance in each invoice currency, in minor units (owner, 2026-11-06). */
  readonly tolerance: Readonly<Record<HubCurrency, bigint>>;
}

/** A hold: the event is kept and retried once its reason is fixed (rules 7–9). */
export interface Hold {
  readonly kind: 'hold';
  readonly reason: HoldReason;
  readonly detail: string | null;
}

export function hold(reason: HoldReason, detail: string | null = null): Hold {
  return { kind: 'hold', reason, detail };
}

/** The dimensions of a line as Hub sends them; the posting function finds or makes each value. */
export interface HubDimensions {
  readonly client?: HubValueRef;
  readonly contract?: HubContractRef;
  readonly service?: HubValueRef;
  readonly department?: HubValueRef;
}

/**
 * The item a line on a control account opens (a Hub invoice, by its number) or moves: an item of
 * the books by its id, or one an earlier entry of the same plan opened, by its reference on the
 * line's account (a late issue's contract asset, S06 rule 7).
 */
export type HubItemRef =
  | { readonly kind: 'open'; readonly reference: string; readonly dueOn: string }
  | { readonly kind: 'existing'; readonly id: string }
  | { readonly kind: 'planned'; readonly reference: string };

/** A line a rule specifies: a transaction amount, never a ledger amount (S03 rule 1). */
export interface HubLine {
  readonly account: string;
  readonly dimensions: HubDimensions;
  readonly amount: Money;
  readonly item?: HubItemRef;
  /**
   * The line carries the negation of the entry's lines on items instead of a new measurement: an
   * ad spend's payable takes what the client's funds gave up (`ad-funds/running-balance`).
   */
  readonly carriesItems?: true;
}

/** A rate a ledger that accepts a transaction's rate reads (Hub's `syp_per_usd`, ADR 0007). */
export interface HubDealtRate {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: string;
}

/**
 * An entry a rule posts, in posting order:
 * - `lines`: new measurements and items, measured at the event's own date (rule 13, rule 15);
 * - `reversal`: the exact reversal of an entry the event's document posted (rule 14);
 * - `reclassification`: a line of an issue entry moved from one service to another at its posted
 *   amounts (`invoice.line_service_changed`), so no rate is read.
 *
 * `key` is the posting request's key under the event's API client: the event id for its main
 * entry, `<event id>:reversal:<n>` for a reversal (S05 "Entries"), so a retry posts nothing twice.
 */
export type PlannedEntry =
  | {
      readonly kind: 'lines';
      readonly key: string;
      readonly lines: readonly HubLine[];
      readonly dealtRates: readonly HubDealtRate[];
      /**
       * The date its new measurements read their rates on, when not the event's accounting date:
       * a `.changed` event's new state at its document's own date (rule 13); an elapsed month's
       * part at the month's last day (S06 rule 7).
       */
      readonly measuredOn?: string;
      /**
       * The entry's own date, when not the event's (S06 rule 7: an elapsed month's part on the
       * month's last day).
       */
      readonly on?: string;
      /** An elapsed month's part: its period closed holds `SERVICE_PERIOD_CLOSED` (S06 rule 18). */
      readonly servicePeriod?: true;
    }
  | {
      readonly kind: 'reversal';
      readonly key: string;
      readonly entryId: string;
      /**
       * A `.changed` event's reversal of what stands, which its new state follows as one change: no
       * difference entry follows it, even across zero, while the reversed entry is still the latest
       * movement on its running items; the posting function checks that (Q13; owner, 2026-11-09).
       * A void's or an archive's reversal has its difference entry (S04 rule 13).
       */
      readonly withinChange?: true;
    }
  | {
      readonly kind: 'reclassification';
      readonly key: string;
      readonly entryId: string;
      readonly lineNo: number;
      /** The Hub line it moves; the posting function reads the service it has now in the books. */
      readonly lineId: string;
      readonly to: HubValueRef;
    }
  | {
      /**
       * A deferred line's recognised revenue moved to another service at its carried amounts (S06
       * rule 10): the posting function reads what the line's schedule released and its elapsed
       * parts, and records the new service for its later releases.
       */
      readonly kind: 'recognised_reclassification';
      readonly key: string;
      readonly lineId: string;
      readonly to: HubValueRef;
    };

/** What an event changes without posting (ADR 0014 `recorded`). */
export type HubRecord =
  | { readonly kind: 'due_date'; readonly itemId: string; readonly dueOn: string }
  | { readonly kind: 'rate'; readonly effectiveOn: string; readonly rate: string };

/**
 * A rule's answer: a hold; a record; or entries, with the `NEEDS_DECISION` detail the attempt
 * holds on only once the reasons before it in rule 8's order (the period, the rates, the
 * settlements) do not hold it first.
 */
export type RulePlan =
  | Hold
  | { readonly kind: 'record'; readonly record: HubRecord }
  | {
      readonly kind: 'post';
      readonly entries: readonly PlannedEntry[];
      readonly decision: string | null;
      /** The over-time schedules the entries open (S06; ADR 0015), written beside them. */
      readonly schedules?: readonly PlannedSchedule[];
    };

/**
 * An over-time line's schedule (S06 rules 3, 7; ADR 0015) as its invoice's plan opens it: the Hub
 * line, its service period with its months, and where the plan's entries carry it: the contract
 * liability line of the issue entry (none when every month elapsed) and the revenue line of each
 * elapsed month's entry, by entry key and line number. The posting function reads those lines'
 * amounts for the schedule's movements.
 */
export interface PlannedSchedule {
  readonly lineId: string;
  /** The line's place on the invoice, from 1. */
  readonly position: number;
  readonly lineSource: 'retainer_charge' | 'manual';
  readonly chargeKind: 'monthly' | 'addition' | null;
  readonly serviceFrom: string;
  readonly serviceTo: string;
  /** `<retainer external id>:<cycle_start>` for a retainer cycle's charge (rule 6), else null. */
  readonly cycleKey: string | null;
  /** The release's dimensions: the client, the contract when named, the line's service. */
  readonly dimensions: HubDimensions;
  /** The contract liability account it defers to, which its releases debit (S06 "Data"). */
  readonly liabilityAccountId: string;
  readonly months: readonly OverTimeMonth[];
  /** The issue entry's key and its contract liability line's number, from 1. */
  readonly deferral: { readonly key: string; readonly lineNo: number } | null;
  /** Each elapsed month with its entry's key and its revenue line's number, from 1. */
  readonly elapsed: readonly {
    readonly month: string;
    readonly key: string;
    readonly lineNo: number;
  }[];
}

/** A Hub document's item as the posting function read it: its account, currency and open amount. */
export interface HubItem {
  readonly id: string;
  readonly accountId: string;
  readonly currency: CurrencyCode;
  /** What remains open, in the item's currency; positive for a receivable. */
  readonly openMinor: bigint;
}

/** An issue entry's line of one Hub invoice line, for a service change (rule 13). */
export interface IssueLine {
  readonly entryId: string;
  readonly lineNo: number;
}

/** What a rule reads of the books for its event; each absent reference holds `UNKNOWN_REFERENCE`. */
export interface HubReferences {
  /** The invoice's document item on the receivable account, once its issue posted. */
  readonly invoiceItem: HubItem | null;
  /** The entries still standing for the event's own document, latest first (rule 14). */
  readonly standing: readonly string[];
  /** For a service change: the line of the issue entry that carries the changed Hub line. */
  readonly issueLine: IssueLine | null;
  /** The invoice's Hub lines that have a recognition schedule (S06; ADR 0015). */
  readonly scheduledLineIds?: readonly string[];
}

/**
 * Hub's rate as a dealt rate when some ledger of the company reads it (S03 rule 13, ADR 0007): a
 * `market` ledger that accepts a transaction's rate and converts one of the currencies to its
 * own. Otherwise none, since a rate no ledger can use is refused (`DEALT_RATE_NOT_ACCEPTED`).
 */
export function hubDealtRates(
  ledgers: CompanyLedgers,
  currencies: readonly CurrencyCode[],
  sypPerUsd: string,
): HubDealtRate[] {
  const pair = ['USD', 'SYP'] as const;
  const read = keptLedgers(ledgers).some(
    ([, { currency, ratePolicy }]) =>
      ratePolicy.rateType === 'market' &&
      ratePolicy.acceptsTransactionRate &&
      (pair as readonly CurrencyCode[]).includes(currency) &&
      currencies.some(
        (from) => from !== currency && (pair as readonly CurrencyCode[]).includes(from),
      ),
  );
  return read ? [{ base: 'USD', quote: 'SYP', rate: sypPerUsd }] : [];
}

/** Hub's `syp_per_usd` as a rate of a date, for the tolerance (rule 9). */
function hubRate(on: string, rate: string): ExchangeRate {
  return { effectiveOn: on, base: 'USD', quote: 'SYP', rate, type: 'market', source: 'hub' };
}

/**
 * The mapped account of a slot, or the hold that names what to fix (rule 8): `slot_unmapped:<slot>`,
 * or `account_blocked:<code>` for a blocked or archived account (S02's recommendation).
 */
export function slotAccount(
  context: HubRuleContext,
  slot: PostingSlot,
  currency: HubCurrency | null,
): MappedAccount | Hold {
  const account = context.mapping(slot, currency);
  if (account === null) return hold('NO_MAPPING', `slot_unmapped:${slot}`);
  if (account.blocked || account.archived) {
    return hold('NO_MAPPING', `account_blocked:${account.code}`);
  }
  return account;
}

const isHold = (value: MappedAccount | Hold): value is Hold => 'kind' in value;

type InvoiceLine = EventOf<'invoice.issued'>['payload']['lines'][number];

/**
 * The recognition pattern of an invoice line (S06 rule 1): at issue; over time on its service
 * period (a retainer cycle's `monthly` or `addition` charge, a `manual` line marked deferred); a
 * credit to a retainer cycle; at a point in time, its milestone's done. A line without the facts its
 * pattern needs, or whose period ends before it starts, is `unclear`.
 */
export type RecognitionPattern =
  | { readonly kind: 'at_issue' }
  | { readonly kind: 'over_time'; readonly from: string; readonly to: string }
  | { readonly kind: 'credit'; readonly cycleStart: string }
  | { readonly kind: 'point_in_time'; readonly milestoneId: string }
  | { readonly kind: 'unclear' };

export function recognitionPatternOf(
  line: InvoiceLine,
  contract: HubContractRef | undefined,
): RecognitionPattern {
  const period = (): RecognitionPattern =>
    line.cycle_start !== undefined &&
    line.cycle_end !== undefined &&
    line.cycle_end >= line.cycle_start
      ? { kind: 'over_time', from: line.cycle_start, to: line.cycle_end }
      : { kind: 'unclear' };
  switch (line.source) {
    case 'extra_work':
      return { kind: 'at_issue' };
    case 'manual':
      return line.deferred === true ? period() : { kind: 'at_issue' };
    case 'retainer_charge':
      if (line.charge_kind === 'termination_fee') return { kind: 'at_issue' };
      if (contract?.kind !== 'retainer') return { kind: 'unclear' };
      if (line.charge_kind === 'credit') {
        return line.cycle_start === undefined
          ? { kind: 'unclear' }
          : { kind: 'credit', cycleStart: line.cycle_start };
      }
      return period();
    case 'deposit':
    case 'milestone':
      return line.milestone_id !== undefined && contract?.kind === 'project'
        ? { kind: 'point_in_time', milestoneId: line.milestone_id }
        : { kind: 'unclear' };
  }
}

/** Whether an invoice line's revenue is recognised at issue (S05 rule 12; S06 rule 1). */
export function recognisedAtIssue(line: InvoiceLine) {
  switch (line.source) {
    case 'extra_work':
      return true;
    case 'manual':
      return line.deferred !== true;
    case 'retainer_charge':
      return line.charge_kind === 'termination_fee';
    case 'deposit':
    case 'milestone':
      return false;
  }
}

/** Whether a contract the event names belongs to another client (rule 9). */
function contractOfAnotherClient(client: HubValueRef, contract: HubContractRef | undefined) {
  return contract !== undefined && contract.client_external_id !== client.external_id;
}

/**
 * The contract asset item of a late line's elapsed month (S06 "Data"): `<number>/<position>`. A
 * document item opens once (S04 rule 3), so a later elapsed month of the same line opens its own,
 * named with its month: `<number>/<position>/<YYYY-MM>`.
 */
export function elapsedItemReference(
  invoiceNumber: string,
  position: number,
  month: string,
  firstElapsedMonth: string,
): string {
  const base = `${invoiceNumber}/${position}`;
  return month === firstElapsedMonth ? base : `${base}/${month}`;
}

/** An over-time line of an invoice with its months (S06 rule 3). */
interface OverTimeLine {
  readonly line: InvoiceLine;
  readonly position: number;
  readonly from: string;
  readonly to: string;
  readonly months: readonly OverTimeMonth[];
}

/**
 * `invoice.issued` (`revenue/revenue-at-issue`; S06 rules 1–3 and 7, `revenue/over-time-release`).
 * One entry on the invoice's accounting date (S06 rule 2): Dr the receivable, one document item
 * under Hub's number with the client and, when named, the contract, due on `due_on`, for the total;
 * Cr each line recognised at issue, in the invoice's order, to `revenue_at_issue` or
 * `termination_fee_revenue`, with the client, the line's service and the contract; Cr each
 * over-time line's months not elapsed to `contract_liability`, with the client and the contract;
 * then each elapsed month's contract asset item cleared at what it carries. Its new lines are
 * measured at the invoice's rates; a residual beside a carried clearing is a realised difference,
 * otherwise conversion rounding (`balanceEntry()`).
 *
 * Before it, each month of an over-time line that ended before the issue month (elapsed) posts its
 * own entry on its last day: Dr a contract asset item `<number>/<position>` / Cr
 * `released_revenue` with the line's service, measured at each ledger's policy rate of that day
 * (Hub's `syp_per_usd` is of another date and is not read; IAS 21.21–22). The plan's schedules say
 * where each over-time line's deferral and elapsed parts are, for its movements (ADR 0015).
 *
 * A non-zero tax holds `NO_MAPPING` (`tax_lines`); a credit, deposit or milestone line
 * `NO_MAPPING` (`deferred_revenue`) until their rules deploy. A line whose pattern is unclear is the
 * accountant's (`recognition_pattern_unclear:<position>`), decided after the period and rate checks
 * (rule 8): its lines are planned as revenue at issue only to run those checks.
 */
export function invoiceIssuedPlan(
  event: EventOf<'invoice.issued'>,
  context: HubRuleContext,
): RulePlan {
  const { payload } = event;
  const { currency, client, contract } = payload;
  const patterns = payload.lines.map((line) => recognitionPatternOf(line, contract));
  const unclear = patterns.findIndex((pattern) => pattern.kind === 'unclear');
  if (
    unclear === -1 &&
    patterns.some((pattern) => pattern.kind === 'credit' || pattern.kind === 'point_in_time')
  ) {
    return hold('NO_MAPPING', 'deferred_revenue');
  }
  if (payload.lines.some((line) => (line.taxes ?? []).some((tax) => tax.amount > 0))) {
    return hold('NO_MAPPING', 'tax_lines');
  }
  const receivable = slotAccount(context, 'receivable', null);
  if (isHold(receivable)) return receivable;
  const named = contract === undefined ? {} : { contract };
  const atIssue: HubLine[] = [];
  const overTime: OverTimeLine[] = [];
  for (const [index, line] of payload.lines.entries()) {
    const pattern = patterns[index];
    if (pattern?.kind === 'over_time') {
      overTime.push({
        line,
        position: index + 1,
        from: pattern.from,
        to: pattern.to,
        months: overTimeMonths(hubMinor(line.amount), pattern.from, pattern.to, payload.issued_on),
      });
      continue;
    }
    const slot =
      line.source === 'retainer_charge' && line.charge_kind === 'termination_fee'
        ? 'termination_fee_revenue'
        : 'revenue_at_issue';
    const account = slotAccount(context, slot, null);
    if (isHold(account)) return account;
    atIssue.push({
      account: account.id,
      dimensions: { client, ...named, service: line.service },
      amount: money(-hubMinor(line.amount), currency),
    });
  }
  const deferredOf = (item: OverTimeLine) =>
    item.months.filter((m) => !m.elapsed).reduce((sum, m) => sum + m.transactionMinor, 0n);
  const elapsedOf = (item: OverTimeLine) =>
    item.months.filter((m) => m.elapsed && m.transactionMinor !== 0n);
  // Every schedule names the liability it defers to, even one wholly elapsed (S06 "Data").
  let liability: MappedAccount | null = null;
  if (overTime.length > 0) {
    const account = slotAccount(context, 'contract_liability', null);
    if (isHold(account)) return account;
    liability = account;
  }
  let asset: MappedAccount | null = null;
  let released: MappedAccount | null = null;
  if (overTime.some((item) => elapsedOf(item).length > 0)) {
    const assetAccount = slotAccount(context, 'contract_asset', null);
    if (isHold(assetAccount)) return assetAccount;
    const revenueAccount = slotAccount(context, 'released_revenue', null);
    if (isHold(revenueAccount)) return revenueAccount;
    asset = assetAccount;
    released = revenueAccount;
  }

  // Each elapsed month's entry, in date order, with every line it holds.
  const monthEntries = new Map<
    string,
    { lastDay: string; lines: HubLine[]; revenueLineOf: Map<number, number> }
  >();
  const clearings: HubLine[] = [];
  for (const item of overTime) {
    const elapsed = elapsedOf(item);
    const first = elapsed[0]?.month ?? '';
    for (const month of elapsed) {
      if (asset === null || released === null) throw new TypeError('Elapsed without its slots');
      const reference = elapsedItemReference(
        payload.invoice.number,
        item.position,
        month.month,
        first,
      );
      const entry = monthEntries.get(month.month) ?? {
        lastDay: month.lastDay,
        lines: [],
        revenueLineOf: new Map<number, number>(),
      };
      monthEntries.set(month.month, entry);
      entry.lines.push(
        {
          account: asset.id,
          dimensions: { client, ...named },
          amount: money(month.transactionMinor, currency),
          item: { kind: 'open', reference, dueOn: month.lastDay },
        },
        {
          account: released.id,
          dimensions: { client, ...named, service: item.line.service },
          amount: money(-month.transactionMinor, currency),
        },
      );
      entry.revenueLineOf.set(item.position, entry.lines.length);
      clearings.push({
        account: asset.id,
        dimensions: { client, ...named },
        amount: money(-month.transactionMinor, currency),
        item: { kind: 'planned', reference },
      });
    }
  }
  const deferrals: HubLine[] = [];
  const deferralLineOf = new Map<number, number>();
  for (const item of overTime) {
    const rest = deferredOf(item);
    if (rest === 0n || liability === null) continue;
    deferrals.push({
      account: liability.id,
      dimensions: { client, ...named },
      amount: money(-rest, currency),
    });
    // After the receivable's line and the lines at issue.
    deferralLineOf.set(item.position, 1 + atIssue.length + deferrals.length);
  }
  const total = payload.lines.reduce((sum, line) => sum + hubMinor(line.amount), 0n);
  const months = [...monthEntries.keys()].sort();
  const entries: PlannedEntry[] = [
    ...months.map((month): PlannedEntry => {
      const entry = monthEntries.get(month);
      if (entry === undefined) throw new TypeError('A month without its entry');
      return {
        kind: 'lines',
        key: `${event.id}:elapsed:${month}`,
        lines: entry.lines,
        dealtRates: [],
        measuredOn: entry.lastDay,
        on: entry.lastDay,
        servicePeriod: true,
      };
    }),
    {
      kind: 'lines',
      key: event.id,
      lines: [
        {
          account: receivable.id,
          dimensions: { client, ...named },
          amount: money(total, currency),
          item: { kind: 'open', reference: payload.invoice.number, dueOn: payload.due_on },
        },
        ...atIssue,
        ...deferrals,
        ...clearings,
      ],
      dealtRates: hubDealtRates(context.ledgers, [currency], payload.syp_per_usd),
    },
  ];
  const schedules = overTime.map(
    (item): PlannedSchedule => ({
      lineId: item.line.id,
      position: item.position,
      lineSource: item.line.source === 'manual' ? 'manual' : 'retainer_charge',
      chargeKind:
        item.line.charge_kind === 'monthly' || item.line.charge_kind === 'addition'
          ? item.line.charge_kind
          : null,
      serviceFrom: item.from,
      serviceTo: item.to,
      cycleKey:
        item.line.source === 'retainer_charge' && contract !== undefined
          ? `${contract.external_id}:${item.from}`
          : null,
      dimensions: { client, ...named, service: item.line.service },
      liabilityAccountId: liability?.id ?? '',
      months: item.months,
      deferral: deferralLineOf.has(item.position)
        ? { key: event.id, lineNo: deferralLineOf.get(item.position) ?? 0 }
        : null,
      elapsed: months.flatMap((month) => {
        const lineNo = monthEntries.get(month)?.revenueLineOf.get(item.position);
        return lineNo === undefined ? [] : [{ month, key: `${event.id}:elapsed:${month}`, lineNo }];
      }),
    }),
  );
  const decision =
    unclear !== -1
      ? `recognition_pattern_unclear:${unclear + 1}`
      : contractOfAnotherClient(client, contract)
        ? 'contract_client_mismatch'
        : null;
  return {
    kind: 'post',
    entries,
    decision,
    ...(schedules.length > 0 && { schedules }),
  };
}

/** The reversals of a document's standing entries, latest first (rule 14). */
function reversalsOf(
  eventId: string,
  standing: readonly string[],
  withinChange = false,
): PlannedEntry[] {
  return standing.map((entryId, index) => ({
    kind: 'reversal',
    key: `${eventId}:reversal:${index + 1}`,
    entryId,
    ...(withinChange && { withinChange: true as const }),
  }));
}

/**
 * A void or an archive (`invoice.voided`, `payment.voided`, `ad_wallet.entry_voided`,
 * `ad_spend.archived`, `project_expense.archived`): the exact reversal of every entry still standing
 * for the document, latest first, on the void date; nothing standing holds `UNKNOWN_REFERENCE`
 * (a void before the posting it reverses). An invoice's reversal is held
 * `OPEN_ITEM_HAS_SETTLEMENTS` by the posting function while a payment on it stands (ADR 0013).
 */
export function voidPlan(eventId: string, references: HubReferences): RulePlan {
  if (references.standing.length === 0) return hold('UNKNOWN_REFERENCE');
  return { kind: 'post', entries: reversalsOf(eventId, references.standing), decision: null };
}

/**
 * `invoice.line_service_changed` of a line recognised at issue: the line's revenue moved from the
 * service it has in the books (after any earlier change) to the new one, on the account it posted
 * to, at the amounts it posted at issue in both ledgers (phase 1 scope §6), so no rate is read.
 * Before its issue posted, or after its invoice's void reversed it: `UNKNOWN_REFERENCE`.
 */
export function lineServiceChangedPlan(
  event: EventOf<'invoice.line_service_changed'>,
  references: HubReferences,
): RulePlan {
  // A deferred line's revenue is what its schedule recognised: it moves at those carried amounts,
  // and its later releases take the new service (S06 rule 10).
  if (references.scheduledLineIds?.includes(event.payload.line_id) === true) {
    return {
      kind: 'post',
      entries: [
        {
          kind: 'recognised_reclassification',
          key: event.id,
          lineId: event.payload.line_id,
          to: event.payload.new_service,
        },
      ],
      decision: null,
    };
  }
  const line = references.issueLine;
  // Before its issue posted, or once its void reversed it, the line has no recognised revenue to
  // move (phase 1 scope §6: a reclassification of the revenue already recognised).
  if (line === null || !references.standing.includes(line.entryId)) {
    return hold('UNKNOWN_REFERENCE');
  }
  return {
    kind: 'post',
    entries: [
      {
        kind: 'reclassification',
        key: event.id,
        entryId: line.entryId,
        lineNo: line.lineNo,
        lineId: event.payload.line_id,
        to: event.payload.new_service,
      },
    ],
    decision: null,
  };
}

/** `invoice.due_date_changed`: the item's due date from the event's date on; no entry (S04 rule 15). */
export function dueDateChangedPlan(
  event: EventOf<'invoice.due_date_changed'>,
  references: HubReferences,
): RulePlan {
  const item = references.invoiceItem;
  if (item === null) return hold('UNKNOWN_REFERENCE');
  return {
    kind: 'record',
    record: { kind: 'due_date', itemId: item.id, dueOn: event.payload.due_on },
  };
}

/**
 * What a payment needs the accountant for (rule 9; owner, 2026-11-06), or null:
 * - `invoice_currency_mismatch`: Hub's `invoice_currency` is not the item's currency;
 * - `payment_exceeds_open`: it applies more than the item has open (ADR 0013);
 * - `amount_above_applied`: in the invoice's currency, more received than applied (IFRS 15.106);
 * - `payment_gap_beyond_tolerance`: in the other currency, the amount at Hub's `syp_per_usd`,
 *   rounded half away from zero, differs from the applied amount by more than the tolerance in the
 *   invoice's currency. A gap of exactly the tolerance posts as a realised difference.
 */
export function paymentDecision(
  payload: EventOf<'payment.recorded'>['payload'],
  item: HubItem,
  tolerance: Readonly<Record<HubCurrency, bigint>>,
): string | null {
  if (payload.invoice_currency !== item.currency) return 'invoice_currency_mismatch';
  const applied = hubMinor(payload.applied_amount);
  if (applied > item.openMinor) return 'payment_exceeds_open';
  const amount = hubMinor(payload.amount);
  if (payload.currency === payload.invoice_currency) {
    return amount > applied ? 'amount_above_applied' : null;
  }
  const received = convert(
    money(amount, payload.currency),
    payload.invoice_currency,
    hubRate(payload.paid_on, payload.syp_per_usd),
  ).amountMinor;
  const gap = received > applied ? received - applied : applied - received;
  return gap > tolerance[payload.invoice_currency] ? 'payment_gap_beyond_tolerance' : null;
}

/**
 * `payment.recorded` (`receivables/hub-payment`): Dr the account of the payment's method in its
 * currency, a new measurement; Cr the invoice's item by Hub's applied amount in the invoice's
 * currency, at what the item carries in proportion to what remains (S04 rule 4). Each ledger's
 * residual is a realised difference (`manualEntry()`). Before its invoice: `UNKNOWN_REFERENCE`.
 */
export function paymentRecordedPlan(
  event: EventOf<'payment.recorded'>,
  references: HubReferences,
  context: HubRuleContext,
): RulePlan {
  const item = references.invoiceItem;
  if (item === null) return hold('UNKNOWN_REFERENCE');
  const { payload } = event;
  const cash = slotAccount(context, paymentMethodSlot(payload.method), payload.currency);
  if (isHold(cash)) return cash;
  const lines: HubLine[] = [
    { account: cash.id, dimensions: {}, amount: money(hubMinor(payload.amount), payload.currency) },
    {
      account: item.accountId,
      dimensions: {},
      amount: money(-hubMinor(payload.applied_amount), item.currency),
      item: { kind: 'existing', id: item.id },
    },
  ];
  return {
    kind: 'post',
    entries: [
      {
        kind: 'lines',
        key: event.id,
        lines,
        dealtRates: hubDealtRates(
          context.ledgers,
          [payload.currency, item.currency],
          payload.syp_per_usd,
        ),
      },
    ],
    decision: paymentDecision(payload, item, context.tolerance),
  };
}

/**
 * What a wallet entry needs the accountant for (S05 rule 9, `ad-funds/running-balance`), or null:
 * `wallet_gap_beyond_tolerance` when an SYP entry's amount at Hub's `syp_per_usd`, rounded half
 * away from zero, differs from the `usd_amount` Hub credits by more than the USD tolerance. A gap
 * of exactly the tolerance posts as a realised difference. A USD entry credits its own amount (the
 * contract refuses any other, rule 3), so it has no gap.
 */
export function walletDecision(
  payload: EventOf<'ad_wallet.deposited'>['payload'],
  tolerance: Readonly<Record<HubCurrency, bigint>>,
): string | null {
  if (payload.currency === 'USD') return null;
  const credited = hubMinor(payload.usd_amount);
  const received = convert(
    money(hubMinor(payload.amount), payload.currency),
    'USD',
    hubRate(payload.entered_on, payload.syp_per_usd),
  ).amountMinor;
  const gap = received > credited ? received - credited : credited - received;
  return gap > tolerance.USD ? 'wallet_gap_beyond_tolerance' : null;
}

/**
 * `ad_wallet.deposited` and `ad_wallet.refunded` (`ad-funds/running-balance`; S04 "Accounting
 * treatment"): a deposit debits the account of its method in its currency, a new measurement, and
 * credits the client's running item on `ad_funds` by Hub's `usd_amount`; a refund is the opposite
 * entry. The posting function moves the item at its average or measures it anew (S04 rule 3), and
 * each ledger's residual is a realised difference (`manualEntry()`). Hub's `syp_per_usd` is the
 * dealt rate where a ledger reads it.
 */
export function walletEntryPlan(
  event: EventOf<'ad_wallet.deposited' | 'ad_wallet.refunded'>,
  context: HubRuleContext,
): RulePlan {
  const { payload } = event;
  const cash = slotAccount(context, paymentMethodSlot(payload.method), payload.currency);
  if (isHold(cash)) return cash;
  const funds = slotAccount(context, 'ad_funds', null);
  if (isHold(funds)) return funds;
  const sign = event.type === 'ad_wallet.deposited' ? 1n : -1n;
  const lines: HubLine[] = [
    {
      account: cash.id,
      dimensions: {},
      amount: money(sign * hubMinor(payload.amount), payload.currency),
    },
    {
      account: funds.id,
      dimensions: { client: payload.client },
      amount: money(-sign * hubMinor(payload.usd_amount), 'USD'),
    },
  ];
  return {
    kind: 'post',
    entries: [
      {
        kind: 'lines',
        key: event.id,
        lines,
        dealtRates: hubDealtRates(context.ledgers, [payload.currency, 'USD'], payload.syp_per_usd),
      },
    ],
    decision: walletDecision(payload, context.tolerance),
  };
}

/**
 * A spend's entry (`ad-funds/running-balance`): Dr the client's running item on `ad_funds` by the
 * USD spend, which clears it at its average (S04 rule 3), or past zero measures the excess anew;
 * Cr `ad_platforms_payable` with the client, carrying the same amounts, so no rate is read for it
 * and the entry has no residual.
 */
function spendEntry(
  key: string,
  payload: EventOf<'ad_spend.recorded'>['payload'],
  context: HubRuleContext,
  measuredOn?: string,
): PlannedEntry | Hold {
  const funds = slotAccount(context, 'ad_funds', null);
  if (isHold(funds)) return funds;
  const payable = slotAccount(context, 'ad_platforms_payable', null);
  if (isHold(payable)) return payable;
  const spend = hubMinor(payload.usd_spend);
  const client = { client: payload.client };
  return {
    kind: 'lines',
    key,
    lines: [
      { account: funds.id, dimensions: client, amount: money(spend, 'USD') },
      {
        account: payable.id,
        dimensions: client,
        amount: money(-spend, 'USD'),
        carriesItems: true,
      },
    ],
    dealtRates: [],
    ...(measuredOn !== undefined && { measuredOn }),
  };
}

const isPlannedHold = (value: PlannedEntry | Hold): value is Hold => value.kind === 'hold';

/** `ad_spend.recorded`: the spend's entry on its accounting date, its period's end (rule 13). */
export function spendRecordedPlan(
  event: EventOf<'ad_spend.recorded'>,
  context: HubRuleContext,
): RulePlan {
  const entry = spendEntry(event.id, event.payload, context);
  if (isPlannedHold(entry)) return entry;
  return { kind: 'post', entries: [entry], decision: null };
}

/**
 * A `.changed` event (rule 13; ADR 0006): the reversal of every entry standing for the document,
 * latest first, then its new state, both on the change date; the new state measured at its
 * document's own date. Nothing standing holds `UNKNOWN_REFERENCE`: a change before what it
 * changes, or after its archive.
 */
function changedPlan(
  eventId: string,
  references: HubReferences,
  state: PlannedEntry | Hold,
  decision: string | null,
): RulePlan {
  if (references.standing.length === 0) return hold('UNKNOWN_REFERENCE');
  if (isPlannedHold(state)) return state;
  return {
    kind: 'post',
    entries: [...reversalsOf(eventId, references.standing, true), state],
    decision,
  };
}

/**
 * `ad_spend.changed`: the spend's posting reversed, then the new spend against the funds as the
 * reversal left them, as one change: while the spend is still the latest movement on the funds, no
 * difference entry follows the reversal, even across zero, and the new state's excess beyond zero
 * is measured at its own `period_to` (rule 13; Q13, owner 2026-11-09), so a spend re-sent
 * unchanged nets to zero (edge case 14); after another movement the difference entry follows.
 */
export function spendChangedPlan(
  event: EventOf<'ad_spend.changed'>,
  references: HubReferences,
  context: HubRuleContext,
): RulePlan {
  const state = spendEntry(event.id, event.payload, context, event.payload.period_to);
  return changedPlan(event.id, references, state, null);
}

/**
 * A project expense's entry (`expenses/project-expense`; phase 1 scope §6, scope Q7): Dr
 * `project_cost` with the client, the contract and the department; Cr
 * `project_expense_awaiting_payment` by the same amount; both new measurements in the expense's
 * currency at one rate, so the entry has no residual. Hub's `syp_per_usd` is the dealt rate where
 * a ledger reads it.
 */
function expenseEntry(
  key: string,
  payload: EventOf<'project_expense.recorded'>['payload'],
  context: HubRuleContext,
  measuredOn?: string,
): PlannedEntry | Hold {
  const cost = slotAccount(context, 'project_cost', null);
  if (isHold(cost)) return cost;
  const awaiting = slotAccount(context, 'project_expense_awaiting_payment', null);
  if (isHold(awaiting)) return awaiting;
  const { client, contract, department, currency } = payload;
  const amount = hubMinor(payload.amount);
  return {
    kind: 'lines',
    key,
    lines: [
      {
        account: cost.id,
        dimensions: { client, ...(contract !== undefined && { contract }), department },
        amount: money(amount, currency),
      },
      { account: awaiting.id, dimensions: {}, amount: money(-amount, currency) },
    ],
    dealtRates: hubDealtRates(context.ledgers, [currency], payload.syp_per_usd),
    ...(measuredOn !== undefined && { measuredOn }),
  };
}

/** `project_expense.recorded`: the expense's entry on its accounting date, its `spent_on`. */
export function expenseRecordedPlan(
  event: EventOf<'project_expense.recorded'>,
  context: HubRuleContext,
): RulePlan {
  const entry = expenseEntry(event.id, event.payload, context);
  if (isPlannedHold(entry)) return entry;
  const { client, contract } = event.payload;
  return {
    kind: 'post',
    entries: [entry],
    decision: contractOfAnotherClient(client, contract) ? 'contract_client_mismatch' : null,
  };
}

/**
 * `project_expense.changed`: the standing entry reversed, then the new state measured at the rates
 * of its own `spent_on`, with its `syp_per_usd` where a ledger reads it (rule 13; IAS 21.21–22), so
 * a change of the description alone nets to zero.
 */
export function expenseChangedPlan(
  event: EventOf<'project_expense.changed'>,
  references: HubReferences,
  context: HubRuleContext,
): RulePlan {
  const state = expenseEntry(event.id, event.payload, context, event.payload.spent_on);
  const { client, contract } = event.payload;
  return changedPlan(
    event.id,
    references,
    state,
    contractOfAnotherClient(client, contract) ? 'contract_client_mismatch' : null,
  );
}

/**
 * The plan of any event. S06's milestones and projects arrive after its over-time rules: until then
 * their events hold `NO_MAPPING` and are retried when their rules deploy (rule 10).
 */
export function planEvent(
  event: EventEnvelope,
  references: HubReferences,
  context: HubRuleContext,
): RulePlan {
  switch (event.type) {
    case 'invoice.issued':
      return invoiceIssuedPlan(event, context);
    case 'invoice.voided':
      // The void of an invoice with schedules reverses its releases and elapsed parts too (S06
      // rule 8), which deploys with S06's credits: until then it holds.
      if ((references.scheduledLineIds?.length ?? 0) > 0)
        return hold('NO_MAPPING', 'deferred_revenue');
      return voidPlan(event.id, references);
    case 'payment.voided':
    case 'ad_wallet.entry_voided':
    case 'ad_spend.archived':
    case 'project_expense.archived':
      return voidPlan(event.id, references);
    case 'ad_wallet.deposited':
    case 'ad_wallet.refunded':
      return walletEntryPlan(event, context);
    case 'ad_spend.recorded':
      return spendRecordedPlan(event, context);
    case 'ad_spend.changed':
      return spendChangedPlan(event, references, context);
    case 'project_expense.recorded':
      return expenseRecordedPlan(event, context);
    case 'project_expense.changed':
      return expenseChangedPlan(event, references, context);
    case 'invoice.line_service_changed':
      return lineServiceChangedPlan(event, references);
    case 'invoice.due_date_changed':
      return dueDateChangedPlan(event, references);
    case 'payment.recorded':
      return paymentRecordedPlan(event, references, context);
    case 'rate.changed':
      return {
        kind: 'record',
        record: {
          kind: 'rate',
          effectiveOn: event.payload.effective_on,
          rate: event.payload.syp_per_usd,
        },
      };
    case 'milestone.done':
    case 'milestone.reopened':
    case 'project.completed':
    case 'project.cancelled':
      return hold('NO_MAPPING', 'deferred_revenue');
    default:
      return hold('NO_MAPPING');
  }
}

/** An event of an item's key as the order check reads it (rule 11). */
export interface KeyedEvent {
  readonly id: string;
  readonly type: EventEnvelope['type'];
  readonly state: 'held' | 'posted' | 'recorded' | 'resolved' | 'dismissed';
  readonly reason: HoldReason | null;
  /** The event it waits behind, when held `WAITING_FOR_EARLIER_EVENT`. */
  readonly waitingFor: string | null;
  /** The documents it references and cannot post without (its invoice, its payment). */
  readonly references: readonly EventDocument[];
}

/** The document an event's posting brings into the books, if any. */
export function createdDocument(event: EventEnvelope): EventDocument | null {
  switch (event.type) {
    case 'invoice.issued':
    case 'payment.recorded':
    case 'ad_wallet.deposited':
    case 'ad_wallet.refunded':
    case 'ad_spend.recorded':
    case 'project_expense.recorded':
      return documentOf(event);
    default:
      return null;
  }
}

/** The documents an event cannot post without (rule 8 `UNKNOWN_REFERENCE`). */
export function referencedDocuments(event: EventEnvelope): EventDocument[] {
  const invoice = (ref: { id: string; number: string }): EventDocument => ({
    type: 'invoice',
    id: ref.id,
    number: ref.number,
  });
  switch (event.type) {
    case 'invoice.voided':
    case 'invoice.line_service_changed':
    case 'invoice.due_date_changed':
    case 'payment.recorded':
      return [invoice(event.payload.invoice)];
    case 'payment.voided':
      return [invoice(event.payload.invoice), documentOf(event)];
    case 'ad_wallet.entry_voided':
    case 'ad_spend.changed':
    case 'ad_spend.archived':
    case 'project_expense.changed':
    case 'project_expense.archived':
      return [documentOf(event)];
    default:
      return [];
  }
}

const sameDocument = (a: EventDocument, b: EventDocument) => a.type === b.type && a.id === b.id;

/**
 * The earlier held event a later one on the same item key waits behind (rule 11), or null: the
 * first held event, in received order, that blocks it. Two holds never block, since they wait for
 * later events themselves (accounting review, 2026-11-07):
 * - an event held `UNKNOWN_REFERENCE` for a document the later event creates, or held
 *   `WAITING_FOR_EARLIER_EVENT` behind such an event, through any chain;
 * - an `invoice.voided` held `OPEN_ITEM_HAS_SETTLEMENTS`, for a later `payment.voided`.
 */
export function blockingEvent(
  later: EventEnvelope,
  earlier: readonly KeyedEvent[],
): KeyedEvent | null {
  const created = createdDocument(later);
  const byId = new Map(earlier.map((event) => [event.id, event]));
  const waitsForCreated = (event: KeyedEvent, seen: Set<string>): boolean => {
    if (created === null || seen.has(event.id)) return false;
    seen.add(event.id);
    if (event.reason === 'UNKNOWN_REFERENCE') {
      return event.references.some((document) => sameDocument(document, created));
    }
    if (event.reason === 'WAITING_FOR_EARLIER_EVENT' && event.waitingFor !== null) {
      const behind = byId.get(event.waitingFor);
      return behind !== undefined && waitsForCreated(behind, seen);
    }
    return false;
  };
  for (const event of earlier) {
    if (event.state !== 'held') continue;
    if (waitsForCreated(event, new Set())) continue;
    if (
      event.type === 'invoice.voided' &&
      event.reason === 'OPEN_ITEM_HAS_SETTLEMENTS' &&
      later.type === 'payment.voided'
    ) {
      continue;
    }
    return event;
  }
  return null;
}

/**
 * The date an event held `PERIOD_CLOSED` posts on when the accountant moves it (rule 15): the first
 * day of the first open period after its accounting date. A period with no row is open.
 */
export function firstOpenDayAfter(on: string, closedPeriods: readonly string[]): string {
  const closed = new Set(closedPeriods);
  let [year, month] = periodOf(on).split('-').map(Number) as [number, number];
  let period: string;
  do {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    period = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  } while (closed.has(period));
  return `${period}-01`;
}

/** A posted Hub entry as the posting function reads it, to reverse it by its event (rule 14). */
export interface PostedHubEntry {
  readonly source: string;
  readonly date: string;
  readonly isReversal: boolean;
  readonly reversed: boolean;
  readonly lines: readonly Line[];
}

/**
 * The lines of a Hub entry's reversal by its event (a void, a change, an archive; rule 14): every
 * line negated at its posted amounts, never converted again (`reverseLines()`), on or after its
 * date. Only a Hub entry that is not itself a reversal, once; the accountant cannot reverse one by
 * hand (`manualReversalLines()`: `ENTRY_NOT_REVERSIBLE`).
 */
export function hubReversalLines(original: PostedHubEntry, on: string): Line[] {
  if (original.source !== 'hub_event' || original.isReversal) {
    throw new DomainError('ENTRY_NOT_REVERSIBLE', 'An event reverses only a Hub entry', {
      source: original.source,
    });
  }
  if (original.reversed) {
    throw new DomainError('ENTRY_ALREADY_REVERSED', 'The entry has a reversal already');
  }
  if (on < original.date) {
    throw new DomainError(
      'REVERSAL_BEFORE_ORIGINAL',
      `A reversal dated ${on} is before its original of ${original.date}`,
      { on, original: original.date },
    );
  }
  return reverseLines(original.lines);
}

/**
 * A line moved to other dimensions at its posted amounts (`invoice.line_service_changed`): the
 * line's amounts negated with the dimensions it has now (`from`: its service after any earlier
 * change), and carried again with the new ones, both `carried`, so no rate is read and the entry
 * balances in every ledger by itself (phase 1 scope §6).
 */
export function reclassifiedLines(line: Line, from: Dimensions, to: Dimensions): Line[] {
  if (line.item !== undefined) throw new TypeError('A line on an item is not reclassified');
  const amounts: CarriedAmounts = {
    transaction: line.transaction,
    bookMinor: line.bookMinor,
    parallelMinor: line.parallelMinor,
  };
  return [
    carriedLine({ account: line.account, dimensions: from, amounts: negate(amounts) }),
    carriedLine({ account: line.account, dimensions: to, amounts }),
  ];
}
