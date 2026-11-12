import { type EventType, parseEventEnvelope } from './events.js';
import {
  type ReconciliationReport,
  reconciliationAmountOf,
  reconciliationReportSchema,
  totalsOf,
  wireAmountOf,
} from './reconciliation.js';

// One example of every event type of the catalogue at version 1 (S05 "API"): what Hub sends, for
// Hub's developers (`export:hub-schema`) and for the API test that posts each. Listed in the order
// one client's story happens, so each posts against what the ones before it made: an invoice, its
// due date and service changed, a payment and its void, the invoice's void; a milestone and a
// project's end; an expense recorded, changed and archived; a deposit, a spend recorded, changed
// and archived, a refund and its void; a rate. Every id, name and amount is synthetic.

/** An example's ids, fixed so that the export reads the same on every run. */
const id = (n: number) => `01934b6e-0000-7000-8000-${String(n).padStart(12, '0')}`;

const client = { external_id: id(9001), code: 'C-EX', name: 'عميل مثال' };
const service = { external_id: id(9002), code: 'S-EX', name: 'خدمة مثال' };
const otherService = { external_id: id(9003), code: 'S-EX2', name: 'خدمة مثال ثانية' };
const department = { external_id: 'design', name: 'التصميم' };
const project = {
  external_id: id(9004),
  code: 'P-EX',
  name: 'مشروع مثال',
  kind: 'project',
  client_external_id: client.external_id,
};
const invoice = { id: id(101), number: 'INV-EX-0001' };
const line = id(102);
const payment = { id: id(201), number: 'R-EX-0001' };
const expense = { id: id(301), number: 'EXP-EX-0001' };
const deposit = { id: id(401), number: 'W-EX-0001' };
const refund = { id: id(402), number: 'W-EX-0002' };
const update = { id: id(501), number: 'U-EX-0001' };
const campaign = { id: id(502), number: 'K-EX-0001' };
const milestone = { id: id(601), number: 'M-EX-0001' };

/** An example envelope as Hub sends it, its body JSON. */
export interface EventExample {
  readonly id: string;
  readonly type: EventType;
  readonly version: 1;
  readonly occurred_at: string;
  readonly accounting_date: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Every event type once, dated `on` (`YYYY-MM-DD`), in the order they post. */
export function eventExamplesV1(on: string): EventExample[] {
  const events: [EventType, Record<string, unknown>][] = [
    [
      'invoice.issued',
      {
        invoice,
        client,
        currency: 'USD',
        syp_per_usd: '122.0000',
        issued_on: on,
        due_on: on,
        lines: [{ id: line, amount: 50_000, service, source: 'extra_work' }],
      },
    ],
    ['invoice.due_date_changed', { invoice, due_on: on }],
    [
      'invoice.line_service_changed',
      { invoice, line_id: line, old_service: service, new_service: otherService, changed_on: on },
    ],
    [
      'payment.recorded',
      {
        payment,
        invoice,
        paid_on: on,
        method: 'bank_transfer',
        currency: 'USD',
        amount: 20_000,
        syp_per_usd: '122.0000',
        applied_amount: 20_000,
        invoice_currency: 'USD',
      },
    ],
    ['payment.voided', { payment, invoice, voided_on: on, reason: 'دفعة مسجلة خطأ' }],
    ['invoice.voided', { invoice, voided_on: on, reason: 'فاتورة ملغاة' }],
    [
      'milestone.done',
      { milestone, client, project, currency: 'USD', amount: 30_000, done_on: on, service },
    ],
    ['milestone.reopened', { milestone, client, project, reopened_on: on }],
    ['project.completed', { project, client, on }],
    ['project.cancelled', { project, client, on }],
    [
      'project_expense.recorded',
      {
        expense,
        client,
        contract: project,
        department,
        spent_on: on,
        currency: 'USD',
        amount: 10_000,
        syp_per_usd: '122.0000',
        description: 'طباعة مثال',
      },
    ],
    [
      'project_expense.changed',
      {
        expense,
        client,
        contract: project,
        department,
        spent_on: on,
        currency: 'USD',
        amount: 12_000,
        syp_per_usd: '122.0000',
        description: 'طباعة مثال',
        changed_on: on,
      },
    ],
    ['project_expense.archived', { expense, archived_on: on }],
    [
      'ad_wallet.deposited',
      {
        entry: deposit,
        client,
        entered_on: on,
        method: 'bank_transfer',
        currency: 'USD',
        amount: 30_000,
        syp_per_usd: '122.0000',
        usd_amount: 30_000,
      },
    ],
    [
      'ad_spend.recorded',
      { update, campaign, client, period_from: on, period_to: on, usd_spend: 5_000 },
    ],
    [
      'ad_spend.changed',
      {
        update,
        campaign,
        client,
        period_from: on,
        period_to: on,
        usd_spend: 6_000,
        changed_on: on,
      },
    ],
    ['ad_spend.archived', { update, campaign, client, archived_on: on }],
    [
      'ad_wallet.refunded',
      {
        entry: refund,
        client,
        entered_on: on,
        method: 'bank_transfer',
        currency: 'USD',
        amount: 10_000,
        syp_per_usd: '122.0000',
        usd_amount: 10_000,
      },
    ],
    ['ad_wallet.entry_voided', { entry: refund, client, voided_on: on }],
    ['rate.changed', { effective_on: on, syp_per_usd: '122.0000' }],
  ];
  return events.map(([type, payload], index) => ({
    id: id(1000 + index),
    type,
    version: 1,
    occurred_at: `${on}T${String(8 + Math.floor(index / 6)).padStart(2, '0')}:${String((index % 6) * 10).padStart(2, '0')}:00+03:00`,
    accounting_date: on,
    payload,
  }));
}

/**
 * The daily report of `on` that lists every example of `eventExamplesV1(on)` as delivered (S08
 * rule 1), consistent with itself: what Hub sends to `POST /v1/reconciliation/daily` for that
 * date. Its id is fixed per date, so a second post is a replay.
 */
export function reconciliationExampleV1(on: string): ReconciliationReport {
  const events = eventExamplesV1(on).map((example) => parseEventEnvelope(example));
  return reconciliationReportSchema.parse({
    id: id(Number(on.replaceAll('-', ''))),
    date: on,
    generated_at: `${on}T23:59:00+03:00`,
    events: events.map((event) => {
      const amount = wireAmountOf(reconciliationAmountOf(event));
      return { id: event.id, type: event.type, ...(amount && { amount }), delivery: 'delivered' };
    }),
    totals: totalsOf(
      events.map((event) => ({ type: event.type, amount: reconciliationAmountOf(event) })),
    ).map((total) => ({ ...total, amount: total.amount === null ? null : Number(total.amount) })),
  });
}
