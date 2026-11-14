import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  type PgTableExtraConfigValue,
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

/** `SERVICE_DEPARTMENT_SOURCES` of `@vertex-mizan/contracts`; a test keeps them equal. */
export const DEPARTMENT_SOURCES = ['hub', 'manual'] as const;

/**
 * A service's department from a date (S09 rules 32–34), append-only: the department in force on a
 * date is the row with the latest `effective_from` on or before it, the latest `created_at` among
 * equals. From Hub with the event that sent it, or by hand for a service not from Hub, by the
 * accountant with a reason. The guards of 0047 check the values' types, the source and that
 * `effective_from` is not in a closed month.
 */
export const serviceDepartments = pgTable(
  'service_departments',
  {
    id: id(),
    companyId: companyId().references(() => companies.id),
    serviceValueId: uuid().notNull(),
    departmentValueId: uuid().notNull(),
    effectiveFrom: date().notNull(),
    source: text().notNull(),
    /**
     * The Hub event that sent a `hub` row: its inbox id, kept without a key since the inbox left
     * with Hub (ADR 0021).
     */
    inboundEventId: uuid(),
    // A person is a platform id, kept without a foreign key as the audit log does.
    recordedByUserId: uuid(),
    reason: text(),
    createdAt: createdAt(),
  },
  // Typed, so the cycle with inbox.ts does not make the table's type infer itself.
  (t): PgTableExtraConfigValue[] => [
    idIsUuidV7('service_departments', t.id),
    foreignKey({
      name: 'service_departments_service_fk',
      columns: [t.companyId, t.serviceValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    foreignKey({
      name: 'service_departments_department_fk',
      columns: [t.companyId, t.departmentValueId],
      foreignColumns: [dimensionValues.companyId, dimensionValues.id],
    }),
    index('service_departments_company_service_idx').on(
      t.companyId,
      t.serviceValueId,
      t.effectiveFrom,
      t.createdAt,
    ),
    index('service_departments_company_department_idx').on(t.companyId, t.departmentValueId),
    check('service_departments_source', sql`${t.source} in (${listed(DEPARTMENT_SOURCES)})`),
    check(
      'service_departments_source_actor',
      sql`(${t.source} = 'hub' and ${t.inboundEventId} is not null and ${t.recordedByUserId} is null)
        or (${t.source} = 'manual' and ${t.recordedByUserId} is not null
          and ${t.inboundEventId} is null and ${t.reason} is not null)`,
    ),
    check(
      'service_departments_reason_length',
      sql`${t.reason} is null or char_length(${t.reason}) between 1 and 500`,
    ),
  ],
);
