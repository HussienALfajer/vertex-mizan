import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { archivedAt, companyId, createdAt, id, idIsUuidV7, updatedAt } from './columns.js';
import { companies } from './companies.js';

// The dimensions module (S02, ADR 0011): dimension types and their values, company tables under
// forced RLS. The built-in types (client, contract under client, department, service) are made
// with every company by `create_company_chart_roots()` (migration 0008). Rules that read other
// rows (a contract's client, the type limit, Hub links never changing) are the triggers of 0008.

/**
 * `CONTRACT_KINDS` and `DIMENSION_EXTERNAL_SOURCES` of `@vertex-mizan/contracts`, which the checks
 * accept; a test keeps them equal.
 */
export const VALUE_CONTRACT_KINDS = ['project', 'retainer'] as const;
export const VALUE_EXTERNAL_SOURCES = ['hub'] as const;

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/** A dimension type: built in (codes never change) or custom; archived, never deleted. */
export const dimensionTypes = pgTable(
  'dimension_types',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    code: text().notNull(),
    builtin: boolean().notNull(),
    parentTypeId: uuid(),
    name: text().notNull(),
    nameLatin: text(),
    position: smallint().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('dimension_types', t.id),
    unique('dimension_types_company_id_id_key').on(t.companyId, t.id),
    unique('dimension_types_company_id_code_key').on(t.companyId, t.code),
    foreignKey({
      name: 'dimension_types_parent_fk',
      columns: [t.companyId, t.parentTypeId],
      foreignColumns: [t.companyId, t.id],
    }),
    index('dimension_types_company_parent_idx').on(t.companyId, t.parentTypeId),
    check('dimension_types_code_shape', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check('dimension_types_name_length', sql`char_length(${t.name}) between 1 and 100`),
    check(
      'dimension_types_name_latin_length',
      sql`${t.nameLatin} is null or char_length(${t.nameLatin}) between 1 and 100`,
    ),
    check('dimension_types_position', sql`${t.position} between 1 and 100`),
    check('dimension_types_custom_no_parent', sql`${t.builtin} or ${t.parentTypeId} is null`),
    check(
      'dimension_types_builtin_codes',
      sql`not ${t.builtin} or ${t.code} in ('client', 'contract', 'department', 'service')`,
    ),
    check('dimension_types_builtin_active', sql`not ${t.builtin} or ${t.archivedAt} is null`),
  ],
);

/**
 * A value of a dimension type: from Hub (matched by `(type, external_source, external_id)` only)
 * or added by hand, later linked to its Hub ID once. A contract value has its kind and its client.
 */
export const dimensionValues = pgTable(
  'dimension_values',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    typeId: uuid().notNull(),
    code: text(),
    name: text().notNull(),
    nameLatin: text(),
    contractKind: text(),
    parentValueId: uuid(),
    externalSource: text(),
    externalId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    idIsUuidV7('dimension_values', t.id),
    unique('dimension_values_company_id_id_key').on(t.companyId, t.id),
    // A dimension set names a value with its type (S03 `dimension_set_values`).
    unique('dimension_values_company_id_id_type_key').on(t.companyId, t.id, t.typeId),
    foreignKey({
      name: 'dimension_values_type_fk',
      columns: [t.companyId, t.typeId],
      foreignColumns: [dimensionTypes.companyId, dimensionTypes.id],
    }),
    foreignKey({
      name: 'dimension_values_parent_fk',
      columns: [t.companyId, t.parentValueId],
      foreignColumns: [t.companyId, t.id],
    }),
    index('dimension_values_company_type_name_idx').on(t.companyId, t.typeId, t.name),
    index('dimension_values_company_parent_idx').on(t.companyId, t.parentValueId),
    uniqueIndex('dimension_values_code_key')
      .on(t.companyId, t.typeId, t.code)
      .where(sql`${t.code} is not null`),
    uniqueIndex('dimension_values_external_key')
      .on(t.companyId, t.typeId, t.externalSource, t.externalId)
      .where(sql`${t.externalId} is not null`),
    check('dimension_values_name_length', sql`char_length(${t.name}) between 1 and 200`),
    check(
      'dimension_values_name_latin_length',
      sql`${t.nameLatin} is null or char_length(${t.nameLatin}) between 1 and 200`,
    ),
    check(
      'dimension_values_code_length',
      sql`${t.code} is null or char_length(${t.code}) between 1 and 40`,
    ),
    check(
      'dimension_values_contract_kind',
      sql`${t.contractKind} is null or ${t.contractKind} in (${listed(VALUE_CONTRACT_KINDS)})`,
    ),
    check(
      'dimension_values_external',
      sql`(${t.externalSource} is null) = (${t.externalId} is null)
        and (${t.externalSource} is null or ${t.externalSource} in (${listed(VALUE_EXTERNAL_SOURCES)}))
        and (${t.externalId} is null or char_length(${t.externalId}) between 1 and 100)`,
    ),
  ],
);
