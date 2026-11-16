import { z } from 'zod';
import { cursorSchema } from './audit.js';
import { entrySchema } from './entries.js';
import { currencyCodeSchema } from './money.js';
import {
  coveredPartSchema,
  lineQuantitySchema,
  projectDocumentKindSchema,
  retentionSideSchema,
  unitSchema,
} from './project-documents.js';
import { entryNumberSchema, minorUnitsSchema } from './wire.js';

/**
 * Projects (S12, ADR 0023): the materials catalogue, a project's terms and budget, subcontracts,
 * and the project documents' reads. The header a project document draft carries is
 * `project-documents.ts`'s.
 */

/** Basis points: 0–10000 (10% is 1000), a rate of retention or advance recovery (S12 "Data"). */
export const basisPointsSchema = z.int().min(0).max(10_000);

const notNegativeMinor = minorUnitsSchema.refine(
  (text) => !text.startsWith('-'),
  'Never below zero',
);

const nameSchema = z.string().trim().min(1).max(200);

// ——— Materials ———

/** A material's code: 1–30 characters (S12 "Data"). */
export const materialCodeSchema = z.string().trim().min(1).max(30);

/** A material of the catalogue (`GET /api/materials`). */
export const materialSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    nameLatin: z.string().nullable(),
    unit: z.string(),
    /** Its unit is locked once a posted line names it (S12 rule 3). */
    used: z.boolean(),
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Material' });

export type Material = z.infer<typeof materialSchema>;

/** `POST /api/materials`. */
export const createMaterialSchema = z
  .object({
    code: materialCodeSchema,
    name: nameSchema,
    nameLatin: nameSchema.nullable().default(null),
    unit: unitSchema,
  })
  .meta({ id: 'CreateMaterial' });

export type CreateMaterial = z.infer<typeof createMaterialSchema>;

/** `PATCH /api/materials/:id`: the unit only before first use (`MATERIAL_LOCKED`). */
export const updateMaterialSchema = z
  .object({
    code: materialCodeSchema.optional(),
    name: nameSchema.optional(),
    nameLatin: nameSchema.nullable().optional(),
    unit: unitSchema.optional(),
  })
  .refine((change) => Object.values(change).some((value) => value !== undefined), {
    message: 'Nothing to change',
  })
  .meta({ id: 'UpdateMaterial' });

export type UpdateMaterial = z.infer<typeof updateMaterialSchema>;

/** `GET /api/materials`: by code, a search on code and names, archived only on request. */
export const materialQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    archived: z.enum(['true', 'false']).optional(),
    cursor: cursorSchema.optional(),
  })
  .meta({ id: 'MaterialQuery' });

export type MaterialQuery = z.infer<typeof materialQuerySchema>;

export const materialPageSchema = z
  .object({ materials: z.array(materialSchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'MaterialPage' });

export type MaterialPage = z.infer<typeof materialPageSchema>;

// ——— A project's terms and budget ———

/** A project's budget on one direct-cost account, in the terms' currency (S12 answer 8). */
export const budgetLineSchema = z
  .object({ accountId: z.uuid(), amountMinor: notNegativeMinor })
  .meta({ id: 'BudgetLine' });

export type BudgetLine = z.infer<typeof budgetLineSchema>;

/**
 * `PUT /api/projects/:valueId/terms`: the contract's currency and value, the retention and
 * advance-recovery rates, and the budget, each account once. The currency is locked after the
 * project's first posted billing (`PROJECT_TERMS_LOCKED`).
 */
export const projectTermsInputSchema = z
  .object({
    currency: currencyCodeSchema,
    contractValueMinor: notNegativeMinor,
    retentionBp: basisPointsSchema,
    advanceRecoveryBp: basisPointsSchema,
    budget: z
      .array(budgetLineSchema)
      .max(50)
      .refine(
        (lines) => new Set(lines.map((line) => line.accountId)).size === lines.length,
        'Each account once',
      )
      .default([]),
  })
  .meta({ id: 'ProjectTermsInput' });

export type ProjectTermsInput = z.infer<typeof projectTermsInputSchema>;

/** A project's terms as stored. */
export const projectTermsSchema = z
  .object({
    currency: currencyCodeSchema,
    contractValueMinor: minorUnitsSchema,
    retentionBp: basisPointsSchema,
    advanceRecoveryBp: basisPointsSchema,
    budget: z.array(budgetLineSchema),
    /** A posted billing locks the currency (S12 rule 1). */
    currencyLocked: z.boolean(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'ProjectTerms' });

export type ProjectTerms = z.infer<typeof projectTermsSchema>;

/** `GET /api/projects/:valueId/terms`: the project and its terms, null until they are set. */
export const projectTermsViewSchema = z
  .object({
    contractValueId: z.uuid(),
    code: z.string(),
    name: z.string(),
    clientValueId: z.uuid().nullable(),
    terms: projectTermsSchema.nullable(),
  })
  .meta({ id: 'ProjectTermsView' });

export type ProjectTermsView = z.infer<typeof projectTermsViewSchema>;

// ——— Subcontracts ———

/** A subcontract: a project and a supplier with its currency, value and rates (S12 rule 2). */
export const subcontractSchema = z
  .object({
    id: z.uuid(),
    contractValueId: z.uuid(),
    supplierValueId: z.uuid(),
    currency: currencyCodeSchema,
    valueMinor: minorUnitsSchema.nullable(),
    retentionBp: basisPointsSchema,
    advanceRecoveryBp: basisPointsSchema,
    currencyLocked: z.boolean(),
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Subcontract' });

export type Subcontract = z.infer<typeof subcontractSchema>;

/** `POST /api/subcontracts`. */
export const createSubcontractSchema = z
  .object({
    contractValueId: z.uuid(),
    supplierValueId: z.uuid(),
    currency: currencyCodeSchema,
    valueMinor: notNegativeMinor.nullable().default(null),
    retentionBp: basisPointsSchema,
    advanceRecoveryBp: basisPointsSchema,
  })
  .meta({ id: 'CreateSubcontract' });

export type CreateSubcontract = z.infer<typeof createSubcontractSchema>;

/** `PATCH /api/subcontracts/:id`: the currency only before its first posted billing. */
export const updateSubcontractSchema = z
  .object({
    currency: currencyCodeSchema.optional(),
    valueMinor: notNegativeMinor.nullable().optional(),
    retentionBp: basisPointsSchema.optional(),
    advanceRecoveryBp: basisPointsSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((change) => Object.values(change).some((value) => value !== undefined), {
    message: 'Nothing to change',
  })
  .meta({ id: 'UpdateSubcontract' });

export type UpdateSubcontract = z.infer<typeof updateSubcontractSchema>;

/** `GET /api/subcontracts`. */
export const subcontractQuerySchema = z
  .object({
    contract: z.uuid().optional(),
    supplier: z.uuid().optional(),
    archived: z.enum(['true', 'false']).optional(),
  })
  .meta({ id: 'SubcontractQuery' });

export type SubcontractQuery = z.infer<typeof subcontractQuerySchema>;

export const subcontractListSchema = z
  .object({ subcontracts: z.array(subcontractSchema) })
  .meta({ id: 'SubcontractList' });

export type SubcontractList = z.infer<typeof subcontractListSchema>;

// ——— Project documents ———

/** The states of a posted project document: cancelled once its entry is reversed (S12 rule 22). */
export const PROJECT_DOCUMENT_STATES = ['posted', 'cancelled'] as const;

/** `GET /api/project-documents`: newest first, pages of 100. */
export const projectDocumentQuerySchema = z
  .object({
    kind: projectDocumentKindSchema.optional(),
    contract: z.uuid().optional(),
    counterparty: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    state: z.enum(PROJECT_DOCUMENT_STATES).optional(),
    cursor: cursorSchema.optional(),
  })
  .meta({ id: 'ProjectDocumentQuery' });

export type ProjectDocumentQuery = z.infer<typeof projectDocumentQuerySchema>;

/** A row of the register of project documents. */
export const projectDocumentSummarySchema = z
  .object({
    id: z.uuid(),
    kind: projectDocumentKindSchema,
    fiscalYear: z.int(),
    number: z.int().min(1),
    /** A billing's number within its project or subcontract. */
    projectSequence: z.int().min(1).nullable(),
    documentDate: z.iso.date(),
    contractValueId: z.uuid(),
    counterpartyValueId: z.uuid().nullable(),
    side: retentionSideSchema.nullable(),
    currency: currencyCodeSchema,
    /** The document's total: the sum of a purchase's or a sheet's lines, a billing's period's value, a release's amount. */
    totalMinor: minorUnitsSchema,
    supplierReference: z.string().nullable(),
    entry: entryNumberSchema.extend({ id: z.uuid() }),
    /** The reversal that cancelled it (S12 rule 22). */
    cancelledBy: entryNumberSchema.extend({ id: z.uuid() }).nullable(),
  })
  .meta({ id: 'ProjectDocumentSummary' });

export type ProjectDocumentSummary = z.infer<typeof projectDocumentSummarySchema>;

export const projectDocumentPageSchema = z
  .object({
    documents: z.array(projectDocumentSummarySchema),
    nextCursor: cursorSchema.nullable(),
  })
  .meta({ id: 'ProjectDocumentPage' });

export type ProjectDocumentPage = z.infer<typeof projectDocumentPageSchema>;

/** A quantity row of a document's entry, with its line. */
export const documentQuantitySchema = z
  .object({ lineNo: z.int().min(1), ...lineQuantitySchema.shape })
  .meta({ id: 'DocumentQuantity' });

/** An advance application of a document's entry: the clearing line and the line it covers. */
export const advanceApplicationSchema = z
  .object({ advanceLineNo: z.int().min(1), lineNo: z.int().min(1), ...coveredPartSchema.shape })
  .meta({ id: 'AdvanceApplication' });

export type AdvanceApplication = z.infer<typeof advanceApplicationSchema>;

/** `GET /api/project-documents/:id`: the document with its entry, quantities and applications. */
export const projectDocumentSchema = z
  .object({
    ...projectDocumentSummarySchema.shape,
    periodFrom: z.iso.date().nullable(),
    periodTo: z.iso.date().nullable(),
    cumulativeMinor: minorUnitsSchema.nullable(),
    previousMinor: minorUnitsSchema.nullable(),
    retentionMinor: minorUnitsSchema.nullable(),
    advanceMinor: minorUnitsSchema.nullable(),
    entryDetail: entrySchema,
    quantities: z.array(documentQuantitySchema),
    applications: z.array(advanceApplicationSchema),
  })
  .meta({ id: 'ProjectDocument' });

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;

