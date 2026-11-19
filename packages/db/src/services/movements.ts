import { createHash } from 'node:crypto';
import {
  type CancelMovement,
  type CreateParty,
  type CreateProject,
  type CurrencyCode,
  type DayRates,
  DomainError,
  draftInputSchema,
  lineAmount,
  type MovementQuery,
  type ProjectMovementKind,
  type RecordDayRates,
  type RecordMovement,
  type UpdateProject,
} from '@vertex-mizan/contracts';
import {
  allocateOldestFirst,
  canonicalJson,
  fiscalYearOf,
  movementSides,
  openTotal,
} from '@vertex-mizan/ledger';
import { and, eq, sql } from 'drizzle-orm';
import { writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { post, postVoucher } from '../posting/post.js';
import { chartAccounts } from '../schema/chart.js';
import { companies, companySettings } from '../schema/companies.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import { entryDrafts } from '../schema/drafts.js';
import { ledgerHeads } from '../schema/ledger.js';
import {
  companyBranding,
  projectDetails,
  projectMovementCancellations,
  projectMovementSequences,
  projectMovements,
} from '../schema/movements.js';
import { materials, projectTerms } from '../schema/projects.js';
import { createDimensionValue } from './dimensions.js';
import { insertDraft } from './drafts.js';
import { projectDocumentContentOf } from './projects.js';
import { type PersonActor, recordRate } from './rates.js';

// S13's project movements (ADR 0024): a movement recorded and posted in one transaction through an
// existing path (a receipt or payment voucher, a purchase invoice, or a manual entry with its open
// item), its cancellation by reversal, and the reads the screens and PDFs show, every figure from
// the ledger's lines (S13 "Reports"). The API and the tests share these, in the caller's
// transaction and company context.

/** The accounts of `contracting@1` a movement posts to (S11, S12). */
const ACCOUNTS = {
  receivables: '112001',
  suppliers: '211001',
  ownerCurrent: '313001',
  revenue: '411001',
  materials: '511001',
  wages: '511002',
  otherSiteCosts: '511006',
  gain: '421001',
  loss: '541001',
} as const;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** What a movement is recorded with: the person, and today in Damascus (S03 rule 6). */
export interface MovementContext {
  readonly companyId: string;
  readonly actor: PersonActor;
  readonly today: string;
}

/** The ids of the accounts by their codes. */
async function accountIdsOf(tx: Transaction): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: chartAccounts.id, code: chartAccounts.code })
    .from(chartAccounts)
    .where(sql`${chartAccounts.code} in (${sql.join(Object.values(ACCOUNTS), sql`, `)})`);
  return new Map(rows.map((row) => [row.code, row.id]));
}

function accountOf(accounts: Map<string, string>, code: string): string {
  const id = accounts.get(code);
  if (id === undefined) {
    throw new DomainError('VALIDATION_FAILED', `The chart has no account ${code}`, {
      issues: [{ path: ['kind'], message: `The chart lacks ${code}` }],
    });
  }
  return id;
}

/** The box of a currency (S13 answer 5): the company's first box in it, not archived. */
async function boxOf(tx: Transaction, currency: CurrencyCode): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    select a.id from public.chart_accounts a
    where a.cash_kind = 'box' and a.currency = ${currency} and a.archived_at is null
    order by a.code limit 1`);
  const [box] = result.rows;
  if (box === undefined) {
    throw new DomainError('CASH_ACCOUNT_INVALID', `No box in ${currency}`, { currency });
  }
  return box.id;
}

/** A project (a contract value of kind `project`) with its client and state. */
interface ProjectRef {
  readonly id: string;
  readonly name: string;
  readonly clientId: string;
  readonly state: 'active' | 'finished';
}

async function projectOf(tx: Transaction, id: string): Promise<ProjectRef> {
  const result = await tx.execute<{
    id: string;
    name: string;
    client_id: string | null;
    state: 'active' | 'finished' | null;
  }>(sql`
    select v.id, v.name, v.parent_value_id as client_id, d.state
    from public.dimension_values v
    left join public.project_details d on d.contract_value_id = v.id
    where v.id = ${id} and v.contract_kind = 'project'`);
  const [row] = result.rows;
  if (row === undefined || row.client_id === null) {
    throw new DomainError('NOT_FOUND', 'No such project');
  }
  return { id: row.id, name: row.name, clientId: row.client_id, state: row.state ?? 'active' };
}

async function typeIdOf(tx: Transaction, code: string): Promise<string> {
  const [type] = await tx
    .select({ id: dimensionTypes.id })
    .from(dimensionTypes)
    .where(and(eq(dimensionTypes.code, code), eq(dimensionTypes.builtin, true)));
  if (type === undefined) throw new Error(`No built-in dimension type ${code}`);
  return type.id;
}

/** A supplier of the company (S13 rule 6). */
async function checkSupplier(tx: Transaction, id: string): Promise<void> {
  const supplierType = await typeIdOf(tx, 'supplier');
  const [row] = await tx
    .select({ id: dimensionValues.id })
    .from(dimensionValues)
    .where(and(eq(dimensionValues.id, id), eq(dimensionValues.typeId, supplierType)));
  if (row === undefined) throw new DomainError('NOT_FOUND', 'No such supplier');
}

/**
 * A client's open items on a project's receivables that exist on `on`, oldest due first (S13 rules
 * 5 and 7), each with what stays open from `on` on: the lowest of its running balance on that day
 * and every later day it moved, so a back-dated collection never settles more than is left after
 * the later ones. A debt is settled only once it is recognised (IAS 21.28): an item dated later is
 * not open on an earlier day.
 */
async function clientItems(
  tx: Transaction,
  clientId: string,
  projectId: string,
  currency: CurrencyCode | null,
  on: string,
): Promise<{ id: string; currency: CurrencyCode; openMinor: bigint }[]> {
  const result = await tx.execute<{ id: string; currency: CurrencyCode; open: string }>(sql`
    select i.id, i.currency, least(b.open_minor, coalesce((
        select min(running.open) from (
          select d.on_day, (
            select coalesce(sum(m.amount_minor), 0) from public.open_item_movements m
            where m.item_id = i.id and m.entry_date <= d.on_day
          ) as open
          from (
            select ${on}::date as on_day
            union select m.entry_date from public.open_item_movements m
            where m.item_id = i.id and m.entry_date >= ${on}
          ) d
        ) running
      ), 0))::text as open
    from public.open_items i
    join public.open_item_balances b on b.item_id = i.id
    join public.chart_accounts a on a.id = i.account_id and a.code = ${ACCOUNTS.receivables}
    where i.counterparty_value_id = ${clientId} and b.open_minor <> 0
      and i.document_date <= ${on}
      and (${currency}::text is null or i.currency = ${currency})
      and exists (
        select 1 from public.dimension_set_values s
        where s.set_id = i.dimension_set_id and s.value_id = ${projectId}
      )
    order by coalesce((
      select d.due_on from public.open_item_due_dates d
      where d.item_id = i.id order by d.effective_on desc, d.created_at desc limit 1
    ), i.document_date), i.document_date, i.created_at`);
  return result.rows
    .map((row) => ({ id: row.id, currency: row.currency, openMinor: BigInt(row.open) }))
    .filter((item) => item.openMinor > 0n);
}

/**
 * What a project owes a supplier in a currency from `on` on (S13 rule 6): the lowest, over `on`
 * and every later day the debt moved, of minus the transaction amounts of the `211001` lines
 * carrying both dated up to that day; so a back-dated payment never pays more than was owed then
 * or is left after the later payments.
 */
async function owedToSupplier(
  tx: Transaction,
  supplierId: string,
  projectId: string,
  currency: CurrencyCode,
  on: string,
): Promise<bigint> {
  const result = await tx.execute<{ owed: string }>(sql`
    with lines as (
      select e.entry_date, l.amount_minor
      from public.journal_lines l
      join public.journal_entries e on e.id = l.entry_id
      join public.chart_accounts a on a.id = l.account_id and a.code = ${ACCOUNTS.suppliers}
      where l.currency = ${currency}
        and exists (select 1 from public.dimension_set_values s
          where s.set_id = l.dimension_set_id and s.value_id = ${supplierId})
        and exists (select 1 from public.dimension_set_values s
          where s.set_id = l.dimension_set_id and s.value_id = ${projectId})
    ),
    days as (
      select ${on}::date as on_day
      union select entry_date from lines where entry_date >= ${on}
    )
    select min(-coalesce(
      (select sum(x.amount_minor) from lines x where x.entry_date <= days.on_day), 0
    ))::text as owed
    from days`);
  return BigInt(result.rows[0]?.owed ?? '0');
}

/** The next movement number of a fiscal year (S13 rule 1), under the sequence row's lock. */
async function takeMovementNumber(
  tx: Transaction,
  companyId: string,
  fiscalYear: number,
): Promise<number> {
  const [sequence] = await tx
    .insert(projectMovementSequences)
    .values({ companyId, fiscalYear, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [projectMovementSequences.companyId, projectMovementSequences.fiscalYear],
      set: { lastNumber: sql`${projectMovementSequences.lastNumber} + 1`, updatedAt: sql`now()` },
    })
    .returning({ lastNumber: projectMovementSequences.lastNumber });
  if (!sequence) throw new Error('No movement number');
  return sequence.lastNumber;
}

/** A movement's line on a project as the draft and the posting function take it. */
interface Line {
  readonly accountId: string;
  readonly dimensionValueIds: readonly string[];
  readonly amountMinor: bigint;
  readonly openItemId?: string;
  readonly newItem?: { readonly reference: string; readonly dueOn: string };
  readonly quantity?: {
    readonly materialId: string;
    readonly unit: string;
    readonly quantity: string;
    readonly unitPrice: string;
  };
}

/** The draft input of a line, as the drafts service stores it. */
const draftLineOf = (line: Line, currency: CurrencyCode) => ({
  accountId: line.accountId,
  dimensionValueIds: [...line.dimensionValueIds],
  currency,
  amountMinor: line.amountMinor.toString(),
  openItemId: line.openItemId ?? null,
  newItem: line.newItem ?? null,
  ...(line.quantity !== undefined && {
    materialId: line.quantity.materialId,
    unit: line.quantity.unit,
    quantity: line.quantity.quantity,
    unitPrice: line.quantity.unitPrice,
  }),
});

/** The posting function's line of a movement line. */
const postingLineOf = (line: Line, currency: CurrencyCode) => ({
  accountId: line.accountId,
  dimensionValueIds: line.dimensionValueIds,
  currency,
  amountMinor: line.amountMinor,
  memo: null,
  openItemId: line.openItemId ?? null,
  newItem: line.newItem ?? null,
  quantity: line.quantity ?? null,
});

/**
 * Movements and their cancellations post at once, so they are refused while manual-entry approval
 * is on: one person cannot approve their own draft (S03 rule 8; S13 "Access").
 */
async function refuseWhileApprovalIsOn(tx: Transaction): Promise<void> {
  const [settings] = await tx
    .select({ approval: companySettings.manualEntryApproval })
    .from(companySettings);
  if (settings?.approval) {
    throw new DomainError('VALIDATION_FAILED', 'Movements post at once: approval is off', {
      manualEntryApproval: 'true',
      issues: [{ path: ['kind'], message: 'manualEntryApproval' }],
    });
  }
}

/** The previous answer to a request key, or null; another request under it is refused. */
async function replayOf(
  tx: Transaction,
  requestKey: string,
  requestHash: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: projectMovements.id, hash: projectMovements.requestHash })
    .from(projectMovements)
    .where(eq(projectMovements.requestKey, requestKey));
  if (row === undefined) return null;
  if (row.hash !== requestHash) {
    throw new DomainError('IDEMPOTENCY_CONFLICT', 'The key was used for another movement');
  }
  return row.id;
}

/**
 * Records a movement and posts it (S13 rules 1–9), answering the movement's id: the ledger head
 * locked first; a replay of the key answers the first movement; the checks of the kind; the
 * movement's number; the draft of its path saved and posted; the movement written.
 */
export async function recordMovement(
  tx: Transaction,
  context: MovementContext,
  input: RecordMovement,
): Promise<string> {
  const { companyId, actor, today } = context;
  await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
  const { requestKey, ...request } = input;
  const requestHash = sha256(canonicalJson(JSON.parse(JSON.stringify(request))));
  const replayed = await replayOf(tx, requestKey, requestHash);
  if (replayed !== null) return replayed;

  if (input.date > today) {
    throw new DomainError('ENTRY_DATE_OUT_OF_RANGE', 'A movement is dated today or earlier', {
      date: input.date,
    });
  }
  const [settings] = await tx.select().from(companySettings);
  if (!settings) throw new Error('A company without its settings');
  await refuseWhileApprovalIsOn(tx);
  const project = input.projectId === null ? null : await projectOf(tx, input.projectId);
  if (project?.state === 'finished') {
    throw new DomainError('PROJECT_FINISHED', 'The project is finished', { project: project.id });
  }
  if (input.supplierId !== null) await checkSupplier(tx, input.supplierId);

  const material =
    input.material === null
      ? null
      : await tx
          .select({ id: materials.id, unit: materials.unit, archivedAt: materials.archivedAt })
          .from(materials)
          .where(eq(materials.id, input.material.materialId))
          .then(([row]) => row);
  if (input.material !== null && (material === undefined || material?.archivedAt !== null)) {
    throw new DomainError('MATERIAL_REQUIRED', 'No such material, or it is archived');
  }
  const amountMinor =
    input.material === null
      ? BigInt(input.amountMinor as string)
      : lineAmount(input.material.quantity, input.material.unitPrice, input.currency).amountMinor;
  if (amountMinor <= 0n) {
    throw new DomainError('VALIDATION_FAILED', 'A movement is above zero', {
      issues: [{ path: ['amountMinor'], message: 'Above zero' }],
    });
  }
  const sides = movementSides(amountMinor);
  const accounts = await accountIdsOf(tx);
  const fiscalYear = fiscalYearOf(input.date, settings.fiscalYearStartMonth);
  const number = await takeMovementNumber(tx, companyId, fiscalYear);
  const costLine = (dims: readonly string[]): Line =>
    input.material === null || material === undefined || material === null
      ? {
          accountId: accountOf(accounts, ACCOUNTS.otherSiteCosts),
          dimensionValueIds: dims,
          amountMinor,
        }
      : {
          accountId: accountOf(accounts, ACCOUNTS.materials),
          dimensionValueIds: dims,
          amountMinor,
          quantity: {
            materialId: material.id,
            unit: material.unit,
            quantity: input.material.quantity,
            unitPrice: input.material.unitPrice,
          },
        };

  const common = {
    client: 'manual',
    entryDate: input.date,
    description: input.description,
    reference: null,
    preparedByUserId: actor.userId,
    approvedByUserId: null,
    actor,
  };
  const dealtRates = input.dealtRate === null ? [] : [input.dealtRate];
  let counterpartyId: string | null = null;
  let posted: { entryId: string; draftId: string };

  const voucher = async (kind: 'receipt' | 'payment', lines: readonly Line[]) => {
    const box = await boxOf(tx, input.currency);
    const cashLine: Line = {
      accountId: box,
      dimensionValueIds: [],
      amountMinor: kind === 'receipt' ? sides.debit : sides.credit,
    };
    const all = kind === 'receipt' ? [cashLine, ...lines] : [...lines, cashLine];
    const draftId = await insertDraft(
      tx,
      companyId,
      actor,
      draftInputSchema.parse({
        entryDate: input.date,
        description: input.description,
        dealtRates,
        lines: all.map((line) => draftLineOf(line, input.currency)),
        voucher: { kind, cashAccountId: box, partyName: null },
      }),
    );
    const result = await postVoucher(tx, {
      ...common,
      idempotencyKey: draftId,
      draftId,
      voucher: {
        kind,
        cashAccountId: box,
        counterCashAccountId: null,
        partyName: null,
        countedMinor: null,
        expectedMinor: null,
      },
      lines: all.map((line) => postingLineOf(line, input.currency)),
      dealtRates,
      today,
    });
    const entryId = result.entry?.id;
    if (entryId === undefined) throw new Error('A movement voucher posts an entry');
    await tx
      .update(entryDrafts)
      .set({ state: 'posted', postedEntryId: entryId })
      .where(eq(entryDrafts.id, draftId));
    return { entryId, draftId };
  };

  const manual = async (lines: readonly Line[]) => {
    const draftId = await insertDraft(
      tx,
      companyId,
      actor,
      draftInputSchema.parse({
        entryDate: input.date,
        description: input.description,
        dealtRates,
        lines: lines.map((line) => draftLineOf(line, input.currency)),
      }),
    );
    const entry = await post(tx, {
      ...common,
      idempotencyKey: draftId,
      draftId,
      content: {
        kind: 'manual',
        today,
        dealtRates,
        lines: lines.map((line) => postingLineOf(line, input.currency)),
      },
    });
    await tx
      .update(entryDrafts)
      .set({ state: 'posted', postedEntryId: entry.id })
      .where(eq(entryDrafts.id, draftId));
    return { entryId: entry.id, draftId };
  };

  const kind: ProjectMovementKind = input.kind;
  if (kind === 'deposit') {
    posted = await voucher('receipt', [
      {
        accountId: accountOf(accounts, ACCOUNTS.ownerCurrent),
        dimensionValueIds: [],
        amountMinor: sides.credit,
      },
    ]);
  } else {
    if (project === null) throw new Error('Every movement but a deposit is on a project');
    const onProject = [project.id];
    const withClient = [project.clientId, project.id];
    if (kind === 'received') {
      const open = await clientItems(tx, project.clientId, project.id, null, input.date);
      if (open.length > 0) {
        throw new DomainError('CLIENT_HAS_OPEN_DEBT', 'The client owes the project', {
          open: open.map((item) => `${item.openMinor} ${item.currency}`).join(', '),
        });
      }
      counterpartyId = project.clientId;
      posted = await voucher('receipt', [
        {
          accountId: accountOf(accounts, ACCOUNTS.revenue),
          dimensionValueIds: withClient,
          amountMinor: sides.credit,
        },
      ]);
    } else if (kind === 'expense') {
      posted = await voucher('payment', [costLine(onProject)]);
    } else if (kind === 'wages') {
      posted = await voucher('payment', [
        {
          accountId: accountOf(accounts, ACCOUNTS.wages),
          dimensionValueIds: onProject,
          amountMinor,
        },
      ]);
    } else if (kind === 'debt_paid') {
      const supplierId = input.supplierId as string;
      const owed = await owedToSupplier(tx, supplierId, project.id, input.currency, input.date);
      if (amountMinor > owed) {
        throw new DomainError('VALIDATION_FAILED', 'More than the project owes the supplier', {
          open: owed.toString(),
          issues: [{ path: ['amountMinor'], message: `At most ${owed}` }],
        });
      }
      counterpartyId = supplierId;
      posted = await voucher('payment', [
        {
          accountId: accountOf(accounts, ACCOUNTS.suppliers),
          dimensionValueIds: [supplierId, project.id],
          amountMinor,
        },
      ]);
    } else if (kind === 'debt_collected') {
      const items = await clientItems(tx, project.clientId, project.id, input.currency, input.date);
      const open = openTotal(items);
      if (amountMinor > open) {
        throw new DomainError('VALIDATION_FAILED', 'More than the client owes the project', {
          open: open.toString(),
          issues: [{ path: ['amountMinor'], message: `At most ${open}` }],
        });
      }
      const lines: Line[] = allocateOldestFirst(amountMinor, items).map((part) => ({
        accountId: accountOf(accounts, ACCOUNTS.receivables),
        dimensionValueIds: [],
        amountMinor: movementSides(part.partMinor).credit,
        openItemId: part.id,
      }));
      counterpartyId = project.clientId;
      posted = await voucher('receipt', lines);
    } else if (kind === 'owed_to_us') {
      counterpartyId = project.clientId;
      posted = await manual([
        {
          accountId: accountOf(accounts, ACCOUNTS.receivables),
          dimensionValueIds: withClient,
          amountMinor,
          newItem: { reference: `حركة ${fiscalYear}/${number}`, dueOn: input.date },
        },
        {
          accountId: accountOf(accounts, ACCOUNTS.revenue),
          dimensionValueIds: withClient,
          amountMinor: sides.credit,
        },
      ]);
    } else {
      // Owed by us: a project purchase invoice on credit (S12), the supplier's running item.
      const supplierId = input.supplierId as string;
      counterpartyId = supplierId;
      const line = costLine([]);
      const draftId = await insertDraft(
        tx,
        companyId,
        actor,
        draftInputSchema.parse({
          entryDate: input.date,
          description: input.description,
          dealtRates,
          projectDocument: {
            kind: 'purchase',
            contractValueId: project.id,
            counterpartyValueId: supplierId,
            currency: input.currency,
          },
          lines: [
            line.quantity === undefined
              ? {
                  accountId: line.accountId,
                  currency: input.currency,
                  amountMinor: amountMinor.toString(),
                }
              : {
                  accountId: line.accountId,
                  currency: input.currency,
                  amountMinor: null,
                  materialId: line.quantity.materialId,
                  quantity: line.quantity.quantity,
                  unitPrice: line.quantity.unitPrice,
                },
          ],
        }),
      );
      const content = await projectDocumentContentOf(tx, draftId);
      const entry = await post(tx, {
        ...common,
        idempotencyKey: draftId,
        draftId,
        content: { kind: 'project_document', today, ...content },
      });
      await tx
        .update(entryDrafts)
        .set({ state: 'posted', postedEntryId: entry.id })
        .where(eq(entryDrafts.id, draftId));
      posted = { entryId: entry.id, draftId };
    }
  }

  const [movement] = await tx
    .insert(projectMovements)
    .values({
      companyId,
      kind,
      fiscalYear,
      number,
      movementDate: input.date,
      contractValueId: project?.id ?? null,
      counterpartyValueId: counterpartyId,
      currency: input.currency,
      amountMinor,
      description: input.description,
      materialId: input.material?.materialId ?? null,
      entryId: posted.entryId,
      draftId: posted.draftId,
      requestKey,
      requestHash,
      createdByUserId: actor.userId,
    })
    .returning({ id: projectMovements.id });
  if (!movement) throw new Error('The movement was not written');
  return movement.id;
}

/**
 * Cancels a movement (S13 rule 8): its entry reversed today with the reason, and the cancellation
 * written in the same transaction. A debt owed by us whose payments would then exceed it is
 * refused; the posting function refuses the rest (`OPEN_ITEM_HAS_SETTLEMENTS`, `CASH_BOX_NEGATIVE`,
 * `PERIOD_CLOSED`).
 */
export async function cancelMovement(
  tx: Transaction,
  context: MovementContext,
  id: string,
  input: CancelMovement,
): Promise<void> {
  const { companyId, actor, today } = context;
  await tx.select({ id: ledgerHeads.id }).from(ledgerHeads).for('update');
  const [movement] = await tx.select().from(projectMovements).where(eq(projectMovements.id, id));
  if (movement === undefined) throw new DomainError('NOT_FOUND', 'No such movement');
  await refuseWhileApprovalIsOn(tx);
  const [cancelled] = await tx
    .select({ id: projectMovementCancellations.id })
    .from(projectMovementCancellations)
    .where(eq(projectMovementCancellations.movementId, id));
  if (cancelled !== undefined) {
    throw new DomainError('ENTRY_ALREADY_REVERSED', 'The movement is cancelled already');
  }
  if (
    movement.kind === 'owed_by_us' &&
    movement.counterpartyValueId !== null &&
    movement.contractValueId !== null
  ) {
    const owed = await owedToSupplier(
      tx,
      movement.counterpartyValueId,
      movement.contractValueId,
      movement.currency as CurrencyCode,
      today,
    );
    if (owed < movement.amountMinor) {
      throw new DomainError('VALIDATION_FAILED', 'Cancel the payments to the supplier first', {
        open: owed.toString(),
      });
    }
  }
  const reversal = await post(tx, {
    client: 'manual',
    idempotencyKey: `reversal:${movement.entryId}`,
    entryDate: today,
    description: input.reason,
    reference: null,
    draftId: null,
    preparedByUserId: actor.userId,
    approvedByUserId: null,
    actor,
    content: { kind: 'reversal', entryId: movement.entryId, today },
  });
  await tx.insert(projectMovementCancellations).values({
    companyId,
    movementId: id,
    reversalEntryId: reversal.id,
    reason: input.reason,
    createdByUserId: actor.userId,
  });
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'movement.cancelled',
    entityType: 'project_movement',
    entityId: id,
    reason: input.reason,
    after: {
      number: movement.number,
      fiscalYear: movement.fiscalYear,
      kind: movement.kind,
      reason: input.reason,
      reversalEntryId: reversal.id,
    },
  });
}

/** Whether an entry is a movement's: its reversal is the movement's cancellation (S13 rule 8). */
export async function isMovementEntry(tx: Transaction, entryId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: projectMovements.id })
    .from(projectMovements)
    .where(eq(projectMovements.entryId, entryId));
  return row !== undefined;
}

// Reads (S13 "Reports"): every figure from the ledger's lines.

/** A movement row as listed. */
export interface MovementRow {
  readonly id: string;
  readonly kind: ProjectMovementKind;
  readonly fiscalYear: number;
  readonly number: number;
  readonly date: string;
  readonly project: { id: string; name: string } | null;
  readonly party: { id: string; name: string } | null;
  readonly currency: CurrencyCode;
  readonly amountMinor: string;
  readonly bookMinor: string;
  readonly description: string;
  readonly material: {
    id: string;
    name: string;
    unit: string;
    quantity: string;
    unitPrice: string;
  } | null;
  readonly entryId: string;
  readonly cancellation: { reason: string; on: string; reversalEntryId: string } | null;
  readonly createdAt: string;
}

/**
 * The movements, newest first, filtered and paged by `(date, id)` (S13 "API"): each with its book
 * amount from its entry (its cash line, or for a debt its debits) and its cancellation.
 */
export async function readMovements(
  tx: Transaction,
  query: MovementQuery,
): Promise<{ movements: MovementRow[]; nextCursor: string | null }> {
  const [cursorDate, cursorId] = query.cursor?.split('_') ?? [];
  const filters = [
    query.project === undefined ? sql`true` : sql`m.contract_value_id = ${query.project}`,
    query.party === undefined ? sql`true` : sql`m.counterparty_value_id = ${query.party}`,
    query.kind === undefined ? sql`true` : sql`m.kind = ${query.kind}`,
    query.currency === undefined ? sql`true` : sql`m.currency = ${query.currency}`,
    query.from === undefined ? sql`true` : sql`m.movement_date >= ${query.from}`,
    query.to === undefined ? sql`true` : sql`m.movement_date <= ${query.to}`,
    cursorDate === undefined || cursorId === undefined
      ? sql`true`
      : sql`(m.movement_date, m.id) < (${cursorDate}::date, ${cursorId}::uuid)`,
  ];
  const rows = await movementRows(tx, sql.join(filters, sql` and `), query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    movements: page,
    nextCursor: rows.length > query.limit && last ? `${last.date}_${last.id}` : null,
  };
}

/** One movement as listed, or `NOT_FOUND`. */
export async function readMovement(tx: Transaction, id: string): Promise<MovementRow> {
  const [row] = await movementRows(tx, sql`m.id = ${id}`, 1);
  if (row === undefined) throw new DomainError('NOT_FOUND', 'No such movement');
  return row;
}

async function movementRows(
  tx: Transaction,
  where: ReturnType<typeof sql>,
  limit: number | null,
  order: 'newest' | 'oldest' = 'newest',
): Promise<MovementRow[]> {
  const result = await tx.execute<{
    id: string;
    kind: ProjectMovementKind;
    fiscal_year: number;
    number: number;
    date: string;
    project_id: string | null;
    project_name: string | null;
    party_id: string | null;
    party_name: string | null;
    currency: CurrencyCode;
    amount: string;
    book: string;
    description: string;
    material_id: string | null;
    material_name: string | null;
    unit: string | null;
    quantity: string | null;
    unit_price: string | null;
    entry_id: string;
    reason: string | null;
    cancelled_on: string | null;
    reversal_entry_id: string | null;
    created_at: string;
  }>(sql`
    select m.id, m.kind, m.fiscal_year, m.number, m.movement_date::text as date,
      p.id as project_id, p.name as project_name, c.id as party_id, c.name as party_name,
      m.currency, m.amount_minor::text as amount,
      coalesce(
        (select abs(sum(l.book_minor)) from public.journal_lines l
          join public.chart_accounts a on a.id = l.account_id
          where l.entry_id = m.entry_id and a.cash_kind = 'box'),
        (select sum(l.book_minor) from public.journal_lines l
          where l.entry_id = m.entry_id and l.book_minor > 0),
        0)::text as book,
      m.description, mt.id as material_id, mt.name as material_name, q.unit,
      q.quantity::text as quantity, q.unit_price::text as unit_price, m.entry_id,
      x.reason, r.entry_date::text as cancelled_on, x.reversal_entry_id,
      to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
    from public.project_movements m
    left join public.dimension_values p on p.id = m.contract_value_id
    left join public.dimension_values c on c.id = m.counterparty_value_id
    left join public.materials mt on mt.id = m.material_id
    left join lateral (
      select lq.unit, lq.quantity, lq.unit_price from public.line_quantities lq
      where lq.entry_id = m.entry_id limit 1
    ) q on m.material_id is not null
    left join public.project_movement_cancellations x on x.movement_id = m.id
    left join public.journal_entries r on r.id = x.reversal_entry_id
    where ${where}
    order by ${order === 'newest' ? sql`m.movement_date desc, m.id desc` : sql`m.movement_date, m.fiscal_year, m.number, m.id`}
    ${limit === null ? sql`` : sql`limit ${limit}`}`);
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    fiscalYear: Number(row.fiscal_year),
    number: Number(row.number),
    date: row.date,
    project: row.project_id === null ? null : { id: row.project_id, name: row.project_name ?? '' },
    party: row.party_id === null ? null : { id: row.party_id, name: row.party_name ?? '' },
    currency: row.currency,
    amountMinor: row.amount,
    bookMinor: row.book,
    description: row.description,
    material:
      row.material_id === null
        ? null
        : {
            id: row.material_id,
            name: row.material_name ?? '',
            unit: row.unit ?? '',
            quantity: row.quantity ?? '0',
            unitPrice: row.unit_price ?? '0',
          },
    entryId: row.entry_id,
    cancellation:
      row.reason === null || row.cancelled_on === null || row.reversal_entry_id === null
        ? null
        : { reason: row.reason, on: row.cancelled_on, reversalEntryId: row.reversal_entry_id },
    createdAt: row.created_at,
  }));
}

/** An amount in a currency with its book amount, as integer strings. */
export interface CurrencyAmountRow {
  readonly currency: CurrencyCode;
  readonly amountMinor: string;
  readonly bookMinor: string;
}

/** A project's (or the company's, with `null`) figures from the ledger (S13 "Reports"). */
export interface FiguresRow {
  readonly bookCurrency: CurrencyCode;
  readonly revenueMinor: string;
  readonly costsMinor: string;
  readonly profitMinor: string;
  readonly receivedMinor: string;
  readonly expensesMinor: string;
  readonly wagesMinor: string;
  readonly netCashMinor: string;
  readonly owedByUs: CurrencyAmountRow[];
  readonly owedToUs: CurrencyAmountRow[];
  readonly movementCount: number;
}

/** A line's project filter: every line with `null`, else the lines whose set names the project. */
const onProject = (projectId: string | null, setColumn: ReturnType<typeof sql>) =>
  projectId === null
    ? sql`true`
    : sql`exists (select 1 from public.dimension_set_values s
        where s.set_id = ${setColumn} and s.value_id = ${projectId})`;

/**
 * The figures of a project, or of the company with `null` (S13 "Reports"): revenue on `411001`,
 * costs on the direct-cost lines, profit their difference, received the revenue of received
 * movements, wages on `511002` and expenses the other costs; net cash the box lines of the
 * movements' entries and of their cancellations; owed to us the open receivables; owed by us the
 * project's `211001` lines in each currency, at the supplier's average carrying amount.
 */
export async function readFigures(tx: Transaction, projectId: string | null): Promise<FiguresRow> {
  const [settings] = await tx
    .select({ bookCurrency: companySettings.bookCurrency })
    .from(companySettings);
  const lineOnProject = onProject(projectId, sql`l.dimension_set_id`);
  const sums = await tx.execute<{
    revenue: string;
    costs: string;
    received: string;
    wages: string;
    net_cash: string;
    movements: string;
    profit: string;
    expenses: string;
  }>(sql`
    with movement_entries as (
      select m.id, m.kind, m.entry_id from public.project_movements m
      where ${projectId === null ? sql`m.contract_value_id is not null` : sql`m.contract_value_id = ${projectId}`}
      union all
      select m.id, m.kind, x.reversal_entry_id from public.project_movements m
      join public.project_movement_cancellations x on x.movement_id = m.id
      where ${projectId === null ? sql`m.contract_value_id is not null` : sql`m.contract_value_id = ${projectId}`}
    )
    , figures as (
      select
        -coalesce((select sum(l.book_minor) from public.journal_lines l
          join public.chart_accounts a on a.id = l.account_id
          where a.code = ${ACCOUNTS.revenue} and ${lineOnProject}), 0) as revenue,
        coalesce((select sum(l.book_minor) from public.journal_lines l
          join public.chart_accounts a on a.id = l.account_id
          where a.statement_line = 'is.direct_costs' and ${lineOnProject}), 0) as costs,
        coalesce((select sum(l.book_minor) from public.journal_lines l
          join public.chart_accounts a on a.id = l.account_id
          join movement_entries e on e.entry_id = l.entry_id and e.kind = 'wages'
          where a.code = ${ACCOUNTS.wages}), 0) as wages
    )
    select
      f.revenue::text as revenue,
      (f.revenue - f.costs)::text as profit,
      coalesce((select sum(l.book_minor) from public.journal_lines l
        join public.chart_accounts a on a.id = l.account_id
        join movement_entries e on e.entry_id = l.entry_id and e.kind = 'expense'
        where a.statement_line = 'is.direct_costs'), 0)::text as expenses,
      f.costs::text as costs,
      (-coalesce((select sum(l.book_minor) from public.journal_lines l
        join public.chart_accounts a on a.id = l.account_id
        join movement_entries e on e.entry_id = l.entry_id and e.kind = 'received'
        where a.code = ${ACCOUNTS.revenue}), 0))::text as received,
      f.wages::text as wages,
      coalesce((select sum(l.book_minor) from public.journal_lines l
        join public.chart_accounts a on a.id = l.account_id
        join movement_entries e on e.entry_id = l.entry_id
        where a.cash_kind = 'box'), 0)::text as net_cash,
      (select count(*) from public.project_movements m
        where ${projectId === null ? sql`m.contract_value_id is not null` : sql`m.contract_value_id = ${projectId}`}
          and not exists (select 1 from public.project_movement_cancellations x
            where x.movement_id = m.id))::text as movements
    from figures f`);
  const owedToUs = await tx.execute<{ currency: CurrencyCode; amount: string; book: string }>(sql`
    select i.currency, sum(b.open_minor)::text as amount, sum(b.book_minor)::text as book
    from public.open_items i
    join public.open_item_balances b on b.item_id = i.id
    join public.chart_accounts a on a.id = i.account_id and a.code = ${ACCOUNTS.receivables}
    where b.open_minor <> 0 and ${onProject(projectId, sql`i.dimension_set_id`)}
    group by i.currency order by i.currency`);
  const owedByUs = await owedByUsOf(tx, projectId);
  const row = sums.rows[0];
  if (row === undefined || !settings) throw new Error('No figures');
  return {
    bookCurrency: settings.bookCurrency as CurrencyCode,
    revenueMinor: row.revenue,
    costsMinor: row.costs,
    profitMinor: row.profit,
    receivedMinor: row.received,
    expensesMinor: row.expenses,
    wagesMinor: row.wages,
    netCashMinor: row.net_cash,
    owedByUs,
    owedToUs: owedToUs.rows.map((item) => ({
      currency: item.currency,
      amountMinor: item.amount,
      bookMinor: item.book,
    })),
    movementCount: Number(row.movements),
  };
}

/**
 * What is owed to suppliers (S13 "Reports"): for a project, minus its `211001` lines in each
 * currency, valued at each supplier item's average carrying amount; for the company, the items'
 * open amounts and carrying amounts.
 */
async function owedByUsOf(tx: Transaction, projectId: string | null): Promise<CurrencyAmountRow[]> {
  if (projectId === null) {
    const result = await tx.execute<{ currency: CurrencyCode; amount: string; book: string }>(sql`
      select i.currency, (-sum(b.open_minor))::text as amount, (-sum(b.book_minor))::text as book
      from public.open_items i
      join public.open_item_balances b on b.item_id = i.id
      join public.chart_accounts a on a.id = i.account_id and a.code = ${ACCOUNTS.suppliers}
      where b.open_minor <> 0
      group by i.currency order by i.currency`);
    return result.rows.map((row) => ({
      currency: row.currency,
      amountMinor: row.amount,
      bookMinor: row.book,
    }));
  }
  const result = await tx.execute<{ currency: CurrencyCode; amount: string; book: string }>(sql`
    with project_lines as (
      select i.id as item_id, l.currency, -sum(l.amount_minor) as owed
      from public.journal_lines l
      join public.chart_accounts a on a.id = l.account_id and a.code = ${ACCOUNTS.suppliers}
      join public.dimension_set_values sv on sv.set_id = l.dimension_set_id
      join public.open_items i on i.account_id = l.account_id and i.currency = l.currency
        and i.counterparty_value_id = sv.value_id
      where ${onProject(projectId, sql`l.dimension_set_id`)}
      group by i.id, l.currency
    )
    select p.currency, sum(p.owed)::text as amount,
      sum(case when b.open_minor = 0 then 0
        else round(-b.book_minor::numeric * p.owed / -b.open_minor) end)::text as book
    from project_lines p
    join public.open_item_balances b on b.item_id = p.item_id
    where p.owed <> 0
    group by p.currency order by p.currency`);
  return result.rows.map((row) => ({
    currency: row.currency,
    amountMinor: row.amount,
    bookMinor: row.book,
  }));
}

/** A project with its client, details, contract value and figures (S13 "Screens"). */
export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly client: { id: string; name: string };
  readonly startDate: string;
  readonly state: 'active' | 'finished';
  readonly contractValue: { amountMinor: string; currency: CurrencyCode } | null;
  readonly figures: FiguresRow;
}

/** The company's projects, by name, with their figures; filtered by state or a search. */
export async function readProjects(
  tx: Transaction,
  filter: {
    state?: 'active' | 'finished' | undefined;
    search?: string | undefined;
    id?: string | undefined;
  } = {},
): Promise<ProjectRow[]> {
  const result = await tx.execute<{
    id: string;
    name: string;
    client_id: string;
    client_name: string;
    start_date: string;
    state: 'active' | 'finished';
    value: string | null;
    currency: CurrencyCode | null;
  }>(sql`
    select v.id, v.name, c.id as client_id, c.name as client_name,
      coalesce(d.start_date, (v.created_at at time zone 'Asia/Damascus')::date)::text as start_date,
      coalesce(d.state, 'active')::text as state,
      t.contract_value_minor::text as value, t.currency
    from public.dimension_values v
    join public.dimension_values c on c.id = v.parent_value_id
    left join public.project_details d on d.contract_value_id = v.id
    left join public.project_terms t on t.contract_value_id = v.id and t.archived_at is null
    where v.contract_kind = 'project' and v.archived_at is null
      and ${filter.id === undefined ? sql`true` : sql`v.id = ${filter.id}`}
      and ${filter.state === undefined ? sql`true` : sql`coalesce(d.state, 'active')::text = ${filter.state}`}
      and ${filter.search === undefined ? sql`true` : sql`(v.name ilike ${`%${filter.search}%`} or c.name ilike ${`%${filter.search}%`})`}
    order by v.name, v.id`);
  const projects: ProjectRow[] = [];
  for (const row of result.rows) {
    projects.push({
      id: row.id,
      name: row.name,
      client: { id: row.client_id, name: row.client_name },
      startDate: row.start_date,
      state: row.state,
      contractValue:
        row.value === null || row.currency === null || row.value === '0'
          ? null
          : { amountMinor: row.value, currency: row.currency },
      figures: await readFigures(tx, row.id),
    });
  }
  return projects;
}

/**
 * Makes a project (S13 "API"): its client (an existing one, or a new one by name), the contract
 * value of kind `project` under it, its details and, with a contract value, its terms; audited.
 */
export async function createProject(
  tx: Transaction,
  companyId: string,
  actor: PersonActor,
  input: CreateProject,
): Promise<string> {
  const clientType = await typeIdOf(tx, 'client');
  let clientId = input.clientId;
  if (clientId === null) {
    const client = await createDimensionValue(
      tx,
      companyId,
      {
        typeId: clientType,
        code: null,
        name: input.clientName as string,
        nameLatin: null,
        contractKind: null,
        parentValueId: null,
      },
      actor,
    );
    clientId = client.id;
  } else {
    const [client] = await tx
      .select({ id: dimensionValues.id })
      .from(dimensionValues)
      .where(and(eq(dimensionValues.id, clientId), eq(dimensionValues.typeId, clientType)));
    if (client === undefined) throw new DomainError('NOT_FOUND', 'No such client');
  }
  const project = await createDimensionValue(
    tx,
    companyId,
    {
      typeId: await typeIdOf(tx, 'contract'),
      code: null,
      name: input.name,
      nameLatin: null,
      contractKind: 'project',
      parentValueId: clientId,
    },
    actor,
  );
  await tx.insert(projectDetails).values({
    companyId,
    contractValueId: project.id,
    startDate: input.startDate,
    state: 'active',
  });
  if (input.contractValue !== null) {
    await tx.insert(projectTerms).values({
      companyId,
      contractValueId: project.id,
      currency: input.contractValue.currency,
      contractValueMinor: BigInt(input.contractValue.amountMinor),
      retentionBp: 0,
      advanceRecoveryBp: 0,
    });
  }
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'project.created',
    entityType: 'project',
    entityId: project.id,
    after: {
      name: input.name,
      clientValueId: clientId,
      startDate: input.startDate,
      state: 'active',
    },
  });
  return project.id;
}

/** Changes a project's name, start date or state (S13 rule 9); audited. */
export async function updateProject(
  tx: Transaction,
  companyId: string,
  actor: PersonActor,
  id: string,
  input: UpdateProject,
): Promise<void> {
  const project = await projectOf(tx, id);
  const [details] = await tx
    .select()
    .from(projectDetails)
    .where(eq(projectDetails.contractValueId, id))
    .for('update');
  if (input.name !== undefined && input.name !== project.name) {
    await tx
      .update(dimensionValues)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(dimensionValues.id, id));
  }
  const startDate = input.startDate ?? details?.startDate ?? null;
  const state = input.state ?? details?.state ?? 'active';
  if (details === undefined) {
    await tx.insert(projectDetails).values({
      companyId,
      contractValueId: id,
      startDate: startDate ?? sql`(now() at time zone 'Asia/Damascus')::date`,
      state,
    });
  } else {
    await tx
      .update(projectDetails)
      .set({ startDate: startDate ?? details.startDate, state, updatedAt: new Date() })
      .where(eq(projectDetails.id, details.id));
  }
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'project.updated',
    entityType: 'project',
    entityId: id,
    before: { name: project.name, startDate: details?.startDate, state: project.state },
    after: { name: input.name ?? project.name, startDate, state },
  });
}

/** A client or supplier with its projects and what is owed each way (S13 "Screens"). */
export interface PartyRow {
  readonly id: string;
  readonly type: 'client' | 'supplier';
  readonly name: string;
  readonly projectCount: number;
  readonly owedToUs: CurrencyAmountRow[];
  readonly owedByUs: CurrencyAmountRow[];
}

/** The company's clients or suppliers, by name. */
export async function readParties(
  tx: Transaction,
  type: 'client' | 'supplier',
): Promise<PartyRow[]> {
  const typeId = await typeIdOf(tx, type);
  const account = type === 'client' ? ACCOUNTS.receivables : ACCOUNTS.suppliers;
  const result = await tx.execute<{ id: string; name: string; projects: string }>(sql`
    select v.id, v.name,
      (${
        type === 'client'
          ? sql`select count(*) from public.dimension_values p
              where p.parent_value_id = v.id and p.contract_kind = 'project'`
          : sql`select count(distinct m.contract_value_id) from public.project_movements m
              where m.counterparty_value_id = v.id`
      })::text as projects
    from public.dimension_values v
    where v.type_id = ${typeId} and v.archived_at is null
    order by v.name, v.id`);
  const balances = await tx.execute<{
    party: string;
    currency: CurrencyCode;
    amount: string;
    book: string;
  }>(sql`
    select i.counterparty_value_id as party, i.currency,
      (${type === 'client' ? sql`1` : sql`-1`} * sum(b.open_minor))::text as amount,
      (${type === 'client' ? sql`1` : sql`-1`} * sum(b.book_minor))::text as book
    from public.open_items i
    join public.open_item_balances b on b.item_id = i.id
    join public.chart_accounts a on a.id = i.account_id and a.code = ${account}
    where b.open_minor <> 0
    group by i.counterparty_value_id, i.currency`);
  const parties: PartyRow[] = [];
  for (const row of result.rows) {
    const owed: CurrencyAmountRow[] = balances.rows
      .filter((item) => item.party === row.id)
      .map((item) => ({ currency: item.currency, amountMinor: item.amount, bookMinor: item.book }));
    parties.push({
      id: row.id,
      type,
      name: row.name,
      projectCount: Number(row.projects),
      owedToUs: type === 'client' ? owed : [],
      owedByUs: type === 'supplier' ? owed : [],
    });
  }
  return parties;
}

/** Adds a client or supplier by name (S13 "API"). */
export async function createParty(
  tx: Transaction,
  companyId: string,
  actor: PersonActor,
  input: CreateParty,
): Promise<string> {
  const value = await createDimensionValue(
    tx,
    companyId,
    {
      typeId: await typeIdOf(tx, input.type),
      code: null,
      name: input.name,
      nameLatin: null,
      contractKind: null,
      parentValueId: null,
    },
    actor,
  );
  return value.id;
}

/** A material's cost across projects or for one (S13 "Screens"), from the lines' quantities. */
export interface MaterialCostRow {
  readonly material: { id: string; name: string; unit: string };
  readonly quantity: string;
  readonly bookMinor: string;
  readonly byCurrency: CurrencyAmountRow[];
  readonly byProject: {
    project: { id: string; name: string };
    quantity: string;
    bookMinor: string;
  }[];
}

export async function readMaterialCosts(
  tx: Transaction,
  filter: { project?: string | undefined; from?: string | undefined; to?: string | undefined },
): Promise<{ bookCurrency: CurrencyCode; materials: MaterialCostRow[]; totalBookMinor: string }> {
  const [settings] = await tx
    .select({ bookCurrency: companySettings.bookCurrency })
    .from(companySettings);
  const where = sql.join(
    [
      sql`q.material_id is not null`,
      filter.from === undefined ? sql`true` : sql`e.entry_date >= ${filter.from}`,
      filter.to === undefined ? sql`true` : sql`e.entry_date <= ${filter.to}`,
      filter.project === undefined ? sql`true` : sql`p.id = ${filter.project}`,
    ],
    sql` and `,
  );
  const result = await tx.execute<{
    material_id: string;
    material_name: string;
    unit: string;
    project_id: string | null;
    project_name: string | null;
    currency: CurrencyCode;
    quantity: string;
    amount: string;
    book: string;
  }>(sql`
    select mt.id as material_id, mt.name as material_name, mt.unit,
      p.id as project_id, p.name as project_name, l.currency,
      sum(q.quantity)::text as quantity, sum(l.amount_minor)::text as amount,
      sum(l.book_minor)::text as book
    from public.line_quantities q
    join public.journal_lines l on l.id = q.line_id
    join public.journal_entries e on e.id = q.entry_id
    join public.materials mt on mt.id = q.material_id
    left join lateral (
      select v.id, v.name from public.dimension_set_values s
      join public.dimension_values v on v.id = s.value_id and v.contract_kind = 'project'
      where s.set_id = l.dimension_set_id limit 1
    ) p on true
    where ${where}
    group by mt.id, mt.name, mt.unit, p.id, p.name, l.currency
    order by mt.name, p.name`);
  const totals = await tx.execute<{
    material_id: string;
    quantity: string;
    book: string;
  }>(sql`
    select q.material_id, sum(q.quantity)::text as quantity, sum(l.book_minor)::text as book
    from public.line_quantities q
    join public.journal_lines l on l.id = q.line_id
    join public.journal_entries e on e.id = q.entry_id
    left join lateral (
      select v.id from public.dimension_set_values s
      join public.dimension_values v on v.id = s.value_id and v.contract_kind = 'project'
      where s.set_id = l.dimension_set_id limit 1
    ) p on true
    where ${where}
    group by q.material_id`);
  const byProject = await tx.execute<{
    material_id: string;
    project_id: string;
    project_name: string;
    quantity: string;
    book: string;
  }>(sql`
    select q.material_id, p.id as project_id, p.name as project_name,
      sum(q.quantity)::text as quantity, sum(l.book_minor)::text as book
    from public.line_quantities q
    join public.journal_lines l on l.id = q.line_id
    join public.journal_entries e on e.id = q.entry_id
    join lateral (
      select v.id, v.name from public.dimension_set_values s
      join public.dimension_values v on v.id = s.value_id and v.contract_kind = 'project'
      where s.set_id = l.dimension_set_id limit 1
    ) p on true
    where ${where}
    group by q.material_id, p.id, p.name
    order by p.name`);
  const grand = await tx.execute<{ book: string }>(sql`
    select coalesce(sum(l.book_minor), 0)::text as book
    from public.line_quantities q
    join public.journal_lines l on l.id = q.line_id
    join public.journal_entries e on e.id = q.entry_id
    left join lateral (
      select v.id from public.dimension_set_values s
      join public.dimension_values v on v.id = s.value_id and v.contract_kind = 'project'
      where s.set_id = l.dimension_set_id limit 1
    ) p on true
    where ${where}`);
  const seen = new Map<string, MaterialCostRow>();
  for (const row of result.rows) {
    let entry = seen.get(row.material_id);
    if (entry === undefined) {
      const total = totals.rows.find((item) => item.material_id === row.material_id);
      entry = {
        material: { id: row.material_id, name: row.material_name, unit: row.unit },
        quantity: total?.quantity ?? '0',
        bookMinor: total?.book ?? '0',
        byCurrency: [],
        byProject: byProject.rows
          .filter((item) => item.material_id === row.material_id)
          .map((item) => ({
            project: { id: item.project_id, name: item.project_name },
            quantity: item.quantity,
            bookMinor: item.book,
          })),
      };
      seen.set(row.material_id, entry);
    }
    const existing = entry.byCurrency.find((item) => item.currency === row.currency);
    if (existing === undefined) {
      entry.byCurrency.push({
        currency: row.currency,
        amountMinor: row.amount,
        bookMinor: row.book,
      });
    }
  }
  // Each currency once per material: the rows are per project and currency, so sum them in SQL.
  for (const entry of seen.values()) {
    const currencies = await tx.execute<{
      currency: CurrencyCode;
      amount: string;
      book: string;
    }>(sql`
      select l.currency, sum(l.amount_minor)::text as amount, sum(l.book_minor)::text as book
      from public.line_quantities q
      join public.journal_lines l on l.id = q.line_id
      join public.journal_entries e on e.id = q.entry_id
      left join lateral (
        select v.id from public.dimension_set_values s
        join public.dimension_values v on v.id = s.value_id and v.contract_kind = 'project'
        where s.set_id = l.dimension_set_id limit 1
      ) p on true
      where ${where} and q.material_id = ${entry.material.id}
      group by l.currency order by l.currency`);
    entry.byCurrency.splice(
      0,
      entry.byCurrency.length,
      ...currencies.rows.map((row) => ({
        currency: row.currency,
        amountMinor: row.amount,
        bookMinor: row.book,
      })),
    );
  }
  return {
    bookCurrency: (settings?.bookCurrency ?? 'USD') as CurrencyCode,
    materials: [...seen.values()],
    totalBookMinor: grand.rows[0]?.book ?? '0',
  };
}

/**
 * The rates of a day (S13 "Currencies"): for each other currency the company uses, 1 unit of the
 * book currency in it, the market rate in force on the day; `missing` when one was not recorded
 * for that very day.
 */
export async function readDayRates(tx: Transaction, date: string): Promise<DayRates> {
  const [settings] = await tx
    .select({ bookCurrency: companySettings.bookCurrency })
    .from(companySettings);
  const base = (settings?.bookCurrency ?? 'USD') as CurrencyCode;
  const quotes = (['SYP', 'TRY', 'USD'] as const).filter((code) => code !== base);
  const rates = [];
  for (const quote of quotes) {
    const result = await tx.execute<{ rate: string; effective_on: string }>(sql`
      select r.rate::text as rate, r.effective_on::text as effective_on
      from public.exchange_rates r
      where r.base = ${base} and r.quote = ${quote} and r.type = 'market'
        and r.effective_on <= ${date}
        and not exists (select 1 from public.exchange_rates n where n.supersedes_rate_id = r.id)
      order by r.effective_on desc, r.created_at desc limit 1`);
    const [row] = result.rows;
    rates.push({
      base,
      quote,
      rate: row === undefined ? null : row.rate.replace(/0+$/, '').replace(/\.$/, ''),
      effectiveOn: row?.effective_on ?? null,
    });
  }
  return { date, rates, missing: rates.some((rate) => rate.effectiveOn !== date) };
}

/** Records a day's rates (S13 "Currencies"), a correction with its reason (S02 rule 15). */
export async function recordDayRates(
  tx: Transaction,
  companyId: string,
  actor: PersonActor,
  input: RecordDayRates,
): Promise<void> {
  for (const rate of input.rates) {
    await recordRate(tx, companyId, actor, {
      base: rate.base,
      quote: rate.quote,
      rate: rate.rate,
      type: 'market',
      effectiveOn: input.date,
      source: 'manual',
      ...(input.reason !== null && { reason: input.reason }),
    });
  }
}

/** The boxes' balances, each in its currency with its book amount. */
async function readBoxes(tx: Transaction): Promise<CurrencyAmountRow[]> {
  const result = await tx.execute<{ currency: CurrencyCode; amount: string; book: string }>(sql`
    select a.currency, coalesce(sum(l.amount_minor), 0)::text as amount,
      coalesce(sum(l.book_minor), 0)::text as book
    from public.chart_accounts a
    left join public.journal_lines l on l.account_id = a.id
    where a.cash_kind = 'box' and a.archived_at is null
    group by a.currency order by a.currency`);
  return result.rows.map((row) => ({
    currency: row.currency,
    amountMinor: row.amount,
    bookMinor: row.book,
  }));
}

/** The dashboard (S13 "Screens"): the company's figures, boxes, rates and lists. */
export async function readDashboard(tx: Transaction, today: string) {
  const figures = await readFigures(tx, null);
  const projects = await readProjects(tx);
  const differences = await tx.execute<{ value: string }>(sql`
    select (-coalesce(sum(l.book_minor), 0))::text as value
    from public.journal_lines l
    join public.chart_accounts a on a.id = l.account_id
    where a.code in (${ACCOUNTS.gain}, ${ACCOUNTS.loss})`);
  const materials = await readMaterialCosts(tx, {});
  const latest = await movementRows(tx, sql`true`, 10);
  return {
    bookCurrency: figures.bookCurrency,
    projects: {
      active: projects.filter((project) => project.state === 'active').length,
      finished: projects.filter((project) => project.state === 'finished').length,
    },
    figures,
    exchangeDifferencesMinor: differences.rows[0]?.value ?? '0',
    boxes: await readBoxes(tx),
    rates: await readDayRates(tx, today),
    topProjects: (
      await rankByProfit(
        tx,
        projects.map((project) => project.id),
      )
    )
      .slice(0, 5)
      .map((id) => {
        const project = projects.find((item) => item.id === id) as ProjectRow;
        return {
          project: { id: project.id, name: project.name },
          profitMinor: project.figures.profitMinor,
          netCashMinor: project.figures.netCashMinor,
        };
      }),
    latestMovements: latest,
    topMaterials: [...materials.materials]
      .sort((a, b) => (BigInt(b.bookMinor) > BigInt(a.bookMinor) ? 1 : -1))
      .slice(0, 5)
      .map((row) => ({
        material: { id: row.material.id, name: row.material.name },
        unit: row.material.unit,
        quantity: row.quantity,
        bookMinor: row.bookMinor,
      })),
  };
}

/** The projects by profit, highest first, compared in SQL. */
async function rankByProfit(tx: Transaction, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await tx.execute<{ id: string }>(sql`
    select v.id from public.dimension_values v
    where v.id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    order by (
      -coalesce((select sum(l.book_minor) from public.journal_lines l
        join public.chart_accounts a on a.id = l.account_id
        join public.dimension_set_values s on s.set_id = l.dimension_set_id and s.value_id = v.id
        where a.code = ${ACCOUNTS.revenue} or a.statement_line = 'is.direct_costs'), 0)
    ) desc, v.name`);
  return result.rows.map((row) => row.id);
}

/** The company's display name and logo (S13 "Data"); the company's name until one is set. */
export async function readBranding(tx: Transaction): Promise<{
  displayName: string;
  logo: { storageKey: string; contentType: string; sha256: string } | null;
}> {
  const [row] = await tx.select().from(companyBranding);
  if (row !== undefined) {
    return {
      displayName: row.displayName,
      logo:
        row.logoStorageKey === null || row.logoContentType === null || row.logoSha256 === null
          ? null
          : {
              storageKey: row.logoStorageKey,
              contentType: row.logoContentType,
              sha256: row.logoSha256,
            },
    };
  }
  const result = await tx.execute<{ name: string }>(sql`
    select c.name from public.companies c where c.id = current_company_id()`);
  return { displayName: result.rows[0]?.name ?? '', logo: null };
}

/** Sets the display name, or the logo with its stored file's key, type and hash; audited. */
export async function updateBranding(
  tx: Transaction,
  companyId: string,
  actor: PersonActor,
  input: {
    displayName?: string;
    logo?: { storageKey: string; contentType: string; sha256: string };
  },
): Promise<void> {
  const current = await readBranding(tx);
  const displayName = input.displayName ?? current.displayName;
  const logo = input.logo ?? current.logo;
  await tx
    .insert(companyBranding)
    .values({
      companyId,
      displayName,
      logoStorageKey: logo?.storageKey ?? null,
      logoContentType: logo?.contentType ?? null,
      logoSha256: logo?.sha256 ?? null,
    })
    .onConflictDoUpdate({
      target: [companyBranding.companyId],
      set: {
        displayName,
        logoStorageKey: logo?.storageKey ?? null,
        logoContentType: logo?.contentType ?? null,
        logoSha256: logo?.sha256 ?? null,
        updatedAt: new Date(),
      },
    });
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'branding.updated',
    entityType: 'company_branding',
    entityId: companyId,
    before: { displayName: current.displayName, logoSha256: current.logo?.sha256 ?? null },
    after: { displayName, logoSha256: logo?.sha256 ?? null },
  });
}

/** The company's name, for a signed-out page (S13 "Data": `SIGN_IN_COMPANY_ID`). */
export async function companyExists(tx: Transaction, companyId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, companyId));
  return row !== undefined;
}

// S13 "Printing": what the three PDFs print, read in the render's one snapshot.

/** What the project owes each supplier, by currency, valued as `owedByUsOf()` values it. */
export interface SupplierDebtRow {
  readonly supplier: { id: string; name: string };
  readonly owed: CurrencyAmountRow[];
}

async function owedBySupplier(tx: Transaction, projectId: string): Promise<SupplierDebtRow[]> {
  const result = await tx.execute<{
    id: string;
    name: string;
    currency: CurrencyCode;
    amount: string;
    book: string;
  }>(sql`
    with project_lines as (
      select i.id as item_id, i.counterparty_value_id as supplier, l.currency,
        -sum(l.amount_minor) as owed
      from public.journal_lines l
      join public.chart_accounts a on a.id = l.account_id and a.code = ${ACCOUNTS.suppliers}
      join public.dimension_set_values sv on sv.set_id = l.dimension_set_id
      join public.open_items i on i.account_id = l.account_id and i.currency = l.currency
        and i.counterparty_value_id = sv.value_id
      where ${onProject(projectId, sql`l.dimension_set_id`)}
      group by i.id, i.counterparty_value_id, l.currency
    )
    select v.id, v.name, p.currency, sum(p.owed)::text as amount,
      sum(case when b.open_minor = 0 then 0
        else round(-b.book_minor::numeric * p.owed / -b.open_minor) end)::text as book
    from project_lines p
    join public.open_item_balances b on b.item_id = p.item_id
    join public.dimension_values v on v.id = p.supplier
    where p.owed <> 0
    group by v.id, v.name, p.currency
    order by v.name, v.id, p.currency`);
  const suppliers: SupplierDebtRow[] = [];
  for (const row of result.rows) {
    let supplier = suppliers.find((item) => item.supplier.id === row.id);
    if (supplier === undefined) {
      supplier = { supplier: { id: row.id, name: row.name }, owed: [] };
      suppliers.push(supplier);
    }
    supplier.owed.push({ currency: row.currency, amountMinor: row.amount, bookMinor: row.book });
  }
  return suppliers;
}

/** One project as its PDF and the PDF of all projects print it. */
export interface ProjectPrintSection {
  readonly project: ProjectRow;
  /** Every movement of the project, oldest first, cancelled ones marked. */
  readonly movements: MovementRow[];
  readonly materials: MaterialCostRow[];
  readonly materialsBookMinor: string;
  readonly suppliers: SupplierDebtRow[];
}

async function projectSection(tx: Transaction, project: ProjectRow): Promise<ProjectPrintSection> {
  const costs = await readMaterialCosts(tx, { project: project.id });
  return {
    project,
    movements: await movementRows(tx, sql`m.contract_value_id = ${project.id}`, null, 'oldest'),
    materials: costs.materials,
    materialsBookMinor: costs.totalBookMinor,
    suppliers: await owedBySupplier(tx, project.id),
  };
}

/** One project's PDF (S13 "Printing"): the project and client, figures, movements, materials, debts. */
export async function readProjectStatementPrint(
  tx: Transaction,
  projectId: string,
): Promise<{ bookCurrency: CurrencyCode; section: ProjectPrintSection }> {
  const [project] = await readProjects(tx, { id: projectId });
  if (project === undefined) throw new DomainError('NOT_FOUND', 'No such project');
  return { bookCurrency: project.figures.bookCurrency, section: await projectSection(tx, project) };
}

/** A rate a movement was measured at: 1 `base` in `quote` on its day, as quoted. */
export interface RateUsedRow {
  readonly date: string;
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: string;
}

/** The PDF of all projects (S13 "Printing"). */
export interface ProjectsOverviewPrint {
  readonly bookCurrency: CurrencyCode;
  readonly figures: FiguresRow;
  readonly exchangeDifferencesMinor: string;
  readonly boxes: CurrencyAmountRow[];
  readonly projects: ProjectPrintSection[];
  readonly materials: MaterialCostRow[];
  readonly materialsBookMinor: string;
  readonly clients: PartyRow[];
  readonly suppliers: PartyRow[];
  readonly rates: RateUsedRow[];
}

export async function readProjectsOverviewPrint(tx: Transaction): Promise<ProjectsOverviewPrint> {
  const figures = await readFigures(tx, null);
  const differences = await tx.execute<{ value: string }>(sql`
    select (-coalesce(sum(l.book_minor), 0))::text as value
    from public.journal_lines l
    join public.chart_accounts a on a.id = l.account_id
    where a.code in (${ACCOUNTS.gain}, ${ACCOUNTS.loss})`);
  const projects: ProjectPrintSection[] = [];
  for (const project of await readProjects(tx)) projects.push(await projectSection(tx, project));
  const costs = await readMaterialCosts(tx, {});
  const owing = (party: PartyRow) => party.owedToUs.length > 0 || party.owedByUs.length > 0;
  // The rates the movements' entries and their cancellations were measured at in the book ledger.
  const rates = await tx.execute<{
    date: string;
    base: CurrencyCode;
    quote: CurrencyCode;
    rate: string;
  }>(sql`
    select distinct c.effective_on::text as date, c.base, c.quote, c.rate::text as rate
    from public.line_conversions c
    join public.journal_lines l on l.id = c.line_id
    where c.ledger = 'book' and l.entry_id in (
      select m.entry_id from public.project_movements m
      union all
      select x.reversal_entry_id from public.project_movement_cancellations x)
    order by 1, 2, 3, 4`);
  return {
    bookCurrency: figures.bookCurrency,
    figures,
    exchangeDifferencesMinor: differences.rows[0]?.value ?? '0',
    boxes: await readBoxes(tx),
    projects,
    materials: costs.materials,
    materialsBookMinor: costs.totalBookMinor,
    clients: (await readParties(tx, 'client')).filter(owing),
    suppliers: (await readParties(tx, 'supplier')).filter(owing),
    rates: rates.rows.map((row) => ({ ...row, rate: trimRate(row.rate) })),
  };
}

/** A stored rate without the trailing zeros of its `numeric(22, 10)`. */
const trimRate = (rate: string) => (rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate);
