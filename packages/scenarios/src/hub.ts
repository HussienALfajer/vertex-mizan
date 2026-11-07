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
  resolveEvent,
  retryEvent,
  retryFreed,
  SYSTEM_NAME,
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

/** Hub's value of a type, as the short form names it by code (S05 rule 2). */
function valueRef(companyId: string, type: string, code: string) {
  return {
    // A department's Hub ID is its fixed code (Hub `departments.ts`).
    external_id: type === 'department' ? code : idOf(companyId, type, code),
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
  const service = (code: unknown) => valueRef(companyId, 'service', asCode(code, 'service'));
  switch (type) {
    case 'invoice.issued': {
      const { lines, contract, ...rest } = short as Short & { lines: Short[] };
      const number = asCode(short.invoice, 'invoice');
      return {
        ...rest,
        invoice: invoice(),
        client: client(),
        ...(contract !== undefined && { contract: contractRef(companyId, contract) }),
        lines: lines.map(({ line, kind, service: code, ...fields }) => ({
          ...fields,
          id: idOf(companyId, 'invoice_line', `${number}:${asCode(line, 'line')}`),
          service: service(code),
          ...(kind !== undefined && { charge_kind: kind }),
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
    default:
      throw new Error(`The short form of ${type} arrives with its rule`);
  }
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

function hubActor(context: CaseContext): AuditActor {
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
