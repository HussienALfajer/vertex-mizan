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

/** The item a line on a control account opens (a Hub invoice, by its number) or moves. */
export type HubItemRef =
  | { readonly kind: 'open'; readonly reference: string; readonly dueOn: string }
  | { readonly kind: 'existing'; readonly id: string };

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
       * a `.changed` event's new state at its document's own date (rule 13).
       */
      readonly measuredOn?: string;
    }
  | {
      readonly kind: 'reversal';
      readonly key: string;
      readonly entryId: string;
      /**
       * A `.changed` event's reversal of what stands, which its new state follows as one change: no
       * difference entry follows it, even across zero (Q13; owner, 2026-11-09). A void's or an
       * archive's reversal has its difference entry (S04 rule 13).
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
    };

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

/** Whether an invoice line's revenue is recognised at issue (S05 rule 12; S06 owns the rest). */
export function recognisedAtIssue(line: EventOf<'invoice.issued'>['payload']['lines'][number]) {
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
 * `invoice.issued` with every line recognised at issue (`revenue/revenue-at-issue`): Dr the
 * receivable, one document item under Hub's number with the client and, when named, the contract,
 * due on `due_on`, for the invoice's total; Cr each line to `revenue_at_issue` or
 * `termination_fee_revenue` with the client, the line's service and the contract. Every line is a
 * new measurement; the residual is conversion rounding (`balanceEntry()`). An invoice with a
 * deferred line holds `NO_MAPPING` (`deferred_revenue`) whole, and one with a non-zero tax
 * (`tax_lines`): one invoice is never split between specs (IFRS 15.31; owner, 2026-11-07).
 */
export function invoiceIssuedPlan(
  event: EventOf<'invoice.issued'>,
  context: HubRuleContext,
): RulePlan {
  const { payload } = event;
  if (!payload.lines.every(recognisedAtIssue)) return hold('NO_MAPPING', 'deferred_revenue');
  if (payload.lines.some((line) => (line.taxes ?? []).some((tax) => tax.amount > 0))) {
    return hold('NO_MAPPING', 'tax_lines');
  }
  const receivable = slotAccount(context, 'receivable', null);
  if (isHold(receivable)) return receivable;
  const revenue: MappedAccount[] = [];
  for (const line of payload.lines) {
    const slot = line.source === 'retainer_charge' ? 'termination_fee_revenue' : 'revenue_at_issue';
    const account = slotAccount(context, slot, null);
    if (isHold(account)) return account;
    revenue.push(account);
  }
  const { currency, client, contract } = payload;
  const named = contract === undefined ? {} : { contract };
  const total = payload.lines.reduce((sum, line) => sum + hubMinor(line.amount), 0n);
  const lines: HubLine[] = [
    {
      account: receivable.id,
      dimensions: { client, ...named },
      amount: money(total, currency),
      item: { kind: 'open', reference: payload.invoice.number, dueOn: payload.due_on },
    },
    ...payload.lines.map((line, index) => ({
      account: (revenue[index] as MappedAccount).id,
      dimensions: { client, ...named, service: line.service },
      amount: money(-hubMinor(line.amount), currency),
    })),
  ];
  return {
    kind: 'post',
    entries: [
      {
        kind: 'lines',
        key: event.id,
        lines,
        dealtRates: hubDealtRates(context.ledgers, [currency], payload.syp_per_usd),
      },
    ],
    decision: contractOfAnotherClient(client, contract) ? 'contract_client_mismatch' : null,
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
 * reversal left them, as one change: no difference entry follows the reversal, even across zero,
 * and the new state's excess beyond zero is measured at its own `period_to` (rule 13; Q13, owner
 * 2026-11-09), so a spend re-sent unchanged nets to zero (edge case 14).
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
 * The plan of any event. S06's deferred revenue arrives after S05: until then its events hold
 * `NO_MAPPING` and are retried when their rules deploy (rule 10).
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
