import { draftInputSchema, lineAmount } from '@vertex-mizan/contracts';
import {
  chartAccounts,
  createMaterial,
  createSubcontract,
  dimensionTypes,
  dimensionValues,
  projectDocuments as documentsTable,
  entryDrafts,
  insertDraft,
  journalEntries,
  journalLines,
  lineQuantities,
  materials as materialsTable,
  post,
  projectDocumentContentOf,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { advanceClock } from './clock.js';
import type { CaseCompany, Step } from './format.js';
import type {
  CaseContext,
  ObservedProjectDocument,
  ObservedQuantity,
  StepResult,
} from './harness.js';
import { bookkeeperOf, outcomeOf } from './system.js';

// Project documents in the scenario book (S12, ADR 0023): the materials and subcontracts made by
// the services the API uses, a document saved as a draft through the drafts service and posted by
// the posting function from what the draft holds, and the documents and quantities read from the
// database as the register reads them.

/** The id of a value named by type and code (`supplier: S1`). */
export async function valueIdOf(tx: Transaction, type: string, code: string): Promise<string> {
  const [value] = await tx
    .select({ id: dimensionValues.id })
    .from(dimensionValues)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, dimensionValues.companyId),
        eq(dimensionTypes.id, dimensionValues.typeId),
      ),
    )
    .where(and(eq(dimensionTypes.code, type), eq(dimensionValues.code, code)));
  if (!value) throw new Error(`The company has no ${type} value ${code}`);
  return value.id;
}

/** The id of a material by its code; an unknown code is the posting's to refuse. */
export async function materialIdOf(tx: Transaction, code: string): Promise<string> {
  const [row] = await tx
    .select({ id: materialsTable.id })
    .from(materialsTable)
    .where(eq(materialsTable.code, code));
  return row?.id ?? uuidv7();
}

/** The case's materials catalogue (S12 rule 3), through the service the API uses. */
export async function materials(
  context: CaseContext,
  rows: CaseCompany['materials'],
): Promise<void> {
  const actor = bookkeeperOf(context.companyId);
  await withCompany(context.database.app, context.companyId, async (tx) => {
    for (const row of rows) {
      await createMaterial(
        tx,
        context.companyId,
        { code: row.code, name: row.name, nameLatin: null, unit: row.unit },
        actor,
      );
    }
  });
}

/** The case's subcontracts (S12 rule 2), through the service the API uses. */
export async function subcontracts(
  context: CaseContext,
  rows: CaseCompany['subcontracts'],
): Promise<void> {
  const actor = bookkeeperOf(context.companyId);
  await withCompany(context.database.app, context.companyId, async (tx) => {
    for (const row of rows) {
      await createSubcontract(
        tx,
        context.companyId,
        {
          contractValueId: await valueIdOf(tx, 'contract', row.contract),
          supplierValueId: await valueIdOf(tx, 'supplier', row.supplier),
          currency: row.currency,
          valueMinor: row.value === null ? null : row.value.toString(),
          retentionBp: row.retentionBp,
          advanceRecoveryBp: row.advanceRecoveryBp,
        },
        actor,
      );
    }
  });
}

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

/** A purchase's payload as the document form sends it (`projects/purchase-invoice.md`). */
const purchasePayloadSchema = z.strictObject({
  description: z.string().trim().min(1).max(500).optional(),
  document: z.strictObject({
    kind: z.literal('purchase'),
    contract: z.string().min(1),
    supplier: z.string().min(1),
    currency: z.enum(['USD', 'SYP', 'TRY', 'EUR']),
    supplier_reference: z.string().trim().min(1).max(60).optional(),
    advance: z.bigint().optional(),
  }),
  lines: z
    .array(
      z.strictObject({
        account: z.string().regex(/^[1-5][0-9]{0,5}$/),
        material: z.string().min(1).optional(),
        quantity: decimal.optional(),
        unit_price: decimal.optional(),
        amount: z.bigint().optional(),
        advance: z.bigint().optional(),
        memo: z.string().trim().min(1).max(300).optional(),
      }),
    )
    .min(1),
});

/** A wage sheet's payload as the document form sends it (`projects/wage-sheet.md`). */
const wageSheetPayloadSchema = z.strictObject({
  description: z.string().trim().min(1).max(500).optional(),
  document: z.strictObject({
    kind: z.literal('wage_sheet'),
    contract: z.string().min(1),
    currency: z.enum(['USD', 'SYP', 'TRY', 'EUR']),
    period_from: z.iso.date(),
    period_to: z.iso.date(),
  }),
  lines: z
    .array(
      z.strictObject({
        worker: z.string().min(1),
        days: decimal.optional(),
        daily_rate: decimal.optional(),
        amount: z.bigint().optional(),
        description: z.string().trim().min(1).max(300).optional(),
      }),
    )
    .min(1),
});

const payloadSchema = z.union([purchasePayloadSchema, wageSheetPayloadSchema]);

/** A refusal is the step's outcome; a draft the form would not save is the case's failure. */
function refusedOnSave(error: unknown): StepResult {
  if (error instanceof z.ZodError) return { status: 'refused', reason: 'VALIDATION_FAILED' };
  throw error;
}

/**
 * A project document (S12 rules 4–13, 21): its draft saved through the drafts service as the
 * document form sends it, then posted by the posting function from what the draft holds
 * (`projectDocumentContentOf()`), and the draft marked posted, in one transaction, so a refusal
 * leaves neither the draft nor a number behind. Its date is the step's.
 */
export async function projectDocument(
  context: CaseContext,
  step: Extract<Step, { kind: 'project_document' }>,
): Promise<StepResult> {
  const payload = payloadSchema.parse(step.payload);
  const actor = bookkeeperOf(context.companyId);
  advanceClock(context.companyId, step.accountingDate);
  const description = payload.description ?? step.description;
  let input: z.input<typeof draftInputSchema>;
  try {
    input = await withCompany(context.database.app, context.companyId, async (tx) => {
      const { document } = payload;
      const contractValueId = await valueIdOf(tx, 'contract', document.contract);
      if (document.kind === 'purchase') {
        const purchase = payload as z.infer<typeof purchasePayloadSchema>;
        const accounts = new Map(
          (
            await tx.select({ id: chartAccounts.id, code: chartAccounts.code }).from(chartAccounts)
          ).map((row) => [row.code, row.id]),
        );
        return {
          entryDate: step.accountingDate,
          description,
          projectDocument: {
            kind: 'purchase',
            contractValueId,
            counterpartyValueId: await valueIdOf(tx, 'supplier', document.supplier),
            currency: document.currency,
            supplierReference: document.supplier_reference ?? null,
            advanceMinor: document.advance?.toString() ?? null,
          },
          lines: await Promise.all(
            purchase.lines.map(async (line) => ({
              accountId: accounts.get(line.account) ?? uuidv7(),
              currency: document.currency,
              amountMinor: line.amount?.toString() ?? null,
              memo: line.memo ?? null,
              materialId:
                line.material === undefined ? null : await materialIdOf(tx, line.material),
              quantity: line.quantity ?? null,
              unitPrice: line.unit_price ?? null,
              advanceMinor: line.advance?.toString() ?? null,
            })),
          ),
        };
      }
      return {
        entryDate: step.accountingDate,
        description,
        projectDocument: {
          kind: 'wage_sheet',
          contractValueId,
          currency: document.currency,
          periodFrom: document.period_from,
          periodTo: document.period_to,
        },
        lines: await Promise.all(
          (payload as z.infer<typeof wageSheetPayloadSchema>).lines.map(async (line) => ({
            accountId: null,
            dimensionValueIds: [await valueIdOf(tx, 'worker', line.worker)],
            currency: document.currency,
            amountMinor: line.amount?.toString() ?? null,
            memo: line.description ?? null,
            ...(line.days !== undefined && {
              unit: 'يوم',
              quantity: line.days,
              unitPrice: line.daily_rate ?? null,
            }),
          })),
        ),
      };
    });
  } catch (error) {
    return refusedOnSave(error);
  }
  let parsed: z.output<typeof draftInputSchema>;
  try {
    parsed = draftInputSchema.parse(input);
  } catch (error) {
    return refusedOnSave(error);
  }
  return outcomeOf(
    withCompany(context.database.app, context.companyId, async (tx) => {
      const draftId = await insertDraft(tx, context.companyId, actor, parsed);
      const content = await projectDocumentContentOf(tx, draftId);
      const entry = await post(tx, {
        client: 'manual',
        idempotencyKey: draftId,
        entryDate: step.accountingDate,
        description,
        reference: null,
        draftId,
        preparedByUserId: actor.userId,
        approvedByUserId: null,
        actor,
        content: { kind: 'project_document', today: step.accountingDate, ...content },
      });
      await tx
        .update(entryDrafts)
        .set({ state: 'posted', postedEntryId: entry.id })
        .where(eq(entryDrafts.id, draftId));
    }),
  );
}

/** Each entry's place in posting order, by id, and each entry's reversal. */
async function postingOrder(tx: Transaction) {
  const entries = await tx
    .select({
      id: journalEntries.id,
      sequence: journalEntries.sequence,
      reverses: journalEntries.reversesEntryId,
    })
    .from(journalEntries);
  return {
    sequenceOf: (id: string) => Number(entries.find((entry) => entry.id === id)?.sequence ?? 0),
    reversalOf: (id: string) => {
      const reversal = entries.find((entry) => entry.reverses === id);
      return reversal === undefined ? null : Number(reversal.sequence);
    },
  };
}

/**
 * Every project document the company holds (S12 rule 21), as the register reads it: its kind,
 * number and date, its project and the project's client, its supplier, its entry and cancelling
 * reversal by their place in posting order, and its kind's fields.
 */
export function projectDocuments(context: CaseContext): Promise<ObservedProjectDocument[]> {
  return withCompany(context.database.app, context.companyId, async (tx) => {
    const values = await tx
      .select({
        id: dimensionValues.id,
        code: dimensionValues.code,
        parent: dimensionValues.parentValueId,
      })
      .from(dimensionValues);
    const codeOf = (id: string | null) => values.find((value) => value.id === id)?.code ?? '';
    const clientOf = (id: string) =>
      codeOf(values.find((value) => value.id === id)?.parent ?? null);
    const { sequenceOf, reversalOf } = await postingOrder(tx);
    const rows = await tx.select().from(documentsTable);
    return rows.map((row): ObservedProjectDocument => {
      const common = {
        number: row.number,
        date: row.documentDate,
        contract: codeOf(row.contractValueId),
        client: clientOf(row.contractValueId),
        entry: sequenceOf(row.entryId),
        currency: row.currency as ObservedProjectDocument['currency'],
        cancelledBy: reversalOf(row.entryId),
      };
      switch (row.kind) {
        case 'purchase':
          return {
            kind: 'purchase',
            ...common,
            supplier: codeOf(row.counterpartyValueId),
            reference: row.supplierReference,
          };
        case 'wage_sheet':
          return {
            kind: 'wage_sheet',
            ...common,
            periodFrom: row.periodFrom ?? '',
            periodTo: row.periodTo ?? '',
          };
        default:
          throw new Error(`The book reads ${row.kind} documents with S12's billings`);
      }
    });
  });
}

/**
 * Every line quantity the company holds (S12 rules 4–6): its entry by posting order, its line by
 * account, currency and amount, its material by code, unit, quantity and unit price.
 */
export function quantities(context: CaseContext): Promise<ObservedQuantity[]> {
  return withCompany(context.database.app, context.companyId, async (tx) => {
    const { sequenceOf } = await postingOrder(tx);
    const rows = await tx
      .select({
        entryId: lineQuantities.entryId,
        account: chartAccounts.code,
        currency: journalLines.currency,
        amount: journalLines.amountMinor,
        material: materialsTable.code,
        unit: lineQuantities.unit,
        quantity: lineQuantities.quantity,
        unitPrice: lineQuantities.unitPrice,
      })
      .from(lineQuantities)
      .innerJoin(
        journalLines,
        and(
          eq(journalLines.companyId, lineQuantities.companyId),
          eq(journalLines.id, lineQuantities.lineId),
        ),
      )
      .innerJoin(
        chartAccounts,
        and(
          eq(chartAccounts.companyId, journalLines.companyId),
          eq(chartAccounts.id, journalLines.accountId),
        ),
      )
      .leftJoin(
        materialsTable,
        and(
          eq(materialsTable.companyId, lineQuantities.companyId),
          eq(materialsTable.id, lineQuantities.materialId),
        ),
      );
    return rows.map((row) => ({
      entry: sequenceOf(row.entryId),
      account: row.account,
      currency: row.currency as ObservedQuantity['currency'],
      amount: row.amount,
      material: row.material,
      unit: row.unit,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
    }));
  });
}

/** A line's amount from its quantity (S12 rule 6), for a manual or voucher line typed without one. */
export function amountOfQuantity(
  quantity: string,
  unitPrice: string,
  currency: Parameters<typeof lineAmount>[2],
): bigint {
  return lineAmount(quantity, unitPrice, currency).amountMinor;
}
