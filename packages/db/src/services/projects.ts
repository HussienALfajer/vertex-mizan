import {
  type CreateMaterial,
  type CreateSubcontract,
  type CurrencyCode,
  DomainError,
  type Material,
  type MaterialPage,
  type MaterialQuery,
  type ProjectDocumentKind,
  type ProjectDocumentQuery,
  type ProjectTermsInput,
  type ProjectTermsView,
  type Subcontract,
  type SubcontractQuery,
  type UpdateMaterial,
  type UpdateSubcontract,
} from '@vertex-mizan/contracts';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { chartAccounts } from '../schema/chart.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import { journalEntries, journalLines } from '../schema/ledger.js';
import {
  advanceApplications,
  lineQuantities,
  projectDocuments,
} from '../schema/project-documents.js';
import { materials, projectBudgets, projectTerms, subcontracts } from '../schema/projects.js';
import { onUniqueViolation } from '../unique-violation.js';

// Projects (S12, ADR 0023): the materials catalogue, a project's terms and budget, subcontracts,
// and the register of project documents, shared by the API and the scenario book's setups. Each
// write is audited in the caller's transaction; refusals are `DomainError`s.

const PAGE = 100;

function invalid(path: string[], message: string): never {
  throw new DomainError('VALIDATION_FAILED', message, { issues: [{ path, message }] });
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode<T>(cursor: string | undefined, valid: (value: unknown) => value is T): T | null {
  if (cursor === undefined) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (valid(value)) return value;
  } catch {
    // Answered below.
  }
  return invalid(['cursor'], 'Unknown cursor');
}

// ——— Materials (S12 rule 3) ———

type MaterialRow = typeof materials.$inferSelect;

async function usedMaterials(tx: Transaction, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ id: lineQuantities.materialId })
    .from(lineQuantities)
    .where(inArray(lineQuantities.materialId, [...ids]));
  return new Set(rows.flatMap((row) => (row.id === null ? [] : [row.id])));
}

function materialOf(row: MaterialRow, used: boolean): Material {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameLatin: row.nameLatin,
    unit: row.unit,
    used,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const audited = (row: MaterialRow) => ({
  code: row.code,
  name: row.name,
  nameLatin: row.nameLatin,
  unit: row.unit,
  archived: row.archivedAt !== null,
});

const MATERIAL_CODE_TAKEN = { materials_code_key: 'DIMENSION_CODE_TAKEN' } as const;

/** `GET /api/materials`: by code, a search on code and names, archived only on request. */
export async function readMaterials(tx: Transaction, query: MaterialQuery): Promise<MaterialPage> {
  const after = decode(
    query.cursor,
    (value): value is { code: string } => typeof (value as { code?: unknown })?.code === 'string',
  );
  const pattern = query.q === undefined ? null : `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await tx
    .select()
    .from(materials)
    .where(
      and(
        query.archived === 'true' ? isNotNull(materials.archivedAt) : isNull(materials.archivedAt),
        pattern === null
          ? undefined
          : or(
              ilike(materials.code, pattern),
              ilike(materials.name, pattern),
              ilike(materials.nameLatin, pattern),
            ),
        after === null ? undefined : gt(materials.code, after.code),
      ),
    )
    .orderBy(asc(materials.code))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const used = await usedMaterials(
    tx,
    page.map((row) => row.id),
  );
  const last = page.at(-1);
  return {
    materials: page.map((row) => materialOf(row, used.has(row.id))),
    nextCursor: rows.length > PAGE && last !== undefined ? encode({ code: last.code }) : null,
  };
}

/** A material of the company, locked for a change; another company's id answers as unknown. */
async function lockedMaterial(tx: Transaction, id: string): Promise<MaterialRow> {
  const [row] = await tx.select().from(materials).where(eq(materials.id, id)).for('update');
  if (!row) throw new DomainError('NOT_FOUND', 'No such material');
  return row;
}

/** `POST /api/materials`, audited `material.created`. */
export async function createMaterial(
  tx: Transaction,
  companyId: string,
  input: CreateMaterial,
  actor: AuditActor,
): Promise<Material> {
  const [row] = await onUniqueViolation(
    () =>
      tx
        .insert(materials)
        .values({
          companyId,
          code: input.code,
          name: input.name,
          nameLatin: input.nameLatin,
          unit: input.unit,
        })
        .returning(),
    MATERIAL_CODE_TAKEN,
  );
  if (!row) throw new Error('The material was not created');
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'material.created',
    entityType: 'material',
    entityId: row.id,
    after: audited(row),
  });
  return materialOf(row, false);
}

/**
 * `PATCH /api/materials/:id`, audited `material.updated` with before and after: the unit only
 * before a posted line names the material (`MATERIAL_LOCKED`, S12 rule 3).
 */
export async function updateMaterial(
  tx: Transaction,
  companyId: string,
  id: string,
  change: UpdateMaterial,
  actor: AuditActor,
): Promise<Material> {
  const before = await lockedMaterial(tx, id);
  const used = (await usedMaterials(tx, [id])).has(id);
  if (change.unit !== undefined && change.unit !== before.unit && used) {
    throw new DomainError('MATERIAL_LOCKED', 'The unit is locked since the first use', {
      material: before.code,
    });
  }
  const [row] = await onUniqueViolation(
    () =>
      tx
        .update(materials)
        .set({
          ...(change.code !== undefined && { code: change.code }),
          ...(change.name !== undefined && { name: change.name }),
          ...(change.nameLatin !== undefined && { nameLatin: change.nameLatin }),
          ...(change.unit !== undefined && { unit: change.unit }),
        })
        .where(eq(materials.id, id))
        .returning(),
    MATERIAL_CODE_TAKEN,
  );
  if (!row) throw new Error('The material was not updated');
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'material.updated',
    entityType: 'material',
    entityId: id,
    before: audited(before),
    after: audited(row),
  });
  return materialOf(row, used);
}

/** `POST /api/materials/:id/archive`, audited `material.archived`; its lines stay (edge case 20). */
export async function archiveMaterial(
  tx: Transaction,
  companyId: string,
  id: string,
  actor: AuditActor,
): Promise<Material> {
  const before = await lockedMaterial(tx, id);
  const used = (await usedMaterials(tx, [id])).has(id);
  if (before.archivedAt !== null) return materialOf(before, used);
  const [row] = await tx
    .update(materials)
    .set({ archivedAt: new Date() })
    .where(eq(materials.id, id))
    .returning();
  if (!row) throw new Error('The material was not archived');
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'material.archived',
    entityType: 'material',
    entityId: id,
    before: audited(before),
    after: audited(row),
  });
  return materialOf(row, used);
}

// ——— A project's terms and budget (S12 rule 1, answers 8 and 15) ———

/** A project: a value of the built-in `contract` type of kind `project` (`NOT_FOUND` otherwise). */
async function projectValue(tx: Transaction, valueId: string) {
  const [row] = await tx
    .select({
      id: dimensionValues.id,
      code: dimensionValues.code,
      name: dimensionValues.name,
      parentValueId: dimensionValues.parentValueId,
      contractKind: dimensionValues.contractKind,
      typeCode: dimensionTypes.code,
      builtin: dimensionTypes.builtin,
    })
    .from(dimensionValues)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, dimensionValues.companyId),
        eq(dimensionTypes.id, dimensionValues.typeId),
      ),
    )
    .where(eq(dimensionValues.id, valueId));
  if (!row?.builtin || row.typeCode !== 'contract' || row.contractKind !== 'project') {
    throw new DomainError('NOT_FOUND', 'No such project');
  }
  return row;
}

/** Whether a billing of the project (or of a supplier's subcontract on it) has posted. */
async function billed(
  tx: Transaction,
  contractValueId: string,
  kind: ProjectDocumentKind,
  supplierValueId?: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: projectDocuments.id })
    .from(projectDocuments)
    .where(
      and(
        eq(projectDocuments.contractValueId, contractValueId),
        eq(projectDocuments.kind, kind),
        supplierValueId === undefined
          ? undefined
          : eq(projectDocuments.counterpartyValueId, supplierValueId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** `GET /api/projects/:valueId/terms`: the project and its terms, null until they are set. */
export async function readProjectTerms(
  tx: Transaction,
  valueId: string,
): Promise<ProjectTermsView> {
  const project = await projectValue(tx, valueId);
  const [terms] = await tx
    .select()
    .from(projectTerms)
    .where(eq(projectTerms.contractValueId, valueId));
  const budget =
    terms === undefined
      ? []
      : await tx
          .select({ accountId: projectBudgets.accountId, amountMinor: projectBudgets.amountMinor })
          .from(projectBudgets)
          .innerJoin(
            chartAccounts,
            and(
              eq(chartAccounts.companyId, projectBudgets.companyId),
              eq(chartAccounts.id, projectBudgets.accountId),
            ),
          )
          .where(
            and(eq(projectBudgets.contractValueId, valueId), isNull(projectBudgets.archivedAt)),
          )
          .orderBy(asc(chartAccounts.code));
  return {
    contractValueId: project.id,
    code: project.code ?? '',
    name: project.name,
    clientValueId: project.parentValueId,
    terms:
      terms === undefined
        ? null
        : {
            currency: terms.currency as CurrencyCode,
            contractValueMinor: terms.contractValueMinor.toString(),
            retentionBp: terms.retentionBp,
            advanceRecoveryBp: terms.advanceRecoveryBp,
            budget: budget.map((line) => ({
              accountId: line.accountId,
              amountMinor: line.amountMinor.toString(),
            })),
            currencyLocked: await billed(tx, valueId, 'progress_billing'),
            updatedAt: terms.updatedAt.toISOString(),
          },
  };
}

/**
 * `PUT /api/projects/:valueId/terms` (S12 rule 1, answer 8): the terms made or changed, the budget
 * set to the lines given (others archived, a line given again restored), audited
 * `project_terms.updated` with before and after. The currency is locked after the project's first
 * posted billing (`PROJECT_TERMS_LOCKED`); a budget is on a postable direct-cost account
 * (`VALIDATION_FAILED`, edge case 22).
 */
export async function putProjectTerms(
  tx: Transaction,
  companyId: string,
  valueId: string,
  input: ProjectTermsInput,
  actor: AuditActor,
): Promise<ProjectTermsView> {
  await projectValue(tx, valueId);
  const before = await readProjectTerms(tx, valueId);
  const [locked] = await tx
    .select({ id: projectTerms.id, currency: projectTerms.currency })
    .from(projectTerms)
    .where(eq(projectTerms.contractValueId, valueId))
    .for('update');
  if (
    locked !== undefined &&
    locked.currency !== input.currency &&
    (await billed(tx, valueId, 'progress_billing'))
  ) {
    throw new DomainError(
      'PROJECT_TERMS_LOCKED',
      "The currency is locked since the project's first billing",
    );
  }
  const accountIds = input.budget.map((line) => line.accountId);
  const accounts =
    accountIds.length === 0
      ? []
      : await tx
          .select({
            id: chartAccounts.id,
            kind: chartAccounts.kind,
            statementLine: chartAccounts.statementLine,
          })
          .from(chartAccounts)
          .where(inArray(chartAccounts.id, accountIds));
  for (const [index, line] of input.budget.entries()) {
    const account = accounts.find((candidate) => candidate.id === line.accountId);
    if (account?.kind !== 'postable' || account.statementLine !== 'is.direct_costs') {
      invalid(
        ['budget', String(index), 'accountId'],
        'A budget is on a postable direct-cost account',
      );
    }
  }
  const values = {
    currency: input.currency,
    contractValueMinor: BigInt(input.contractValueMinor),
    retentionBp: input.retentionBp,
    advanceRecoveryBp: input.advanceRecoveryBp,
  };
  if (locked === undefined) {
    await tx.insert(projectTerms).values({ companyId, contractValueId: valueId, ...values });
  } else {
    await tx.update(projectTerms).set(values).where(eq(projectTerms.id, locked.id));
  }
  const stored = await tx
    .select()
    .from(projectBudgets)
    .where(eq(projectBudgets.contractValueId, valueId));
  for (const line of input.budget) {
    const row = stored.find((candidate) => candidate.accountId === line.accountId);
    const amountMinor = BigInt(line.amountMinor);
    if (row === undefined) {
      await tx
        .insert(projectBudgets)
        .values({ companyId, contractValueId: valueId, accountId: line.accountId, amountMinor });
    } else {
      await tx
        .update(projectBudgets)
        .set({ amountMinor, archivedAt: null })
        .where(eq(projectBudgets.id, row.id));
    }
  }
  for (const row of stored) {
    if (row.archivedAt === null && !accountIds.includes(row.accountId)) {
      await tx
        .update(projectBudgets)
        .set({ archivedAt: new Date() })
        .where(eq(projectBudgets.id, row.id));
    }
  }
  const after = await readProjectTerms(tx, valueId);
  const auditedTerms = (view: ProjectTermsView) =>
    view.terms === null
      ? null
      : {
          contractValueId: valueId,
          currency: view.terms.currency,
          contractValueMinor: view.terms.contractValueMinor,
          retentionBp: view.terms.retentionBp,
          advanceRecoveryBp: view.terms.advanceRecoveryBp,
          budget: view.terms.budget,
        };
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'project_terms.updated',
    entityType: 'project_terms',
    entityId: valueId,
    before: auditedTerms(before),
    after: auditedTerms(after),
  });
  return after;
}

// ——— Subcontracts (S12 rule 2) ———

type SubcontractRow = typeof subcontracts.$inferSelect;

async function subcontractOf(tx: Transaction, row: SubcontractRow): Promise<Subcontract> {
  return {
    id: row.id,
    contractValueId: row.contractValueId,
    supplierValueId: row.supplierValueId,
    currency: row.currency as CurrencyCode,
    valueMinor: row.valueMinor?.toString() ?? null,
    retentionBp: row.retentionBp,
    advanceRecoveryBp: row.advanceRecoveryBp,
    currencyLocked: await billed(
      tx,
      row.contractValueId,
      'subcontract_billing',
      row.supplierValueId,
    ),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const auditedSubcontract = (row: SubcontractRow) => ({
  contractValueId: row.contractValueId,
  supplierValueId: row.supplierValueId,
  currency: row.currency,
  valueMinor: row.valueMinor?.toString() ?? null,
  retentionBp: row.retentionBp,
  advanceRecoveryBp: row.advanceRecoveryBp,
  archived: row.archivedAt !== null,
});

/** `GET /api/subcontracts`: by project and supplier, archived only on request. */
export async function readSubcontracts(
  tx: Transaction,
  query: SubcontractQuery,
): Promise<Subcontract[]> {
  const rows = await tx
    .select()
    .from(subcontracts)
    .where(
      and(
        query.archived === 'true'
          ? isNotNull(subcontracts.archivedAt)
          : isNull(subcontracts.archivedAt),
        query.contract === undefined ? undefined : eq(subcontracts.contractValueId, query.contract),
        query.supplier === undefined ? undefined : eq(subcontracts.supplierValueId, query.supplier),
      ),
    )
    .orderBy(asc(subcontracts.createdAt), asc(subcontracts.id));
  const answer: Subcontract[] = [];
  for (const row of rows) answer.push(await subcontractOf(tx, row));
  return answer;
}

/**
 * `POST /api/subcontracts`, audited `subcontract.created`: a project and a supplier
 * (`VALIDATION_FAILED` otherwise), one subcontract per pair.
 */
export async function createSubcontract(
  tx: Transaction,
  companyId: string,
  input: CreateSubcontract,
  actor: AuditActor,
): Promise<Subcontract> {
  const project = await projectValue(tx, input.contractValueId).catch(() =>
    invalid(['contractValueId'], 'A subcontract is on a project'),
  );
  const [supplier] = await tx
    .select({ code: dimensionTypes.code, builtin: dimensionTypes.builtin })
    .from(dimensionValues)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, dimensionValues.companyId),
        eq(dimensionTypes.id, dimensionValues.typeId),
      ),
    )
    .where(eq(dimensionValues.id, input.supplierValueId));
  if (!supplier?.builtin || supplier.code !== 'supplier') {
    invalid(['supplierValueId'], 'A subcontract is with a supplier');
  }
  const [row] = await onUniqueViolation(
    () =>
      tx
        .insert(subcontracts)
        .values({
          companyId,
          contractValueId: project.id,
          supplierValueId: input.supplierValueId,
          currency: input.currency,
          valueMinor: input.valueMinor === null ? null : BigInt(input.valueMinor),
          retentionBp: input.retentionBp,
          advanceRecoveryBp: input.advanceRecoveryBp,
        })
        .returning(),
    { subcontracts_key: 'VALIDATION_FAILED' },
  );
  if (!row) throw new Error('The subcontract was not created');
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'subcontract.created',
    entityType: 'subcontract',
    entityId: row.id,
    after: auditedSubcontract(row),
  });
  return subcontractOf(tx, row);
}

/**
 * `PATCH /api/subcontracts/:id`, audited `subcontract.updated` with before and after; the currency
 * is locked after the subcontract's first posted billing (`PROJECT_TERMS_LOCKED`).
 */
export async function updateSubcontract(
  tx: Transaction,
  companyId: string,
  id: string,
  change: UpdateSubcontract,
  actor: AuditActor,
): Promise<Subcontract> {
  const [before] = await tx
    .select()
    .from(subcontracts)
    .where(eq(subcontracts.id, id))
    .for('update');
  if (!before) throw new DomainError('NOT_FOUND', 'No such subcontract');
  if (
    change.currency !== undefined &&
    change.currency !== before.currency &&
    (await billed(tx, before.contractValueId, 'subcontract_billing', before.supplierValueId))
  ) {
    throw new DomainError(
      'PROJECT_TERMS_LOCKED',
      "The currency is locked since the subcontract's first billing",
    );
  }
  const [row] = await tx
    .update(subcontracts)
    .set({
      ...(change.currency !== undefined && { currency: change.currency }),
      ...(change.valueMinor !== undefined && {
        valueMinor: change.valueMinor === null ? null : BigInt(change.valueMinor),
      }),
      ...(change.retentionBp !== undefined && { retentionBp: change.retentionBp }),
      ...(change.advanceRecoveryBp !== undefined && {
        advanceRecoveryBp: change.advanceRecoveryBp,
      }),
      ...(change.archived !== undefined && {
        archivedAt: change.archived ? (before.archivedAt ?? new Date()) : null,
      }),
    })
    .where(eq(subcontracts.id, id))
    .returning();
  if (!row) throw new Error('The subcontract was not updated');
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'subcontract.updated',
    entityType: 'subcontract',
    entityId: id,
    before: auditedSubcontract(before),
    after: auditedSubcontract(row),
  });
  return subcontractOf(tx, row);
}

// ——— The register of project documents (S12 "API") ———

/** A project document as the register reads it, with its entry's number and its cancelling one. */
export interface ProjectDocumentRow {
  readonly document: typeof projectDocuments.$inferSelect;
  readonly entry: { readonly id: string; readonly fiscalYear: number; readonly number: number };
  readonly cancelledBy: {
    readonly id: string;
    readonly fiscalYear: number;
    readonly number: number;
  } | null;
}

interface DocumentCursor {
  readonly date: string;
  readonly id: string;
}

const isDocumentCursor = (value: unknown): value is DocumentCursor =>
  typeof (value as DocumentCursor)?.date === 'string' &&
  typeof (value as DocumentCursor)?.id === 'string';

/** `GET /api/project-documents`: newest first, pages of 100, by kind, project, party, dates and state. */
export async function readProjectDocuments(
  tx: Transaction,
  query: ProjectDocumentQuery,
): Promise<{ rows: ProjectDocumentRow[]; nextCursor: string | null }> {
  const after = decode(query.cursor, isDocumentCursor);
  const reversal = sql`(select r.id from ${journalEntries} r
    where r.company_id = ${projectDocuments.companyId} and r.reverses_entry_id = ${projectDocuments.entryId})`;
  const rows = await tx
    .select({
      document: projectDocuments,
      entryFiscalYear: journalEntries.fiscalYear,
      entryNumber: journalEntries.number,
      reversalId: sql<string | null>`${reversal}`,
    })
    .from(projectDocuments)
    .innerJoin(
      journalEntries,
      and(
        eq(journalEntries.companyId, projectDocuments.companyId),
        eq(journalEntries.id, projectDocuments.entryId),
      ),
    )
    .where(
      and(
        query.kind === undefined ? undefined : eq(projectDocuments.kind, query.kind),
        query.contract === undefined
          ? undefined
          : eq(projectDocuments.contractValueId, query.contract),
        query.counterparty === undefined
          ? undefined
          : eq(projectDocuments.counterpartyValueId, query.counterparty),
        query.from === undefined
          ? undefined
          : sql`${projectDocuments.documentDate} >= ${query.from}`,
        query.to === undefined ? undefined : sql`${projectDocuments.documentDate} <= ${query.to}`,
        query.state === undefined
          ? undefined
          : query.state === 'cancelled'
            ? sql`${reversal} is not null`
            : sql`${reversal} is null`,
        after === null
          ? undefined
          : or(
              lt(projectDocuments.documentDate, after.date),
              and(eq(projectDocuments.documentDate, after.date), lt(projectDocuments.id, after.id)),
            ),
      ),
    )
    .orderBy(desc(projectDocuments.documentDate), desc(projectDocuments.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const reversalIds = page.flatMap((row) => (row.reversalId === null ? [] : [row.reversalId]));
  const reversals =
    reversalIds.length === 0
      ? []
      : await tx
          .select({
            id: journalEntries.id,
            fiscalYear: journalEntries.fiscalYear,
            number: journalEntries.number,
          })
          .from(journalEntries)
          .where(inArray(journalEntries.id, reversalIds));
  const last = page.at(-1)?.document;
  return {
    rows: page.map((row) => ({
      document: row.document,
      entry: { id: row.document.entryId, fiscalYear: row.entryFiscalYear, number: row.entryNumber },
      cancelledBy: reversals.find((candidate) => candidate.id === row.reversalId) ?? null,
    })),
    nextCursor:
      rows.length > PAGE && last !== undefined
        ? encode({ date: last.documentDate, id: last.id })
        : null,
  };
}

/** A document of the register by id, or by the draft that posted it; null when there is none. */
export async function readProjectDocument(
  tx: Transaction,
  by: { readonly id: string } | { readonly draftId: string },
): Promise<
  | (ProjectDocumentRow & {
      readonly quantities: (typeof lineQuantities.$inferSelect & { lineNo: number })[];
      readonly applications: (typeof advanceApplications.$inferSelect & {
        lineNo: number;
        advanceLineNo: number;
      })[];
    })
  | null
> {
  const [document] = await tx
    .select()
    .from(projectDocuments)
    .where('id' in by ? eq(projectDocuments.id, by.id) : eq(projectDocuments.draftId, by.draftId));
  if (!document) return null;
  const [entry] = await tx
    .select({
      id: journalEntries.id,
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
    })
    .from(journalEntries)
    .where(eq(journalEntries.id, document.entryId));
  const [cancelledBy] = await tx
    .select({
      id: journalEntries.id,
      fiscalYear: journalEntries.fiscalYear,
      number: journalEntries.number,
    })
    .from(journalEntries)
    .where(eq(journalEntries.reversesEntryId, document.entryId));
  if (!entry) throw new Error('A document without its entry');
  const lines = await tx
    .select({ id: journalLines.id, lineNo: journalLines.lineNo })
    .from(journalLines)
    .where(eq(journalLines.entryId, document.entryId));
  const lineNoOf = (id: string) => lines.find((line) => line.id === id)?.lineNo ?? 0;
  const quantities = await tx
    .select()
    .from(lineQuantities)
    .where(eq(lineQuantities.entryId, document.entryId));
  const applications = await tx
    .select()
    .from(advanceApplications)
    .where(eq(advanceApplications.entryId, document.entryId));
  return {
    document,
    entry,
    cancelledBy: cancelledBy ?? null,
    quantities: quantities
      .map((row) => ({ ...row, lineNo: lineNoOf(row.lineId) }))
      .sort((a, b) => a.lineNo - b.lineNo),
    applications: applications
      .map((row) => ({
        ...row,
        lineNo: lineNoOf(row.lineId),
        advanceLineNo: lineNoOf(row.advanceLineId),
      }))
      .sort((a, b) => a.lineNo - b.lineNo),
  };
}
