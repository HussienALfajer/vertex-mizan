import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { chartAccounts } from './chart.js';
import { archivedAt, companyId, createdAt, id, idIsUuidV7, updatedAt } from './columns.js';
import { companies, SETTINGS_CURRENCY_CODES } from './companies.js';
import { dimensionValues } from './dimensions.js';

// Projects (S12, ADR 0023): the materials catalogue, a project's terms and budget, and the
// subcontracts, all business data, edited and audited, archived rather than deleted; and the enums
// of project documents, which `drafts.ts` and `project-documents.ts` share. Company tables under
// forced RLS; the S12 projects migration guards them.

/**
 * `PROJECT_DOCUMENT_KINDS` of `@vertex-mizan/contracts` (S12, ADR 0023), the
 * `project_document_kind` enum of a project document draft and of `project_documents`; values are
 * never renamed. A test keeps them equal.
 */
export const projectDocumentKind = pgEnum('project_document_kind', [
  'purchase',
  'wage_sheet',
  'progress_billing',
  'subcontract_billing',
  'retention_release',
]);

/** `RETENTION_SIDES` of contracts (S12 rules 19–20): a retention release's side. */
export const retentionSide = pgEnum('retention_side', ['client', 'supplier']);

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * A material of the catalogue (S12 rule 3): a code, a name and a unit, which is locked once a
 * posted line names the material (`material_rules()`). An archived material is refused on new lines.
 */
export const materials = pgTable(
  'materials',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    code: text().notNull(),
    name: text().notNull(),
    nameLatin: text(),
    unit: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('materials', t.id),
    unique('materials_company_id_id_key').on(t.companyId, t.id),
    unique('materials_code_key').on(t.companyId, t.code),
    check('materials_code_length', sql`char_length(${t.code}) between 1 and 30`),
    check('materials_name_length', sql`char_length(${t.name}) between 1 and 200`),
    check(
      'materials_name_latin_length',
      sql`${t.nameLatin} is null or char_length(${t.nameLatin}) between 1 and 200`,
    ),
    check('materials_unit_length', sql`char_length(${t.unit}) between 1 and 20`),
  ],
);

/**
 * A project's terms (S12 rule 1, answer 8): the contract's currency and value and the rates of
 * retention and advance recovery in basis points; management data with no accounting effect. The
 * currency is locked after the project's first posted billing (`project_terms_rules()`).
 */
export const projectTerms = pgTable(
  'project_terms',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    contractValueId: uuid().notNull(),
    currency: text().notNull(),
    contractValueMinor: bigint({ mode: 'bigint' }).notNull(),
    retentionBp: integer().notNull(),
    advanceRecoveryBp: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('project_terms', t.id),
    unique('project_terms_company_id_id_key').on(t.companyId, t.id),
    unique('project_terms_contract_key').on(t.companyId, t.contractValueId),
    foreignKey({
      name: 'project_terms_contract_value_fk',
      columns: [t.companyId, t.contractValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    check('project_terms_currency', sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`),
    check('project_terms_contract_value', sql`${t.contractValueMinor} >= 0`),
    check(
      'project_terms_rates',
      sql`${t.retentionBp} between 0 and 10000 and ${t.advanceRecoveryBp} between 0 and 10000`,
    ),
  ],
);

/**
 * A project's budget on one direct-cost account, in its terms' currency (S12 answer 8). A line
 * taken out of the budget is archived; set again, it is restored.
 */
export const projectBudgets = pgTable(
  'project_budgets',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    contractValueId: uuid().notNull(),
    accountId: uuid().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('project_budgets', t.id),
    unique('project_budgets_key').on(t.companyId, t.contractValueId, t.accountId),
    foreignKey({
      name: 'project_budgets_terms_fk',
      columns: [t.companyId, t.contractValueId],
      foreignColumns: [projectTerms.companyId, projectTerms.contractValueId],
    }),
    foreignKey({
      name: 'project_budgets_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [chartAccounts.companyId, chartAccounts.id],
    }),
    index('project_budgets_company_account_idx').on(t.companyId, t.accountId),
    check('project_budgets_amount', sql`${t.amountMinor} >= 0`),
  ],
);

/**
 * A subcontract (S12 rule 2): a project and a supplier with the subcontract's currency, optional
 * value and rates; its currency locked after its first posted subcontract billing.
 */
export const subcontracts = pgTable(
  'subcontracts',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    contractValueId: uuid().notNull(),
    supplierValueId: uuid().notNull(),
    currency: text().notNull(),
    valueMinor: bigint({ mode: 'bigint' }),
    retentionBp: integer().notNull(),
    advanceRecoveryBp: integer().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('subcontracts', t.id),
    unique('subcontracts_company_id_id_key').on(t.companyId, t.id),
    unique('subcontracts_key').on(t.companyId, t.contractValueId, t.supplierValueId),
    foreignKey({
      name: 'subcontracts_contract_value_fk',
      columns: [t.companyId, t.contractValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    foreignKey({
      name: 'subcontracts_supplier_value_fk',
      columns: [t.companyId, t.supplierValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    index('subcontracts_company_supplier_idx').on(t.companyId, t.supplierValueId),
    check('subcontracts_currency', sql`${t.currency} in (${listed(SETTINGS_CURRENCY_CODES)})`),
    check('subcontracts_value', sql`${t.valueMinor} is null or ${t.valueMinor} >= 0`),
    check(
      'subcontracts_rates',
      sql`${t.retentionBp} between 0 and 10000 and ${t.advanceRecoveryBp} between 0 and 10000`,
    ),
  ],
);
