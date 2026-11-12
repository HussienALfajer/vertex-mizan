import { type EventType, parseEventEnvelope } from './events.js';
import { type OpeningSnapshot, openingSnapshotSchema } from './opening.js';
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
        // the service with its performing department (S09 rule 33)
        lines: [
          { id: line, amount: 50_000, service: { ...service, department }, source: 'extra_work' },
        ],
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

/** A date `days` after `date` (`YYYY-MM-DD`, negative before), in UTC. */
function shift(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

const retainer = {
  external_id: id(9005),
  code: 'R-EX',
  name: 'عقد شهري مثال',
  kind: 'retainer',
  client_external_id: client.external_id,
};
const openingInvoice = { id: id(701), number: 'INV-EX-0007' };

/**
 * Hub's opening snapshot for a company whose books start on `booksStart` (S10 rule 5), as of its
 * eve: S10's worked example with the example client. One unpaid invoice issued 20 days before the
 * eve at Hub's rate 117.0000, one monthly retainer line of 300.00 USD for the cycle from 14 days
 * before the eve to 14 days after the books start, and the client's wallet of 500.00 USD; the
 * register holds the invoice. Its key (`Idempotency-Key`) is `openingSnapshotKeyV1(booksStart)`.
 */
export function openingSnapshotExampleV1(booksStart: string): OpeningSnapshot {
  const asOf = shift(booksStart, -1);
  const issuedOn = shift(asOf, -20);
  return openingSnapshotSchema.parse({
    as_of: asOf,
    generated_at: `${booksStart}T06:00:00+03:00`,
    invoices: [
      {
        invoice: openingInvoice,
        client,
        contract: retainer,
        currency: 'USD',
        syp_per_usd: '117.0000',
        issued_on: issuedOn,
        due_on: shift(issuedOn, 15),
        total: 30_000,
        outstanding: 30_000,
        lines: [
          {
            id: id(702),
            amount: 30_000,
            service: { ...service, department },
            source: 'retainer_charge',
            charge_kind: 'monthly',
            cycle_start: shift(asOf, -14),
            cycle_end: shift(booksStart, 14),
          },
        ],
      },
    ],
    wallets: [{ client, balance: 50_000 }],
    prior_documents: {
      invoices: [{ invoice: openingInvoice, issued_on: issuedOn }],
    },
  });
}

/** The example snapshot's key, fixed per books start, so a second post is a replay. */
export function openingSnapshotKeyV1(booksStart: string): string {
  return `opening-example-${booksStart}`;
}
