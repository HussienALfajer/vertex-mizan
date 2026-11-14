import { z } from 'zod';
import { cursorSchema } from './audit.js';
import { personRefSchema } from './wire.js';

/**
 * Dimensions (S02, ADR 0011): analysis tags a journal line carries. Four built-in types every
 * company has (client, contract under client, department, service), custom types up to
 * `DIMENSION_TYPE_LIMIT` active ones, and values added by hand. Values Hub fed before its removal
 * (ADR 0021) keep their Hub ID, read only.
 */

/** The built-in types: codes never change; posting rules (S05) and reports (S09) know them. */
export const BUILTIN_DIMENSION_TYPES = [
  { code: 'client', name: 'العميل', nameLatin: 'Client', parentCode: null, position: 1 },
  { code: 'contract', name: 'العقد', nameLatin: 'Contract', parentCode: 'client', position: 2 },
  { code: 'department', name: 'القسم', nameLatin: 'Department', parentCode: null, position: 3 },
  { code: 'service', name: 'الخدمة', nameLatin: 'Service', parentCode: null, position: 4 },
] as const;

export type BuiltinDimensionType = (typeof BUILTIN_DIMENSION_TYPES)[number]['code'];

/** At most this many active dimension types per company, built-in ones included. */
export const DIMENSION_TYPE_LIMIT = 10;

/** The kind of a contract value: a project or a retainer (IFRS 15.105, one contract dimension). */
export const CONTRACT_KINDS = ['project', 'retainer'] as const;

export const contractKindSchema = z.enum(CONTRACT_KINDS).meta({ id: 'ContractKind' });

export type ContractKind = z.infer<typeof contractKindSchema>;

/** Where a value's external ID comes from. */
export const DIMENSION_EXTERNAL_SOURCES = ['hub'] as const;

export const dimensionExternalSourceSchema = z
  .enum(DIMENSION_EXTERNAL_SOURCES)
  .meta({ id: 'DimensionExternalSource' });

export const dimensionTypeCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Expected lower case letters, digits and _')
  .meta({ id: 'DimensionTypeCode' });

const typeNameSchema = z.string().trim().min(1).max(100);

const valueNameSchema = z.string().trim().min(1).max(200);

/** The accountant's short code of a value. */
const valueCodeSchema = z.string().trim().min(1).max(40);

const timestampSchema = z.iso.datetime({ offset: true });

export const dimensionTypeSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    builtin: z.boolean(),
    parentTypeId: z.uuid().nullable(),
    name: z.string(),
    nameLatin: z.string().nullable(),
    position: z.int(),
    archivedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
  })
  .meta({ id: 'DimensionType' });

export type DimensionType = z.infer<typeof dimensionTypeSchema>;

/** `POST /api/dimension-types`: a custom type, with no parent type. */
export const createDimensionTypeSchema = z
  .object({
    code: dimensionTypeCodeSchema,
    name: typeNameSchema,
    nameLatin: typeNameSchema.nullable().default(null),
  })
  .meta({ id: 'CreateDimensionType' });

export type CreateDimensionType = z.infer<typeof createDimensionTypeSchema>;

/** `PATCH /api/dimension-types/:id`: the names and the position; a code never changes. */
export const updateDimensionTypeSchema = z
  .object({
    name: typeNameSchema.optional(),
    nameLatin: typeNameSchema.nullable().optional(),
    position: z.int().min(1).max(100).optional(),
  })
  .refine((change) => Object.values(change).some((value) => value !== undefined), {
    message: 'Nothing to change',
  })
  .meta({ id: 'UpdateDimensionType' });

export type UpdateDimensionType = z.infer<typeof updateDimensionTypeSchema>;

export const dimensionValueSchema = z
  .object({
    id: z.uuid(),
    typeId: z.uuid(),
    code: z.string().nullable(),
    name: z.string(),
    nameLatin: z.string().nullable(),
    contractKind: contractKindSchema.nullable(),
    parentValueId: z.uuid().nullable(),
    /** The parent value's current name (a contract's client), so a screen never looks it up. */
    parentName: z.string().nullable(),
    externalSource: dimensionExternalSourceSchema.nullable(),
    externalId: z.string().nullable(),
    archivedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
  })
  .meta({ id: 'DimensionValue' });

export type DimensionValue = z.infer<typeof dimensionValueSchema>;

/**
 * `POST /api/dimension-values`: a manual value. A contract value has its kind and may name its
 * client (`parentValueId`); other types have neither.
 */
export const createDimensionValueSchema = z
  .object({
    typeId: z.uuid(),
    code: valueCodeSchema.nullable().default(null),
    name: valueNameSchema,
    nameLatin: valueNameSchema.nullable().default(null),
    contractKind: contractKindSchema.nullable().default(null),
    parentValueId: z.uuid().nullable().default(null),
  })
  .meta({ id: 'CreateDimensionValue' });

export type CreateDimensionValue = z.infer<typeof createDimensionValueSchema>;

/** `PATCH /api/dimension-values/:id`: the names, the short code and a contract's client. */
export const updateDimensionValueSchema = z
  .object({
    code: valueCodeSchema.nullable().optional(),
    name: valueNameSchema.optional(),
    nameLatin: valueNameSchema.nullable().optional(),
    parentValueId: z.uuid().nullable().optional(),
  })
  .refine((change) => Object.values(change).some((value) => value !== undefined), {
    message: 'Nothing to change',
  })
  .meta({ id: 'UpdateDimensionValue' });

export type UpdateDimensionValue = z.infer<typeof updateDimensionValueSchema>;

/** `GET /api/dimension-values`: one type's values, searched by code or name. */
export const dimensionValueQuerySchema = z
  .object({
    typeId: z.uuid(),
    q: z.string().trim().min(1).max(100).optional(),
    includeArchived: z.enum(['true', 'false']).optional(),
    cursor: cursorSchema.optional(),
  })
  .meta({ id: 'DimensionValueQuery' });

export type DimensionValueQuery = z.infer<typeof dimensionValueQuerySchema>;

export const dimensionValuePageSchema = z
  .object({ values: z.array(dimensionValueSchema), nextCursor: cursorSchema.nullable() })
  .meta({ id: 'DimensionValuePage' });

export type DimensionValuePage = z.infer<typeof dimensionValuePageSchema>;

/** Where a service's dated department came from (S09 rules 33, 34). */
export const SERVICE_DEPARTMENT_SOURCES = ['hub', 'manual'] as const;

export const serviceDepartmentSourceSchema = z
  .enum(SERVICE_DEPARTMENT_SOURCES)
  .meta({ id: 'ServiceDepartmentSource' });

/** A value a service's department history names: its id, code and name. */
const historyValueSchema = z.object({
  id: z.uuid(),
  code: z.string().nullable(),
  name: z.string(),
  archived: z.boolean(),
});

/**
 * One row of a service's department history: the department in force from `effectiveFrom`, the
 * latest row on or before a date deciding it, the latest `createdAt` among equals (S09 rule 32).
 */
export const serviceDepartmentSchema = z
  .object({
    id: z.uuid(),
    department: historyValueSchema,
    effectiveFrom: z.iso.date(),
    source: serviceDepartmentSourceSchema,
    /** The Hub event that sent it, from Hub. */
    inboundEventId: z.uuid().nullable(),
    /** The accountant who set it, by hand. */
    recordedBy: personRefSchema.nullable(),
    reason: z.string().nullable(),
    createdAt: timestampSchema,
  })
  .meta({ id: 'ServiceDepartment' });

export type ServiceDepartment = z.infer<typeof serviceDepartmentSchema>;

/** `GET /api/dimension-values/:id/departments`: a service's history, oldest first. */
export const serviceDepartmentHistorySchema = z
  .object({
    service: historyValueSchema,
    /** A service Hub made takes its department from Hub only (`DIMENSION_FROM_HUB`). */
    fromHub: z.boolean(),
    rows: z.array(serviceDepartmentSchema),
  })
  .meta({ id: 'ServiceDepartmentHistory' });

export type ServiceDepartmentHistory = z.infer<typeof serviceDepartmentHistorySchema>;

/** `POST /api/dimension-values/:id/departments`: a manual service's department from a date. */
export const setServiceDepartmentSchema = z
  .object({
    departmentValueId: z.uuid(),
    effectiveFrom: z.iso.date(),
    reason: z.string().trim().min(1).max(500),
  })
  .meta({ id: 'SetServiceDepartment' });

export type SetServiceDepartment = z.infer<typeof setServiceDepartmentSchema>;
