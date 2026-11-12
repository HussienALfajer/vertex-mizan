import { type CreateDimensionValue, DomainError } from '@vertex-mizan/contracts';
import { and, eq } from 'drizzle-orm';
import { type AuditActor, writeCompanyAudit } from '../audit.js';
import type { Transaction } from '../client.js';
import { dimensionTypes, dimensionValues } from '../schema/dimensions.js';
import { onUniqueViolation } from '../unique-violation.js';

// The dimension writes that the API and the scenario book's setup share (S02 rules 9–13), in the
// caller's transaction and company context.

export type DimensionValueRow = typeof dimensionValues.$inferSelect;

/**
 * A new manual value of a dimension type (S02 rule 10): of a type of the company that is not
 * archived (`NOT_FOUND`), with a contract kind exactly on a built-in contract value
 * (`VALIDATION_FAILED`), a parent value of the type's parent type (`DIMENSION_PARENT_MISMATCH`,
 * read `FOR SHARE`), a code free in its type (`DIMENSION_CODE_TAKEN`), and its audit row.
 */
export async function createDimensionValue(
  tx: Transaction,
  companyId: string,
  input: CreateDimensionValue,
  actor: AuditActor,
): Promise<DimensionValueRow> {
  const [type] = await tx.select().from(dimensionTypes).where(eq(dimensionTypes.id, input.typeId));
  if (!type) throw new DomainError('NOT_FOUND', 'No such dimension type');
  if (type.archivedAt) throw new DomainError('NOT_FOUND', 'The type is archived');
  const isContract = type.builtin && type.code === 'contract';
  if ((input.contractKind !== null) !== isContract) {
    throw new DomainError('VALIDATION_FAILED', 'A contract kind exactly on contract values', {
      issues: [{ path: ['contractKind'], message: 'A contract kind exactly on contract values' }],
    });
  }
  if (input.parentValueId !== null) {
    if (type.parentTypeId === null) {
      throw new DomainError('DIMENSION_PARENT_MISMATCH', 'The type has no parent type');
    }
    const [parent] = await tx
      .select({ typeId: dimensionValues.typeId })
      .from(dimensionValues)
      .where(eq(dimensionValues.id, input.parentValueId))
      .for('share');
    if (!parent) throw new DomainError('NOT_FOUND', 'No such parent value');
    if (parent.typeId !== type.parentTypeId) {
      throw new DomainError('DIMENSION_PARENT_MISMATCH', 'The parent is of another type');
    }
  }
  const [row] = await onUniqueViolation(
    () =>
      tx
        .insert(dimensionValues)
        .values({
          companyId,
          typeId: type.id,
          code: input.code,
          name: input.name,
          nameLatin: input.nameLatin,
          contractKind: input.contractKind,
          parentValueId: input.parentValueId,
        })
        .returning(),
    { dimension_values_code_key: 'DIMENSION_CODE_TAKEN' },
  );
  if (!row) throw new Error('The value was not created');
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'dimension_value.created',
    entityType: 'dimension_value',
    entityId: row.id,
    after: {
      typeId: row.typeId,
      code: row.code,
      name: row.name,
      nameLatin: row.nameLatin,
      contractKind: row.contractKind,
      parentValueId: row.parentValueId,
    },
  });
  return row;
}

/**
 * Links a manual value to its Hub ID (S02 rule 11), once (`DIMENSION_ALREADY_LINKED`); an ID
 * another value of the type holds is refused (`DIMENSION_LINK_TAKEN`), also when a Hub event
 * claims it at the same time (edge case 2). A contract names its client first. With its
 * `dimension_value.linked` audit row, in the caller's transaction, the value locked by the caller.
 */
export async function linkDimensionValue(
  tx: Transaction,
  companyId: string,
  actor: AuditActor,
  row: DimensionValueRow,
  externalId: string,
): Promise<void> {
  if (row.externalId !== null) {
    throw new DomainError('DIMENSION_ALREADY_LINKED', 'The value is already linked');
  }
  const [type] = await tx.select().from(dimensionTypes).where(eq(dimensionTypes.id, row.typeId));
  if (!type) throw new DomainError('NOT_FOUND', 'No such dimension type');
  if (type.parentTypeId !== null && row.parentValueId === null) {
    throw new DomainError('VALIDATION_FAILED', 'A Hub contract names its client', {
      issues: [{ path: ['parentValueId'], message: 'Name the contract’s client before linking it' }],
    });
  }
  const [holder] = await tx
    .select({ id: dimensionValues.id })
    .from(dimensionValues)
    .where(
      and(
        eq(dimensionValues.typeId, row.typeId),
        eq(dimensionValues.externalSource, 'hub'),
        eq(dimensionValues.externalId, externalId),
      ),
    );
  if (holder) throw new DomainError('DIMENSION_LINK_TAKEN', 'Another value holds the ID');
  await onUniqueViolation(
    () =>
      tx
        .update(dimensionValues)
        .set({ externalSource: 'hub', externalId })
        .where(eq(dimensionValues.id, row.id)),
    { dimension_values_external_key: 'DIMENSION_LINK_TAKEN' },
  );
  await writeCompanyAudit(tx, companyId, actor, {
    action: 'dimension_value.linked',
    entityType: 'dimension_value',
    entityId: row.id,
    before: { externalSource: null, externalId: null },
    after: { externalSource: 'hub', externalId },
  });
}
