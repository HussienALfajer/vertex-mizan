import {
  DomainError,
  type ServiceDepartment,
  type ServiceDepartmentHistory,
  type SetServiceDepartment,
} from '@vertex-mizan/contracts';
import { departmentInForce, periodOf, type ServiceDepartmentRow } from '@vertex-mizan/ledger';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { isClosedPeriod, readClosedPeriods } from '../posting/periods.js';
import { users } from '../schema/access.js';
import { dimensionTypes, dimensionValues, serviceDepartments } from '../schema/dimensions.js';

/**
 * A service's dated department (S09 rules 32–34): the history a profitability by department
 * reads, the accountant's row for a manual service, and the row a Hub event's service starts. The
 * guards of 0047 hold the same rules in the database.
 */

/** The dated departments of some services, or of every one, for `departmentInForce()`. */
export async function readServiceDepartmentRows(
  tx: Transaction,
  serviceIds?: readonly string[],
): Promise<ServiceDepartmentRow[]> {
  if (serviceIds !== undefined && serviceIds.length === 0) return [];
  const rows = await tx
    .select({
      serviceId: serviceDepartments.serviceValueId,
      departmentId: serviceDepartments.departmentValueId,
      effectiveFrom: serviceDepartments.effectiveFrom,
      createdAt: serviceDepartments.createdAt,
      id: serviceDepartments.id,
    })
    .from(serviceDepartments)
    .where(
      serviceIds === undefined
        ? undefined
        : inArray(serviceDepartments.serviceValueId, [...serviceIds]),
    )
    .orderBy(
      asc(serviceDepartments.effectiveFrom),
      asc(serviceDepartments.createdAt),
      asc(serviceDepartments.id),
    );
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** A value of a built-in type, or null. */
async function builtinValue(tx: Transaction, valueId: string, type: 'service' | 'department') {
  const [found] = await tx
    .select({
      id: dimensionValues.id,
      code: dimensionValues.code,
      name: dimensionValues.name,
      externalSource: dimensionValues.externalSource,
      archivedAt: dimensionValues.archivedAt,
    })
    .from(dimensionValues)
    .innerJoin(dimensionTypes, eq(dimensionTypes.id, dimensionValues.typeId))
    .where(
      and(
        eq(dimensionValues.id, valueId),
        eq(dimensionTypes.code, type),
        eq(dimensionTypes.builtin, true),
      ),
    );
  return found ?? null;
}

const valueRef = (value: {
  id: string;
  code: string | null;
  name: string;
  archivedAt: Date | null;
}) => ({ id: value.id, code: value.code, name: value.name, archived: value.archivedAt !== null });

/** `GET /api/dimension-values/:id/departments`: a service's history, oldest first. */
export async function readServiceDepartments(
  tx: Transaction,
  serviceValueId: string,
): Promise<ServiceDepartmentHistory> {
  const service = await builtinValue(tx, serviceValueId, 'service');
  if (service === null) throw new DomainError('NOT_FOUND', 'No such service');
  const rows = await tx
    .select({
      row: serviceDepartments,
      department: dimensionValues,
      recorderName: users.name,
    })
    .from(serviceDepartments)
    .innerJoin(dimensionValues, eq(dimensionValues.id, serviceDepartments.departmentValueId))
    .leftJoin(users, eq(users.id, serviceDepartments.recordedByUserId))
    .where(eq(serviceDepartments.serviceValueId, serviceValueId))
    .orderBy(
      asc(serviceDepartments.effectiveFrom),
      asc(serviceDepartments.createdAt),
      asc(serviceDepartments.id),
    );
  return {
    service: valueRef(service),
    fromHub: service.externalSource !== null,
    rows: rows.map(
      ({ row, department, recorderName }): ServiceDepartment => ({
        id: row.id,
        department: valueRef(department),
        effectiveFrom: row.effectiveFrom,
        source: row.source as ServiceDepartment['source'],
        inboundEventId: row.inboundEventId,
        recordedBy:
          row.recordedByUserId === null
            ? null
            : { id: row.recordedByUserId, name: recorderName ?? '' },
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      }),
    ),
  };
}

/** The department in force for a service on a date, from its stored rows. */
async function inForce(tx: Transaction, serviceId: string, on: string): Promise<string | null> {
  return departmentInForce(await readServiceDepartmentRows(tx, [serviceId]), serviceId, on);
}

/**
 * `POST /api/dimension-values/:id/departments` (rule 34): a manual service's department from a
 * date in an open month, with a reason, by a person; audited `service_department.set` with the
 * department in force before.
 */
export async function setServiceDepartment(
  tx: Transaction,
  input: SetServiceDepartment & { readonly serviceValueId: string; readonly actor: AuditActor },
): Promise<ServiceDepartmentHistory> {
  if (input.actor.kind !== 'person') throw new TypeError('A person sets a manual department');
  const service = await builtinValue(tx, input.serviceValueId, 'service');
  if (service === null) throw new DomainError('NOT_FOUND', 'No such service');
  if (service.externalSource !== null) {
    throw new DomainError('DIMENSION_FROM_HUB', "A Hub service's department comes from Hub");
  }
  const department = await builtinValue(tx, input.departmentValueId, 'department');
  if (department === null || department.archivedAt !== null) {
    throw new DomainError('VALIDATION_FAILED', 'Expected an active department value', {
      field: 'departmentValueId',
    });
  }
  if (isClosedPeriod(await readClosedPeriods(tx), periodOf(input.effectiveFrom))) {
    throw new DomainError('PERIOD_CLOSED', 'A department takes effect in an open month', {
      period: periodOf(input.effectiveFrom),
    });
  }
  const before = await inForce(tx, service.id, input.effectiveFrom);
  const [row] = await tx
    .insert(serviceDepartments)
    .values({
      companyId: await companyOf(tx, service.id),
      serviceValueId: service.id,
      departmentValueId: department.id,
      effectiveFrom: input.effectiveFrom,
      source: 'manual',
      recordedByUserId: input.actor.userId,
      reason: input.reason,
    })
    .returning();
  if (!row) throw new Error('The department row was not stored');
  await writeCompanyAudit(tx, row.companyId, input.actor, {
    action: 'service_department.set',
    entityType: 'service_department',
    entityId: row.id,
    reason: input.reason,
    before: { serviceValueId: service.id, departmentValueId: before },
    after: {
      serviceValueId: service.id,
      departmentValueId: department.id,
      effectiveFrom: input.effectiveFrom,
      source: 'manual',
    },
  });
  return readServiceDepartments(tx, service.id);
}

async function companyOf(tx: Transaction, valueId: string): Promise<string> {
  const [found] = await tx
    .select({ companyId: dimensionValues.companyId })
    .from(dimensionValues)
    .where(eq(dimensionValues.id, valueId));
  if (!found) throw new Error('A value read back without its company');
  return found.companyId;
}
