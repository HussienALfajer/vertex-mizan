import { z } from 'zod';
import { currencyCodeSchema } from './money.js';
import { minorUnitsSchema } from './wire.js';

/**
 * A project document's header (S12 "Drafts", ADR 0023), which a draft carries beside its lines, and
 * the quantity and covered part a line carries. `entries.ts` adds them to the draft, preview and
 * entry schemas; `projects.ts` holds the master data and the documents' reads.
 */

/**
 * The kinds of a project document (S12 "In scope"), stored in the `project_document_kind` enum: a
 * value is never renamed, a new one appended. Each kind has its own numbers per fiscal year.
 */
export const PROJECT_DOCUMENT_KINDS = [
  'purchase',
  'wage_sheet',
  'progress_billing',
  'subcontract_billing',
  'retention_release',
] as const;

export const projectDocumentKindSchema = z
  .enum(PROJECT_DOCUMENT_KINDS)
  .meta({ id: 'ProjectDocumentKind' });

export type ProjectDocumentKind = z.infer<typeof projectDocumentKindSchema>;

/** The side of a retention release (S12 rules 19–20). */
export const RETENTION_SIDES = ['client', 'supplier'] as const;

export const retentionSideSchema = z.enum(RETENTION_SIDES).meta({ id: 'RetentionSide' });

export type RetentionSide = z.infer<typeof retentionSideSchema>;

/** The unit of a wage sheet's days (S12 rule 10). */
export const DAYS_UNIT = 'يوم';

/** A material's unit as typed: طن، م³، كيس، قطعة… (S12 "Data"). */
export const unitSchema = z.string().trim().min(1).max(20);

/** The supplier's own invoice number (S12 rule 7): 1–60 characters. */
export const supplierReferenceSchema = z.string().trim().min(1).max(60);

const notNegativeMinor = minorUnitsSchema.refine(
  (text) => !text.startsWith('-'),
  'Never below zero',
);

/** A client's retention item released, and how much of it (S12 rule 19). */
export const retentionItemReleaseSchema = z
  .object({ itemId: z.uuid(), amountMinor: notNegativeMinor })
  .meta({ id: 'RetentionItemRelease' });

export type RetentionItemRelease = z.infer<typeof retentionItemReleaseSchema>;

/**
 * A draft's project document header as typed (S12 "API": `projectDocument: { kind,
 * contractValueId, counterpartyValueId?, side?, periodFrom?, periodTo?, cumulativeMinor?,
 * retentionMinor?, advanceMinor?, supplierReference?, retentionItems? }`). The document's currency
 * is its lines' (a purchase, a wage sheet) or its terms' (a billing). Which fields a kind takes is
 * checked here; the rest (the project, the supplier, the period's month, the amounts against the
 * books) at submission and posting.
 */
export const projectDocumentHeaderInputSchema = z
  .object({
    kind: projectDocumentKindSchema,
    /** The project: a value of the `contract` dimension of kind `project` (S12 rule 1). */
    contractValueId: z.uuid(),
    /** The supplier of a purchase, a subcontract billing or a supplier's release. */
    counterpartyValueId: z.uuid().nullable().default(null),
    /** A wage sheet's or a purchase's currency; a billing's is its terms'. */
    currency: currencyCodeSchema.nullable().default(null),
    side: retentionSideSchema.nullable().default(null),
    periodFrom: z.iso.date().nullable().default(null),
    periodTo: z.iso.date().nullable().default(null),
    /** A billing's cumulative certified value to date (S12 rule 14). */
    cumulativeMinor: minorUnitsSchema.nullable().default(null),
    /** A billing's retention as changed by the accountant, or a supplier's release's amount. */
    retentionMinor: notNegativeMinor.nullable().default(null),
    /** The advance applied or recovered (S12 rule 12), as changed by the accountant. */
    advanceMinor: notNegativeMinor.nullable().default(null),
    supplierReference: supplierReferenceSchema.nullable().default(null),
    retentionItems: z.array(retentionItemReleaseSchema).max(100).nullable().default(null),
  })
  .superRefine((header, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', message, path: [path] });
    const { kind } = header;
    const takesSupplier =
      kind === 'purchase' ||
      kind === 'subcontract_billing' ||
      (kind === 'retention_release' && header.side === 'supplier');
    if (takesSupplier !== (header.counterpartyValueId !== null)) {
      issue(
        'counterpartyValueId',
        'A purchase, a subcontract billing and a supplier release, and only they, name the supplier',
      );
    }
    if ((kind === 'purchase' || kind === 'wage_sheet') !== (header.currency !== null)) {
      issue('currency', 'A purchase and a wage sheet, and only they, name their currency');
    }
    if ((kind === 'retention_release') !== (header.side !== null)) {
      issue('side', 'A retention release, and only it, has a side');
    }
    const wage = kind === 'wage_sheet';
    if (wage !== (header.periodFrom !== null) || wage !== (header.periodTo !== null)) {
      issue('periodFrom', 'A wage sheet, and only it, has a period');
    }
    if (
      header.periodFrom !== null &&
      header.periodTo !== null &&
      header.periodFrom > header.periodTo
    ) {
      issue('periodTo', 'A period ends on or after its start');
    }
    const billing = kind === 'progress_billing' || kind === 'subcontract_billing';
    if (!billing && header.cumulativeMinor !== null) {
      issue('cumulativeMinor', 'Only a billing has a cumulative value');
    }
    const supplierRelease = kind === 'retention_release' && header.side === 'supplier';
    if (!billing && !supplierRelease && header.retentionMinor !== null) {
      issue('retentionMinor', 'Only a billing or a supplier release has a retention amount');
    }
    if (kind !== 'purchase' && !billing && header.advanceMinor !== null) {
      issue('advanceMinor', 'Only a purchase or a billing applies an advance');
    }
    if (kind !== 'purchase' && header.supplierReference !== null) {
      issue('supplierReference', "Only a purchase has the supplier's reference");
    }
    const clientRelease = kind === 'retention_release' && header.side === 'client';
    if (!clientRelease && header.retentionItems !== null) {
      issue('retentionItems', 'Only a client release names retention items');
    }
  })
  .meta({ id: 'ProjectDocumentHeaderInput' });

export type ProjectDocumentHeaderInput = z.infer<typeof projectDocumentHeaderInputSchema>;

/** A draft's project document header as stored and returned. */
export const projectDocumentHeaderSchema = z
  .object({
    kind: projectDocumentKindSchema,
    contractValueId: z.uuid(),
    counterpartyValueId: z.uuid().nullable(),
    currency: currencyCodeSchema.nullable(),
    side: retentionSideSchema.nullable(),
    periodFrom: z.iso.date().nullable(),
    periodTo: z.iso.date().nullable(),
    cumulativeMinor: minorUnitsSchema.nullable(),
    retentionMinor: minorUnitsSchema.nullable(),
    advanceMinor: minorUnitsSchema.nullable(),
    supplierReference: z.string().nullable(),
    retentionItems: z.array(retentionItemReleaseSchema).nullable(),
  })
  .meta({ id: 'ProjectDocumentHeader' });

export type ProjectDocumentHeader = z.infer<typeof projectDocumentHeaderSchema>;

/** A line's quantity as stored and returned (`line_quantities`, or a draft line's). */
export const lineQuantitySchema = z
  .object({
    materialId: z.uuid().nullable(),
    unit: z.string(),
    quantity: z.string(),
    unitPrice: z.string().nullable(),
  })
  .meta({ id: 'LineQuantity' });

export type LineQuantity = z.infer<typeof lineQuantitySchema>;

/**
 * The part of a revenue or cost line an applied advance covers (S12 rule 12, IFRIC 22.8): its
 * transaction amount and the advance's carried book and parallel amounts it takes.
 */
export const coveredPartSchema = z
  .object({
    amountMinor: minorUnitsSchema,
    bookMinor: minorUnitsSchema,
    parallelMinor: minorUnitsSchema.nullable(),
  })
  .meta({ id: 'CoveredPart' });

export type CoveredPart = z.infer<typeof coveredPartSchema>;

/** The warnings a project document's preview shows and the posting accepts (S12 rules 8, 14). */
export const PROJECT_DOCUMENT_WARNINGS = [
  'duplicate_supplier_reference',
  'cumulative_above_contract_value',
] as const;

export const projectDocumentWarningSchema = z
  .enum(PROJECT_DOCUMENT_WARNINGS)
  .meta({ id: 'ProjectDocumentWarning' });

/**
 * What the preview of a project document draft adds (S12 "API"): its kind; a billing's previous
 * cumulative, period's value and deductions as they would post; the advance applied; the total and
 * the net; and the warnings.
 */
export const projectDocumentPreviewSchema = z
  .object({
    kind: projectDocumentKindSchema,
    currency: currencyCodeSchema.nullable(),
    totalMinor: minorUnitsSchema.nullable(),
    previousMinor: minorUnitsSchema.nullable(),
    periodValueMinor: minorUnitsSchema.nullable(),
    retentionMinor: minorUnitsSchema.nullable(),
    advanceMinor: minorUnitsSchema.nullable(),
    netMinor: minorUnitsSchema.nullable(),
    warnings: z.array(projectDocumentWarningSchema),
  })
  .meta({ id: 'ProjectDocumentPreview' });

export type ProjectDocumentPreview = z.infer<typeof projectDocumentPreviewSchema>;

/** A project document's number as printed: `<fiscal year>/<number>` in its kind (S12 "Printing"). */
export const projectDocumentNumberSchema = z
  .object({
    kind: projectDocumentKindSchema,
    fiscalYear: z.int().min(2000).max(9999),
    number: z.int().min(1),
  })
  .meta({ id: 'ProjectDocumentNumber' });

export type ProjectDocumentNumber = z.infer<typeof projectDocumentNumberSchema>;
