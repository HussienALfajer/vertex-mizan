import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, createdAt, id, idIsUuidV7, updatedAt } from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES } from './companies.js';
import { dimensionValues } from './dimensions.js';
import { entryDrafts } from './drafts.js';
import { journalEntries, journalLines } from './ledger.js';
import { materials, projectDocumentKind, retentionSide } from './projects.js';

// Project documents (S12, ADR 0023): the documents the posting function writes with the entries of
// project document drafts, the gapless numbers it takes for them per kind and fiscal year, and the
// quantities and advance applications it writes beside the lines. All are written only by `post()`
// in the posting transaction (ADR 0005 invariant 11); the S12 projects migration guards them for
// every role.

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * The last project document number of a kind in a fiscal year (S12 rule 21), ledger state: made at
 * 1 and moved by one number at a time; every number it gives is taken by a document by commit.
 */
export const projectDocumentSequences = pgTable(
  'project_document_sequences',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    kind: projectDocumentKind().notNull(),
    fiscalYear: smallint().notNull(),
    lastNumber: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    idIsUuidV7('project_document_sequences', t.id),
    unique('project_document_sequences_key').on(t.companyId, t.kind, t.fiscalYear),
    check('project_document_sequences_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check('project_document_sequences_last_number', sql`${t.lastNumber} >= 1`),
  ],
);

/**
 * A posted project document (S12 "Data"), append-only: its kind and number in its fiscal year, its
 * date, its entry and draft, its project and counterparty, its currency and figures. A cancelled
 * document is one whose entry is reversed; the document itself never changes.
 */
export const projectDocuments = pgTable(
  'project_documents',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    kind: projectDocumentKind().notNull(),
    fiscalYear: smallint().notNull(),
    number: integer().notNull(),
    /** A billing's number within its project or subcontract (S12 rule 16). */
    projectSequence: integer(),
    documentDate: date().notNull(),
    entryId: uuid().notNull(),
    draftId: uuid().notNull(),
    contractValueId: uuid().notNull(),
    counterpartyValueId: uuid(),
    side: retentionSide(),
    currency: text().notNull(),
    periodFrom: date(),
    periodTo: date(),
    /** The sum of a purchase's or a sheet's lines; a billing's period's value; a release's amount. */
    totalMinor: bigint({ mode: 'bigint' }).notNull(),
    cumulativeMinor: bigint({ mode: 'bigint' }),
    previousMinor: bigint({ mode: 'bigint' }),
    retentionMinor: bigint({ mode: 'bigint' }),
    advanceMinor: bigint({ mode: 'bigint' }),
    supplierReference: text(),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('project_documents', t.id),
    unique('project_documents_company_id_id_key').on(t.companyId, t.id),
    unique('project_documents_number_key').on(t.companyId, t.kind, t.fiscalYear, t.number),
    unique('project_documents_entry_key').on(t.companyId, t.entryId),
    unique('project_documents_draft_key').on(t.companyId, t.draftId),
    uniqueIndex('project_documents_project_sequence_key')
      .on(t.companyId, t.contractValueId, t.counterpartyValueId, t.kind, t.projectSequence)
      .where(sql`${t.projectSequence} is not null`),
    foreignKey({
      name: 'project_documents_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'project_documents_draft_fk',
      columns: [t.companyId, t.draftId],
      foreignColumns: [entryDrafts.companyId, entryDrafts.id],
    }),
    foreignKey({
      name: 'project_documents_contract_value_fk',
      columns: [t.companyId, t.contractValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    foreignKey({
      name: 'project_documents_counterparty_value_fk',
      columns: [t.companyId, t.counterpartyValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    index('project_documents_company_contract_idx').on(
      t.companyId,
      t.contractValueId,
      t.documentDate,
    ),
    index('project_documents_company_counterparty_idx').on(t.companyId, t.counterpartyValueId),
    index('project_documents_company_date_idx').on(t.companyId, t.documentDate, t.id),
    check('project_documents_fiscal_year', sql`${t.fiscalYear} between 2000 and 9999`),
    check('project_documents_number', sql`${t.number} >= 1`),
    check(
      'project_documents_project_sequence',
      sql`(${t.projectSequence} is not null)
        = (${t.kind} in ('progress_billing', 'subcontract_billing'))
        and (${t.projectSequence} is null or ${t.projectSequence} >= 1)`,
    ),
    check('project_documents_currency', sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`),
    // Which fields a kind takes (S12 "Data"): a supplier on a purchase, a subcontract billing and a
    // supplier's release, none on a wage sheet; a period on a wage sheet only; a billing's figures
    // on a billing only; a side on a release only; the supplier's reference on a purchase only.
    check(
      'project_documents_kind_fields',
      sql`(${t.kind} <> 'wage_sheet' or ${t.counterpartyValueId} is null)
        and (${t.kind} not in ('purchase', 'subcontract_billing') or ${t.counterpartyValueId} is not null)
        and ((${t.periodFrom} is not null) = (${t.kind} = 'wage_sheet'))
        and ((${t.periodTo} is not null) = (${t.kind} = 'wage_sheet'))
        and (${t.periodFrom} is null or (${t.periodFrom} <= ${t.periodTo}
          and date_trunc('month', ${t.periodFrom}) = date_trunc('month', ${t.periodTo})
          and ${t.periodTo} = ${t.documentDate}))
        and ((${t.cumulativeMinor} is not null)
          = (${t.kind} in ('progress_billing', 'subcontract_billing')))
        and ((${t.previousMinor} is not null) = (${t.cumulativeMinor} is not null))
        and ((${t.side} is not null) = (${t.kind} = 'retention_release'))
        and (${t.side} is distinct from 'supplier' or ${t.counterpartyValueId} is not null)
        and (${t.supplierReference} is null or (${t.kind} = 'purchase'
          and char_length(${t.supplierReference}) between 1 and 60))`,
    ),
    check(
      'project_documents_amounts',
      sql`${t.totalMinor} >= 0
        and (${t.retentionMinor} is null or ${t.retentionMinor} >= 0)
        and (${t.advanceMinor} is null or ${t.advanceMinor} >= 0)
        and (${t.cumulativeMinor} is null or ${t.cumulativeMinor} > ${t.previousMinor})`,
    ),
  ],
);

/**
 * A posted line's material and quantity (S12 rules 4–6), append-only: the material (none on a
 * wage sheet's days), its unit, the quantity, and the unit price, null exactly on a price
 * adjustment (a quantity of 0). `line_quantity_rules()` holds the line's amount to the rounded
 * product and the material to the account's requirement.
 */
export const lineQuantities = pgTable(
  'line_quantities',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    entryId: uuid().notNull(),
    lineId: uuid().notNull(),
    materialId: uuid(),
    unit: text().notNull(),
    quantity: numeric({ precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric({ precision: 18, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('line_quantities', t.id),
    unique('line_quantities_line_key').on(t.companyId, t.lineId),
    foreignKey({
      name: 'line_quantities_line_fk',
      columns: [t.companyId, t.lineId],
      foreignColumns: [journalLines.companyId, journalLines.id],
    }),
    foreignKey({
      name: 'line_quantities_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'line_quantities_material_fk',
      columns: [t.companyId, t.materialId],
      foreignColumns: [materials.companyId, materials.id],
    }),
    index('line_quantities_company_entry_idx').on(t.companyId, t.entryId),
    index('line_quantities_company_material_idx').on(t.companyId, t.materialId),
    check('line_quantities_unit_length', sql`char_length(${t.unit}) between 1 and 20`),
    check(
      'line_quantities_unit_price',
      sql`(${t.unitPrice} is null) = (${t.quantity} = 0)
        and (${t.unitPrice} is null or ${t.unitPrice} >= 0)
        and (${t.quantity} <> 0 or ${t.materialId} is not null)`,
    ),
  ],
);

/**
 * The part of a revenue or cost line an applied advance covers (S12 rule 12, IFRIC 22.8–9),
 * append-only: the clearing line on the advance's running item and the covered amounts it took.
 * `advance_applications_agree()`, deferred, holds the covered parts of a clearing line to its
 * amounts in every ledger.
 */
export const advanceApplications = pgTable(
  'advance_applications',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    entryId: uuid().notNull(),
    advanceLineId: uuid().notNull(),
    lineId: uuid().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    bookMinor: bigint({ mode: 'bigint' }).notNull(),
    parallelMinor: bigint({ mode: 'bigint' }),
    createdAt: createdAt(),
  },
  (t) => [
    idIsUuidV7('advance_applications', t.id),
    unique('advance_applications_line_key').on(t.companyId, t.lineId),
    foreignKey({
      name: 'advance_applications_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [journalEntries.companyId, journalEntries.id],
    }),
    foreignKey({
      name: 'advance_applications_advance_line_fk',
      columns: [t.companyId, t.advanceLineId],
      foreignColumns: [journalLines.companyId, journalLines.id],
    }),
    foreignKey({
      name: 'advance_applications_line_fk',
      columns: [t.companyId, t.lineId],
      foreignColumns: [journalLines.companyId, journalLines.id],
    }),
    index('advance_applications_company_entry_idx').on(t.companyId, t.entryId),
    index('advance_applications_company_advance_line_idx').on(t.companyId, t.advanceLineId),
    check('advance_applications_amount', sql`${t.amountMinor} <> 0`),
    check('advance_applications_lines', sql`${t.advanceLineId} <> ${t.lineId}`),
  ],
);
