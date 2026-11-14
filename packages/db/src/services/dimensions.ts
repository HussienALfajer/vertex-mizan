import { type CreateDimensionValue, DomainError } from '@vertex-mizan/contracts';
import { eq } from 'drizzle-orm';
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
