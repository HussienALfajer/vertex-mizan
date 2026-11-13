import { createHash } from 'node:crypto';
import { DomainError, type EventEnvelope, parseEventEnvelope } from '@vertex-mizan/contracts';
import {
  type AuditActor,
  dismissEvent,
  type InboxResult,
  journalEntries,
  moveEvent,
  type RetryTrigger,
  receiveEvent,
  recogniseEvent,
  releaseMonth,
  resolveEvent,
  retryEvent,
  retryFreed,
  SYSTEM_NAME,
  splitEvent,
  withCompany,
} from '@vertex-mizan/db';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Step } from './format.js';
import type { CaseContext, ScenarioDatabase, StepResult } from './harness.js';

// Hub's events in the scenario book (S05): a step's payload in the book's short form (dimensions
// by their code, each document by its number; `docs/scenarios/README.md`) made into the full
// envelope Hub sends (`packages/contracts` `eventEnvelopeSchema`), received through the event
// inbox as `POST /v1/events` receives it, and the automatic retries run after each step as the
// worker's `events.retry` job runs them after the commit (S05 rule 10). The inbox actions run as
// the accountant's screen runs them.

/** Each case company's Hub: its API client id, the steps' clock and the documents it sent. */
interface CaseHub {
  readonly clientId: string;
  /** The latest date of the case so far: the clock its actions run at (S03 rule 6). */
  today: string;
  /** The inbox id of each event step, by its step number. */
  readonly inboxIds: Map<number, string>;
  /** Each payment's receipt and invoice, for its void (the short form names the payment only). */
  readonly payments: Map<string, { receipt: string; invoice: string }>;
  /** Each wallet entry's client, for its void (the short form names the entry only). */
  readonly walletEntries: Map<string, string>;
}

const hubs = new Map<string, CaseHub>();

function hubOf(companyId: string): CaseHub {
  let hub = hubs.get(companyId);
  if (hub === undefined) {
    hub = {
      clientId: uuidv7(),
      today: '0000-01-01',
      inboxIds: new Map(),
      payments: new Map(),
      walletEntries: new Map(),
    };
    hubs.set(companyId, hub);
  }
  return hub;
}

/** A stable synthetic UUID for a case's document or value (version 8, RFC 9562). */
function idOf(companyId: string, kind: string, code: string): string {
  const hex = createHash('sha256').update(`${companyId}:${kind}:${code}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

type Short = Record<string, unknown>;

const asCode = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new Error(`A Hub step names its ${field} by code`);
  return value;
};

/** The Hub ID of a case's value; a department's is its fixed code (Hub `departments.ts`). */
export function hubValueId(companyId: string, type: string, code: string): string {
  return type === 'department' ? code : idOf(companyId, type, code);
}

/**
 * Hub's ids of an invoice line, as the short form names it (`<invoice number>/<line>`): what a
 * manual line naming an opening schedule finds it by (S10 rule 28).
 */
export function hubInvoiceLine(
  companyId: string,
  number: string,
  line: string,
): { invoiceId: string; lineId: string } {
  return {
    invoiceId: idOf(companyId, 'invoice', number),
    lineId: idOf(companyId, 'invoice_line', `${number}:${line}`),
  };
}

/** Hub's value of a type, as the short form names it by code (S05 rule 2). */
function valueRef(companyId: string, type: string, code: string) {
  return {
    external_id: hubValueId(companyId, type, code),
    code,
    name: `${type} ${code}`,
  };
}

function contractRef(companyId: string, contract: unknown) {
  const { code, kind, client } = contract as { code: string; kind: string; client: string };
  return {
    ...valueRef(companyId, 'contract', code),
    kind,
    client_external_id: idOf(companyId, 'client', client),
  };
}

const documentRef = (companyId: string, type: string, number: string) => ({
  id: idOf(companyId, type, number),
  number,
});

/** The full payload of a short-form step (README "Writing the YAML"; S05 rule 2). */
function payloadOf(
  companyId: string,
  hub: CaseHub,
  type: string,
  short: Short,
  accountingDate: string,
): Short {
  const invoice = () => documentRef(companyId, 'invoice', asCode(short.invoice, 'invoice'));
  const client = () => valueRef(companyId, 'client', asCode(short.client, 'client'));
  // A service as `S1`, or with its department as `{ code: S1, department: design }` (S09 rule 33).
  const service = (named: unknown) => {
    if (typeof named === 'object' && named !== null) {
      const { code, department } = named as { code?: unknown; department?: unknown };
      return {
        ...valueRef(companyId, 'service', asCode(code, 'service')),
        department: valueRef(companyId, 'department', asCode(department, 'department')),
      };
    }
    return valueRef(companyId, 'service', asCode(named, 'service'));
  };
  switch (type) {
    case 'invoice.issued': {
      const { lines, contract, ...rest } = short as Short & { lines: Short[] };
      const number = asCode(short.invoice, 'invoice');
      return {
        ...rest,
        invoice: invoice(),
        client: client(),
        ...(contract !== undefined && { contract: contractRef(companyId, contract) }),
        lines: lines.map(({ line, kind, service: code, milestone, ...fields }) => ({
          ...fields,
          id: idOf(companyId, 'invoice_line', `${number}:${asCode(line, 'line')}`),
          service: service(code),
          ...(kind !== undefined && { charge_kind: kind }),
          // A deposit or milestone line names its milestone by Hub's number (S06).
          ...(milestone !== undefined && {
            milestone_id: idOf(companyId, 'milestone', asCode(milestone, 'milestone')),
          }),
        })),
      };
    }
    case 'invoice.voided':
    case 'invoice.due_date_changed':
      return { ...short, invoice: invoice() };
    case 'invoice.line_service_changed': {
      const { line, old_service, new_service, ...rest } = short;
      const number = asCode(short.invoice, 'invoice');
      return {
        ...rest,
        invoice: invoice(),
        line_id: idOf(companyId, 'invoice_line', `${number}:${asCode(line, 'line')}`),
        old_service: service(old_service),
        new_service: service(new_service),
      };
    }
    case 'payment.recorded': {
      const { payment, receipt, ...rest } = short;
      const code = asCode(payment, 'payment');
      hub.payments.set(code, {
        receipt: asCode(receipt, 'receipt'),
        invoice: asCode(short.invoice, 'invoice'),
      });
      return {
        ...rest,
        payment: { id: idOf(companyId, 'payment', code), number: asCode(receipt, 'receipt') },
        invoice: invoice(),
      };
    }
    case 'payment.voided': {
      const { payment, ...rest } = short;
      const code = asCode(payment, 'payment');
      const recorded = hub.payments.get(code);
      if (recorded === undefined)
        throw new Error(`Payment ${code} is voided before it is recorded`);
      return {
        ...rest,
        payment: { id: idOf(companyId, 'payment', code), number: recorded.receipt },
        invoice: documentRef(companyId, 'invoice', recorded.invoice),
      };
    }
    case 'ad_wallet.deposited':
    case 'ad_wallet.refunded': {
      const code = asCode(short.entry, 'wallet entry');
      hub.walletEntries.set(code, asCode(short.client, 'client'));
      return {
        ...short,
        entry: documentRef(companyId, 'ad_wallet_entry', code),
        client: client(),
      };
    }
    case 'ad_wallet.entry_voided': {
      const code = asCode(short.entry, 'wallet entry');
      const owner = hub.walletEntries.get(code);
      if (owner === undefined) throw new Error(`Wallet entry ${code} is voided before it is sent`);
      return {
        ...short,
        entry: documentRef(companyId, 'ad_wallet_entry', code),
        client: valueRef(companyId, 'client', owner),
      };
    }
    case 'ad_spend.recorded':
    case 'ad_spend.changed':
    case 'ad_spend.archived':
      return {
        ...short,
        update: documentRef(companyId, 'ad_spend', asCode(short.update, 'spend update')),
        campaign: documentRef(companyId, 'campaign', asCode(short.campaign, 'campaign')),
        client: client(),
        // The book's short form leaves an archive's date to the step's accounting date.
        ...(type === 'ad_spend.archived' &&
          short.archived_on === undefined && { archived_on: accountingDate }),
      };
    case 'project_expense.recorded':
    case 'project_expense.changed': {
      const { contract, department, ...rest } = short;
      return {
        ...rest,
        expense: documentRef(companyId, 'project_expense', asCode(short.expense, 'expense')),
        client: client(),
        ...(contract !== undefined && { contract: contractRef(companyId, contract) }),
        department: valueRef(companyId, 'department', asCode(department, 'department')),
      };
    }
    case 'project_expense.archived':
      return {
        ...short,
        expense: documentRef(companyId, 'project_expense', asCode(short.expense, 'expense')),
      };
    case 'milestone.done':
    case 'milestone.reopened': {
      const { milestone, project, service: code, ...rest } = short;
      return {
        ...rest,
        milestone: documentRef(companyId, 'milestone', asCode(milestone, 'milestone')),
        client: client(),
        project: contractRef(companyId, project),
        ...(code !== undefined && { service: service(code) }),
      };
    }
    case 'project.completed':
    case 'project.cancelled':
      return {
        ...short,
        project: contractRef(companyId, short.project),
        client: client(),
      };
    default:
      throw new Error(`The short form of ${type} arrives with its rule`);
  }
}

/** The API client a case's Hub sends as (S05; S10's snapshot, `opening:write`). */
export function hubClientId(companyId: string): string {
  return hubOf(companyId).clientId;
}

/**
 * The opening step's snapshot as Hub sends it (S10 rule 5), from the book's short form: each
 * invoice as `invoice.issued`'s payload with its total and outstanding, a credit with its invoice's
 * number, date and rate and its line, a milestone with its project and its done, invoiced when an
 * invoice of the snapshot bills it, each wallet by its client, and the register of prior documents,
 * whose payments and wallet entries a later void finds (S10 rule 28).
 */
export function snapshotOf(
  companyId: string,
  asOf: string,
  short: {
    readonly invoices: readonly unknown[];
    readonly credits: readonly unknown[];
    readonly milestones: readonly unknown[];
    readonly wallets: readonly { readonly client: string; readonly balance: bigint }[];
    readonly prior_documents: {
      readonly invoices: readonly { readonly invoice: string; readonly issued_on: string }[];
      readonly payments: readonly {
        readonly payment: string;
        readonly receipt: string;
        readonly invoice: string;
        readonly paid_on: string;
      }[];
      readonly wallet_entries: readonly {
        readonly entry: string;
        readonly client: string;
        readonly entered_on: string;
      }[];
      readonly spend_updates: readonly {
        readonly update: string;
        readonly campaign: string;
        readonly client: string;
        readonly period_to: string;
      }[];
      readonly project_expenses: readonly { readonly expense: string; readonly spent_on: string }[];
      readonly milestone_dones: readonly { readonly milestone: string; readonly done_on: string }[];
    };
  },
): unknown {
  const hub = hubOf(companyId);
  const invoices = short.invoices.map((item) => {
    const { total, outstanding, ...invoice } = item as Short;
    return {
      ...payloadOf(companyId, hub, 'invoice.issued', invoice, asOf),
      total,
      outstanding,
    };
  });
  const billedOn = new Map<string, string>();
  for (const invoice of invoices as unknown as {
    issued_on: string;
    lines: { milestone_id?: string }[];
  }[]) {
    for (const line of invoice.lines) {
      if (line.milestone_id !== undefined) billedOn.set(line.milestone_id, invoice.issued_on);
    }
  }
  const credits = short.credits.map((item) => {
    const { invoice, client, contract, currency, syp_per_usd, issued_on, ...line } = item as Short;
    const issued = payloadOf(
      companyId,
      hub,
      'invoice.issued',
      {
        invoice,
        client,
        contract,
        currency,
        syp_per_usd,
        issued_on,
        due_on: issued_on,
        lines: [line],
      },
      asOf,
    ) as Short & { lines: Short[] };
    return {
      invoice: issued.invoice,
      client: issued.client,
      contract: issued.contract,
      currency,
      syp_per_usd,
      issued_on,
      line: issued.lines[0],
    };
  });
  const milestones = short.milestones.map((item) => {
    const done = payloadOf(companyId, hub, 'milestone.done', item as Short, asOf) as Short & {
      milestone: { id: string };
      done_on?: string;
    };
    const invoiced = billedOn.get(done.milestone.id);
    return {
      ...done,
      ...(invoiced !== undefined && done.done_on !== undefined && { invoiced_on: invoiced }),
    };
  });
  const register = short.prior_documents;
  for (const payment of register.payments) {
    hub.payments.set(payment.payment, { receipt: payment.receipt, invoice: payment.invoice });
  }
  for (const entry of register.wallet_entries) hub.walletEntries.set(entry.entry, entry.client);
  return asJson({
    as_of: asOf,
    generated_at: `${asOf}T23:00:00+03:00`,
    invoices,
    credits,
    milestones,
    wallets: short.wallets.map((wallet) => ({
      client: valueRef(companyId, 'client', wallet.client),
      balance: wallet.balance,
    })),
    prior_documents: {
      invoices: register.invoices.map((row) => ({
        invoice: documentRef(companyId, 'invoice', row.invoice),
        issued_on: row.issued_on,
      })),
      payments: register.payments.map((row) => ({
        payment: { id: idOf(companyId, 'payment', row.payment), number: row.receipt },
        invoice: documentRef(companyId, 'invoice', row.invoice),
        paid_on: row.paid_on,
      })),
      wallet_entries: register.wallet_entries.map((row) => ({
        entry: documentRef(companyId, 'ad_wallet_entry', row.entry),
        client: valueRef(companyId, 'client', row.client),
        entered_on: row.entered_on,
      })),
      spend_updates: register.spend_updates.map((row) => ({
        update: documentRef(companyId, 'ad_spend', row.update),
        campaign: documentRef(companyId, 'campaign', row.campaign),
        client: valueRef(companyId, 'client', row.client),
        period_to: row.period_to,
      })),
      project_expenses: register.project_expenses.map((row) => ({
        expense: documentRef(companyId, 'project_expense', row.expense),
        spent_on: row.spent_on,
      })),
      milestone_dones: register.milestone_dones.map((row) => ({
        milestone: documentRef(companyId, 'milestone', row.milestone),
        done_on: row.done_on,
      })),
    },
  });
}

/** A payload as JSON carries it: the book's integers (`bigint`) as JSON numbers. */
function asJson(value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('A Hub amount is within 2^53');
    }
    return Number(value);
  }
  if (Array.isArray(value)) return value.map(asJson);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asJson(item)]));
  }
  return value;
}

/** A short-form event step as the body Hub sends, and that body parsed as `/v1` parses it. */
export function envelopeOf(
  companyId: string,
  step: Extract<Step, { kind: 'event' }>,
): { raw: Record<string, unknown>; envelope: EventEnvelope } {
  const hub = hubOf(companyId);
  const raw = {
    id: uuidv7(),
    type: step.type,
    version: 1,
    occurred_at: `${step.accountingDate}T12:00:00+03:00`,
    accounting_date: step.accountingDate,
    payload: asJson(
      payloadOf(companyId, hub, step.type, step.payload as Short, step.accountingDate),
    ),
  };
  return { raw, envelope: parseEventEnvelope(raw) };
}

export function hubActor(context: CaseContext): AuditActor {
  return {
    kind: 'api_client',
    clientId: hubOf(context.companyId).clientId,
    name: 'Vertex Hub',
    requestId: `scenario-${context.companyId}`,
    ipAddress: null,
    userAgent: 'scenario book',
  };
}

const systemActor = (context: CaseContext): AuditActor => ({
  kind: 'system',
  name: SYSTEM_NAME,
  requestId: `scenario-${context.companyId}`,
  ipAddress: null,
  userAgent: 'scenario book',
});

/**
 * The retries a change frees, as the worker runs them after its commit (S05 rule 10): in their
 * own transaction, as the system.
 */
export async function runRetries(
  database: ScenarioDatabase,
  companyId: string,
  triggers: readonly RetryTrigger[],
): Promise<void> {
  if (triggers.length === 0) return;
  const context = { database, companyId } as CaseContext;
  await withCompany(database.app, companyId, (tx) =>
    retryFreed(tx, triggers, { actor: systemActor(context), today: hubOf(companyId).today }),
  );
}

function resultOf(result: InboxResult): StepResult {
  const { event } = result;
  return event.state === 'held'
    ? { status: 'held', reason: event.reason as string, detail: event.detail }
    : { status: 'done' };
}

/** Runs an inbox call, then its retries; a business refusal is the step's `refused`. */
async function inbox(
  context: CaseContext,
  call: (
    actor: AuditActor,
    today: string,
    tx: Parameters<Parameters<typeof withCompany>[2]>[0],
  ) => Promise<InboxResult>,
  actor: AuditActor,
  remember?: (result: InboxResult) => void,
): Promise<StepResult> {
  const hub = hubOf(context.companyId);
  try {
    const result = await withCompany(context.database.app, context.companyId, (tx) =>
      call(actor, hub.today, tx),
    );
    remember?.(result);
    await runRetries(context.database, context.companyId, result.triggers);
    return resultOf(result);
  } catch (error) {
    if (error instanceof DomainError) return { status: 'refused', reason: error.code };
    throw error;
  }
}

function inboxIdOf(context: CaseContext, step: number): string {
  const id = hubOf(context.companyId).inboxIds.get(step);
  if (id === undefined) throw new Error(`Step ${step} is not an event the inbox received`);
  return id;
}

/** A Hub event, received as `POST /v1/events` receives it, then the retries it frees. */
export function event(
  context: CaseContext,
  step: Extract<Step, { kind: 'event' }>,
): Promise<StepResult> {
  const hub = hubOf(context.companyId);
  if (step.accountingDate > hub.today) hub.today = step.accountingDate;
  const { raw, envelope } = envelopeOf(context.companyId, step);
  const number = context.step;
  return inbox(
    context,
    (actor, today, tx) =>
      receiveEvent(
        tx,
        context.companyId,
        { raw, envelope, apiClientId: hub.clientId, requestId: `scenario-${envelope.id}` },
        { actor, today },
      ),
    hubActor(context),
    (result) => {
      if (number !== undefined) hub.inboxIds.set(number, result.event.inboxId);
    },
  );
}

/** The accountant's actions (S05 rules 15–17), as the owner, who holds every inbox permission. */
export function inboxActions(bookkeeper: (companyId: string) => AuditActor) {
  return {
    retry: (context: CaseContext, step: Extract<Step, { kind: 'retry' }>) =>
      inbox(
        context,
        (actor, today, tx) => retryEvent(tx, inboxIdOf(context, step.step), { actor, today }),
        bookkeeper(context.companyId),
      ),
    move: (context: CaseContext, step: Extract<Step, { kind: 'move' }>) =>
      inbox(
        context,
        (actor, today, tx) =>
          moveEvent(tx, inboxIdOf(context, step.step), step.reason, { actor, today }),
        bookkeeper(context.companyId),
      ),
    resolve: (context: CaseContext, step: Extract<Step, { kind: 'resolve' }>) =>
      inbox(
        context,
        async (actor, today, tx) => {
          const [entry] = await tx
            .select({ id: journalEntries.id })
            .from(journalEntries)
            .where(eq(journalEntries.sequence, BigInt(step.entry)));
          if (!entry) throw new Error(`The case posted no entry ${step.entry}`);
          return resolveEvent(tx, inboxIdOf(context, step.step), entry.id, step.reason, {
            actor,
            today,
          });
        },
        bookkeeper(context.companyId),
      ),
    recognise: (context: CaseContext, step: Extract<Step, { kind: 'recognise' }>) =>
      inbox(
        context,
        (actor, today, tx) =>
          recogniseEvent(tx, inboxIdOf(context, step.step), step.reason, { actor, today }),
        bookkeeper(context.companyId),
      ),
    split: (context: CaseContext, step: Extract<Step, { kind: 'split' }>) =>
      inbox(
        context,
        (actor, today, tx) =>
          splitEvent(tx, inboxIdOf(context, step.step), step.revenueMinor, step.reason, {
            actor,
            today,
          }),
        bookkeeper(context.companyId),
      ),
    dismiss: (context: CaseContext, step: Extract<Step, { kind: 'dismiss' }>) =>
      inbox(
        context,
        (actor, today, tx) =>
          dismissEvent(tx, inboxIdOf(context, step.step), step.reason, { actor, today }),
        bookkeeper(context.companyId),
      ),
  };
}

/** The clock of a case's company moves with its dated steps (a manual entry, a reversal). */
export function advanceClock(companyId: string, on: string): void {
  const hub = hubOf(companyId);
  if (on > hub.today) hub.today = on;
}

/** The case's clock: the latest date of its steps so far. */
export function caseToday(companyId: string): string {
  return hubOf(companyId).today;
}

/** The first day of the month after `month` (`YYYY-MM`). */
export function dayAfterMonth(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, '0')}-01`;
}

/**
 * A job step (S06 brings the first: `revenue_release_month`, the worker's `revenue.release-month`
 * for the step's month). It runs on the first day of the next month, so the case's clock moves to
 * that day (`revenue/over-time-release`, "Cases"), in the company's context as the system, as the
 * worker runs it. A release the job could not post is the step's `refused` with its code. Any
 * other job arrives with its spec (S07's month end and close).
 */
export async function job(
  context: CaseContext,
  step: Extract<Step, { kind: 'job' }>,
): Promise<StepResult> {
  if (step.name !== 'revenue_release_month') {
    throw new Error(`The job ${step.name} arrives with its spec`);
  }
  advanceClock(context.companyId, dayAfterMonth(step.period));
  const result = await withCompany(context.database.app, context.companyId, (tx) =>
    releaseMonth(tx, step.period, hubOf(context.companyId).today, systemActor(context)),
  );
  const [refused] = result.refused;
  return refused === undefined
    ? { status: 'done' }
    : { status: 'refused', reason: refused.code, detail: refused.detail };
}
