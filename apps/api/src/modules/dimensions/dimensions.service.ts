import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateDimensionType,
  type CreateDimensionValue,
  DIMENSION_TYPE_LIMIT,
  type DimensionType,
  type DimensionValue,
  type DimensionValuePage,
  type DimensionValueQuery,
  type UpdateDimensionType,
  type UpdateDimensionValue,
} from '@vertex-mizan/contracts';
import {
  accountRequiredDimensions,
  companySettings,
  type Database,
  dimensionTypes,
  dimensionValues,
  type Transaction,
  withCompany,
} from '@vertex-mizan/db';
import { and, asc, count, desc, eq, ilike, isNull, lt, max, or } from 'drizzle-orm';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { type AuditActor, changedFields, writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { onUniqueViolation } from '../../core/database/unique-violation.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { decodeCursor, pageOf } from '../../core/http/cursor.js';

type TypeRow = typeof dimensionTypes.$inferSelect;
type ValueRow = typeof dimensionValues.$inferSelect;

/** A page of values (S02 "Volume and performance": up to 50,000 per company). */
const PAGE_SIZE = 100;

function dimensionTypeOf(row: TypeRow): DimensionType {
  return {
    id: row.id,
    code: row.code,
    builtin: row.builtin,
    parentTypeId: row.parentTypeId,
    name: row.name,
    nameLatin: row.nameLatin,
    position: row.position,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function dimensionValueOf(row: ValueRow): DimensionValue {
  return {
    id: row.id,
    typeId: row.typeId,
    code: row.code,
    name: row.name,
    nameLatin: row.nameLatin,
    contractKind: row.contractKind as DimensionValue['contractKind'],
    parentValueId: row.parentValueId,
    externalSource: row.externalSource as DimensionValue['externalSource'],
    externalId: row.externalId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The `LIKE` pattern of a search text, its wildcards taken literally. */
function containing(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Dimension types and values (S02 "Dimensions", rules 9–13). */
@Injectable()
export class DimensionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/dimension-types`: every type, archived ones included, in position order. */
  async types(access: CompanyRouteAccess): Promise<DimensionType[]> {
    return withCompany(this.db, access.company.id, async (tx) => {
      const rows = await tx
        .select()
        .from(dimensionTypes)
        .orderBy(asc(dimensionTypes.position), asc(dimensionTypes.id));
      return rows.map(dimensionTypeOf);
    });
  }

  /**
   * `POST /api/dimension-types` (rule 9): a custom type, at most `DIMENSION_TYPE_LIMIT` active
   * (`DIMENSION_TYPE_LIMIT`), counted under the settings row's lock the database's own check takes.
   */
  async createType(access: CompanyRouteAccess, input: CreateDimensionType): Promise<DimensionType> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      await this.refuseOverLimit(tx);
      const [last] = await tx
        .select({ position: max(dimensionTypes.position) })
        .from(dimensionTypes);
      const [row] = await onUniqueViolation(
        () =>
          tx
            .insert(dimensionTypes)
            .values({
              companyId,
              code: input.code,
              builtin: false,
              name: input.name,
              nameLatin: input.nameLatin,
              position: Math.min((last?.position ?? 0) + 1, 100),
            })
            .returning(),
        { dimension_types_company_id_code_key: 'DIMENSION_CODE_TAKEN' },
      );
      if (!row) throw new Error('The type was not created');
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'dimension_type.created',
        entityType: 'dimension_type',
        entityId: row.id,
        after: { code: row.code, name: row.name, nameLatin: row.nameLatin, position: row.position },
      });
      return dimensionTypeOf(row);
    });
  }

  /** `PATCH /api/dimension-types/:id`: the names and the position; a code never changes. */
  async updateType(
    access: CompanyRouteAccess,
    id: string,
    change: UpdateDimensionType,
  ): Promise<DimensionType> {
    return this.changeType(access, id, async (tx, row, actor) => {
      const next = {
        name: change.name ?? row.name,
        nameLatin: change.nameLatin === undefined ? row.nameLatin : change.nameLatin,
        position: change.position ?? row.position,
      };
      const diff = changedFields(
        { name: row.name, nameLatin: row.nameLatin, position: row.position },
        next,
      );
      if (!diff) return;
      await tx.update(dimensionTypes).set(next).where(eq(dimensionTypes.id, id));
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'dimension_type.updated',
        entityType: 'dimension_type',
        entityId: id,
        ...diff,
      });
    });
  }

  /**
   * `POST /api/dimension-types/:id/archive` (rule 9): a custom type no account requires; a
   * built-in type is never archived (`DIMENSION_TYPE_IN_USE`).
   */
  async archiveType(access: CompanyRouteAccess, id: string): Promise<DimensionType> {
    return this.changeType(access, id, async (tx, row, actor) => {
      if (row.archivedAt) return;
      if (row.builtin) throw new CodedException('DIMENSION_TYPE_IN_USE', 'A built-in type');
      const [required] = await tx
        .select({ id: accountRequiredDimensions.id })
        .from(accountRequiredDimensions)
        .where(
          and(
            eq(accountRequiredDimensions.dimensionTypeId, id),
            isNull(accountRequiredDimensions.archivedAt),
          ),
        )
        .limit(1);
      if (required) throw new CodedException('DIMENSION_TYPE_IN_USE', 'An account requires it');
      await tx
        .update(dimensionTypes)
        .set({ archivedAt: new Date() })
        .where(eq(dimensionTypes.id, id));
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'dimension_type.archived',
        entityType: 'dimension_type',
        entityId: id,
        before: { archived: false },
        after: { archived: true },
      });
    });
  }

  /** `POST /api/dimension-types/:id/restore`: within the limit of active types. */
  async restoreType(access: CompanyRouteAccess, id: string): Promise<DimensionType> {
    return this.changeType(access, id, async (tx, row, actor) => {
      if (!row.archivedAt) return;
      await this.refuseOverLimit(tx);
      await tx.update(dimensionTypes).set({ archivedAt: null }).where(eq(dimensionTypes.id, id));
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'dimension_type.restored',
        entityType: 'dimension_type',
        entityId: id,
        before: { archived: true },
        after: { archived: false },
      });
    });
  }

  /**
   * `GET /api/dimension-values`: one type's values, newest first, searched by code or name
   * (case-insensitive, anywhere in the text); archived values only on request.
   */
  async values(
    access: CompanyRouteAccess,
    query: DimensionValueQuery,
  ): Promise<DimensionValuePage> {
    return withCompany(this.db, access.company.id, async (tx) => {
      await this.typeRow(tx, query.typeId);
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await tx
        .select()
        .from(dimensionValues)
        .where(
          and(
            eq(dimensionValues.typeId, query.typeId),
            query.includeArchived === 'true' ? undefined : isNull(dimensionValues.archivedAt),
            query.q
              ? or(
                  ilike(dimensionValues.name, containing(query.q)),
                  ilike(dimensionValues.code, containing(query.q)),
                  ilike(dimensionValues.nameLatin, containing(query.q)),
                )
              : undefined,
            after
              ? or(
                  lt(dimensionValues.createdAt, after.createdAt),
                  and(
                    eq(dimensionValues.createdAt, after.createdAt),
                    lt(dimensionValues.id, after.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(dimensionValues.createdAt), desc(dimensionValues.id))
        .limit(PAGE_SIZE + 1);
      const page = pageOf(rows, PAGE_SIZE, dimensionValueOf);
      return { values: page.entries, nextCursor: page.nextCursor };
    });
  }

  /**
   * `POST /api/dimension-values` (rule 11): a manual value of an unarchived type. A contract value
   * has its kind and may name its client (`DIMENSION_PARENT_MISMATCH` when the parent is not a
   * value of the parent type); other types carry neither.
   */
  async createValue(
    access: CompanyRouteAccess,
    input: CreateDimensionValue,
  ): Promise<DimensionValue> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const type = await this.typeRow(tx, input.typeId);
      if (type.archivedAt) throw new CodedException('NOT_FOUND', 'The type is archived');
      const isContract = type.builtin && type.code === 'contract';
      if ((input.contractKind !== null) !== isContract) {
        throw new CodedException(
          'VALIDATION_FAILED',
          'A contract kind exactly on contract values',
          [{ path: ['contractKind'], message: 'A contract kind exactly on contract values' }],
        );
      }
      await this.checkParent(tx, type, input.parentValueId);
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
      await writeCompanyAudit(tx, companyId, actorOf(access), {
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
      return dimensionValueOf(row);
    });
  }

  /**
   * `PATCH /api/dimension-values/:id` (rule 12): the names, the short code and a contract's
   * client. A Hub value is renamed again by Hub's next differing name (S05); a Hub contract keeps
   * a client.
   */
  async updateValue(
    access: CompanyRouteAccess,
    id: string,
    change: UpdateDimensionValue,
  ): Promise<DimensionValue> {
    return this.changeValue(access, id, async (tx, row, actor) => {
      const next = {
        code: change.code === undefined ? row.code : change.code,
        name: change.name ?? row.name,
        nameLatin: change.nameLatin === undefined ? row.nameLatin : change.nameLatin,
        parentValueId:
          change.parentValueId === undefined ? row.parentValueId : change.parentValueId,
      };
      if (next.parentValueId !== row.parentValueId) {
        const type = await this.typeRow(tx, row.typeId);
        if (next.parentValueId === null && row.externalId !== null && type.parentTypeId !== null) {
          throw new CodedException('VALIDATION_FAILED', 'A Hub contract names its client', [
            { path: ['parentValueId'], message: 'A Hub contract names its client' },
          ]);
        }
        await this.checkParent(tx, type, next.parentValueId);
      }
      const diff = changedFields(
        {
          code: row.code,
          name: row.name,
          nameLatin: row.nameLatin,
          parentValueId: row.parentValueId,
        },
        next,
      );
      if (!diff) return;
      await onUniqueViolation(
        () => tx.update(dimensionValues).set(next).where(eq(dimensionValues.id, id)),
        { dimension_values_code_key: 'DIMENSION_CODE_TAKEN' },
      );
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'dimension_value.updated',
        entityType: 'dimension_value',
        entityId: id,
        ...diff,
      });
    });
  }

  /**
   * `POST /api/dimension-values/:id/link` (rule 11): a manual value to its Hub ID, once
   * (`DIMENSION_ALREADY_LINKED`); an ID another value of the type holds is refused
   * (`DIMENSION_LINK_TAKEN`), also when a Hub event claims it at the same time (edge case 2).
   */
  async link(access: CompanyRouteAccess, id: string, externalId: string): Promise<DimensionValue> {
    return this.changeValue(access, id, async (tx, row, actor) => {
      if (row.externalId !== null) {
        throw new CodedException('DIMENSION_ALREADY_LINKED', 'The value is already linked');
      }
      const type = await this.typeRow(tx, row.typeId);
      if (type.parentTypeId !== null && row.parentValueId === null) {
        throw new CodedException('VALIDATION_FAILED', 'A Hub contract names its client', [
          { path: ['parentValueId'], message: 'Name the contract’s client before linking it' },
        ]);
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
      if (holder) throw new CodedException('DIMENSION_LINK_TAKEN', 'Another value holds the ID');
      await onUniqueViolation(
        () =>
          tx
            .update(dimensionValues)
            .set({ externalSource: 'hub', externalId })
            .where(eq(dimensionValues.id, id)),
        { dimension_values_external_key: 'DIMENSION_LINK_TAKEN' },
      );
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'dimension_value.linked',
        entityType: 'dimension_value',
        entityId: id,
        before: { externalSource: null, externalId: null },
        after: { externalSource: 'hub', externalId },
      });
    });
  }

  /** `POST /api/dimension-values/:id/archive` (rule 13): hidden from pickers, refused on manual lines. */
  async archiveValue(access: CompanyRouteAccess, id: string): Promise<DimensionValue> {
    return this.changeValue(access, id, async (tx, row, actor) => {
      if (row.archivedAt) return;
      await tx
        .update(dimensionValues)
        .set({ archivedAt: new Date() })
        .where(eq(dimensionValues.id, id));
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'dimension_value.archived',
        entityType: 'dimension_value',
        entityId: id,
        before: { archived: false },
        after: { archived: true },
      });
    });
  }

  /** `POST /api/dimension-values/:id/restore`. */
  async restoreValue(access: CompanyRouteAccess, id: string): Promise<DimensionValue> {
    return this.changeValue(access, id, async (tx, row, actor) => {
      if (!row.archivedAt) return;
      await tx.update(dimensionValues).set({ archivedAt: null }).where(eq(dimensionValues.id, id));
      await writeCompanyAudit(tx, access.company.id, actor, {
        action: 'dimension_value.restored',
        entityType: 'dimension_value',
        entityId: id,
        before: { archived: true },
        after: { archived: false },
      });
    });
  }

  /** At most `DIMENSION_TYPE_LIMIT` active types, counted under the settings row's lock. */
  private async refuseOverLimit(tx: Transaction): Promise<void> {
    await tx.select({ id: companySettings.id }).from(companySettings).for('update');
    const [active] = await tx
      .select({ types: count() })
      .from(dimensionTypes)
      .where(isNull(dimensionTypes.archivedAt));
    if ((active?.types ?? 0) >= DIMENSION_TYPE_LIMIT) {
      throw new CodedException('DIMENSION_TYPE_LIMIT', `At most ${DIMENSION_TYPE_LIMIT} types`);
    }
  }

  /** A contract's client: a value of the type's parent type (`DIMENSION_PARENT_MISMATCH`). */
  private async checkParent(tx: Transaction, type: TypeRow, parentValueId: string | null) {
    if (parentValueId === null) return;
    if (type.parentTypeId === null) {
      throw new CodedException('DIMENSION_PARENT_MISMATCH', 'The type has no parent type');
    }
    const [parent] = await tx
      .select({ typeId: dimensionValues.typeId })
      .from(dimensionValues)
      .where(eq(dimensionValues.id, parentValueId))
      .for('share');
    if (!parent) throw new CodedException('NOT_FOUND', 'No such parent value');
    if (parent.typeId !== type.parentTypeId) {
      throw new CodedException('DIMENSION_PARENT_MISMATCH', 'The parent is of another type');
    }
  }

  /** A type of the company; another company's id answers like an unknown one. */
  private async typeRow(tx: Transaction, id: string, lock = false): Promise<TypeRow> {
    const query = tx.select().from(dimensionTypes).where(eq(dimensionTypes.id, id));
    const [row] = lock ? await query.for('no key update') : await query;
    if (!row) throw new CodedException('NOT_FOUND', 'No such dimension type');
    return row;
  }

  private async changeType(
    access: CompanyRouteAccess,
    id: string,
    work: (tx: Transaction, row: TypeRow, actor: AuditActor) => Promise<void>,
  ): Promise<DimensionType> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      await work(tx, await this.typeRow(tx, id, true), actorOf(access));
      return dimensionTypeOf(await this.typeRow(tx, id));
    });
  }

  private async changeValue(
    access: CompanyRouteAccess,
    id: string,
    work: (tx: Transaction, row: ValueRow, actor: AuditActor) => Promise<void>,
  ): Promise<DimensionValue> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      const read = () => tx.select().from(dimensionValues).where(eq(dimensionValues.id, id));
      const [row] = await read().for('no key update');
      if (!row) throw new CodedException('NOT_FOUND', 'No such dimension value');
      await work(tx, row, actorOf(access));
      const [after] = await read();
      if (!after) throw new CodedException('NOT_FOUND', 'No such dimension value');
      return dimensionValueOf(after);
    });
  }
}
