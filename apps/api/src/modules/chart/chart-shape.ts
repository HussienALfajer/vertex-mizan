import type { Account, AccountRole, CurrencyCode } from '@vertex-mizan/contracts';
import {
  type AccountRow,
  accountRequiredDimensions,
  accountRoles,
  chartAccounts,
  dimensionTypes,
  type Transaction,
} from '@vertex-mizan/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { CodedException } from '../../core/errors/coded-exception.js';

export { type AccountRow, applyChartTemplate, levelOf } from '@vertex-mizan/db';

/** An account row with its active required dimension types and roles, as the API answers it. */
export function accountOf(
  row: AccountRow,
  requiredDimensionTypeIds: readonly string[],
  roles: readonly AccountRole[],
): Account {
  return {
    id: row.id,
    code: row.code,
    level: row.level,
    parentId: row.parentId,
    kind: row.kind as Account['kind'],
    class: row.class as Account['class'],
    name: row.name,
    nameLatin: row.nameLatin,
    normalBalance: row.normalBalance as Account['normalBalance'],
    statementLine: row.statementLine,
    currency: row.currency as CurrencyCode | null,
    isControl: row.isControl,
    isMonetary: row.isMonetary,
    requiredDimensionTypeIds: [...requiredDimensionTypeIds],
    roles: [...roles],
    blocked:
      row.blockedAt && row.blockedReason
        ? { at: row.blockedAt.toISOString(), reason: row.blockedReason }
        : null,
    archived:
      row.archivedAt && row.archivedReason
        ? { at: row.archivedAt.toISOString(), reason: row.archivedReason }
        : null,
    firstPostedAt: row.firstPostedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Each account's active required dimension types and roles, in the company context of `tx`. */
async function linksOf(
  tx: Transaction,
  accountIds?: readonly string[],
): Promise<{ dimensions: Map<string, string[]>; roles: Map<string, AccountRole[]> }> {
  const only = (
    column: typeof accountRoles.accountId | typeof accountRequiredDimensions.accountId,
  ) => (accountIds === undefined ? undefined : inArray(column, [...accountIds]));
  const dimensionRows = await tx
    .select({
      accountId: accountRequiredDimensions.accountId,
      typeId: accountRequiredDimensions.dimensionTypeId,
    })
    .from(accountRequiredDimensions)
    .innerJoin(
      dimensionTypes,
      and(
        eq(dimensionTypes.companyId, accountRequiredDimensions.companyId),
        eq(dimensionTypes.id, accountRequiredDimensions.dimensionTypeId),
      ),
    )
    .where(
      and(isNull(accountRequiredDimensions.archivedAt), only(accountRequiredDimensions.accountId)),
    )
    .orderBy(asc(dimensionTypes.position), asc(dimensionTypes.id));
  const roleRows = await tx
    .select({ accountId: accountRoles.accountId, role: accountRoles.role })
    .from(accountRoles)
    .where(and(isNull(accountRoles.archivedAt), only(accountRoles.accountId)))
    .orderBy(asc(accountRoles.role));
  const dimensions = new Map<string, string[]>();
  for (const row of dimensionRows) {
    dimensions.set(row.accountId, [...(dimensions.get(row.accountId) ?? []), row.typeId]);
  }
  const roles = new Map<string, AccountRole[]>();
  for (const row of roleRows) {
    roles.set(row.accountId, [...(roles.get(row.accountId) ?? []), row.role]);
  }
  return { dimensions, roles };
}

/** The whole chart in code order, archived accounts only when asked (`GET /api/accounts`). */
export async function readChart(tx: Transaction, includeArchived: boolean): Promise<Account[]> {
  const rows = await tx
    .select()
    .from(chartAccounts)
    .where(includeArchived ? undefined : isNull(chartAccounts.archivedAt))
    .orderBy(asc(chartAccounts.code));
  const { dimensions, roles } = await linksOf(tx);
  return rows.map((row) => accountOf(row, dimensions.get(row.id) ?? [], roles.get(row.id) ?? []));
}

/** One account of the company's chart; another company's id answers like an unknown one. */
export async function readAccount(tx: Transaction, id: string): Promise<Account> {
  const [row] = await tx.select().from(chartAccounts).where(eq(chartAccounts.id, id));
  if (!row) throw new CodedException('NOT_FOUND', 'No such account');
  const { dimensions, roles } = await linksOf(tx, [id]);
  return accountOf(row, dimensions.get(id) ?? [], roles.get(id) ?? []);
}
